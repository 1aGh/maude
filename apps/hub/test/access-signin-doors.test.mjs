// The three hub sign-in doors honour per-person access — S9.6b (pre-flip blocker).
//
// `/join` (invite redeem), `/studio/signin` (password) and `/auth/oidc/callback`
// used to mint a session from the ACCOUNT role and ignore `users.access`. After
// the Q13 flip a canvas-only person signing in through any of them would have
// held a project-wide member session. Each door now mints through the one mint
// door (`peerTokenDoor`): a canvas-only account gets a canvas-scoped session,
// and an account without `access` gets exactly what 1.9.1 minted.

import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { after, before, describe, test } from 'node:test';

import { handleBrowserAuth, handleOidc } from '../src/browser-auth.mjs';
import { createInvite, peekInvite } from '../src/invites.mjs';
import { verifyToken } from '../src/tokens.mjs';
import { closeUsers, createUser, linkOidcSub } from '../src/users.mjs';
import { A, http, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const PW = 'correct horse battery staple';
const CANVAS_ONLY = { v: 1, role: null, grants: [{ c: A, r: 'member' }] };

/** The stored session, without the fields every mint makes unique. */
function session(dataDir, value) {
  const seen = verifyToken(dataDir, value);
  assert.ok(seen, 'the minted value verifies');
  const { label: _l, createdAt: _c, expiresAt: _e, ...rest } = seen;
  return rest;
}

/** What 1.9.1 minted for an account without `access`. */
const legacy = (owner, role) => ({ scope: '*', source: 'file', readOnly: false, role, owner });
/** A canvas-only session: no project role, read-only floor, the claim does the narrowing. */
const canvasOnly = (owner) => ({
  scope: '*',
  source: 'file',
  readOnly: true,
  access: CANVAS_ONLY,
  owner,
});

const cookieToken = (headers) => {
  const raw = [headers.get?.('set-cookie') ?? headers['set-cookie']].flat().join('\n');
  const m = /maude_studio=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : null;
};

describe('/join mints through the door (rolesV2 on)', () => {
  let dataDir;
  let hub;
  let owner;
  before(async () => {
    dataDir = tmpDir('maude-signin-doors-');
    const t = seedTokens(dataDir);
    createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
    hub = await startHub(dataDir, { rateLimit: false, rolesV2: true });
    owner = http(hub.http, t.owner);
  });
  after(async () => {
    await hub.close();
    rm(dataDir);
  });

  const join = (body, headers = {}) =>
    fetch(`${hub.http}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  test('a canvas invite redeemed by a v2 client is a canvas-scoped session, not a member', async () => {
    const made = await owner.post('/api/access/invites', {
      email: 'petra@x.test',
      role: 'member',
      canvas: A,
    });
    assert.equal(made.status, 201, made.text);
    const value = made.body.url.split('/join/')[1];
    const r = await join(
      { token: value, email: 'petra@x.test', password: PW },
      { 'x-maude-access': '2' }
    );
    assert.equal(r.status, 201, await r.clone().text());
    const body = await r.json();
    assert.deepEqual(session(dataDir, body.token), canvasOnly('petra@x.test'));
    const me = (await http(hub.http, body.token).get('/api/access/me')).body;
    assert.equal(me.role, null);
    assert.equal(me.caps.read, false);
    assert.equal(me.canvasCaps[A].edit, true);
  });

  test('a v1 client is told to update (426) and the invite stays unspent', async () => {
    const invite = createInvite(dataDir, {
      email: 'cyril@x.test',
      role: 'member',
      access: CANVAS_ONLY,
    });
    const r = await join({ token: invite.value, email: 'cyril@x.test', password: PW });
    assert.equal(r.status, 426);
    assert.equal((await r.json()).reason, 'access-version');
    assert.equal(peekInvite(dataDir, invite.value).ok, true);
  });

  test('the landing form (the browser lane) mints the canvas-scoped cookie', async () => {
    const invite = createInvite(dataDir, {
      email: 'ada@x.test',
      role: 'member',
      access: CANVAS_ONLY,
    });
    const r = await fetch(`${hub.http}/join`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: hub.http,
      },
      body: new URLSearchParams({ token: invite.value, email: 'ada@x.test', password: PW }),
    });
    assert.equal(r.status, 303, await r.clone().text());
    assert.deepEqual(session(dataDir, cookieToken(r.headers)), canvasOnly('ada@x.test'));
  });

  test('an invite without access mints exactly what 1.9.1 did', async () => {
    const invite = createInvite(dataDir, { email: 'max@x.test', role: 'member' });
    const r = await join({ token: invite.value, email: 'max@x.test', password: PW });
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'label', 'ok', 'token', 'user']);
    assert.deepEqual(body.user, { email: 'max@x.test', role: 'member' });
    assert.deepEqual(session(dataDir, body.token), legacy('max@x.test', 'member'));
  });
});

function response() {
  const headers = {};
  return {
    headers,
    getHeader: (key) => headers[key],
    setHeader: (key, value) => {
      headers[key] = value;
    },
    writeHead(status, values) {
      this.status = status;
      Object.assign(headers, values);
    },
    end() {},
  };
}

describe('/studio/signin mints through the door', () => {
  const signIn = async (dataDir, email) => {
    const request = Readable.from([
      Buffer.from(`email=${encodeURIComponent(email)}&password=${encodeURIComponent(PW)}`),
    ]);
    request.url = '/studio/signin';
    request.headers = { origin: 'https://project.example.com' };
    const res = response();
    await handleBrowserAuth({
      request,
      response: res,
      path: '/studio/signin',
      method: 'POST',
      dataDir,
      secret: 'test-secret',
      publicUrl: 'https://project.example.com',
      env: {},
    });
    return res;
  };

  test('a canvas-only account signs in canvas-scoped; an admin is the owner it always was', async () => {
    const dataDir = tmpDir('maude-signin-pw-');
    try {
      createUser(dataDir, {
        email: 'petra@x.test',
        password: PW,
        role: 'member',
        access: CANVAS_ONLY,
      });
      createUser(dataDir, { email: 'olga@x.test', password: PW, role: 'admin' });
      const scoped = await signIn(dataDir, 'petra@x.test');
      assert.equal(scoped.status, 302);
      assert.deepEqual(session(dataDir, cookieToken(scoped.headers)), canvasOnly('petra@x.test'));
      const plain = await signIn(dataDir, 'olga@x.test');
      assert.equal(plain.status, 302);
      assert.deepEqual(
        session(dataDir, cookieToken(plain.headers)),
        legacy('olga@x.test', 'owner')
      );
    } finally {
      closeUsers(dataDir);
      rm(dataDir);
    }
  });
});

describe('/auth/oidc/callback mints through the door', () => {
  test('a linked canvas-only account signs in canvas-scoped; a plain one is unchanged', async () => {
    const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
    const { createTransaction, encodeTransaction, OIDC_TXN_COOKIE } = await import(
      '../src/oidc-routes.mjs'
    );
    const dataDir = tmpDir('maude-signin-oidc-');
    const issuer = 'https://identity.example.com';
    const secret = 'test-secret';
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' };
    const callback = async (email, sub) => {
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
      await handleOidc({
        request: {
          url: `/auth/oidc/callback?code=test&state=${txn.state}`,
          headers: {
            cookie: `${OIDC_TXN_COOKIE}=${encodeURIComponent(encodeTransaction(txn, secret))}`,
          },
        },
        response: res,
        path: '/auth/oidc/callback',
        method: 'GET',
        dataDir,
        secret,
        publicUrl: 'https://project.example.com',
        env: {
          HUB_OIDC_MODE: 'hybrid',
          HUB_OIDC_ISSUER: issuer,
          HUB_OIDC_CLIENT_ID: 'hub',
          HUB_OIDC_CLIENT_SECRET: 'test',
          HUB_OIDC_ALLOWED_DOMAINS: 'example.com',
        },
        fetchImpl: async (url) => {
          if (String(url).endsWith('/.well-known/openid-configuration'))
            return { issuer, jwks_uri: `${issuer}/jwks`, token_endpoint: `${issuer}/token` };
          if (String(url).endsWith('/token')) return { id_token: idToken };
          return { keys: [jwk] };
        },
      });
      return res;
    };
    try {
      createUser(dataDir, {
        email: 'petra@example.com',
        password: PW,
        role: 'member',
        access: CANVAS_ONLY,
      });
      createUser(dataDir, { email: 'max@example.com', password: PW, role: 'member' });
      linkOidcSub(dataDir, 'petra@example.com', 'sub-petra');
      linkOidcSub(dataDir, 'max@example.com', 'sub-max');
      const scoped = await callback('petra@example.com', 'sub-petra');
      assert.equal(scoped.status, 302);
      assert.deepEqual(
        session(dataDir, cookieToken(scoped.headers)),
        canvasOnly('petra@example.com')
      );
      const plain = await callback('max@example.com', 'sub-max');
      assert.equal(plain.status, 302);
      assert.deepEqual(
        session(dataDir, cookieToken(plain.headers)),
        legacy('max@example.com', 'member')
      );
    } finally {
      closeUsers(dataDir);
      rm(dataDir);
    }
  });
});
