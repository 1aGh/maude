// The desktop signs in through the hub's own page — issue #204 (2.0.4).
//
// Decision `maude/v2-michal-team-server-signin-via-hub-page`: the desktop has
// no login method of its own for a team server. It opens `/studio/signin?
// client=desktop&state&code_challenge&redirect_uri=<loopback>`, the person
// signs in there (password or OIDC), the hub hands back a ONE-TIME code on a
// loopback hop, and the app trades it — with the PKCE verifier only it holds —
// for the same token `/auth/login` mints.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { handleOidc } from '../src/browser-auth.mjs';
import {
  createDesktopCodes,
  DESKTOP_RETURN_PATH,
  DESKTOP_SIGNIN_CAPABILITY,
  DESKTOP_TXN_COOKIE,
  encodeDesktopTxn,
  parseDesktopRequest,
  readDesktopTxn,
  validReturnUri,
} from '../src/desktop-signin.mjs';
import { closeUsers, createUser, linkOidcSub } from '../src/users.mjs';
import { rm, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const RETURN = `http://127.0.0.1:49152${DESKTOP_RETURN_PATH}`;

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const newState = () => randomBytes(16).toString('hex');

function desktopQuery({ state, challenge, redirectUri = RETURN, ...extra }) {
  return new URLSearchParams({
    client: 'desktop',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    ...extra,
  }).toString();
}

const setCookies = (res) => {
  const raw = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  return raw.flat();
};
const cookieOf = (res, name) => {
  for (const c of setCookies(res)) {
    const m = new RegExp(`^${name}=([^;]*)`).exec(c);
    if (m) return m[1];
  }
  return null;
};
/** The `href` of the hand-off page's "Go back to Maude" link. */
const handoffHref = (html) => {
  const m = /<a href="([^"]+)">Go back to Maude<\/a>/.exec(html);
  return m ? new URL(m[1].replaceAll('&amp;', '&')) : null;
};

describe('the request grammar', () => {
  test('a redirect target is loopback, http, one exact path, nothing else', () => {
    assert.equal(validReturnUri(RETURN), true);
    assert.equal(validReturnUri(`http://localhost:5000${DESKTOP_RETURN_PATH}`), true);
    assert.equal(validReturnUri(`http://[::1]:5000${DESKTOP_RETURN_PATH}`), true);
    for (const bad of [
      `https://127.0.0.1:5000${DESKTOP_RETURN_PATH}`,
      `http://127.0.0.1${DESKTOP_RETURN_PATH}`,
      `http://evil.example:5000${DESKTOP_RETURN_PATH}`,
      `http://127.0.0.1.evil.example:5000${DESKTOP_RETURN_PATH}`,
      `http://user@127.0.0.1:5000${DESKTOP_RETURN_PATH}`,
      `http://127.0.0.1:5000${DESKTOP_RETURN_PATH}?x=1`,
      `http://127.0.0.1:5000${DESKTOP_RETURN_PATH}#x`,
      'http://127.0.0.1:5000/_api/hub-signin/other',
      `http://127.0.0.1:5000/a/..${DESKTOP_RETURN_PATH}`,
      `maude://open/x`,
      `javascript:alert(1)`,
      '',
    ]) {
      assert.equal(validReturnUri(bad), false, bad);
    }
  });

  test('no client ⇒ an ordinary sign-in; a malformed desktop request is refused', () => {
    assert.deepEqual(parseDesktopRequest(new URLSearchParams('')), { desktop: false });
    const { challenge } = pkce();
    const ok = parseDesktopRequest(
      new URLSearchParams(desktopQuery({ state: newState(), challenge }))
    );
    assert.equal(ok.ok, true);
    for (const q of [
      desktopQuery({ state: 'short', challenge }),
      desktopQuery({ state: newState(), challenge: 'x' }),
      desktopQuery({ state: newState(), challenge, code_challenge_method: 'plain' }),
      desktopQuery({ state: newState(), challenge, redirectUri: 'https://evil.example/' }),
      'client=mobile',
    ]) {
      assert.equal(parseDesktopRequest(new URLSearchParams(q)).ok, false, q);
    }
  });

  test('the request cookie is signed: a forged or stale one reads as nothing', () => {
    const req = { state: newState(), challenge: pkce().challenge, redirectUri: RETURN };
    const raw = encodeDesktopTxn(req, 'k');
    assert.deepEqual(readDesktopTxn(raw, { secret: 'k' }), req);
    assert.equal(readDesktopTxn(raw, { secret: 'other' }), null);
    const forged = `${Buffer.from(JSON.stringify({ ...req, createdAt: Date.now() })).toString('base64url')}.AAAA`;
    assert.equal(readDesktopTxn(forged, { secret: 'k' }), null);
    assert.equal(readDesktopTxn(raw, { secret: 'k', now: Date.now() + 11 * 60_000 }), null);
  });
});

describe('one-time codes', () => {
  test('a code redeems exactly once, with the right verifier, in time', () => {
    const codes = createDesktopCodes();
    const { verifier, challenge } = pkce();
    const code = codes.issue({ email: 'a@x.test', challenge });
    const first = codes.redeem(code, verifier);
    assert.equal(first.ok, true);
    assert.equal(first.email, 'a@x.test');
    assert.deepEqual(codes.redeem(code, verifier), { ok: false, reason: 'unknown-code' });
  });

  test('a wrong verifier is refused AND burns the code', () => {
    const codes = createDesktopCodes();
    const { verifier, challenge } = pkce();
    const code = codes.issue({ email: 'a@x.test', challenge });
    assert.deepEqual(codes.redeem(code, pkce().verifier), { ok: false, reason: 'bad-verifier' });
    assert.equal(codes.redeem(code, verifier).ok, false);
  });

  test('an expired code is refused', () => {
    const codes = createDesktopCodes({ ttlMs: 1000 });
    const { verifier, challenge } = pkce();
    const code = codes.issue({ email: 'a@x.test', challenge }, 0);
    assert.deepEqual(codes.redeem(code, verifier, 5000), { ok: false, reason: 'expired' });
  });
});

describe('password hub: the full round trip through a real hub', () => {
  let dataDir;
  let hub;
  before(async () => {
    dataDir = tmpDir('maude-desktop-signin-');
    createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
    createUser(dataDir, { email: 'max@x.test', password: PW, role: 'member' });
    hub = await startHub(dataDir, { rateLimit: false });
  });
  after(async () => {
    await hub.close();
    closeUsers(dataDir);
    rm(dataDir);
  });

  /** GET the desktop sign-in page, then POST the password form the way the browser would. */
  async function signInThroughPage(email, { state, challenge }) {
    const page = await fetch(`${hub.http}/studio/signin?${desktopQuery({ state, challenge })}`);
    assert.equal(page.status, 200, await page.clone().text());
    const txn = cookieOf(page, DESKTOP_TXN_COOKIE);
    assert.ok(txn, 'the desktop request rides a cookie');
    const html = await page.text();
    assert.match(html, /action="\/studio\/signin"/, 'the page is the hub’s own sign-in form');
    return fetch(`${hub.http}/studio/signin`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: hub.http,
        cookie: `${DESKTOP_TXN_COOKIE}=${txn}`,
      },
      body: new URLSearchParams({ email, password: PW }),
    });
  }

  const exchange = (body) =>
    fetch(`${hub.http}/auth/desktop/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('/health advertises the desktop sign-in', async () => {
    const r = await (await fetch(`${hub.http}/health`)).json();
    assert.ok(r.capabilities.includes(DESKTOP_SIGNIN_CAPABILITY), JSON.stringify(r.capabilities));
  });

  test('sign in on the page → a code on loopback → the /auth/login token, once', async () => {
    const { verifier, challenge } = pkce();
    const state = newState();
    const done = await signInThroughPage('max@x.test', { state, challenge });
    assert.equal(done.status, 200, 'a hand-off PAGE, not a redirect (form-action CSP)');
    assert.equal(cookieOf(done, 'maude_studio'), null, 'no browser session is left behind');
    assert.equal(cookieOf(done, DESKTOP_TXN_COOKIE), '', 'the desktop request is cleared');
    const href = handoffHref(await done.text());
    assert.ok(href, 'the page links back to the app');
    assert.equal(`${href.origin}${href.pathname}`, RETURN);
    assert.equal(href.searchParams.get('state'), state);
    assert.equal(href.searchParams.has('token'), false, 'no token in any URL');
    const code = href.searchParams.get('code');
    assert.ok(code);

    const r = await exchange({ code, code_verifier: verifier });
    assert.equal(r.status, 200, await r.clone().text());
    const body = await r.json();
    assert.equal(typeof body.token, 'string');
    assert.equal(typeof body.expiresAt, 'number');
    assert.deepEqual(body.user, { email: 'max@x.test', role: 'member' });
    // The same kind of session `/auth/login` mints: it answers /auth/session.
    const s = await fetch(`${hub.http}/auth/session`, {
      headers: { authorization: `Bearer ${body.token}` },
    });
    assert.equal(s.status, 200);
    assert.equal((await s.json()).user.email, 'max@x.test');

    const again = await exchange({ code, code_verifier: verifier });
    assert.equal(again.status, 400, 'a code is single use');
  });

  test('a wrong verifier is refused, and the code is gone for the right one too', async () => {
    const { verifier, challenge } = pkce();
    const done = await signInThroughPage('max@x.test', { state: newState(), challenge });
    const code = handoffHref(await done.text()).searchParams.get('code');
    const wrong = await exchange({ code, code_verifier: pkce().verifier });
    assert.equal(wrong.status, 400);
    const right = await exchange({ code, code_verifier: verifier });
    assert.equal(right.status, 400);
  });

  test('a made-up code is refused', async () => {
    const r = await exchange({
      code: randomBytes(32).toString('base64url'),
      code_verifier: pkce().verifier,
    });
    assert.equal(r.status, 400);
  });

  test('a wrong password re-renders the page and issues nothing', async () => {
    const { challenge } = pkce();
    const page = await fetch(
      `${hub.http}/studio/signin?${desktopQuery({ state: newState(), challenge })}`
    );
    const txn = cookieOf(page, DESKTOP_TXN_COOKIE);
    const r = await fetch(`${hub.http}/studio/signin`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: hub.http,
        cookie: `${DESKTOP_TXN_COOKIE}=${txn}`,
      },
      body: new URLSearchParams({ email: 'max@x.test', password: 'nope' }),
    });
    assert.equal(r.status, 401);
    assert.equal(handoffHref(await r.text()), null);
  });

  test('a redirect target outside loopback is refused before any sign-in', async () => {
    const { challenge } = pkce();
    const r = await fetch(
      `${hub.http}/studio/signin?${desktopQuery({ state: newState(), challenge, redirectUri: 'https://evil.example/_api/hub-signin/return' })}`
    );
    assert.equal(r.status, 400);
    assert.equal(cookieOf(r, DESKTOP_TXN_COOKIE), null);
  });

  test('a forged desktop cookie is ignored: the browser sign-in is unchanged', async () => {
    const forged = encodeDesktopTxn(
      { state: newState(), challenge: pkce().challenge, redirectUri: RETURN },
      'not-the-hub-secret'
    );
    const r = await fetch(`${hub.http}/studio/signin`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: hub.http,
        cookie: `${DESKTOP_TXN_COOKIE}=${encodeURIComponent(forged)}`,
      },
      body: new URLSearchParams({ email: 'max@x.test', password: PW }),
    });
    assert.equal(r.status, 302, 'the ordinary browser sign-in');
    assert.ok(cookieOf(r, 'maude_studio'));
  });

  test('a disabled account cannot redeem a code it was issued', async () => {
    const { setUserDisabled } = await import('../src/users.mjs');
    const { verifier, challenge } = pkce();
    const done = await signInThroughPage('olga@x.test', { state: newState(), challenge });
    const code = handoffHref(await done.text()).searchParams.get('code');
    setUserDisabled(dataDir, 'olga@x.test', true);
    try {
      const r = await exchange({ code, code_verifier: verifier });
      assert.equal(r.status, 401);
    } finally {
      setUserDisabled(dataDir, 'olga@x.test', false);
    }
  });
});

describe('OIDC hub: the provider’s callback hands the code to the app', () => {
  const issuer = 'https://identity.example.com';
  const secret = 'test-secret';
  const env = {
    HUB_OIDC_MODE: 'hybrid',
    HUB_OIDC_ISSUER: issuer,
    HUB_OIDC_CLIENT_ID: 'hub',
    HUB_OIDC_CLIENT_SECRET: 'test',
    HUB_OIDC_ALLOWED_DOMAINS: 'example.com',
  };

  async function callback(dataDir, { email, sub, desktop }) {
    const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
    const { createTransaction, encodeTransaction, OIDC_TXN_COOKIE } = await import(
      '../src/oidc-routes.mjs'
    );
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
    const txn = createTransaction();
    const idToken = await new SignJWT({ email, email_verified: true, nonce: txn.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(sub)
      .setIssuer(issuer)
      .setAudience('hub')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    const res = response();
    const cookies = [`${OIDC_TXN_COOKIE}=${encodeURIComponent(encodeTransaction(txn, secret))}`];
    if (desktop) {
      cookies.push(
        `${DESKTOP_TXN_COOKIE}=${encodeURIComponent(encodeDesktopTxn(desktop, secret))}`
      );
    }
    await handleOidc({
      request: {
        url: `/auth/oidc/callback?code=test&state=${txn.state}`,
        headers: { cookie: cookies.join('; ') },
      },
      response: res,
      path: '/auth/oidc/callback',
      method: 'GET',
      dataDir,
      secret,
      publicUrl: 'https://project.example.com',
      env,
      fetchImpl: async (url) => {
        if (String(url).endsWith('/.well-known/openid-configuration'))
          return { issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token` };
        if (String(url).endsWith('/token')) return { id_token: idToken };
        return { keys: [jwk] };
      },
    });
    return res;
  }

  test('a linked subject coming from the desktop gets a code, not a cookie', async () => {
    const dataDir = tmpDir('maude-desktop-oidc-');
    try {
      createUser(dataDir, { email: 'max@example.com', password: PW, role: 'member' });
      linkOidcSub(dataDir, 'max@example.com', 'sub-max');
      const { challenge } = pkce();
      const desktop = { state: newState(), challenge, redirectUri: RETURN };
      const res = await callback(dataDir, { email: 'max@example.com', sub: 'sub-max', desktop });
      assert.equal(res.status, 200);
      const cookies = [res.headers['set-cookie']].flat().join('\n');
      assert.doesNotMatch(cookies, /maude_studio=[^;]/, 'no browser session');
      const href = handoffHref(res.body);
      assert.equal(href.searchParams.get('state'), desktop.state);
      assert.ok(href.searchParams.get('code'));
    } finally {
      closeUsers(dataDir);
      rm(dataDir);
    }
  });

  test('an unlinked subject from the desktop goes back with error=pending and no code', async () => {
    const dataDir = tmpDir('maude-desktop-oidc-pending-');
    try {
      const desktop = { state: newState(), challenge: pkce().challenge, redirectUri: RETURN };
      const res = await callback(dataDir, { email: 'new@example.com', sub: 'sub-new', desktop });
      const href = handoffHref(res.body);
      assert.equal(href.searchParams.get('error'), 'pending');
      assert.equal(href.searchParams.has('code'), false);
    } finally {
      closeUsers(dataDir);
      rm(dataDir);
    }
  });
});

function response() {
  const headers = {};
  return {
    headers,
    body: '',
    getHeader: (key) => headers[key],
    setHeader: (key, value) => {
      headers[key] = value;
    },
    writeHead(status, values) {
      this.status = status;
      Object.assign(headers, values);
    },
    end(chunk) {
      if (chunk) this.body += String(chunk);
    },
  };
}
