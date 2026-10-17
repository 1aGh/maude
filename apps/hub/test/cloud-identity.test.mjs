// Cloud Phase 22 — one account, two authorities (DDR-204).
//
// Two properties carry this feature, and they pull in opposite directions:
// a cloud cell must NOT accept a local password, and a cloud cell must keep
// working when the control plane is unreachable. Most of these tests are about
// holding both at once.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ACCESS_TOKEN_TTL_MS,
  accessClaims,
  authenticateForMode,
  cloudIdentityEnabled,
  signAccessToken,
  verifyAccessToken,
} from '../src/cloud-identity.mjs';

const SECRET = 'a'.repeat(64);
const NOW = 1_700_000_000_000;
// Phase 23 B1: identity is its OWN explicit switch — the URL alone must
// never flip it (the 2026-07-30 regression). '1' = hybrid, 'strict' = tokens only.
const CLOUD = { MAUDE_CLOUD_IDENTITY: 'strict', MAUDE_TENANT_ID: 'alligators' };
const HYBRID = { MAUDE_CLOUD_IDENTITY: '1', MAUDE_TENANT_ID: 'alligators' };

const tokenFor = (over = {}, secret = SECRET) =>
  signAccessToken(
    accessClaims(
      { email: 'a@example.com', project: 'alligators', role: 'member', ...over },
      { now: NOW }
    ),
    secret
  );

describe('a self-hosted hub is untouched', () => {
  it('uses its own users when no control plane is configured', () => {
    // The moment the two paths fork, the self-hosted one starts rotting —
    // nobody on the cloud side ever runs it. One function, two configurations.
    let asked = null;
    const r = authenticateForMode(
      { email: 'a@example.com', password: 'pw' },
      {
        env: {},
        secret: SECRET,
        local: (email, password) => {
          asked = { email, password };
          return { ok: true, user: { email } };
        },
      }
    );
    assert.deepEqual(asked, { email: 'a@example.com', password: 'pw' });
    assert.equal(r.ok, true);
  });

  it('cloud mode is an EXPLICIT switch — a control-plane URL alone never flips it', () => {
    assert.equal(cloudIdentityEnabled({}), false);
    // The regression this guards: the mirror clock needs the URL, and the
    // URL must not double as consent to an authentication mode.
    assert.equal(
      cloudIdentityEnabled({ MAUDE_CONTROL_PLANE_URL: 'x', MAUDE_TENANT_ID: 'alligators' }),
      false
    );
    assert.equal(cloudIdentityEnabled(HYBRID), true);
    assert.equal(cloudIdentityEnabled(CLOUD), true);
  });

  it('HYBRID keeps the local password working alongside tokens', () => {
    let asked = null;
    const r = authenticateForMode(
      { email: 'a@example.com', password: 'pw' },
      {
        env: HYBRID,
        secret: SECRET,
        local: (email, password) => {
          asked = { email, password };
          return { ok: true, user: { email } };
        },
      }
    );
    assert.deepEqual(asked, { email: 'a@example.com', password: 'pw' });
    assert.equal(r.ok, true);
  });

  it('a viewer token is ADMITTED, carrying the role that makes it read-only', () => {
    // Until Phase 25 C1 this was a refusal: peer tokens were write-capable, so
    // honoring a viewer token would have handed a viewer an editor's session
    // and made the People page's "cannot change anything" promise false.
    // Enforcement now exists (read-only tokens + a protocol-level Yjs gate +
    // one HTTP gate), so the honest answer is to let them in and stop them
    // writing — which is what the role has meant to customers all along.
    const r = authenticateForMode(
      { token: tokenFor({ role: 'viewer' }) },
      { env: HYBRID, secret: SECRET, now: NOW, local: () => assert.fail('no local call') }
    );
    assert.equal(r.ok, true);
    assert.equal(r.user.role, 'viewer');
  });

  it('a token exchange surfaces the claim expiry so the session dies with it', () => {
    const r = authenticateForMode(
      { token: tokenFor() },
      { env: HYBRID, secret: SECRET, now: NOW, local: () => assert.fail('no local call') }
    );
    assert.equal(r.ok, true);
    assert.equal(r.expiresAt, NOW + ACCESS_TOKEN_TTL_MS);
  });
});

describe('a cloud cell has no passwords of its own', () => {
  it('refuses a local password without calling the local store at all', () => {
    let called = false;
    const r = authenticateForMode(
      { email: 'a@example.com', password: 'pw' },
      {
        env: CLOUD,
        secret: SECRET,
        local: () => {
          called = true;
          return { ok: true };
        },
      }
    );
    assert.equal(called, false);
    assert.equal(r.ok, false);
    // Must NOT read as "wrong password" — the password is not wrong, it is not
    // a thing that exists here — and must say where to go instead.
    assert.equal(r.reason, 'cloud-identity');
    assert.match(r.message, /Sign in at the Maude dashboard/);
    assert.ok(!/incorrect|wrong/i.test(r.message));
  });

  it('accepts a token the control plane minted', () => {
    const r = authenticateForMode(
      { token: tokenFor() },
      {
        env: CLOUD,
        secret: SECRET,
        now: NOW,
        local: () => assert.fail('local store must not be used'),
      }
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.user, { email: 'a@example.com', role: 'member' });
  });
});

describe('an outage must not lock anyone out of their own work', () => {
  it('verification is offline — no network, no lookup', () => {
    // The whole reason the token is SIGNED rather than looked up. An
    // already-issued token keeps working while the control plane is down;
    // only obtaining a new one needs it.
    const token = tokenFor();
    const r = verifyAccessToken(token, SECRET, { now: NOW + 60_000, tenantId: 'alligators' });
    assert.equal(r.ok, true);
  });

  it('a token still works most of a working day later', () => {
    const r = verifyAccessToken(tokenFor(), SECRET, {
      now: NOW + ACCESS_TOKEN_TTL_MS - 1000,
      tenantId: 'alligators',
    });
    assert.equal(r.ok, true);
  });
});

describe('a token for one project is not a token for another', () => {
  it('refuses a token minted for a different project', () => {
    // Without this check, one token is a token for every project that shares
    // the master — which is every project.
    const r = verifyAccessToken(tokenFor({ project: 'someone-else' }), SECRET, {
      now: NOW,
      tenantId: 'alligators',
    });
    assert.deepEqual(r, { ok: false, reason: 'wrong-project' });
  });

  it("refuses a token signed with another cell's secret", () => {
    const r = verifyAccessToken(tokenFor({}, 'b'.repeat(64)), SECRET, {
      now: NOW,
      tenantId: 'alligators',
    });
    assert.deepEqual(r, { ok: false, reason: 'bad-signature' });
  });
});

describe('every rejection says WHY', () => {
  it('names the reason instead of a bare false', () => {
    // A sign-in that fails with "invalid" and no reason is the failure mode
    // that produces support tickets nobody can answer.
    assert.equal(verifyAccessToken('', SECRET).reason, 'malformed');
    assert.equal(verifyAccessToken('nodot', SECRET).reason, 'malformed');
    assert.equal(
      verifyAccessToken(tokenFor(), SECRET, { now: NOW + ACCESS_TOKEN_TTL_MS + 1 }).reason,
      'expired'
    );
  });

  it('a tampered payload fails on the signature, not on the parse', () => {
    // Order matters: parsing attacker-controlled bytes before checking that
    // they are ours is the wrong way round.
    const [_body, sig] = tokenFor().split('.');
    const forged = Buffer.from(
      JSON.stringify({ email: 'evil@example.com', project: 'alligators', exp: NOW + 1e9 })
    ).toString('base64url');
    const r = verifyAccessToken(`${forged}.${sig}`, SECRET, { now: NOW, tenantId: 'alligators' });
    assert.equal(r.reason, 'bad-signature');
    assert.ok(!('user' in r));
  });

  it('a wrong-length signature is rejected, not thrown', () => {
    // timingSafeEqual THROWS on a length mismatch, and a thrown comparison is
    // a comparison that did not happen.
    const [body] = tokenFor().split('.');
    assert.doesNotThrow(() => verifyAccessToken(`${body}.QQ`, SECRET, { now: NOW }));
    assert.equal(verifyAccessToken(`${body}.QQ`, SECRET, { now: NOW }).reason, 'bad-signature');
  });
});

describe('HUB_OIDC_MODE=strict refuses password sign-in (B1-a)', () => {
  it('refuses local, and never calls the local authenticator', () => {
    let asked = null;
    const r = authenticateForMode(
      { email: 'a@example.com', password: 'pw' },
      {
        env: { HUB_OIDC_MODE: 'strict' },
        secret: SECRET,
        local: (email, password) => {
          asked = { email, password };
          return { ok: true, user: { email } };
        },
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'password-refused-oidc-strict');
    assert.equal(asked, null, 'the password store must not even be consulted');
  });

  it('hybrid mode still allows password sign-in', () => {
    const r = authenticateForMode(
      { email: 'a@example.com', password: 'pw' },
      { env: { HUB_OIDC_MODE: 'hybrid' }, secret: SECRET, local: () => ({ ok: true, user: {} }) }
    );
    assert.equal(r.ok, true);
  });
});
