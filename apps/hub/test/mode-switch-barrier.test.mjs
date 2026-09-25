// Plan T30 — the switch's write barrier does not depend on an answer.
//
// The plan's Validate line lists "lost barrier response" among the failures a
// migration must survive. The honest answer is that this design removed the
// failure rather than handling it: `setMode` BROADCASTS a stateless notice,
// waits a fixed grace, and then fences per message. There is no response to
// lose, and a peer that never received the notice is fenced anyway on its very
// next message.
//
// That property is invisible in the code — a future change could easily make
// the switch await acknowledgements "to be safe" and reintroduce exactly the
// stall this avoids. So it is pinned here: a switch completes even when
// telling the peers fails outright.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createAcceptedRevisions } from '../src/project-transactions/hub-integration.mjs';

/** A store that records what it was asked, and answers like a durable one. */
function fakeStore() {
  let mode = 'legacy';
  let epoch = 0;
  return {
    durable: true,
    async state() {
      return { mode, epoch, revision: 0, importPending: false };
    },
    async setMode({ mode: next, expectEpoch }) {
      assert.equal(expectEpoch, epoch, 'the switch must be pinned to the epoch it read');
      mode = next;
      epoch += 1;
      return { mode, epoch, revision: 0, importPending: next === 'transactions' };
    },
    async manifest() {
      return { revision: 0, docs: [] };
    },
    // The real store clears the resume note here; an empty project has nothing
    // to import. Present so the switch can reach its last step at all — which
    // is the point: a broadcast that threw must not stop it getting there.
    async markImported() {},
  };
}

/** A store that has not answered yet — a cold cell's Durable Object. */
function silentStore() {
  return {
    durable: true,
    state() {
      return new Promise(() => {});
    },
    async manifest() {
      return { revision: 0, docs: [] };
    },
    async markImported() {},
  };
}

function coordinator({
  broadcast,
  store,
  browserUnpaired = false,
  docs = [],
  checkoutHasCanvases = () => false,
}) {
  // One writer connection per document, plus a viewer on the second.
  const conn = (readOnly) => ({ context: { user: { readOnly } }, sendStateless: broadcast });
  const documents = new Map([
    ['ws/local/main/ui-a', { getConnections: () => [conn(false)] }],
    ['ws/local/main/ui-b', { getConnections: () => [conn(false), conn(true)] }],
  ]);
  return createAcceptedRevisions({
    server: { hocuspocus: { documents } },
    store: store ?? fakeStore(),
    projectId: 'local',
    canvasGroups: () => [{ label: 'UI', path: 'ui' }],
    designRel: '.design',
    deleteDocument: () => {},
    reviveDocument: () => {},
    listDocuments: () => docs,
    tombstoned: () => [],
    checkoutPath: () => null,
    checkoutBody: () => null,
    checkoutDirs: () => [],
    storeDurable: true,
    browserUnpaired,
    checkoutHasCanvases,
    switchGraceMs: 0,
    log: { warn: () => {}, error: () => {}, log: () => {} },
  });
}

describe('a brand-new project starts in accepted revisions (G3a)', () => {
  test('an empty project switches itself at boot', async () => {
    const acc = coordinator({ broadcast() {} });
    const next = await acc.adoptNewProjectMode('transactions');
    assert.equal(next.mode, 'transactions');
    assert.equal((await acc.refresh()).mode, 'transactions');
  });

  test('a project with canvases — in the hub or in the checkout — waits for its owner', async () => {
    const withDocs = coordinator({ broadcast() {}, docs: [{ name: 'ws/local/main/ui-a' }] });
    assert.deepEqual(await withDocs.adoptNewProjectMode('transactions'), {
      skipped: 'has-canvases',
    });
    assert.equal((await withDocs.refresh()).mode, 'legacy');
    const withFiles = coordinator({ broadcast() {}, checkoutHasCanvases: () => true });
    assert.deepEqual(await withFiles.adoptNewProjectMode('transactions'), {
      skipped: 'has-canvases',
    });
    // The control document alone is not content.
    const ctlOnly = coordinator({ broadcast() {}, docs: [{ name: 'maude.files' }] });
    assert.equal((await ctlOnly.adoptNewProjectMode('transactions')).mode, 'transactions');
  });

  test('nothing happens unless asked, or once the project has ever switched, or without a paired browser studio', async () => {
    assert.equal(await coordinator({ broadcast() {} }).adoptNewProjectMode(undefined), null);
    const once = coordinator({ broadcast() {} });
    await once.setMode({ mode: 'transactions', expectEpoch: 0 });
    await once.setMode({ mode: 'legacy', expectEpoch: 1 });
    assert.equal(
      await once.adoptNewProjectMode('transactions'),
      null,
      'a rolled-back project stays where its owner put it'
    );
    const unpaired = coordinator({ broadcast() {}, browserUnpaired: true });
    assert.deepEqual(await unpaired.adoptNewProjectMode('transactions'), {
      skipped: 'browser-not-paired',
    });
    assert.equal((await unpaired.refresh()).mode, 'legacy');
  });
});

describe('a browser studio that is not a participant', () => {
  // F3 S09 (2026-09-25): on an accepted self-host without MAUDE_CELL_PAIRING,
  // a browser edit never became an accepted action.
  test('blocks the switch to accepted revisions, loudly and with its reason', async () => {
    const acc = coordinator({ broadcast() {}, browserUnpaired: true });
    await assert.rejects(acc.setMode({ mode: 'transactions', expectEpoch: 0 }), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, 'browser-not-paired');
      assert.match(err.message, /MAUDE_CELL_PAIRING/);
      return true;
    });
    assert.equal((await acc.refresh()).mode, 'legacy', 'nothing switched');
  });

  test('never blocks going back to legacy, and health names the state', async () => {
    const acc = coordinator({ broadcast() {}, browserUnpaired: true });
    await acc.refresh();
    assert.equal((await acc.setMode({ mode: 'legacy', expectEpoch: 0 })).mode, 'legacy');
    assert.equal(acc.health({ privileged: true }).browserPaired, false);
    assert.equal(coordinator({ broadcast() {} }).health({ privileged: true }).browserPaired, true);
  });
});

describe('the switch barrier needs no answer', () => {
  test('a peer that cannot be told still gets a completed switch', async () => {
    // Every document's notice throws — the worst case of "the barrier response
    // was lost", and then some: the notice never even left.
    const acc = coordinator({
      broadcast() {
        throw new Error('this peer is gone');
      },
    });
    const after = await acc.setMode({ mode: 'transactions', expectEpoch: 0 });
    assert.equal(after.mode, 'transactions');
    assert.equal(after.epoch, 1);
    // And the fence is on, for a connection that was open the whole time and
    // was never successfully told anything.
    const connection = { readOnly: false };
    acc.fence({ connection, context: { user: { readOnly: false } } });
    assert.equal(connection.readOnly, true, 'an untold peer is still fenced');
  });

  test('the notice is sent to every open document, and says what changed', async () => {
    const sent = [];
    const acc = coordinator({
      broadcast(payload) {
        sent.push(JSON.parse(payload));
      },
    });
    await acc.setMode({ mode: 'transactions', expectEpoch: 0 });
    assert.equal(sent.length, 3, 'every open connection of every document was told');
    assert.deepEqual(sent[0], {
      type: 'maude.mode',
      mode: 'transactions',
      epoch: 1,
      writable: false,
    });
  });

  // F3 S17 (2026-09-23): a desktop admitted read-only while the project took
  // proposals was never told it could write again after a rollback, and held
  // its legacy saves until it happened to reconnect.
  test('a switch back to legacy tells each connection whether it may write', async () => {
    const sent = [];
    const acc = coordinator({
      broadcast(payload) {
        sent.push(JSON.parse(payload));
      },
    });
    await acc.setMode({ mode: 'transactions', expectEpoch: 0 });
    sent.length = 0;
    await acc.setMode({ mode: 'legacy', expectEpoch: 1 });
    assert.deepEqual(
      sent.map((m) => [m.mode, m.writable]),
      [
        ['legacy', true],
        ['legacy', true],
        ['legacy', false], // the viewer stays a viewer
      ]
    );
  });

  test('switching back to legacy lifts the fence for a writer that has the right', async () => {
    const acc = coordinator({ broadcast: () => {} });
    await acc.setMode({ mode: 'transactions', expectEpoch: 0 });
    await acc.setMode({ mode: 'legacy', expectEpoch: 1 });
    const writer = { readOnly: true };
    acc.fence({ connection: writer, context: { user: { readOnly: false } } });
    assert.equal(writer.readOnly, false);
    // A viewer stays a viewer whatever the mode is.
    const viewer = { readOnly: false };
    acc.fence({ connection: viewer, context: { user: { readOnly: true } } });
    assert.equal(viewer.readOnly, true);
  });
});

describe('an unknown mode fences', () => {
  test('a peer that connects before the store answers cannot write', async () => {
    // The window this exists for: a cloud cell listens before its Durable
    // Object has said what mode the project is in. `state` still holds the
    // `legacy` default, so "not transactions" is an assumption. Observed on a
    // live cell — /health answered `mode: "legacy"` seconds after boot and
    // `transactions` moments later — and a peer reconnecting into that window
    // used to be handed a writable socket on a project that accepts only
    // proposals. Two writable authorities, which the design forbids outright.
    const acc = coordinator({ broadcast: () => {}, store: silentStore() });
    const connection = { readOnly: false };
    acc.fence({ connection, context: { user: { readOnly: false } } });
    assert.equal(connection.readOnly, true, 'an unread mode must fence');
  });

  test('health does not report the default as if it were a reading', () => {
    const acc = coordinator({ broadcast: () => {}, store: silentStore() });
    const h = acc.health();
    assert.equal(h.ready, false);
    assert.equal(h.mode, 'unknown', 'a fleet sweep must not be told "legacy" by a waking cell');
  });

  test('once the store answers, the fence follows the real mode', async () => {
    const acc = coordinator({ broadcast: () => {} });
    await acc.refresh();
    assert.equal(acc.health().mode, 'legacy');
    const writer = { readOnly: true };
    acc.fence({ connection: writer, context: { user: { readOnly: false } } });
    assert.equal(writer.readOnly, false, 'a known legacy project still writes');
  });
});
