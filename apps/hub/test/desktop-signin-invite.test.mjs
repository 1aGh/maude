// An invitation accepted from the Maude app — issue #204 K2 (2.0.4).
//
// The desktop owns no login method for a team server, and that includes an invitation: the app opens
// the hub's OWN invite page (`/join/<key>`) with the same desktop request `/studio/signin` takes
// (`client=desktop&state&code_challenge&S256&redirect_uri=<loopback>`). The request rides the signed
// desktop cookie; the person chooses a password (or enters an existing one) on the hub's page; the
// redeem then ends in the desktop hand-off — a one-time code on loopback, no browser session — and
// the app trades the code for the token, exactly like a sign-in. The invite key stays where the hub
// always kept it: the invite link itself and the form's hidden field — never the hand-off URL.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { DESKTOP_RETURN_PATH, DESKTOP_TXN_COOKIE } from '../src/desktop-signin.mjs';
import { closeInvites, createInvite, peekInvite } from '../src/invites.mjs';
import { closeUsers, createUser } from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const RETURN = `http://127.0.0.1:49152${DESKTOP_RETURN_PATH}`;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const newState = () => randomBytes(16).toString('hex');
const desktopQuery = ({ state, challenge, redirectUri = RETURN }) =>
  new URLSearchParams({
    client: 'desktop',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
  }).toString();
const setCookies = (res) =>
  (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)).flat();
const cookieOf = (res, name) => {
  for (const c of setCookies(res)) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(c);
    if (m) return m[1];
  }
  return null;
};
const handoffHref = (html) => {
  const m = /<a href="([^"]+)">Go back to Maude<\/a>/.exec(html);
  return m ? new URL(m[1].replaceAll('&amp;', '&')) : null;
};

describe('an invitation accepted from the Maude app', () => {
  let dataDir;
  let hub;
  before(async () => {
    dataDir = tmpDir('maude-desktop-invite-');
    createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
    hub = await startHub(dataDir, { rateLimit: false });
  });
  after(async () => {
    await hub.close();
    closeInvites(dataDir);
    closeUsers(dataDir);
    rm(dataDir);
  });

  const exchange = (body) =>
    fetch(`${hub.http}/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  /** Open the invite page the way the app does, then submit its form the way the browser would. */
  async function joinThroughPage(value, form, { state, challenge }) {
    const page = await fetch(`${hub.http}/join/${value}?${desktopQuery({ state, challenge })}`, {
      headers: { accept: 'text/html' },
    });
    assert.equal(page.status, 200, await page.clone().text());
    const txn = cookieOf(page, DESKTOP_TXN_COOKIE);
    assert.ok(txn, 'the desktop request rides the signed cookie');
    const html = await page.text();
    assert.match(html, /action="\/join"/, 'the hub’s own invite form');
    assert.match(html, /go back to the Maude app/i, 'the page says where the person goes next');
    const done = await fetch(`${hub.http}/join`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        origin: hub.http,
        cookie: `${DESKTOP_TXN_COOKIE}=${txn}`,
      },
      body: new URLSearchParams({ token: value, ...form }),
    });
    return done;
  }

  test('new account: the invite page hands a one-time code to the app, never a session', async () => {
    const invite = createInvite(dataDir, { email: 'nina@x.test', role: 'member' });
    const { verifier, challenge } = pkce();
    const state = newState();
    const done = await joinThroughPage(
      invite.value,
      { email: 'nina@x.test', password: PW },
      { state, challenge }
    );
    assert.equal(done.status, 200, 'a hand-off PAGE (not the 303 into the browser studio)');
    assert.equal(cookieOf(done, 'maude_studio'), null, 'no browser session is left behind');
    assert.equal(cookieOf(done, DESKTOP_TXN_COOKIE), '', 'the desktop request is cleared');
    const html = await done.text();
    assert.equal(html.includes(invite.value), false, 'the invite key is not on the hand-off page');
    const href = handoffHref(html);
    assert.ok(href, 'the page links back to the app');
    assert.equal(`${href.origin}${href.pathname}`, RETURN);
    assert.equal(href.searchParams.get('state'), state);
    assert.deepEqual([...href.searchParams.keys()].sort(), ['code', 'state']);
    assert.equal(peekInvite(dataDir, invite.value).ok, false, 'the invite is spent');

    const r = await exchange({ code: href.searchParams.get('code'), code_verifier: verifier });
    assert.equal(r.status, 200, await r.clone().text());
    const body = await r.json();
    assert.equal(typeof body.token, 'string');
    assert.equal(body.user.email, 'nina@x.test');
  });

  test('a refused redeem (wrong address) issues nothing and keeps the invite', async () => {
    const invite = createInvite(dataDir, { email: 'otto@x.test', role: 'member' });
    const { challenge } = pkce();
    const done = await joinThroughPage(
      invite.value,
      { email: 'someone-else@x.test', password: PW },
      { state: newState(), challenge }
    );
    assert.notEqual(done.status, 200);
    assert.equal(handoffHref(await done.text()), null);
    assert.equal(peekInvite(dataDir, invite.value).ok, true, 'a typo is a retry');
  });

  test('a malformed desktop request on the invite page is refused and sets nothing', async () => {
    const invite = createInvite(dataDir, { email: 'pia@x.test', role: 'member' });
    const r = await fetch(
      `${hub.http}/join/${invite.value}?${desktopQuery({ state: newState(), challenge: pkce().challenge, redirectUri: 'https://evil.example/_api/hub-signin/return' })}`,
      { headers: { accept: 'text/html' } }
    );
    assert.equal(r.status, 400);
    assert.equal(cookieOf(r, DESKTOP_TXN_COOKIE), null);
    assert.equal(peekInvite(dataDir, invite.value).ok, true, 'looking never spends the invite');
  });

  test('without the desktop request the invite page is the browser one, as before', async () => {
    const invite = createInvite(dataDir, { email: 'rui@x.test', role: 'member' });
    const r = await fetch(`${hub.http}/join`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'text/html',
        origin: hub.http,
      },
      body: new URLSearchParams({ token: invite.value, email: 'rui@x.test', password: PW }),
    });
    assert.equal(r.status, 303);
    assert.ok(cookieOf(r, 'maude_studio'), 'the browser studio session');
  });
});
