// The invite rides through the provider sign-in and IS the approval.
//
// The pain this closes (design.studyfi.com): the join page's provider button
// was a plain link to /auth/oidc/start, so the invite was dropped, the invited
// person landed in the pending queue, and an admin approved by hand.
//
// The rule that must survive the fix (oidc-routes.mjs header): a subject is
// never linked to an EXISTING account because its email matches.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeAudit, listAudit } from '../src/audit-log.mjs';
import { DESKTOP_RETURN_PATH } from '../src/desktop-signin.mjs';
import { closeInvites, createInvite, listInvites } from '../src/invites.mjs';
import { readSettings, writeSettings } from '../src/settings.mjs';
import {
  closeUsers,
  createUser,
  getUser,
  getUserByOidcSub,
  listPendingOidc,
} from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';
import { browser, createFakeIssuer, oidcEnv, refreshTarget, signInAs } from './_fake-issuer.mjs';

const PW = 'correct horse battery staple';
let hub;
let dataDir;
let issuer;

before(async () => {
  dataDir = tmpDir('maude-oidc-invite-');
  issuer = await createFakeIssuer();
  hub = await startHub(dataDir, {
    env: oidcEnv(),
    oidcFetch: issuer.fetchImpl,
    rateLimit: false,
  });
});
after(async () => {
  await hub.close();
  closeUsers(dataDir);
  closeInvites(dataDir);
  closeAudit(dataDir);
  rm(dataDir);
});

const inviteStatus = (id) => listInvites(dataDir).find((i) => i.id === id)?.status;
const marek = { sub: 'sub-marek', email: 'marek@example.test' };

/** Open the invite, press the provider button, sign in as `person`. */
async function joinThroughProvider(invite, person, b = browser(hub.http), query = '') {
  const page = await b.get(`/join/${invite.value}${query}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(
    html,
    /<form method="post" action="\/auth\/oidc\/start"/,
    'the provider button POSTs'
  );
  assert.ok(
    !/href="\/auth\/oidc\/start"/.test(html),
    'and is no longer a link that drops the invite'
  );
  const started = await b.form('/auth/oidc/start', { invite: invite.value });
  assert.equal(started.status, 200, 'a hand-off page, not a 302 (form-action)');
  return { b, done: await signInAs(b, started, person) };
}

describe('an invited person signs in through the provider', () => {
  test('the invite is the approval: an account, a session, no pending row, the invite spent once', async () => {
    const invite = createInvite(dataDir, { email: marek.email, role: 'member' });
    const { b, done } = await joinThroughProvider(invite, marek);
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), '/');
    assert.ok(b.jar.get('maude_studio'), 'signed in');
    assert.equal(getUser(dataDir, marek.email)?.role, 'member');
    assert.equal(getUserByOidcSub(dataDir, marek.sub)?.email, marek.email, 'the subject is linked');
    assert.deepEqual(listPendingOidc(dataDir), [], 'no pending row');
    assert.equal(inviteStatus(invite.id), 'used');
    const kinds = listAudit(dataDir, { who: marek.email }).map((r) => r.kind);
    assert.ok(kinds.includes('invite-redeem'), 'the redeem is in the activity log');

    // The next sign-in is the ordinary linked one — and a second redeem of the same invite is impossible.
    const again = browser(hub.http);
    const replay = await again.form('/auth/oidc/start', { invite: invite.value });
    assert.equal(replay.status, 410, 'a spent invite does not start a sign-in');
    const plain = await signInAs(again, await again.get('/auth/oidc/start'), marek);
    assert.equal(plain.status, 302);
    assert.ok(again.jar.get('maude_studio'));
  });

  test('the invite value never travels in a URL, only in the signed HttpOnly cookie', async () => {
    const invite = createInvite(dataDir, { email: 'eva@example.test' });
    const b = browser(hub.http);
    await b.get(`/join/${invite.value}`);
    const started = await b.form('/auth/oidc/start', { invite: invite.value });
    const setCookie = started.headers.getSetCookie().join('\n');
    assert.match(setCookie, /maude_oidc_txn=[^;]+;[^\n]*HttpOnly/i);
    const html = await started.text();
    assert.ok(!refreshTarget(html).includes(invite.value), 'not in the provider URL');
    assert.ok(!html.includes(invite.value), 'not on the hand-off page');
    const asGet = await b.get(`/auth/oidc/start?invite=${invite.value}`);
    assert.notEqual(asGet.status, 200);
    await signInAs(b, asGet, { sub: 'sub-stranger', email: 'stranger@example.test' });
    assert.equal(
      inviteStatus(invite.id),
      'open',
      'a GET with the value in the query redeems nothing'
    );
  });

  test('a cross-site POST cannot start a sign-in with an invite', async () => {
    const invite = createInvite(dataDir, { email: 'csrf@example.test' });
    const res = await fetch(`${hub.http}/auth/oidc/start`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
        origin: 'https://evil.example',
      },
      body: new URLSearchParams({ invite: invite.value }).toString(),
    });
    assert.equal(res.status, 403);
  });

  test('an invite for another address is refused, says which address, offers another account, and is not burned', async () => {
    const invite = createInvite(dataDir, { email: 'petra@example.test' });
    const { b, done } = await joinThroughProvider(invite, {
      sub: 'sub-other',
      email: 'other@example.test',
    });
    assert.equal(done.status, 403);
    const html = await done.text();
    assert.match(html, /petra@example\.test/);
    assert.match(html, /Use another account/);
    assert.equal(b.jar.get('maude_studio'), undefined, 'no session');
    assert.equal(inviteStatus(invite.id), 'open', 'the invite survives');
    assert.equal(getUser(dataDir, 'other@example.test'), null);
    assert.ok(!listPendingOidc(dataDir).some((p) => p.sub === 'sub-other'), 'and nobody is queued');

    // "Use another account" carries the invite on, in a POST, and asks the provider to choose.
    const retry = await b.form('/auth/oidc/start', { invite: invite.value, switch: '1' });
    assert.match(refreshTarget(await retry.text()), /prompt=select_account/);
  });

  test('an existing account with that address is NEVER linked by email: pending, invite not burned', async () => {
    createUser(dataDir, { email: 'boss@example.test', password: PW, role: 'admin' });
    const invite = createInvite(dataDir, { role: 'member' }); // open invite, any address
    const { b, done } = await joinThroughProvider(invite, {
      sub: 'sub-attacker',
      email: 'boss@example.test',
    });
    assert.equal(done.status, 403);
    assert.equal(b.jar.get('maude_studio'), undefined);
    assert.equal(getUserByOidcSub(dataDir, 'sub-attacker'), null, 'not linked');
    assert.equal(inviteStatus(invite.id), 'open');
    assert.ok(
      listPendingOidc(dataDir).some((p) => p.sub === 'sub-attacker'),
      'queued, as before'
    );
  });

  test('an unverified or outside-domain email redeems nothing', async () => {
    const invite = createInvite(dataDir, {});
    for (const person of [
      { sub: 'sub-unverified', email: 'u@example.test', email_verified: false },
      { sub: 'sub-outside', email: 'someone@elsewhere.test' },
    ]) {
      const { b, done } = await joinThroughProvider(invite, person);
      assert.equal(done.status, 403);
      assert.equal(b.jar.get('maude_studio'), undefined);
      assert.equal(getUser(dataDir, person.email), null);
      assert.ok(
        !listPendingOidc(dataDir).some((p) => p.sub === person.sub),
        'and is not queued: only a verified, allow-listed address reaches the admin'
      );
    }
    assert.equal(inviteStatus(invite.id), 'open');
  });

  test('an invite with no address accepts any allowed verified address', async () => {
    const invite = createInvite(dataDir, { role: 'member' });
    const { done } = await joinThroughProvider(invite, {
      sub: 'sub-open',
      email: 'open@example.test',
    });
    assert.equal(done.status, 302);
    assert.equal(getUserByOidcSub(dataDir, 'sub-open')?.email, 'open@example.test');
    assert.equal(inviteStatus(invite.id), 'used');
  });

  test('password redemption of an invite still works (hybrid)', async () => {
    const invite = createInvite(dataDir, { email: 'pw@example.test' });
    const b = browser(hub.http);
    const res = await b.form('/join', {
      token: invite.value,
      email: 'pw@example.test',
      password: PW,
    });
    assert.equal(res.status, 303);
    assert.ok(b.jar.get('maude_studio'));
    assert.equal(inviteStatus(invite.id), 'used');
  });

  test('from the Maude app: the invited provider sign-in ends in a code the app trades for a token', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');
    const q = `?${new URLSearchParams({
      client: 'desktop',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      redirect_uri: `http://127.0.0.1:49152${DESKTOP_RETURN_PATH}`,
    })}`;
    const invite = createInvite(dataDir, { email: 'app@example.test' });
    const { b, done } = await joinThroughProvider(
      invite,
      { sub: 'sub-app', email: 'app@example.test' },
      browser(hub.http),
      q
    );
    assert.equal(done.status, 200, 'the hand-off page back to the app');
    assert.equal(b.jar.get('maude_studio'), undefined, 'no browser session');
    const back = new URL(refreshTarget(await done.text()));
    assert.equal(back.searchParams.get('state'), state);
    const exchanged = await fetch(`${hub.http}/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: back.searchParams.get('code'), code_verifier: verifier }),
    });
    assert.equal(exchanged.status, 200);
    const body = await exchanged.json();
    assert.ok(body.token);
    assert.equal(body.user.email, 'app@example.test');
    assert.deepEqual(
      listPendingOidc(dataDir).filter((p) => p.sub === 'sub-app'),
      []
    );
  });
});

describe('who can join (an uninvited subject)', () => {
  const setPolicy = (whoCanJoin) =>
    writeSettings(dataDir, { name: readSettings(dataDir).name, whoCanJoin });
  const uninvited = async (person) => {
    const b = browser(hub.http);
    return { b, done: await signInAs(b, await b.get('/auth/oidc/start'), person) };
  };
  const pendingSubs = () => listPendingOidc(dataDir).map((p) => p.sub);

  test('the default is "ask": the pending queue, as before', async () => {
    assert.equal(readSettings(dataDir).whoCanJoin, 'ask');
    const { b, done } = await uninvited({ sub: 'sub-ask', email: 'ask@example.test' });
    assert.equal(done.status, 403);
    assert.equal(b.jar.get('maude_studio'), undefined);
    assert.ok(pendingSubs().includes('sub-ask'));
  });

  test('"invite-only": turned away, no pending row', async () => {
    setPolicy('invite-only');
    const { b, done } = await uninvited({ sub: 'sub-turned', email: 'turned@example.test' });
    assert.equal(done.status, 403);
    assert.match(await done.text(), /invit/i);
    assert.equal(b.jar.get('maude_studio'), undefined);
    assert.ok(!pendingSubs().includes('sub-turned'));
    // …while an invite still lets its person in.
    const invite = createInvite(dataDir, { email: 'guest@example.test' });
    const joined = await joinThroughProvider(invite, {
      sub: 'sub-guest',
      email: 'guest@example.test',
    });
    assert.equal(joined.done.status, 302);
  });

  test('"domain": a verified colleague comes straight in as a member — never over an existing account', async () => {
    setPolicy('domain');
    const { b, done } = await uninvited({ sub: 'sub-col', email: 'colleague@example.test' });
    assert.equal(done.status, 302);
    assert.ok(b.jar.get('maude_studio'));
    assert.equal(
      getUser(dataDir, 'colleague@example.test')?.role,
      'member',
      'the lowest account role'
    );
    assert.equal(getUserByOidcSub(dataDir, 'sub-col')?.email, 'colleague@example.test');

    for (const person of [
      { sub: 'sub-out', email: 'x@elsewhere.test' },
      { sub: 'sub-unv', email: 'unv@example.test', email_verified: false },
    ]) {
      const r = await uninvited(person);
      assert.equal(r.done.status, 403);
      assert.equal(getUser(dataDir, person.email), null);
    }
    // boss@example.test exists (password account, not linked): no auto-link.
    const taken = await uninvited({ sub: 'sub-boss-2', email: 'boss@example.test' });
    assert.equal(taken.done.status, 403);
    assert.equal(getUserByOidcSub(dataDir, 'sub-boss-2'), null);
    setPolicy('ask');
  });

  test('an unknown policy value is refused', () => {
    assert.throws(() => setPolicy('everyone'), /who can join/i);
  });
});

describe('"Link my sign-in": an account holder links their own provider identity', () => {
  const seeded = { sub: 'sub-seeded', email: 'seeded@example.test' };

  test('without a link the seeded password admin lands in pending (no email auto-link)', async () => {
    createUser(dataDir, { email: seeded.email, password: PW, role: 'admin' });
    const b = browser(hub.http);
    const done = await signInAs(b, await b.get('/auth/oidc/start'), seeded);
    assert.equal(done.status, 403);
    assert.equal(getUserByOidcSub(dataDir, seeded.sub), null);
  });

  test('signed in with the password, the same verified address links — and then signs in directly', async () => {
    const b = browser(hub.http);
    const signedIn = await b.form('/studio/signin', { email: seeded.email, password: PW });
    assert.equal(signedIn.status, 302);
    const started = await b.form('/auth/oidc/start', { link: '1' });
    assert.equal(started.status, 200);
    const done = await signInAs(b, started, seeded);
    assert.equal(done.status, 302);
    assert.equal(getUserByOidcSub(dataDir, seeded.sub)?.email, seeded.email);
    assert.ok(
      !listPendingOidc(dataDir).some((p) => p.sub === seeded.sub),
      'the pending row is gone'
    );
    assert.ok(listAudit(dataDir, { kind: 'oidc-self-link' }).length >= 1);

    const fresh = browser(hub.http);
    const again = await signInAs(fresh, await fresh.get('/auth/oidc/start'), seeded);
    assert.equal(again.status, 302);
    assert.ok(fresh.jar.get('maude_studio'));
  });

  test('it links only the signed-in account, and only for the SAME verified address', async () => {
    createUser(dataDir, { email: 'second@example.test', password: PW, role: 'member' });
    // not signed in → refused before the provider is contacted
    const anon = await browser(hub.http).form('/auth/oidc/start', { link: '1' });
    assert.equal(anon.status, 401);

    const b = browser(hub.http);
    await b.form('/studio/signin', { email: 'second@example.test', password: PW });
    const done = await signInAs(b, await b.form('/auth/oidc/start', { link: '1' }), {
      sub: 'sub-someone-else',
      email: 'someone-else@example.test',
    });
    assert.equal(done.status, 403);
    assert.equal(getUserByOidcSub(dataDir, 'sub-someone-else'), null);

    // the session ended between start and callback → nothing is linked
    const c = browser(hub.http);
    await c.form('/studio/signin', { email: 'second@example.test', password: PW });
    const started = await c.form('/auth/oidc/start', { link: '1' });
    c.jar.delete('maude_studio');
    const lost = await signInAs(c, started, { sub: 'sub-second', email: 'second@example.test' });
    assert.equal(lost.status, 403);
    assert.equal(getUserByOidcSub(dataDir, 'sub-second'), null);
  });
});
