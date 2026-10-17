// Cloud access token v2 — V2-1.7 §5.4 (S9.2).
//
// `m2.<body>.<sig>` carries a claim a v1 cell cannot honour (observer,
// canvas-only, grants). The protection for every v1.9.x desktop and every
// not-yet-upgraded cell is the FORMAT: an old verifier requires two parts and
// answers `malformed`. This file pins that with a FROZEN copy of the 1.9.1
// verifier, pins H-1 (no role → refused, never `member`), and pins the one mint
// door every peer-credential lane asks.

import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  ACCESS_VERSION_REFUSAL,
  declaredAccessOf,
  peerTokenDoor,
} from '../../studio/access/scope.ts';
import {
  accessClaims,
  authenticateForMode,
  signAccessToken,
  signAccessTokenV2,
  verifyAccessToken,
} from '../src/cloud-identity.mjs';

const KEY = 'k'.repeat(64);
const NOW = 1_700_000_000_000;
const TENANT = 'alligators';
const CLOUD = { MAUDE_CLOUD_IDENTITY: 'strict', MAUDE_TENANT_ID: TENANT };

/**
 * FROZEN — `verifyAccessToken` exactly as v1.9.1 shipped it. Never edit this
 * copy: it is the old cell, and the old cell does not get upgraded by a test.
 */
function verifyAccessTokenV191(token, secret, { now = Date.now(), tenantId } = {}) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = createHmac('sha256', secret).update(body).digest();
  let offered;
  try {
    offered = Buffer.from(sig, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (tenantId && claims.project !== tenantId) return { ok: false, reason: 'wrong-project' };
  if (!claims.email) return { ok: false, reason: 'malformed' };
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, reason: 'expired' };
  return {
    ok: true,
    user: { email: claims.email, role: claims.role ?? 'member' },
    expiresAt: claims.exp,
    issuedAt: claims.iat,
  };
}

const base = { email: 'a@example.com', project: TENANT, iat: NOW, exp: NOW + 60_000 };
const v2 = (over) => signAccessTokenV2({ ...base, ...over }, KEY);
const v1raw = (claims) => signAccessToken({ ...base, ...claims }, KEY);
const verify = (t) => verifyAccessToken(t, KEY, { now: NOW, tenantId: TENANT });

describe('m2. tokens round-trip and fail closed on an old cell', () => {
  it('a canvas-only v2 token verifies, carrying its claim', () => {
    const t = v2({ role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
    assert.match(t, /^m2\.[^.]+\.[^.]+$/);
    const r = verify(t);
    assert.equal(r.ok, true);
    assert.equal(r.format, 2);
    assert.deepEqual(r.user, { email: 'a@example.com', role: null });
    assert.deepEqual(r.access, { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
  });

  it('an observer v2 token verifies', () => {
    const r = verify(v2({ role: 'observer' }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.access, { v: 1, role: 'observer' });
  });

  it('the 1.9.1 verifier reads every m2. token as malformed', () => {
    for (const claim of [
      { role: 'observer' },
      { role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
      { role: 'viewer', grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    ]) {
      assert.deepEqual(verifyAccessTokenV191(v2(claim), KEY, { now: NOW, tenantId: TENANT }), {
        ok: false,
        reason: 'malformed',
      });
    }
  });

  it('stripping the prefix does not leave a v1 token the old cell accepts', () => {
    // The MAC covers `m2.` — otherwise `role: null` would read as `member` on 1.9.1.
    const t = v2({ role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] });
    const stripped = t.slice('m2.'.length);
    assert.equal(
      verifyAccessTokenV191(stripped, KEY, { now: NOW, tenantId: TENANT }).reason,
      'bad-signature'
    );
    assert.equal(verify(stripped).ok, false);
  });

  it('a v1 token stays byte-identical and both verifiers accept it', () => {
    const t = signAccessToken(accessClaims({ ...base, role: 'member' }, { now: NOW }), KEY);
    assert.equal(t.split('.').length, 2);
    assert.equal(verifyAccessTokenV191(t, KEY, { now: NOW, tenantId: TENANT }).ok, true);
    const r = verify(t);
    assert.equal(r.ok, true);
    assert.equal(r.format, undefined);
    assert.equal(r.access, undefined);
    assert.deepEqual(r.user, { email: 'a@example.com', role: 'member' });
    // Key-for-key the verdict 1.9.1 returns, for every v1 role.
    for (const role of ['owner', 'member', 'viewer', 'admin']) {
      const v1 = signAccessToken(accessClaims({ ...base, role }, { now: NOW }), KEY);
      assert.deepEqual(verify(v1), verifyAccessTokenV191(v1, KEY, { now: NOW, tenantId: TENANT }));
    }
  });

  it('a forged or tampered m2. token is refused', () => {
    const t = v2({ role: 'observer' });
    const [p, body, sig] = t.split('.');
    const other = Buffer.from(JSON.stringify({ ...base, v: 2, role: 'owner' }), 'utf8').toString(
      'base64url'
    );
    assert.equal(verify(`${p}.${other}.${sig}`).reason, 'bad-signature');
    assert.equal(verify(`m3.${body}.${sig}`).reason, 'malformed');
    assert.equal(verifyAccessToken(t, 'x'.repeat(64), { now: NOW }).reason, 'bad-signature');
  });
});

describe('H-1 — no role is refused, never defaulted to member', () => {
  it('a v1 body with no role is malformed (was: member)', () => {
    assert.equal(verifyAccessTokenV191(v1raw({}), KEY, { now: NOW }).user.role, 'member');
    assert.deepEqual(verify(v1raw({})), { ok: false, reason: 'malformed' });
    assert.equal(verify(v1raw({ role: null })).ok, false);
    assert.equal(verify(v1raw({ role: '' })).ok, false);
  });

  it('a v1 body carrying v2 semantics is malformed', () => {
    assert.equal(verify(v1raw({ role: 'observer' })).reason, 'malformed');
    assert.equal(verify(v1raw({ role: 'viewer', grants: [] })).reason, 'malformed');
    assert.equal(verify(v1raw({ role: 'member', v: 2 })).reason, 'malformed');
  });

  it('a v2 body with no role key, a bad role, or no grant for role null is malformed', () => {
    assert.equal(verify(v2({})).reason, 'malformed');
    assert.equal(verify(v2({ role: 'admin' })).reason, 'malformed');
    assert.equal(verify(v2({ role: null })).reason, 'malformed');
    assert.equal(verify(v2({ role: null, grants: [] })).reason, 'malformed');
    assert.equal(
      verify(v2({ role: null, grants: [{ c: 'a.tsx', r: 'owner' }] })).reason,
      'malformed'
    );
    assert.equal(verify(v2({ role: null, grants: [{ c: '', r: 'viewer' }] })).reason, 'malformed');
    const many = Array.from({ length: 257 }, (_, i) => ({ c: `c${i}.tsx`, r: 'viewer' }));
    assert.equal(verify(v2({ role: null, grants: many })).reason, 'malformed');
  });

  it('every mint path states a role: accessClaims refuses to default one', () => {
    assert.throws(() => accessClaims({ email: 'a@example.com', project: TENANT }), /role/);
  });

  it('the cloud-mode door refuses a role-less token', () => {
    const r = authenticateForMode(
      { token: v1raw({ exp: Date.now() + 60_000 }) },
      { env: CLOUD, secret: KEY }
    );
    assert.deepEqual(r, { ok: false, reason: 'malformed' });
  });

  it('the cloud-mode door passes a v2 claim through to the minting door', () => {
    const r = authenticateForMode(
      { token: v2({ role: 'observer', exp: Date.now() + 60_000 }) },
      { env: CLOUD, secret: KEY }
    );
    assert.equal(r.ok, true);
    assert.equal(r.format, 2);
    assert.deepEqual(r.access, { v: 1, role: 'observer' });
  });
});

describe('the peer-token mint door (V2-1.7 §5.4 table)', () => {
  const door = (claim, opts = {}) =>
    peerTokenDoor(claim, { doorUrl: 'https://alligators.cloud.maude.sh/', ...opts });

  it('v1-expressible claims mint today’s token, declared or not', () => {
    for (const role of ['owner', 'member', 'viewer']) {
      for (const declaredAccess of [1, 2]) {
        assert.deepEqual(door({ v: 1, role }, { declaredAccess }), {
          outcome: 'mint',
          claim: { v: 1, role },
          v2: false,
        });
      }
    }
  });

  it('grants or observer without the declaration: 426, in words', () => {
    for (const claim of [
      { v: 1, role: 'observer' },
      { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
      { v: 1, role: 'viewer', grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    ]) {
      const d = door(claim, { declaredAccess: 1 });
      assert.equal(d.outcome, 'update');
      assert.equal(d.status, 426);
      assert.deepEqual(d.body, {
        error: 'Update Maude to open this project.',
        reason: 'access-version',
        minAccess: 2,
      });
      assert.equal(d.body, ACCESS_VERSION_REFUSAL);
    }
  });

  it('grants ≥ viewer with the declaration: a peer token carrying the claim', () => {
    const d = door(
      {
        v: 1,
        role: null,
        grants: [
          { c: 'ui/b.tsx', r: 'member' },
          { c: 'ui/a.tsx', r: 'viewer' },
        ],
      },
      { declaredAccess: 2 }
    );
    assert.deepEqual(d, {
      outcome: 'mint',
      v2: true,
      claim: {
        v: 1,
        role: null,
        grants: [
          { c: 'ui/a.tsx', r: 'viewer' },
          { c: 'ui/b.tsx', r: 'member' },
        ],
      },
    });
  });

  it('an observer who declared is sent to the browser door — never a peer token', () => {
    assert.deepEqual(door({ v: 1, role: 'observer' }, { declaredAccess: 2 }), {
      outcome: 'browser-door',
      status: 409,
      body: { reason: 'browser-door', url: 'https://alligators.cloud.maude.sh' },
    });
    const canvasOnly = door(
      {
        v: 1,
        role: null,
        grants: [
          { c: 'ui/2026/Combine kampan.tsx', r: 'observer' },
          { c: 'ui/z.tsx', r: 'member' },
        ],
      },
      { declaredAccess: 2 }
    );
    assert.equal(canvasOnly.status, 409);
    assert.equal(
      canvasOnly.body.url,
      'https://alligators.cloud.maude.sh/c/ui/2026/Combine%20kampan.tsx'
    );
  });

  it('the browser lane IS the browser door: an observer mints there', () => {
    assert.deepEqual(door({ v: 1, role: 'observer' }, { declaredAccess: 2, browserLane: true }), {
      outcome: 'mint',
      claim: { v: 1, role: 'observer' },
      v2: true,
    });
  });

  it('a claim holding nothing mints nothing', () => {
    assert.deepEqual(door({ v: 1, role: null }, { declaredAccess: 2 }), { outcome: 'none' });
    assert.deepEqual(door(null), { outcome: 'none' });
  });

  it('X-Maude-Access parses fail-safe to 1', () => {
    assert.equal(declaredAccessOf('2'), 2);
    assert.equal(declaredAccessOf(' 3 '), 2);
    assert.equal(declaredAccessOf(['2']), 2);
    for (const v of [undefined, null, '', '1', 'two', '1.9']) assert.equal(declaredAccessOf(v), 1);
  });
});
