// The project-format fence on the doc lanes — V2-1.12 §5.4 / §5.5 (V2-2.18 H3).
//
// A writer DECLARES its file format (`maude-format=<n>` on the socket URL;
// absent = 1, which is every client older than the compat release) and is a
// writer only while that equals the project's format. The oracles are what a
// second reader receives and what the hub's own document holds — never the
// writer's local state, which always "succeeds".
//
// The v1 promise is tested first and on purpose: a client that declares
// nothing, on a format-1 project, writes exactly as it did before this change.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { createAcceptedRevisions } from '../src/project-transactions/hub-integration.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error(`${what} not reached before deadline`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startHub() {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-format-fence-'));
  dirs.push(dataDir);
  const owner = addToken(dataDir, { label: 'owner-machine', scope: '*', role: 'owner' }).value;
  const member = addToken(dataDir, {
    label: 'member',
    scope: '*',
    role: 'member',
    owner: 'm@x.test',
  }).value;
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
  return { built, http, ws, owner, member };
}

/** A peer on one document. `format` undefined = a pre-compat client (no param). */
function peer(ws, token, name, format) {
  const doc = new Y.Doc();
  const url = format === undefined ? ws : `${ws}?maude-format=${format}`;
  const notices = [];
  const provider = new HocuspocusProvider({
    url,
    name,
    token,
    document: doc,
    onStateless: ({ payload }) => {
      try {
        notices.push(JSON.parse(payload));
      } catch {}
    },
  });
  return {
    doc,
    provider,
    notices,
    text: () => doc.getText('html').toString(),
    write: (t) => doc.getText('html').insert(doc.getText('html').length, t),
    close: () => (provider.destroy(), doc.destroy()),
  };
}

async function flip(http, token, body) {
  const res = await fetch(`${http}/api/project-format`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('the format fence on a real hub', () => {
  test('v1 writes on a format-1 project; after the flip it is a reader, a format-2 writer is not', {
    timeout: 60000,
  }, async () => {
    const { built, http, ws, owner, member } = await startHub();
    const peers = [];
    const open = (...a) => {
      const p = peer(...a);
      peers.push(p);
      return p;
    };
    try {
      const name = 'ws/local/main/ui-fence';
      // 1. A pre-compat client on a format-1 project — exactly as before.
      const v1 = open(ws, member, name);
      const reader = open(ws, owner, name, 2);
      await until(() => v1.provider.synced && reader.provider.synced, 8000, 'synced');
      assert.equal(v1.provider.authorizedScope, 'read-write', 'v1 is a writer on format 1');
      v1.write('v1-before;');
      await until(() => reader.text().includes('v1-before;'), 8000, 'v1 write arrives');
      // …and the other direction: a peer writing the project's format (a
      // compat 1.x, or v2 under the staged gate, both declare 1 here) reaches
      // the pre-compat client.
      const compat = open(ws, owner, name, 1);
      await until(() => compat.provider.synced, 8000, 'compat synced');
      assert.equal(compat.provider.authorizedScope, 'read-write');
      compat.write('compat-before;');
      await until(() => v1.text().includes('compat-before;'), 8000, 'compat → v1 arrives');

      // 2. The owner flips the project to format 2.
      const flipped = await flip(http, owner, { formatVersion: 2 });
      assert.equal(flipped.status, 200);
      assert.equal(flipped.body.formatVersion, 2);

      // The notice rides the `maude.mode` envelope 1.x already obeys, with
      // THIS connection's write right and the new format.
      await until(
        () => v1.notices.some((n) => n.type === 'maude.mode' && n.formatVersion === 2),
        4000,
        'v1 got the format notice'
      );
      const toV1 = v1.notices.find((n) => n.type === 'maude.mode');
      assert.equal(toV1.writable, false);
      assert.equal(toV1.mode, 'legacy');
      assert.equal(toV1.epoch, flipped.body.epoch);
      await until(() => reader.notices.some((n) => n.type === 'maude.mode'), 4000, 'reader notice');
      assert.equal(reader.notices.find((n) => n.type === 'maude.mode').writable, true);

      // 3. After the grace, the undeclared writer's updates are dropped…
      v1.write('v1-after;');
      // …while a format-2 writer's arrive.
      reader.write('v2-after;');
      const watcher = open(ws, owner, name, 2);
      await until(() => watcher.provider.synced, 8000, 'watcher synced');
      await until(() => watcher.text().includes('v2-after;'), 8000, 'v2 write arrives');
      // V2 → V1: the fenced v1 peer still RECEIVES the project.
      await until(() => v1.text().includes('v2-after;'), 8000, 'v2 → v1 still arrives');
      // The compat peer (declared 1) is fenced like the pre-compat one.
      compat.write('compat-after;');
      await sleep(300);
      assert.ok(!watcher.text().includes('v1-after;'), 'a v1 write after the flip never lands');
      assert.ok(!reader.text().includes('v1-after;'));
      assert.ok(!watcher.text().includes('compat-after;'), 'a declared-1 write never lands');

      // 4. A pre-compat client connecting AFTER the flip is read-only from its
      //    handshake — no writable window.
      const late = open(ws, member, name);
      await until(() => late.provider.synced, 8000, 'late synced');
      assert.equal(late.provider.authorizedScope, 'readonly');
      assert.ok(late.text().includes('v2-after;'), 'it still READS the project');
      // And a declared format-1 writer is treated exactly like an undeclared one.
      const explicit1 = open(ws, member, name, 1);
      await until(() => explicit1.provider.synced, 8000, 'explicit1 synced');
      assert.equal(explicit1.provider.authorizedScope, 'readonly');
      // A declared format-2 member is a writer.
      const v2member = open(ws, member, name, 2);
      await until(() => v2member.provider.synced, 8000, 'v2 member synced');
      assert.equal(v2member.provider.authorizedScope, 'read-write');

      // 5. The owner flips back: the v1 peer is told it may write again, and can.
      v1.notices.length = 0;
      const back = await flip(http, owner, { formatVersion: 1 });
      assert.equal(back.status, 200);
      await until(
        () => v1.notices.some((n) => n.type === 'maude.mode' && n.formatVersion === 1),
        4000,
        'v1 got the unflip notice'
      );
      assert.equal(v1.notices.find((n) => n.formatVersion === 1).writable, true);
      // A pre-compat client writes again. (A FRESH one: the old socket's
      // post-flip updates were dropped by the hub, and Yjs holds anything
      // built on them until that peer resyncs — a patched 1.x never makes
      // them, it holds writes on `writable: false`.)
      const again = open(ws, member, name);
      await until(() => again.provider.synced, 8000, 'again synced');
      assert.equal(again.provider.authorizedScope, 'read-write');
      again.write('v1-again;');
      await until(() => watcher.text().includes('v1-again;'), 8000, 'v1 writes again on format 1');
    } finally {
      for (const p of peers) p.close();
      await built.stopJournal?.();
      await built.server.destroy();
      built.projectStore?.close?.();
    }
  });
});

// ---------------------------------------------------------------------------
// The coordinator, without a network: the predicate and the barrier's order.

function fakeStore({ formatVersion = 1, epoch = 0 } = {}) {
  let fmt = formatVersion;
  let ep = epoch;
  const calls = [];
  return {
    calls,
    async state() {
      return { mode: 'legacy', epoch: ep, revision: 0, importPending: false, formatVersion: fmt };
    },
    async setFormat({ formatVersion: next, expectEpoch, by }) {
      calls.push({ next, expectEpoch, by });
      if (expectEpoch !== undefined && expectEpoch !== ep) {
        const e = new Error('epoch-stale');
        e.code = 'epoch-stale';
        throw e;
      }
      if (next === fmt)
        return { mode: 'legacy', epoch: ep, revision: 0, formatVersion: fmt, changed: false };
      fmt = next;
      ep += 1;
      return {
        mode: 'legacy',
        epoch: ep,
        revision: 0,
        formatVersion: fmt,
        changed: true,
        changedAt: '2026-10-10T00:00:00.000Z',
        changedBy: by,
      };
    },
    async raiseFormat(n) {
      if (n <= fmt)
        return { mode: 'legacy', epoch: ep, revision: 0, formatVersion: fmt, changed: false };
      fmt = n;
      ep += 1;
      return { mode: 'legacy', epoch: ep, revision: 0, formatVersion: fmt, changed: true };
    },
    async manifest() {
      return { revision: 0, docs: [] };
    },
    async markImported() {},
  };
}

function coordinator({ store, connections, switchGraceMs = 0 }) {
  const documents = new Map([['ws/local/main/ui-a', { getConnections: () => connections }]]);
  return createAcceptedRevisions({
    server: { hocuspocus: { documents } },
    store,
    projectId: 'local',
    canvasGroups: () => [],
    designRel: '.design',
    deleteDocument: () => {},
    reviveDocument: () => {},
    listDocuments: () => [],
    tombstoned: () => [],
    checkoutPath: () => null,
    checkoutBody: () => null,
    checkoutDirs: () => [],
    storeDurable: true,
    switchGraceMs,
    log: { warn: () => {}, error: () => {}, log: () => {} },
  });
}

const conn = (user, sent) => ({
  context: { user },
  readOnly: false,
  sendStateless: (m) => sent.push(JSON.parse(m)),
});

describe('the fence predicate', () => {
  test('an UNREAD format fences every writer, whatever it declares', () => {
    const acc = coordinator({
      store: { state: () => new Promise(() => {}) },
      connections: [],
    });
    for (const format of [undefined, 1, 2]) {
      const c = { readOnly: false };
      acc.fence({ connection: c, context: { user: { format } } });
      assert.equal(c.readOnly, true, `format ${format} before the store answered`);
    }
  });

  test('format 1: an undeclared writer writes (v1); format 2: only a format-2 writer does', async () => {
    const store = fakeStore();
    const acc = coordinator({ store, connections: [] });
    await acc.refresh();
    const decide = (user) => {
      const c = { readOnly: false };
      acc.fence({ connection: c, context: { user } });
      return c.readOnly;
    };
    assert.equal(decide({}), false, 'v1 on format 1 is a writer — unchanged');
    assert.equal(decide({ format: 1 }), false);
    assert.equal(decide({ format: 2 }), true, 'a v2 writer on a format-1 project reads');
    assert.equal(decide({ readOnly: true }), true, 'a viewer stays a viewer');
    await acc.setFormat({ formatVersion: 2, by: 'owner' });
    assert.equal(decide({}), true, 'v1 on format 2 reads');
    assert.equal(decide({ format: 'garbage' }), true, 'a nonsense declaration is format 1');
    assert.equal(decide({ format: 2 }), false);
    assert.equal(decide({ format: 2, readOnly: true }), true, 'the format never widens a role');
  });
});

describe('the format barrier (the setMode order)', () => {
  test('persist → notice (writable + formatVersion) → grace → fence; epoch + 1', async () => {
    const store = fakeStore();
    const sent = [];
    const v1 = conn({}, sent);
    const v2 = conn({ format: 2 }, sent);
    const viewer = conn({ readOnly: true, format: 2 }, sent);
    const acc = coordinator({ store, connections: [v1, v2, viewer], switchGraceMs: 150 });
    await acc.refresh();
    const pending = acc.setFormat({ formatVersion: 2, by: 'owner@x.test' });
    // Inside the grace: the notice is out, and the old writer is STILL admitted
    // — a write it sent before the notice reached it lands.
    await until(() => sent.length === 3, 1000, 'notices sent');
    const c = { readOnly: false };
    acc.fence({ connection: c, context: v1.context });
    assert.equal(c.readOnly, false, 'in-flight v1 write admitted during the grace');
    const out = await pending;
    assert.deepEqual(
      sent.map((n) => [n.type, n.writable, n.formatVersion, n.epoch]),
      [
        ['maude.mode', false, 2, 1],
        ['maude.mode', true, 2, 1],
        ['maude.mode', false, 2, 1],
      ]
    );
    assert.equal(out.formatVersion, 2);
    assert.equal(out.epoch, 1);
    assert.equal(out.changedBy, 'owner@x.test');
    acc.fence({ connection: c, context: v1.context });
    assert.equal(c.readOnly, true, 'fenced once the grace is over');
    assert.equal(acc.health().formatVersion, 2);
  });

  test('the same value is an answer: no epoch bump, no notice', async () => {
    const store = fakeStore({ formatVersion: 2, epoch: 4 });
    const sent = [];
    const acc = coordinator({ store, connections: [conn({}, sent)], switchGraceMs: 50 });
    await acc.refresh();
    const out = await acc.setFormat({ formatVersion: 2, by: 'owner' });
    assert.equal(out.epoch, 4);
    assert.equal(sent.length, 0);
  });

  test('a mode switch tells a mismatched writer it may NOT write (the old notice said it could)', async () => {
    let mode = 'transactions';
    let epoch = 2;
    const store = {
      ...fakeStore({ formatVersion: 2, epoch: 2 }),
      async state() {
        return { mode, epoch, revision: 0, importPending: false, formatVersion: 2 };
      },
      async setMode({ mode: next }) {
        mode = next;
        epoch += 1;
        return { mode, epoch, revision: 0, importPending: false, formatVersion: 2 };
      },
    };
    const sent = [];
    const acc = coordinator({ store, connections: [conn({}, sent), conn({ format: 2 }, sent)] });
    await acc.refresh();
    await acc.setMode({ mode: 'legacy', expectEpoch: 2 });
    assert.deepEqual(
      sent.map((n) => [n.writable, n.formatVersion]),
      [
        [false, 2],
        [true, 2],
      ]
    );
  });

  test('a second flip while one is in flight is refused (409 switch-in-progress)', async () => {
    const acc = coordinator({ store: fakeStore(), connections: [], switchGraceMs: 100 });
    await acc.refresh();
    const first = acc.setFormat({ formatVersion: 2, by: 'a' });
    await assert.rejects(acc.setFormat({ formatVersion: 1, by: 'b' }), (e) => {
      assert.equal(e.code, 'switch-in-progress');
      assert.equal(e.status, 409);
      return true;
    });
    await first;
  });

  test('the checkout seed only ever raises', async () => {
    const store = fakeStore({ formatVersion: 2, epoch: 3 });
    const acc = coordinator({ store, connections: [] });
    await acc.refresh();
    assert.equal((await acc.seedFormat(1)).changed, false);
    assert.equal(acc.projectFormat(), 2);
    const low = fakeStore();
    const acc2 = coordinator({ store: low, connections: [] });
    await acc2.refresh();
    const raised = await acc2.seedFormat(2);
    assert.equal(raised.changed, true);
    assert.equal(acc2.projectFormat(), 2);
    // Never above what this hub knows (a tenant's checkout could lock out
    // every writer with a format no build writes).
    const acc3 = coordinator({ store: fakeStore(), connections: [] });
    await acc3.refresh();
    assert.equal((await acc3.seedFormat(3)).changed, false);
    assert.equal(acc3.projectFormat(), 1);
  });
});
