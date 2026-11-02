// V2-1.16 L5 — assets, the hub's half (S9.4).
//
// The three hub asset routes checked no scope at all. Now:
//  - everyone: the DDR-053 scope check every other plane-B route has;
//  - a canvas-only session: its closure. An asset used only by B is 404 by key
//    (exactly as a missing one), absent on both probes; an asset A shares with
//    B is readable and not overwritable (`acl-l1-file-plane` holds the write).
// The studio half (`/_api/assets`, the manifest lanes, the canvas origin) is
// S9.10 / S9.11's.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { addToken } from '../src/tokens.mjs';
import { bootAclHub, call } from './_acl-files-fixture.mjs';

let hub;
before(async () => {
  hub = await bootAclHub('maude-acl-l5');
  // DDR-053's default: a token bound to its label, scoped to no project path.
  hub.tokens.narrow = addToken(hub.dataDir, { label: 'narrow', role: 'member' }).value;
});
after(async () => {
  await hub?.stop();
});

const probe = (token, paths) =>
  call(hub, 'POST', '/_asset-probe', token, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths }),
  });

const ALL = ['assets/a-only.png', 'assets/b-only.png', 'assets/shared.png', 'ui/b-styles.css'];

describe('project sessions keep today’s asset routes (U7)', () => {
  test('owner · member · viewer read every asset and probe every path', async () => {
    for (const who of ['owner', 'member', 'viewer']) {
      for (const key of ['a-only.png', 'b-only.png', 'shared.png']) {
        assert.equal((await call(hub, 'GET', `/assets/${key}`, hub.tokens[who])).status, 200, who);
        const presence = await call(hub, 'GET', `/_asset-file/assets/${key}`, hub.tokens[who]);
        assert.equal(presence.status, 200, `${who} presence ${key}`);
      }
      const p = await probe(hub.tokens[who], [...ALL, 'assets/nope.png']);
      if (who === 'viewer') {
        // The probe serves the push sweep: a write-lane POST, refused a viewer
        // exactly as before (S9.3 classified it `edit`).
        assert.equal(p.status, 403, who);
        assert.equal(p.body?.reason, 'read-only');
        continue;
      }
      assert.equal(p.status, 200, who);
      assert.deepEqual(p.body.present.sort(), [...ALL].sort(), who);
    }
  });

  test('everyone: a token scoped to no project path reads no asset', async () => {
    const missing = await call(hub, 'GET', '/assets/nope.png', hub.tokens.owner);
    const r = await call(hub, 'GET', '/assets/a-only.png', hub.tokens.narrow);
    assert.equal(r.status, 404);
    assert.deepEqual(r.body, missing.body);
    assert.equal(
      (await call(hub, 'GET', '/_asset-file/assets/a-only.png', hub.tokens.narrow)).status,
      404
    );
    assert.deepEqual((await probe(hub.tokens.narrow, ALL)).body.present, []);
  });
});

describe('a canvas-only token reads only its closure’s assets', () => {
  test('/assets/<key>: A’s and the shared asset; B’s is a missing one', async () => {
    assert.equal((await call(hub, 'GET', '/assets/a-only.png', hub.tokens.canvasA)).status, 200);
    assert.equal((await call(hub, 'GET', '/assets/shared.png', hub.tokens.canvasA)).status, 200);
    const missing = await call(hub, 'GET', '/assets/nope.png', hub.tokens.canvasA);
    for (const method of ['GET', 'HEAD']) {
      const r = await call(hub, method, '/assets/b-only.png', hub.tokens.canvasA);
      assert.equal(r.status, missing.status, method);
      if (method === 'GET') assert.deepEqual(r.body, missing.body);
    }
  });

  test('/_asset-file/ presence: absent for B, present for A', async () => {
    const a = await call(hub, 'GET', '/_asset-file/assets/a-only.png', hub.tokens.canvasA);
    assert.equal(a.status, 200);
    const missing = await call(hub, 'GET', '/_asset-file/assets/nope.png', hub.tokens.canvasA);
    for (const p of ['assets/b-only.png', 'assets/b-only.photo.json', 'ui/b-styles.css']) {
      const r = await call(hub, 'GET', `/_asset-file/${p}`, hub.tokens.canvasA);
      assert.equal(r.status, missing.status, p);
      assert.deepEqual(r.body, missing.body, p);
    }
    // A canvas-owned path of ANOTHER canvas answers as a missing one, not 400:
    // the class half of admission would otherwise say ui/b.tsx exists.
    const owned = await call(hub, 'GET', '/_asset-file/ui/b.meta.json', hub.tokens.canvasA);
    assert.equal(owned.status, 404);
  });

  test('/_asset-probe: B’s paths are reported absent', async () => {
    const p = await probe(hub.tokens.canvasA, [...ALL, 'assets/b-only.photo.json']);
    assert.equal(p.status, 200);
    assert.deepEqual(p.body.present.sort(), ['assets/a-only.png', 'assets/shared.png']);
  });
});
