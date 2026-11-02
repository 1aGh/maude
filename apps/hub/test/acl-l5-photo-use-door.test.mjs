// S8.15 — a per-use photo edit through the hub file door (contract S8-asset-sidecars §5.6).
//
// `assets/<img8>.<edit8>.photo.json` is content-addressed: a canvas-only session may CREATE
// one for an asset a canvas it edits references, and only when the bytes it sends hash to the
// name. S8.0b taught `writes()` the rule, but the door never passed it the bytes, so every
// such create was refused. The door now asks before the body (`mayCreatePerUse`) and again
// with the landed bytes. A mismatched body, another canvas's asset, an overwrite and a viewer
// grant all get the one `403 not-in-scope`.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { photoEditHash } from '../../studio/access/scope.ts';
import { NOT_IN_SCOPE_REFUSAL } from '../src/access-gate.mjs';
import { bootAclHub, call } from './_acl-files-fixture.mjs';

let hub;
before(async () => {
  hub = await bootAclHub('maude-acl-l5-photo-use');
});
after(async () => {
  await hub?.stop();
});

const edit = (exposure) => ({ version: 1, adjustments: { exposure } });
const bytesOf = (e) => Buffer.from(JSON.stringify(e, null, 2));
const perUse = (base, e, n = 8) => `assets/${base}.${photoEditHash(e).slice(0, n)}.photo.json`;

describe('a canvas-only member creates a per-use edit named by its bytes', () => {
  test('a use of an asset its canvas references: written', async () => {
    const e = edit(0.2);
    const name = perUse('shared', e);
    const r = await call(hub, 'PUT', `/api/file/${name}`, hub.tokens.canvasA, { body: bytesOf(e) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.path, name);
  });

  test('bytes that do not hash to the name: refused, nothing kept', async () => {
    const name = perUse('a-only', edit(0.3));
    const r = await call(hub, 'PUT', `/api/file/${name}`, hub.tokens.canvasA, {
      body: bytesOf(edit(0.4)),
    });
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL);
    const back = await call(hub, 'GET', `/_project-file/${name}`, hub.tokens.owner);
    assert.equal(back.status, 404);
  });

  test('another canvas’s asset, an existing name, a viewer grant: one refusal', async () => {
    const e = edit(0.5);
    const first = perUse('a-only', e);
    assert.equal(
      (await call(hub, 'PUT', `/api/file/${first}`, hub.tokens.canvasA, { body: bytesOf(e) }))
        .status,
      200
    );
    const cases = [
      [hub.tokens.canvasA, perUse('b-only', e), bytesOf(e)], // B's asset
      [hub.tokens.canvasA, first, bytesOf(e)], // already there: never an overwrite
    ];
    for (const [token, name, body] of cases) {
      const r = await call(hub, 'PUT', `/api/file/${name}`, token, { body });
      assert.equal(r.status, 403, name);
      assert.deepEqual(r.body, NOT_IN_SCOPE_REFUSAL, name);
    }
    // a viewer grant is refused one gate earlier, for its role
    const viewer = perUse('a-only', edit(0.6));
    const r = await call(hub, 'PUT', `/api/file/${viewer}`, hub.tokens.canvasAViewer, {
      body: bytesOf(edit(0.6)),
    });
    assert.equal(r.status, 403);
    assert.equal(r.body?.reason, 'read-only');
  });
});
