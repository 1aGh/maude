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

function coordinator({ broadcast }) {
  const documents = new Map([
    ['ws/local/main/ui-a', { broadcastStateless: broadcast }],
    ['ws/local/main/ui-b', { broadcastStateless: broadcast }],
  ]);
  return createAcceptedRevisions({
    server: { hocuspocus: { documents } },
    store: fakeStore(),
    projectId: 'local',
    canvasGroups: () => [{ label: 'UI', path: 'ui' }],
    designRel: '.design',
    deleteDocument: () => {},
    reviveDocument: () => {},
    listDocuments: () => [],
    tombstoned: () => [],
    checkoutPath: () => null,
    checkoutBody: () => null,
    checkoutDirs: () => [],
    storeDurable: true,
    switchGraceMs: 0,
    log: { warn: () => {}, error: () => {}, log: () => {} },
  });
}

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
    assert.equal(sent.length, 2, 'both open documents were told');
    assert.deepEqual(sent[0], { type: 'maude.mode', mode: 'transactions', epoch: 1 });
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
