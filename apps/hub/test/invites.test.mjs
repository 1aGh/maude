// Cloud Phase 6 Task 1 — magic-link invites.
//
// The persona is the invited teammate who has never used git. The mechanics
// that matter are all about what an invite must NOT be: not reusable, not
// survivable past expiry, not burnable by a link preview bot, and not
// recoverable by someone who reads the database.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import {
  closeInvites,
  createInvite,
  invitesDbPath,
  inviteTtlMs,
  inviteUrl,
  listInvites,
  peekInvite,
  purgeExpiredInvites,
  redeemInvite,
  revokeInvite,
} from '../src/invites.mjs';

let dataDir;
const accounts = [];
const createAccount = ({ email, password, role }) => {
  if (!password || password.length < 12) throw new Error('password must be at least 12 characters');
  if (accounts.some((a) => a.email === email)) throw new Error(`user "${email}" already exists`);
  const user = { email, role };
  accounts.push(user);
  return user;
};

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-invites-'));
  accounts.length = 0;
});
afterEach(() => {
  if (dataDir) {
    closeInvites(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ minting

test('an invite is minted once and its raw value is never stored', () => {
  // Someone who reads the database must not be able to redeem an outstanding
  // invite — the same reason peer tokens are hashed at rest.
  const invite = createInvite(dataDir, { createdBy: 'alice@example.com' });
  assert.match(invite.value, /^inv_[0-9a-f]{48}$/);
  assert.ok(invite.expiresAt > Date.now());

  const raw = readFileSync(invitesDbPath(dataDir));
  assert.ok(!raw.includes(invite.value), 'the raw invite value must not appear on disk');
});

test('an invite for a role accounts cannot hold is refused, never stored as a writer', () => {
  // F3/S02 on a real self-host hub: "invite a viewer" answered 201 with
  // role 'viewer' while storing 'member', and the joined account could write.
  for (const role of ['viewer', 'owner', 'superuser', null]) {
    assert.throws(() => createInvite(dataDir, { role }), /role must be one of: admin, member/);
  }
  const created = [];
  const redeemed = redeemInvite(dataDir, {
    value: createInvite(dataDir, { role: 'member' }).value,
    email: 'bob@example.com',
    password: 'correct horse battery staple',
    createAccount: (account) => {
      created.push(account);
      return { email: account.email, role: account.role };
    },
  });
  assert.equal(redeemed.ok, true);
  assert.deepEqual(
    created.map((a) => a.role),
    ['member']
  );
  assert.equal(createInvite(dataDir, { role: 'admin' }).role, 'admin');
});

test('the token sits in the PATH, not a query string', () => {
  // Query strings are what analytics and link-preview tooling copy around.
  const invite = createInvite(dataDir);
  const url = inviteUrl('https://acme.cloud.maude.sh/', invite.value);
  assert.equal(url, `https://acme.cloud.maude.sh/join/${invite.value}`);
  assert.ok(!url.includes('?'));
});

test('the lifetime defaults to a week and is clamped to a month', () => {
  assert.equal(inviteTtlMs(undefined), 7 * 24 * 3600_000);
  assert.equal(inviteTtlMs(0), 7 * 24 * 3600_000);
  assert.equal(inviteTtlMs('nonsense'), 7 * 24 * 3600_000);
  assert.equal(inviteTtlMs(1), 3600_000);
  // An invite that never expires is a permanent way into someone's project.
  assert.equal(inviteTtlMs(99_999), 30 * 24 * 3600_000);
});

// -------------------------------------------------------------------- peek

test('LOOKING at an invite does not consume it', () => {
  // A crawler, a link preview, or a corporate mail scanner following the link
  // must not burn the invite — otherwise it arrives already used, which is a
  // very ordinary way for this to fail.
  const invite = createInvite(dataDir);
  for (let i = 0; i < 5; i++) {
    assert.equal(peekInvite(dataDir, invite.value).ok, true, `peek ${i + 1} must still be valid`);
  }
  const redeemed = redeemInvite(dataDir, {
    value: invite.value,
    email: 'bob@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(redeemed.ok, true);
});

test('peek distinguishes unknown, expired, revoked and used', () => {
  assert.deepEqual(peekInvite(dataDir, 'inv_nope'), { ok: false, reason: 'unknown' });
  assert.deepEqual(peekInvite(dataDir, 'not-even-an-invite'), { ok: false, reason: 'unknown' });

  const expired = createInvite(dataDir, { ttlHours: 1 });
  assert.equal(peekInvite(dataDir, expired.value, Date.now() + 2 * 3600_000).reason, 'expired');

  const revoked = createInvite(dataDir);
  assert.equal(revokeInvite(dataDir, revoked.id), true);
  assert.equal(peekInvite(dataDir, revoked.value).reason, 'revoked');
  assert.equal(revokeInvite(dataDir, revoked.id), false, 'revoking twice is not a second event');

  const used = createInvite(dataDir);
  redeemInvite(dataDir, {
    value: used.value,
    email: 'carol@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(peekInvite(dataDir, used.value).reason, 'already-used');
});

// ---------------------------------------------------------------- redeeming

test('redeeming creates the account and the invite is then spent', () => {
  const invite = createInvite(dataDir, { role: 'member' });
  const res = redeemInvite(dataDir, {
    value: invite.value,
    email: 'Dave@Example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.user, { email: 'dave@example.com', role: 'member' });

  const again = redeemInvite(dataDir, {
    value: invite.value,
    email: 'eve@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already-used');
  assert.equal(accounts.length, 1, 'the second attempt must not create an account');
});

test('a FAILED signup leaves the invite usable — a typo must not burn it', () => {
  const invite = createInvite(dataDir);
  const tooWeak = redeemInvite(dataDir, {
    value: invite.value,
    email: 'frank@example.com',
    password: 'short',
    createAccount,
  });
  assert.equal(tooWeak.ok, false);
  assert.equal(tooWeak.reason, 'account-failed');
  assert.equal(peekInvite(dataDir, invite.value).ok, true, 'the invite survives a failed attempt');

  const retry = redeemInvite(dataDir, {
    value: invite.value,
    email: 'frank@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(retry.ok, true);
});

test('the invite carries the ROLE — a member invite cannot mint an admin', () => {
  const memberInvite = createInvite(dataDir, { role: 'member' });
  const res = redeemInvite(dataDir, {
    value: memberInvite.value,
    email: 'grace@example.com',
    password: 'a-perfectly-fine-password',
    // The caller cannot smuggle a role past this: redeemInvite passes the
    // invite's role, never the request's.
    createAccount: ({ email, role }) => ({ email, role }),
  });
  assert.equal(res.user.role, 'member');

  const adminInvite = createInvite(dataDir, { role: 'admin' });
  const asAdmin = redeemInvite(dataDir, {
    value: adminInvite.value,
    email: 'heidi@example.com',
    password: 'a-perfectly-fine-password',
    createAccount: ({ email, role }) => ({ email, role }),
  });
  assert.equal(asAdmin.user.role, 'admin');
});

test('a BOUND invite enforces its address — the role travels with the link', () => {
  // An invite carries a role, so treating its address as a mere hint means a
  // forwarded link mints an account of the invited role under whatever address
  // the redeemer types (B5). A bound invite is for one person; forwarding it is
  // supposed to break. "Invite whoever" is what an UNBOUND invite is for.
  const bound = createInvite(dataDir, { email: 'intended@example.com', role: 'admin' });
  const stolen = redeemInvite(dataDir, {
    value: bound.value,
    email: 'attacker@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(stolen.ok, false);
  assert.equal(stolen.reason, 'email-mismatch');

  // Redeemed AS the bound address, it works — with or without the redeemer
  // restating it.
  const ok = redeemInvite(dataDir, {
    value: bound.value,
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.user.email, 'intended@example.com');
});

test('an UNBOUND invite lets the redeemer choose the address', () => {
  // The small-team "forward it to whoever" workflow, made explicit rather than
  // smuggled through a bound invite's address.
  const invite = createInvite(dataDir, {});
  const res = redeemInvite(dataDir, {
    value: invite.value,
    email: 'actual-colleague@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(res.ok, true);
  assert.equal(res.user.email, 'actual-colleague@example.com');
});

test('an expired invite cannot be redeemed', () => {
  const invite = createInvite(dataDir, { ttlHours: 1 });
  const res = redeemInvite(
    dataDir,
    {
      value: invite.value,
      email: 'ivan@example.com',
      password: 'a-perfectly-fine-password',
      createAccount,
    },
    Date.now() + 2 * 3600_000
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'expired');
  assert.equal(accounts.length, 0);
});

test('a revoked invite cannot be redeemed', () => {
  const invite = createInvite(dataDir);
  revokeInvite(dataDir, invite.id);
  const res = redeemInvite(dataDir, {
    value: invite.value,
    email: 'judy@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'revoked');
});

test('single-use is enforced by the DATABASE, not by the read before it', () => {
  // Two simultaneous redemptions both pass peekInvite; exactly one may win.
  const invite = createInvite(dataDir);
  const attempt = (email) =>
    redeemInvite(dataDir, {
      value: invite.value,
      email,
      password: 'a-perfectly-fine-password',
      createAccount: ({ email: e, role }) => ({ email: e, role }),
    });
  const results = [attempt('a@example.com'), attempt('b@example.com')];
  assert.equal(results.filter((r) => r.ok).length, 1, 'exactly one redemption may succeed');
});

// ------------------------------------------------------------ admin surface

test('the admin listing never exposes anything redeemable', () => {
  const invite = createInvite(dataDir, {
    email: 'kim@example.com',
    createdBy: 'alice@example.com',
  });
  const [listed] = listInvites(dataDir);
  assert.equal(listed.id, invite.id);
  assert.equal(listed.status, 'open');
  const serialized = JSON.stringify(listInvites(dataDir));
  assert.ok(!serialized.includes(invite.value), 'the value must never be listed');
  assert.ok(!serialized.includes('hash'), 'the hash must never be listed');
});

test('the listing reports each status accurately', () => {
  const open = createInvite(dataDir);
  const used = createInvite(dataDir);
  const revoked = createInvite(dataDir);
  const expired = createInvite(dataDir, { ttlHours: 1 });

  redeemInvite(dataDir, {
    value: used.value,
    email: 'l@example.com',
    password: 'a-perfectly-fine-password',
    createAccount,
  });
  revokeInvite(dataDir, revoked.id);

  const byId = Object.fromEntries(
    listInvites(dataDir, { now: Date.now() + 2 * 3600_000 }).map((i) => [i.id, i.status])
  );
  // `open` was minted with the default 7-day window, so two hours later it is
  // still open — which is the point: status is computed against the probe time,
  // not assumed from creation order.
  assert.equal(byId[open.id], 'open');
  assert.equal(byId[used.id], 'used');
  assert.equal(byId[revoked.id], 'revoked');
  assert.equal(byId[expired.id], 'expired');
});

test('purging removes only long-expired, unredeemed invites', () => {
  const fresh = createInvite(dataDir);
  assert.equal(purgeExpiredInvites(dataDir), 0, 'a live invite is never purged');
  assert.equal(listInvites(dataDir).length, 1);
  assert.equal(peekInvite(dataDir, fresh.value).ok, true);
});
