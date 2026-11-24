// Security review of the team-server admin (2026-11-24) — one test per finding.
//
// The thread through all of them: a browser SESSION must never be able to
// leave behind a credential its thief keeps, a removed person must stay
// removed, and a link must not leave an older way in standing.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { closeAudit, listAudit, recordAudit } from '../src/audit-log.mjs';
import { closeInvites, createInvite, listInvites } from '../src/invites.mjs';
import { usableEmailClaim } from '../src/oidc.mjs';
import { readSettings, writeSettings } from '../src/settings.mjs';
import { listTokensForOwner } from '../src/tokens.mjs';
import {
  authenticate,
  closeUsers,
  createUser,
  getUser,
  getUserByOidcSub,
  linkOidcSub,
  listPendingOidc,
  recordPendingOidc,
} from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';
import { browser, createFakeIssuer, oidcEnv, signInAs } from './_fake-issuer.mjs';

const PW = 'correct horse battery staple';
let hub;
let dataDir;
let admin;

const key = async (path, body) => {
  const res = await fetch(`${hub.http}/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer test-secret',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, json: await res.json() };
};
const via = async (b, path, body) => {
  const res = await b.json(`/admin/api${path}`, body);
  return { status: res.status, json: await res.json() };
};
async function signedIn(email, password = PW) {
  const b = browser(hub.http);
  const res = await b.form('/studio/signin', { email, password });
  assert.equal(res.status, 302);
  return b;
}
const provider = async (person, b = browser(hub.http)) => ({
  b,
  done: await signInAs(b, await b.get('/auth/oidc/start'), person),
});
const setPolicy = (whoCanJoin) =>
  writeSettings(dataDir, { name: readSettings(dataDir).name, whoCanJoin });
const pending = (sub) => listPendingOidc(dataDir).some((p) => p.sub === sub);

before(async () => {
  dataDir = tmpDir('maude-admin-sec-');
  createUser(dataDir, { email: 'michal@example.test', password: PW, role: 'admin' });
  createUser(dataDir, { email: 'jonas@example.test', password: PW, role: 'member' });
  const issuer = await createFakeIssuer();
  hub = await startHub(dataDir, { rateLimit: false, env: oidcEnv(), oidcFetch: issuer.fetchImpl });
  admin = await signedIn('michal@example.test');
});
after(async () => {
  await hub.close();
  closeUsers(dataDir);
  closeInvites(dataDir);
  closeAudit(dataDir);
  rm(dataDir);
});

describe('1 · a session cannot leave a credential behind', () => {
  test('no password is set, reset or created through a session; /oidc/link and /oidc/approve are key-only', async () => {
    recordPendingOidc(dataDir, { sub: 'sub-evil', email: 'evil@example.test' });
    for (const [path, body] of [
      ['/users', { email: 'backdoor@example.test', password: PW, role: 'admin' }],
      ['/users/password', { email: 'jonas@example.test', password: 'attacker-chosen-pass-1' }],
      ['/users/password', { email: 'michal@example.test', password: 'attacker-chosen-pass-1' }],
      ['/oidc/link', { sub: 'sub-evil', email: 'jonas@example.test' }],
      ['/oidc/approve', { sub: 'sub-evil', email: 'boss@example.test', role: 'admin' }],
      ['/oidc/unlink', { email: 'jonas@example.test' }],
    ]) {
      const res = await via(admin, path, body);
      assert.equal(res.status, 403, path);
      assert.equal(res.json.reason, 'admin-key-required', path);
    }
    assert.equal(getUser(dataDir, 'backdoor@example.test'), null);
    assert.equal(
      authenticate(dataDir, 'jonas@example.test', PW).ok,
      true,
      'the password is untouched'
    );
    assert.equal(getUserByOidcSub(dataDir, 'sub-evil'), null);
    // Promoting through a session stays allowed — it hands the caller no credential.
    assert.equal(
      (await via(admin, '/people/role', { email: 'jonas@example.test', role: 'admin' })).status,
      200
    );
    await key('/people/role', { email: 'jonas@example.test', role: 'member' });
    await key('/people/dismiss', { sub: 'sub-evil' });
    // The admin key still does all of it.
    assert.equal(
      (await key('/users/password', { email: 'jonas@example.test', password: PW })).status,
      200
    );
  });

  test('an Admin invite always names an address — no unbound admin link', async () => {
    for (const b of [(p, body) => via(admin, p, body), key]) {
      const res = await b('/people/invite', { role: 'admin' });
      assert.equal(res.status, 400);
      assert.match(res.json.error, /address/i);
    }
    assert.ok(!listInvites(dataDir).some((i) => i.role === 'admin' && !i.email));
    assert.equal(
      (await key('/people/invite', { role: 'admin', emails: ['new-admin@example.test'] })).status,
      201
    );
    assert.equal(
      (await key('/people/invite', { role: 'member' })).status,
      201,
      'an open Can edit link is still fine'
    );
  });
});

describe('2 · removed and dismissed people stay out, in every "who can join" mode', () => {
  const col = { sub: 'sub-col', email: 'col@example.test' };

  test('Remove under "domain": the person asks to join instead of walking back in; Let in restores them', async () => {
    setPolicy('domain');
    assert.equal((await provider(col)).done.status, 302, 'came straight in');
    assert.equal((await key('/people/remove', { email: col.email })).status, 200);
    const back = await provider(col);
    assert.equal(back.done.status, 403, 'removed means removed');
    assert.equal(getUser(dataDir, col.email), null);
    assert.ok(pending(col.sub), 'they are under Asks to join');
    // The same person under a NEW subject, or the same subject under a new address: still not let in.
    assert.equal((await provider({ sub: 'sub-col-2', email: col.email })).done.status, 403);
    assert.equal(getUser(dataDir, col.email), null);
    // An open link for anyone does not get them round it either.
    const open = createInvite(dataDir, { role: 'member' });
    const b = browser(hub.http);
    const viaInvite = await signInAs(
      b,
      await b.form('/auth/oidc/start', { invite: open.value }),
      col
    );
    assert.equal(viaInvite.status, 403);
    assert.equal(listInvites(dataDir).find((i) => i.id === open.id).status, 'open');

    assert.equal((await key('/people/let-in', { sub: col.sub })).status, 201);
    assert.equal((await provider(col)).done.status, 302, 'let in again by an admin');
    await key('/people/remove', { email: col.email });
    assert.equal((await provider(col)).done.status, 403);
    // …and an invitation that NAMES them is the admin saying yes again.
    const named = (await key('/people/invite', { emails: [col.email] })).json.invites[0];
    const c = browser(hub.http);
    const joined = await signInAs(
      c,
      await c.form('/auth/oidc/start', { invite: named.url.split('/join/')[1] }),
      col
    );
    assert.equal(joined.status, 302);
    setPolicy('ask');
  });

  test('Dismiss under "domain": the dismissed subject is queued again, not admitted', async () => {
    const d = { sub: 'sub-dis', email: 'dis@example.test' };
    assert.equal((await provider(d)).done.status, 403, 'asks (policy: ask)');
    await key('/people/dismiss', { sub: d.sub });
    setPolicy('domain');
    assert.equal((await provider(d)).done.status, 403);
    assert.equal(getUser(dataDir, d.email), null);
    assert.ok(pending(d.sub));
    setPolicy('invite-only');
    await key('/people/dismiss', { sub: d.sub });
    assert.equal((await provider(d)).done.status, 403);
    assert.ok(pending(d.sub), 'queued even under invite-only, so an admin can see and decide');
    setPolicy('ask');
    await key('/people/dismiss', { sub: d.sub });
  });
});

describe('3 · a link ends the older ways in', () => {
  test('"Link my sign-in": the password stops working and every OTHER session ends', async () => {
    createUser(dataDir, { email: 'anna@example.test', password: PW, role: 'member' });
    const squatter = await signedIn('anna@example.test'); // whoever made the account first
    const anna = await signedIn('anna@example.test');
    const done = await signInAs(anna, await anna.form('/auth/oidc/start', { link: '1' }), {
      sub: 'sub-anna',
      email: 'anna@example.test',
    });
    assert.equal(done.status, 302);
    assert.equal(
      authenticate(dataDir, 'anna@example.test', PW).ok,
      false,
      'the old password is dead'
    );
    assert.equal(listTokensForOwner(dataDir, 'anna@example.test').length, 1, 'one session left');
    assert.equal((await via(anna, '/me')).json.signedIn, true, 'the one that linked');
    assert.equal((await via(squatter, '/me')).json.signedIn, false, 'the other is signed out');
    // Only the admin key gives the account a password again.
    assert.equal(
      (await key('/users/password', { email: 'anna@example.test', password: PW })).status,
      200
    );
  });

  test("an admin-key link does the same, and ends ALL the account's sessions", async () => {
    createUser(dataDir, { email: 'ota@example.test', password: PW, role: 'member' });
    const ota = await signedIn('ota@example.test');
    recordPendingOidc(dataDir, { sub: 'sub-ota', email: 'ota@example.test' });
    const res = await key('/oidc/link', { sub: 'sub-ota', email: 'ota@example.test' });
    assert.equal(res.status, 200);
    assert.equal(authenticate(dataDir, 'ota@example.test', PW).ok, false);
    assert.equal(listTokensForOwner(dataDir, 'ota@example.test').length, 0);
    assert.equal((await via(ota, '/me')).json.signedIn, false);
  });

  test('an invite that names an address makes the account for THAT address only (password join)', async () => {
    const invite = createInvite(dataDir, { email: 'named@example.test', role: 'member' });
    const b = browser(hub.http);
    const res = await b.form('/join', {
      token: invite.value,
      email: 'other@example.test',
      password: PW,
    });
    assert.notEqual(res.status, 303);
    assert.equal(getUser(dataDir, 'other@example.test'), null);
    assert.equal(listInvites(dataDir).find((i) => i.id === invite.id).status, 'open');
  });
});

describe('4 · a link never overwrites another', () => {
  test('linkOidcSub refuses an account that already has a different sign-in; unlink is an admin-key act', async () => {
    createUser(dataDir, { email: 'eva@example.test', password: PW, role: 'member' });
    recordPendingOidc(dataDir, { sub: 'sub-eva-1', email: 'eva@example.test' });
    recordPendingOidc(dataDir, { sub: 'sub-eva-2', email: 'eva@example.test' });
    linkOidcSub(dataDir, 'eva@example.test', 'sub-eva-1');
    assert.throws(() => linkOidcSub(dataDir, 'eva@example.test', 'sub-eva-2'), /already has/);
    const refused = await key('/oidc/link', { sub: 'sub-eva-2', email: 'eva@example.test' });
    assert.equal(refused.status, 400);
    assert.equal(getUserByOidcSub(dataDir, 'sub-eva-1')?.email, 'eva@example.test');
    assert.equal(getUserByOidcSub(dataDir, 'sub-eva-2'), null);

    assert.equal((await key('/oidc/unlink', { email: 'eva@example.test' })).status, 200);
    assert.equal(getUserByOidcSub(dataDir, 'sub-eva-1'), null);
    assert.equal(
      (await key('/oidc/link', { sub: 'sub-eva-2', email: 'eva@example.test' })).status,
      200
    );
    assert.ok(listAudit(dataDir, { kind: 'oidc-unlink' }).length >= 1);
  });
});

describe('5 · the email claim is one spelling', () => {
  test('usableEmailClaim trims and lowercases before the domain check and the return', () => {
    const claim = (email) => usableEmailClaim({ email, emailVerified: true }, ['example.test']);
    assert.equal(claim('  Marek@Example.TEST '), 'marek@example.test');
    assert.equal(claim('MAREK@EXAMPLE.TEST'), 'marek@example.test');
    assert.equal(claim('marek@elsewhere.test'), null);
    assert.equal(claim('   '), null);
    assert.equal(usableEmailClaim({ email: 'A@B.c', emailVerified: true }), 'a@b.c');
    assert.equal(
      usableEmailClaim({ email: 'A@example.test', emailVerified: false }, ['example.test']),
      null
    );
  });

  test('an invite for marek@… is redeemed by a provider that says Marek@…', async () => {
    const invite = createInvite(dataDir, { email: 'casey@example.test' });
    const b = browser(hub.http);
    const done = await signInAs(b, await b.form('/auth/oidc/start', { invite: invite.value }), {
      sub: 'sub-casey',
      email: ' Casey@Example.Test',
    });
    assert.equal(done.status, 302);
    assert.equal(getUserByOidcSub(dataDir, 'sub-casey')?.email, 'casey@example.test');
  });
});

describe('6 · notes', () => {
  test('"Last here" comes from sign-ins that succeeded — never from asking or being turned away', async () => {
    createUser(dataDir, { email: 'quiet@example.test', password: PW, role: 'member' });
    recordAudit(dataDir, { kind: 'oidc-pending', actor: 'quiet@example.test' });
    recordAudit(dataDir, { kind: 'oidc-refused', actor: 'quiet@example.test' });
    const row = (await key('/people')).json.people.find((p) => p.email === 'quiet@example.test');
    assert.equal(row.lastSeen, null);
    await signedIn('quiet@example.test');
    const after_ = (await key('/people')).json.people.find((p) => p.email === 'quiet@example.test');
    assert.ok(after_.lastSeen > 0);
  });

  test('on a cloud cell an unauthenticated GET /admin/api/me is the 401 it always was', async () => {
    const d = tmpDir('maude-admin-sec-cell-');
    const cell = await startHub(d, { rateLimit: false, env: { MAUDE_CLOUD_IDENTITY: '1' } });
    try {
      const res = await fetch(`${cell.http}/admin/api/me`);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: 'unauthorized' });
      const withKey = await fetch(`${cell.http}/admin/api/me`, {
        headers: { authorization: 'Bearer test-secret' },
      });
      assert.equal(withKey.status, 200);
    } finally {
      await cell.close();
      closeAudit(d);
      rm(d);
    }
  });

  test('on a strict cloud cell the admin key cannot make a local account or change who can join', async () => {
    const d = tmpDir('maude-admin-sec-strict-');
    const cell = await startHub(d, { rateLimit: false, env: { MAUDE_CLOUD_IDENTITY: 'strict' } });
    const call = async (path, body) => {
      const res = await fetch(`${cell.http}/admin/api${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: 'Bearer test-secret',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: res.status, json: await res.json() };
    };
    try {
      const made = await call('/users', { email: 'x@example.test', password: PW, role: 'member' });
      assert.equal(made.status, 409);
      assert.match(made.json.error, /Maude Cloud/);
      assert.deepEqual((await call('/users')).json.users, []);

      const join = await call('/settings', { name: 'Cell', whoCanJoin: 'domain' });
      assert.equal(join.status, 409);
      const now = (await call('/settings')).json;
      assert.equal(now.whoCanJoin, 'ask', 'not persisted');
      assert.notEqual(now.name, 'Cell', 'a refused save saves nothing');
      // Name and description keep working as they always did.
      const named = await call('/settings', { name: 'Cell', description: 'ours' });
      assert.equal(named.status, 200);
      assert.equal((await call('/settings')).json.name, 'Cell');
    } finally {
      await cell.close();
      closeUsers(d);
      closeAudit(d);
      rm(d);
    }
  });
});
