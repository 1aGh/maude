// Accepted revisions end to end on a real hub — DDR-241, plan T7/T9/T11/T12.
//
// Real Hocuspocus server, real providers, real HTTP. The oracles are the
// accepted documents every reader receives, the store, and what a restart
// rebuilds — never the kernel's own return value alone.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { laneHash } from '../src/project-transactions/lanes.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const EMPTY = laneHash('');
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

const src = (title, color = 'black') =>
  `export default () => <h1 title="${title}" color="${color}">x</h1>;\n`;

async function startHub(dataDir) {
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');
  return { built, http, ws };
}

function rig(dataDir) {
  const owner = addToken(dataDir, { label: 'owner-machine', scope: '*' }).value;
  const alice = addToken(dataDir, {
    label: 'alice-laptop',
    scope: '*',
    role: 'member',
    owner: 'alice@x.test',
  }).value;
  const bob = addToken(dataDir, {
    label: 'bob-laptop',
    scope: '*',
    role: 'member',
    owner: 'bob@x.test',
  }).value;
  const viewer = addToken(dataDir, { label: 'viewer', scope: '*', readOnly: true }).value;
  return { owner, alice, bob, viewer };
}

let txCounter = 0;
function client(http, token, epochRef) {
  const post = async (path, body) => {
    const res = await fetch(`${http}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const get = async (path) => {
    const res = await fetch(`${http}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: res.status, body: await res.json() };
  };
  const propose = async (operations, extra = {}) => {
    const bytes = JSON.stringify({
      protocol: 1,
      projectId: 'local',
      epoch: epochRef.epoch,
      transactionId: extra.transactionId ?? `tx_test_${++txCounter}_${Date.now()}`,
      origin: { deviceId: 'test', sessionId: 's1' },
      action: { kind: extra.kind ?? 'edit', label: extra.label ?? 'test edit', operations },
      ...(extra.dependsOn ? { dependsOn: extra.dependsOn } : {}),
    });
    const r = await post('/api/projects/local/v1/proposals', bytes);
    return { ...r, bytes };
  };
  return { post, get, propose };
}

function reader(ws, token, name) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({ url: ws, name, token, document: doc });
  return {
    doc,
    provider,
    html: () => doc.getText('html').toString(),
    close: () => (provider.destroy(), doc.destroy()),
  };
}

describe('accepted revisions on a real hub', () => {
  test('mode switch, create, replace, merge, conflict, invalid, idempotency and fencing', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-tx-'));
    dirs.push(dataDir);
    const t = rig(dataDir);
    const { built, http, ws } = await startHub(dataDir);
    const epoch = { epoch: 0 };
    const owner = client(http, t.owner, epoch);
    const alice = client(http, t.alice, epoch);
    const bob = client(http, t.bob, epoch);
    const viewer = client(http, t.viewer, epoch);
    const readers = [];
    try {
      // Legacy until the owner switches. A member cannot switch.
      assert.equal(
        (await alice.propose([{ op: 'dir.create', path: 'ui/Empty' }])).body.code,
        'mode-off'
      );
      assert.equal(
        (await alice.post('/api/projects/local/v1/mode', { mode: 'transactions' })).status,
        403
      );
      const switched = await owner.post('/api/projects/local/v1/mode', {
        mode: 'transactions',
        expectEpoch: 0,
      });
      assert.equal(switched.status, 200);
      epoch.epoch = switched.body.epoch;
      assert.equal(epoch.epoch, 1);

      const doc = 'ws/local/main/ui-home';
      const created = await alice.propose([
        { op: 'doc.create', doc, path: 'ui/home.tsx', lanes: { html: src('old') } },
      ]);
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.status, 'accepted');
      const r1 = reader(ws, t.bob, doc);
      readers.push(r1);
      await until(() => r1.html() === src('old'), 8000, 'reader receives accepted create');

      // Proven-base replace.
      const base = laneHash(src('old'));
      const edit = await alice.propose([
        { op: 'lane.replace', doc, lane: 'html', base, content: src('new') },
      ]);
      assert.equal(edit.status, 200, JSON.stringify(edit.body));
      await until(() => r1.html() === src('new'), 8000, 'reader receives accepted replace');

      // Bob edited the colour from the OLD base: independent → merged, both kept.
      const stale = await bob.propose([
        { op: 'lane.replace', doc, lane: 'html', base, content: src('old', 'red') },
      ]);
      assert.equal(stale.status, 200, JSON.stringify(stale.body));
      assert.deepEqual(stale.body.merged, [{ doc, lane: 'html', merged: true }]);
      await until(() => r1.html() === src('new', 'red'), 8000, 'merged result published');

      // Overlapping edit from the old base: refused, head untouched.
      const clash = await bob.propose([
        { op: 'lane.replace', doc, lane: 'html', base, content: src('bob') },
      ]);
      assert.equal(clash.status, 409);
      assert.equal(clash.body.code, 'base-conflict');
      assert.equal(clash.body.head, laneHash(src('new', 'red')));

      // Invalid source never reaches the accepted document.
      const cur = laneHash(src('new', 'red'));
      const broken = await alice.propose([
        {
          op: 'lane.replace',
          doc,
          lane: 'html',
          base: cur,
          content: 'export default () => <h1 title="broken',
        },
      ]);
      assert.equal(broken.status, 422);
      assert.equal(broken.body.code, 'source-invalid');
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(r1.html(), src('new', 'red'));

      // Idempotency: exact retry returns the original result; reuse is refused.
      const retry = await fetch(`${http}/api/projects/local/v1/proposals`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t.alice}` },
        body: edit.bytes,
      });
      const retryBody = await retry.json();
      assert.equal(retryBody.revision, edit.body.revision);
      const reused = await alice.propose(
        [{ op: 'lane.replace', doc, lane: 'html', base: cur, content: src('other') }],
        {
          transactionId: JSON.parse(edit.bytes).transactionId,
        }
      );
      assert.equal(reused.body.code, 'transaction-id-reused');

      // A reader proposes nothing.
      assert.equal((await viewer.propose([{ op: 'dir.create', path: 'ui/X' }])).status, 403);

      // FENCE: a client writing raw Yjs content changes nothing accepted.
      const rogue = reader(ws, t.alice, doc);
      readers.push(rogue);
      await until(() => rogue.html() === src('new', 'red'), 8000, 'rogue synced');
      rogue.doc.getText('html').insert(0, '// injected\n');
      await new Promise((r) => setTimeout(r, 400));
      const fresh = reader(ws, t.bob, doc);
      readers.push(fresh);
      await until(() => fresh.html().length > 0, 8000, 'fresh reader synced');
      assert.equal(fresh.html(), src('new', 'red'), 'raw client content must not be accepted');

      // Epoch fence: an old epoch is refused.
      const oldEpoch = await client(http, t.alice, { epoch: 0 }).propose([
        { op: 'dir.create', path: 'ui/Old' },
      ]);
      assert.equal(oldEpoch.body.code, 'epoch-stale');
    } finally {
      for (const r of readers) r.close();
      await built.stopJournal();
      await built.server.destroy();
      built.projectStore.close();
    }
  });

  test('manifest: move, delete, empty folders, and revival on undo', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-tx-'));
    dirs.push(dataDir);
    const t = rig(dataDir);
    const { built, http, ws } = await startHub(dataDir);
    const epoch = { epoch: 0 };
    const owner = client(http, t.owner, epoch);
    const alice = client(http, t.alice, epoch);
    const readers = [];
    try {
      epoch.epoch = (
        await owner.post('/api/projects/local/v1/mode', { mode: 'transactions' })
      ).body.epoch;
      const doc = 'ws/local/main/ui-card';
      await alice.propose([
        { op: 'doc.create', doc, path: 'ui/card.tsx', lanes: { html: src('card') } },
      ]);
      assert.equal((await alice.propose([{ op: 'dir.create', path: 'ui/Empty' }])).status, 200);
      let boot = (await alice.get('/api/projects/local/v1/bootstrap')).body;
      assert.deepEqual(boot.dirs, ['ui/Empty']);

      const moved = await alice.propose([
        { op: 'doc.move', doc, to: { path: 'ui/Folder/card.tsx' } },
      ]);
      assert.equal(moved.status, 200, JSON.stringify(moved.body));
      const target = 'ws/local/main/ui-folder-card';
      const oldReader = reader(ws, t.alice, doc);
      const newReader = reader(ws, t.alice, target);
      readers.push(oldReader, newReader);
      await until(
        () => newReader.html() === src('card'),
        8000,
        'moved content at the new document'
      );
      await until(
        () => oldReader.doc.getMap('syncMeta').get('movedTo') === 'ui/Folder/card.tsx',
        8000,
        'old doc retired'
      );
      assert.equal(newReader.doc.getMap('syncMeta').get('path'), 'ui/Folder/card.tsx');

      boot = (await alice.get('/api/projects/local/v1/bootstrap')).body;
      const live = boot.docs.filter((d) => !d.retired);
      assert.deepEqual(
        live.map((d) => d.path),
        ['ui/Folder/card.tsx']
      );
      const entry = live[0].entry;
      assert.equal(
        boot.docs.find((d) => d.doc === doc).entry,
        entry,
        'a move keeps the entry identity'
      );

      // Recursive folder delete removes the folder and its canvas atomically.
      const del = await alice.propose([
        { op: 'dir.create', path: 'ui/Folder' },
        { op: 'dir.delete', path: 'ui/Folder' },
      ]);
      assert.equal(del.status, 200, JSON.stringify(del.body));
      boot = (await alice.get('/api/projects/local/v1/bootstrap')).body;
      assert.equal(boot.docs.filter((d) => !d.retired).length, 0);
      const listing = await (
        await fetch(`${http}/api/documents`, { headers: { authorization: `Bearer ${t.alice}` } })
      ).json();
      assert.ok(
        listing.tombstones.some((d) => d.name === target),
        'deletion speaks the tombstone protocol'
      );

      // Undo the delete: the canvas comes back with its content.
      const undo = await alice.propose([{ op: 'history.undo', actionId: del.body.actionId }]);
      assert.equal(undo.status, 200, JSON.stringify(undo.body));
      boot = (await alice.get('/api/projects/local/v1/bootstrap')).body;
      assert.deepEqual(
        boot.docs.filter((d) => !d.retired).map((d) => d.path),
        ['ui/Folder/card.tsx']
      );
      const revived = reader(ws, t.alice, target);
      readers.push(revived);
      await until(() => revived.html() === src('card'), 8000, 'revived content');
    } finally {
      for (const r of readers) r.close();
      await built.stopJournal();
      await built.server.destroy();
      built.projectStore.close();
    }
  });

  test('personal undo is effect-aware: never erases a later peer value, even an equal one', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-tx-'));
    dirs.push(dataDir);
    const t = rig(dataDir);
    const { built, http } = await startHub(dataDir);
    const epoch = { epoch: 0 };
    const alice = client(http, t.alice, epoch);
    const bob = client(http, t.bob, epoch);
    try {
      epoch.epoch = (
        await client(http, t.owner, epoch).post('/api/projects/local/v1/mode', {
          mode: 'transactions',
        })
      ).body.epoch;
      const doc = 'ws/local/main/ui-undo';
      const head = async () => {
        const boot = (await alice.get('/api/projects/local/v1/bootstrap')).body;
        const d = boot.docs.find((x) => x.doc === doc);
        return (await alice.get(`/api/projects/local/v1/blobs/${d.lanes.html.hash}`)).body.body;
      };
      await alice.propose([
        { op: 'doc.create', doc, path: 'ui/undo.tsx', lanes: { html: src('A', 'black') } },
      ]);
      // Alice: title A→B. Bob: colour black→red (independent). Alice undoes.
      const a1 = await alice.propose([
        { op: 'lane.replace', doc, lane: 'html', base: laneHash(src('A')), content: src('B') },
      ]);
      await bob.propose([
        {
          op: 'lane.replace',
          doc,
          lane: 'html',
          base: laneHash(src('B')),
          content: src('B', 'red'),
        },
      ]);
      const u1 = await alice.propose([{ op: 'history.undo', actionId: a1.body.actionId }]);
      assert.equal(u1.status, 200, JSON.stringify(u1.body));
      assert.equal(await head(), src('A', 'red'), "undo reverts only Alice's title");

      // ABA: Alice sets C; Bob sets D then C again. Alice's undo of her C must
      // not remove Bob's (equal-looking) C.
      const a2 = await alice.propose([
        {
          op: 'lane.replace',
          doc,
          lane: 'html',
          base: laneHash(src('A', 'red')),
          content: src('C', 'red'),
        },
      ]);
      await bob.propose([
        {
          op: 'lane.replace',
          doc,
          lane: 'html',
          base: laneHash(src('C', 'red')),
          content: src('D', 'red'),
        },
      ]);
      await bob.propose([
        {
          op: 'lane.replace',
          doc,
          lane: 'html',
          base: laneHash(src('D', 'red')),
          content: src('C', 'red'),
        },
      ]);
      const u2 = await alice.propose([{ op: 'history.undo', actionId: a2.body.actionId }]);
      assert.equal(u2.status, 409, JSON.stringify(u2.body));
      assert.equal(u2.body.code, 'undo-conflict');
      assert.equal(await head(), src('C', 'red'), "Bob's later C survives");

      // Bob cannot undo Alice's action.
      assert.equal(
        (await bob.propose([{ op: 'history.undo', actionId: a2.body.actionId }])).status,
        403
      );

      // Redo = undo of the undo.
      const redo = await alice.propose([{ op: 'history.redo', actionId: u1.body.actionId }]);
      assert.equal(
        redo.status,
        409,
        'the title was changed since, so the redo is refused, not forced'
      );
      const hist = (await alice.get('/api/projects/local/v1/history?limit=20')).body.history;
      assert.ok(hist.length >= 6);
      assert.ok(hist.every((h) => typeof h.actor === 'string' && h.effects.length > 0));
    } finally {
      await built.stopJournal();
      await built.server.destroy();
      built.projectStore.close();
    }
  });

  test('acknowledged actions survive losing the document cache: the store rebuilds them', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-tx-'));
    dirs.push(dataDir);
    const t = rig(dataDir);
    let hub = await startHub(dataDir);
    const epoch = { epoch: 0 };
    epoch.epoch = (
      await client(hub.http, t.owner, epoch).post('/api/projects/local/v1/mode', {
        mode: 'transactions',
      })
    ).body.epoch;
    const doc = 'ws/local/main/ui-durable';
    const r = await client(hub.http, t.alice, epoch).propose([
      { op: 'doc.create', doc, path: 'ui/durable.tsx', lanes: { html: src('saved'), css: 'h1{}' } },
    ]);
    assert.equal(r.status, 200);
    await hub.built.stopJournal();
    await hub.built.server.destroy();
    hub.built.projectStore.close();
    // The renderer/document cache is disposable — remove it outright.
    for (const f of ['hub.db', 'hub.db-wal', 'hub.db-shm'])
      rmSync(join(dataDir, f), { force: true });
    hub = await startHub(dataDir);
    const readerAfter = reader(hub.ws, t.bob, doc);
    try {
      await until(() => readerAfter.html() === src('saved'), 8000, 'rebuilt from the store');
      assert.equal(readerAfter.doc.getText('css').toString(), 'h1{}');
    } finally {
      readerAfter.close();
      await hub.built.stopJournal();
      await hub.built.server.destroy();
      hub.built.projectStore.close();
    }
  });
});
