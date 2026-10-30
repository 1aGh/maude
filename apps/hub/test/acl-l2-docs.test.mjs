// V2-1.16 L2 — Plane-A Yjs canvas documents on the peer door (S9.5).
//
// A canvas-only session opens its granted canvases' documents only; B is
// refused with TODAY's out-of-scope reason, exactly like a document that does
// not exist (U1). A's document is read-only where the grant is below edit.
// Nobody below `export` opens a document at all: it is the canvas's source,
// and Can view's browser-door cookie is a peer token (closes S9.3's open item).
// `GET /api/documents` lists exactly what the door would open.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  A,
  B,
  CANARY,
  docOf,
  http,
  NOPE,
  openDoc,
  rm,
  seedTokens,
  startHub,
  tmpDir,
  until,
} from './_acl-docs-fixture.mjs';

const REASON = 'token not authorized for this documentName';

let dataDir;
let hub;
let t;

before(async () => {
  dataDir = tmpDir('maude-acl-l2-');
  t = seedTokens(dataDir);
  hub = await startHub(dataDir);
  // The owner writes both canvases, so B has bytes worth leaking.
  for (const [canvas, text] of [
    [A, 'alpha'],
    [B, 'CANARY-B-SOURCE'],
  ]) {
    const opened = await openDoc(hub.ws, t.owner, docOf(canvas), { keep: true });
    opened.doc.getText('html').insert(0, text);
    await until(() => opened.provider.unsyncedChanges === 0, 5000, 'owner write flushed');
    opened.close();
  }
  // Stored (the SQLite debounce) before any listing is read.
  await until(
    async () => (await http(hub.http, t.owner).get('/api/documents')).body.count >= 2,
    15000,
    'both documents stored'
  );
});

after(async () => {
  await hub?.close();
  rm(dataDir);
});

describe('L2 — the Yjs door', () => {
  test('owner, member and viewer open every document, as today (U7)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      for (const canvas of [A, B]) {
        const r = await openDoc(hub.ws, t[role], docOf(canvas));
        assert.equal(r.status, 'synced', `${role} ${canvas}`);
        assert.equal(r.scope, role === 'viewer' ? 'readonly' : 'read-write', `${role} scope`);
      }
    }
  });

  test('Can view (an observer cookie) opens no document — the document is the source', async () => {
    for (const canvas of [A, B]) {
      assert.equal((await openDoc(hub.ws, t.observer, docOf(canvas))).status, REASON);
    }
  });

  test('canvas-only: B is refused with today’s reason, exactly as a missing document', async () => {
    for (const role of ['aEdit', 'aComment', 'aView']) {
      const b = await openDoc(hub.ws, t[role], docOf(B));
      const missing = await openDoc(hub.ws, t[role], docOf(NOPE));
      assert.equal(b.status, REASON, `${role} B`);
      assert.equal(missing.status, b.status, `${role}: B answers as missing (U1)`);
      // A legacy flat name never matches a grant either.
      assert.equal((await openDoc(hub.ws, t[role], 'canary-b-zx')).status, REASON);
    }
  });

  test('canvas-only: A opens — read-write on an edit grant, read-only on a comment grant', async () => {
    const edit = await openDoc(hub.ws, t.aEdit, docOf(A), { keep: true });
    assert.equal(edit.status, 'synced');
    assert.equal(edit.scope, 'read-write');
    assert.equal(edit.doc.getText('html').toString(), 'alpha');
    edit.close();
    const comment = await openDoc(hub.ws, t.aComment, docOf(A));
    assert.equal(comment.status, 'synced');
    assert.equal(comment.scope, 'readonly');
    // A Can view grant has no export: refused like everything else.
    assert.equal((await openDoc(hub.ws, t.aView, docOf(A))).status, REASON);
  });
});

describe('L2 — GET /api/documents lists what the door opens', () => {
  test('canvas-only lists A only; tombstones are filtered the same way', async () => {
    const r = await http(hub.http, t.aEdit).get('/api/documents');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.body.documents.map((d) => d.name),
      [docOf(A)]
    );
    assert.equal(r.body.count, 1);
    assert.doesNotMatch(r.text, CANARY);
  });

  test('owner, member and viewer list both, as today (U7)', async () => {
    for (const role of ['owner', 'member', 'viewer']) {
      const r = await http(hub.http, t[role]).get('/api/documents');
      assert.equal(r.status, 200, role);
      const names = r.body.documents.map((d) => d.name);
      assert.ok(names.includes(docOf(A)) && names.includes(docOf(B)), role);
    }
  });

  test('Can view lists nothing it could not open', async () => {
    const r = await http(hub.http, t.observer).get('/api/documents');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.documents, []);
  });
});
