// Render tokens — V2-1.7 §5.4 (S9.2): the floor is `observer`, and a canvas
// capability carries the session's grants (`g`, sorted) so the canvas listener
// can resolve them against the closure (V2-1.16 L15).

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { mintRenderToken, verifyRenderToken } from '../src/render-token.mjs';

const secret = 'test-secret';

/** A token signed with the real secret over a hand-built payload. */
const forge = (claims) => {
  const payload = JSON.stringify(claims);
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${mac}`;
};

test('a token without a role claim floors to observer (was viewer)', () => {
  const t = mintRenderToken({ secret, project: 'p', subject: 'v@b.c' });
  assert.equal(verifyRenderToken({ secret, token: t, project: 'p' }).role, 'observer');
});

test('an unknown role claim floors to observer too — never null, never passed through', () => {
  const t = forge({ p: 'p', s: 'x@b.c', r: 'admin', e: Date.now() + 60_000 });
  const v = verifyRenderToken({ secret, token: t, project: 'p' });
  assert.equal(v.ok, true);
  assert.equal(v.role, 'observer');
});

test('a known role rides through unchanged', () => {
  for (const role of ['observer', 'viewer', 'member', 'owner']) {
    const t = mintRenderToken({ secret, project: 'p', subject: 'o@b.c', role });
    assert.equal(verifyRenderToken({ secret, token: t, project: 'p' }).role, role);
  }
});

test('grants ride as `g`, sorted by canvas, and verify back', () => {
  const t = mintRenderToken({
    secret,
    project: 'p',
    subject: 'g@b.c',
    role: null,
    grants: [
      { c: 'ui/b.tsx', r: 'member' },
      { c: 'ui/a.tsx', r: 'viewer' },
    ],
  });
  const payload = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
  assert.deepEqual(payload.g, [
    { c: 'ui/a.tsx', r: 'viewer' },
    { c: 'ui/b.tsx', r: 'member' },
  ]);
  const v = verifyRenderToken({ secret, token: t, project: 'p' });
  assert.deepEqual(v.grants, payload.g);
});

test('no grants → no `g` key (a v1 capability stays byte-identical) and grants: []', () => {
  const t = mintRenderToken({ secret, project: 'p', subject: 'o@b.c', role: 'owner' });
  const payload = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
  assert.equal('g' in payload, false);
  assert.deepEqual(verifyRenderToken({ secret, token: t, project: 'p' }).grants, []);
});

test('a malformed `g` makes the whole capability malformed', () => {
  for (const g of ['ui/a.tsx', [{ c: 'ui/a.tsx', r: 'owner' }], [{ c: '', r: 'viewer' }]]) {
    const t = forge({ p: 'p', s: 'x@b.c', r: 'viewer', g, e: Date.now() + 60_000 });
    assert.deepEqual(verifyRenderToken({ secret, token: t, project: 'p' }), {
      ok: false,
      reason: 'malformed',
    });
  }
});
