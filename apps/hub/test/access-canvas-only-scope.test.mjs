// V2-5 A3 lead (S9.5 → S9.2) — a canvas-only session minted by the REAL door.
//
// `peerSessionFields` used to store a canvas-only session (`role: null`, canvas
// grants) without a scope, so `addToken` bound it to its label (DDR-053) and the
// machine-scope check refused even its own canvas's document. Now that every
// door reading the claim is in place (S9.4 files, S9.5 docs), the claim does the
// canvas narrowing and the stored scope is `*`. A project-role session's scope
// is what the caller passed, unchanged.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { peerTokenDoor } from '../../studio/access/scope.ts';
import { peerSessionFields } from '../src/cloud-identity.mjs';
import { addToken } from '../src/tokens.mjs';
import { A, B, docOf, NOPE, openDoc, rm, startHub, tmpDir, until } from './_acl-docs-fixture.mjs';
import { canvasOnlyToken } from './_acl-files-fixture.mjs';

const REASON = 'token not authorized for this documentName';

describe('peerSessionFields — the stored scope', () => {
  test('a canvas-only session is stored with scope *, the claim narrows it', () => {
    const door = peerTokenDoor(
      { v: 1, role: null, grants: [{ c: A, r: 'member' }] },
      { declaredAccess: 2 }
    );
    assert.equal(door.outcome, 'mint');
    const fields = peerSessionFields(door, { scope: 'petra-mac' });
    assert.equal(fields.scope, '*');
    assert.equal(fields.readOnly, true, 'the read_only projection stays fail closed');
    assert.deepEqual(fields.access?.grants, [{ c: A, r: 'member' }]);
  });

  test('a project-role session keeps the scope it was given', () => {
    for (const role of ['owner', 'member', 'viewer']) {
      const door = peerTokenDoor({ v: 1, role }, { declaredAccess: 2 });
      assert.equal(door.outcome, 'mint', role);
      assert.equal(peerSessionFields(door, { scope: 'max-mac' }).scope, 'max-mac', role);
      assert.equal(peerSessionFields(door).scope, '*', `${role} default`);
    }
  });
});

describe('a canvas-only session on the Yjs door', () => {
  let dataDir;
  let hub;
  let owner;
  let petra;

  before(async () => {
    dataDir = tmpDir('maude-acl-co-scope-');
    owner = addToken(dataDir, {
      label: 'owner-mac',
      owner: 'olga@x.test',
      role: 'owner',
      scope: '*',
    }).value;
    // Minted exactly as the mint door mints one — no hand-set scope.
    petra = canvasOnlyToken(dataDir, 'petra-mac', [{ c: A, r: 'member' }]);
    hub = await startHub(dataDir);
    for (const [canvas, text] of [
      [A, 'alpha'],
      [B, 'CANARY-B-SOURCE'],
    ]) {
      const opened = await openDoc(hub.ws, owner, docOf(canvas), { keep: true });
      opened.doc.getText('html').insert(0, text);
      await until(() => opened.provider.unsyncedChanges === 0, 5000, 'owner write flushed');
      opened.close();
    }
  });

  after(async () => {
    await hub?.close();
    rm(dataDir);
  });

  test('opens its granted canvas’s document', async () => {
    const r = await openDoc(hub.ws, petra, docOf(A));
    assert.equal(r.status, 'synced');
    assert.equal(r.scope, 'read-write', 'a member grant edits its canvas');
  });

  test('another canvas is refused with the same reason as a missing document', async () => {
    assert.equal((await openDoc(hub.ws, petra, docOf(B))).status, REASON);
    assert.equal((await openDoc(hub.ws, petra, docOf(NOPE))).status, REASON);
  });
});
