// The cell's browser sign-in IS the browser door — V2-1.7 §5.4 (S9.2).
//
// An observer who declared is sent HERE by the 409; so this door must mint the
// session the desktop door refuses, store the v2 claim, and tell the control
// plane it understands one (`X-Maude-Access: 2`) — otherwise the exchange
// would answer the cell itself with a 426.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { legacyClaim } from '../../studio/access/scope.ts';
import { handleBrowserAuth } from '../src/browser-auth.mjs';
import { accessClaims, signAccessToken, signAccessTokenV2 } from '../src/cloud-identity.mjs';
import { browserSession } from '../src/server.mjs';
import { verifyToken } from '../src/tokens.mjs';

const KEY = 'k'.repeat(64);
const TENANT = 'alligators';
let dataDir;
let saved;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-browser-lane-'));
  saved = {
    MAUDE_CLOUD_IDENTITY: process.env.MAUDE_CLOUD_IDENTITY,
    MAUDE_TENANT_ID: process.env.MAUDE_TENANT_ID,
    MAUDE_PROJECT_TOKEN_KEY: process.env.MAUDE_PROJECT_TOKEN_KEY,
  };
  process.env.MAUDE_CLOUD_IDENTITY = '1';
  process.env.MAUDE_TENANT_ID = TENANT;
  process.env.MAUDE_PROJECT_TOKEN_KEY = KEY;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dataDir, { recursive: true, force: true });
});

function fakeResponse() {
  const res = { status: 0, headers: {}, body: '' };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.writeHead = (status, headers = {}) => {
    res.status = status;
    for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v;
  };
  res.end = (body = '') => {
    res.body = String(body);
  };
  return res;
}

async function browserSignIn(projectToken) {
  const sent = [];
  const response = fakeResponse();
  await handleBrowserAuth({
    request: { url: '/auth/browser?code=mhc_x', headers: {} },
    response,
    path: '/auth/browser',
    method: 'GET',
    dataDir,
    secret: 'admin',
    env: { MAUDE_CONTROL_PLANE_URL: 'https://cp.test' },
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      return new Response(JSON.stringify({ token: projectToken }), { status: 200 });
    },
  });
  const cookie = String(response.headers['set-cookie'] ?? '');
  const value = /maude_studio=([^;]+)/.exec(cookie)?.[1];
  return { response, sent, session: value ? decodeURIComponent(value) : null };
}

const now = () => Date.now();

test('the exchange declares X-Maude-Access: 2 to the control plane', async () => {
  const token = signAccessToken(
    accessClaims({ email: 'm@x.test', project: TENANT, role: 'member' }),
    KEY
  );
  const { sent, response } = await browserSignIn(token);
  assert.equal(response.status, 302);
  assert.equal(sent[0].url, 'https://cp.test/auth/handoff/exchange');
  assert.equal(sent[0].init.headers['x-maude-access'], '2');
});

test('an observer mints a browser session here (no 409), carrying the claim', async () => {
  const token = signAccessTokenV2(
    { email: 'o@x.test', project: TENANT, role: 'observer', iat: now(), exp: now() + 60_000 },
    KEY
  );
  const { response, session } = await browserSignIn(token);
  assert.equal(response.status, 302);
  const match = verifyToken(dataDir, session, '');
  assert.equal(match.role, 'observer');
  assert.equal(match.readOnly, true);
  assert.deepEqual(match.access, { v: 1, role: 'observer' });
});

test('a v1 viewer session is byte-for-byte today’s: role stored, no access column', async () => {
  const token = signAccessToken(
    accessClaims({ email: 'v@x.test', project: TENANT, role: 'viewer' }),
    KEY
  );
  const { session } = await browserSignIn(token);
  const match = verifyToken(dataDir, session, '');
  assert.equal(match.role, 'viewer');
  assert.equal(match.readOnly, true);
  assert.equal(match.access, undefined);
  assert.equal(match.scope, '*');
});

test('H-1 on the browser lane: a role-less token gets no session', async () => {
  const token = signAccessToken(
    { email: 'r@x.test', project: TENANT, iat: now(), exp: now() + 60_000 },
    KEY
  );
  const { response, session } = await browserSignIn(token);
  assert.equal(response.status, 403);
  assert.equal(session, null);
});

// S9.3 → the proxy: the session `browserSession` vouches for carries the claim, so the cell
// proxy's `x-maude-access` names Can view instead of re-deriving a role (V2-5 A1 lead patch).
test('the vouched browser session carries the stored claim; a v1 one gets its legacy claim', async () => {
  const cookie = (session) => ({
    headers: { cookie: `maude_studio=${encodeURIComponent(session)}` },
  });
  const observer = await browserSignIn(
    signAccessTokenV2(
      { email: 'o@x.test', project: TENANT, role: 'observer', iat: now(), exp: now() + 60_000 },
      KEY
    )
  );
  const o = browserSession(dataDir, '', cookie(observer.session));
  assert.equal(o?.role, 'observer');
  assert.deepEqual(o.access, { v: 1, role: 'observer' });

  const viewer = await browserSignIn(
    signAccessToken(accessClaims({ email: 'v@x.test', project: TENANT, role: 'viewer' }), KEY)
  );
  const v = browserSession(dataDir, '', cookie(viewer.session));
  assert.equal(v?.role, 'viewer');
  assert.deepEqual(v.access, legacyClaim('viewer'));
});
