// The v0.55.0 lesson, pinned: a session token without a STORED role is a
// session `browserSession` refuses outright — "no session at all" — so every
// HTTP write surface answers 401 while reads and cursors keep flowing. The
// browser door (browser-auth.mjs) stored the role; /auth/login (the
// desktop/API token-exchange door) only stored the one-bit `read_only`
// projection. These tests hold the two doors to the same contract: what
// `browserSession` reads (`match.role`) must be written at mint.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';

import { accessClaims, signAccessToken, signAccessTokenV2 } from '../src/cloud-identity.mjs';
import { createHub } from '../src/server.mjs';
import { verifyToken } from '../src/tokens.mjs';
import { closeUsers } from '../src/users.mjs';

const BASE_PORT = Number.parseInt(process.env.HUB_LOGIN_ROLE_TEST_PORT ?? '14980', 10);
const SECRET = 'test-admin-secret';
const TOKEN_KEY = 'k'.repeat(64);
const TENANT = 'alligators';

let hub;
let dataDir;
let PORT;
let portCounter = 0;
let savedEnv;

beforeEach(async () => {
  PORT = BASE_PORT + portCounter++;
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-login-role-'));
  // authenticateForMode reads process.env at request time — cloud identity on,
  // and the project-token key the exchanged token is verified against.
  savedEnv = {
    MAUDE_CLOUD_IDENTITY: process.env.MAUDE_CLOUD_IDENTITY,
    MAUDE_TENANT_ID: process.env.MAUDE_TENANT_ID,
    MAUDE_PROJECT_TOKEN_KEY: process.env.MAUDE_PROJECT_TOKEN_KEY,
  };
  process.env.MAUDE_CLOUD_IDENTITY = '1';
  process.env.MAUDE_TENANT_ID = TENANT;
  process.env.MAUDE_PROJECT_TOKEN_KEY = TOKEN_KEY;
  const built = createHub({
    port: PORT,
    dataDir,
    secret: SECRET,
    publicUrl: `https://hub.example.com:${PORT}`,
    verbose: false,
  });
  hub = built.server;
  await hub.listen();
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (hub) await hub.destroy();
  if (dataDir) {
    closeUsers(dataDir);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

const login = (projectToken) =>
  fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: projectToken }),
  });

const projectToken = (role) =>
  signAccessToken(accessClaims({ email: 'a@example.com', project: TENANT, role }), TOKEN_KEY);

test('token-exchange login STORES the project role — not only its read_only projection', async () => {
  const res = await login(projectToken('owner'));
  assert.equal(res.status, 200);
  const body = await res.json();

  // The exact read `browserSession` performs: a stored role, in the role
  // matrix's vocabulary. `read_only` alone reproduces the 401-on-every-write
  // session this test exists to prevent.
  const match = verifyToken(dataDir, body.token, SECRET);
  assert.equal(match.role, 'owner');
  assert.equal(Boolean(match.readOnly), false);
});

test('a viewer token stores viewer — role and projection agreeing', async () => {
  const res = await login(projectToken('viewer'));
  assert.equal(res.status, 200);
  const body = await res.json();

  const match = verifyToken(dataDir, body.token, SECRET);
  assert.equal(match.role, 'viewer');
  assert.equal(Boolean(match.readOnly), true);
});

test('an ACCOUNT-vocabulary role is translated before it is stored', async () => {
  // `admin` is not a project role; storing it verbatim would recreate the
  // stale-session refusal one vocabulary over. The door translates
  // (admin → owner) and stores the translation.
  const res = await login(projectToken('admin'));
  assert.equal(res.status, 200);
  const body = await res.json();

  const match = verifyToken(dataDir, body.token, SECRET);
  assert.equal(match.role, 'owner');
  assert.equal(Boolean(match.readOnly), false);
});

// ------------------------------------------- the mint door (V2-1.7 §5.4, S9.2)

const v2Token = (claim) =>
  signAccessTokenV2(
    {
      email: 'g@example.com',
      project: TENANT,
      iat: Date.now(),
      exp: Date.now() + 60_000,
      ...claim,
    },
    TOKEN_KEY
  );

const loginDeclared = (projectToken, declared = '2') =>
  fetch(`http://127.0.0.1:${PORT}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-maude-access': declared },
    body: JSON.stringify({ token: projectToken }),
  });

test('H-1: a role-less project token is refused, never a member session', async () => {
  const roleless = signAccessToken(
    { email: 'a@example.com', project: TENANT, iat: Date.now(), exp: Date.now() + 60_000 },
    TOKEN_KEY
  );
  const res = await login(roleless);
  assert.equal(res.status, 401);
});

test('a claim a v1 client cannot honour answers 426 without the declaration', async () => {
  for (const claim of [
    { role: 'observer' },
    { role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    { role: 'viewer', grants: [{ c: 'ui/a.tsx', r: 'member' }] },
  ]) {
    const res = await login(v2Token(claim));
    assert.equal(res.status, 426, JSON.stringify(claim));
    assert.deepEqual(await res.json(), {
      error: 'Update Maude to open this project.',
      reason: 'access-version',
      minAccess: 2,
    });
  }
});

test('an observer who declared is sent to the browser door; no peer token exists', async () => {
  const res = await loginDeclared(v2Token({ role: 'observer' }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.reason, 'browser-door');
  assert.equal(body.url, `https://hub.example.com:${PORT}`);
  assert.equal(body.token, undefined);
});

test('a declared canvas-only claim mints a peer token that stores the claim', async () => {
  const claim = { role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] };
  const res = await loginDeclared(v2Token(claim));
  assert.equal(res.status, 200);
  const body = await res.json();
  const match = verifyToken(dataDir, body.token, SECRET);
  assert.deepEqual(match.access, { v: 1, ...claim });
  assert.equal(match.role, undefined);
  // Interim fail-closed until the doors read `access` (S9.4/S9.5): no wildcard.
  assert.notEqual(match.scope, '*');
});

test('a declared v1 role still mints exactly today’s token (no access column)', async () => {
  const res = await loginDeclared(projectToken('viewer'));
  assert.equal(res.status, 200);
  const body = await res.json();
  const match = verifyToken(dataDir, body.token, SECRET);
  assert.equal(match.role, 'viewer');
  assert.equal(match.access, undefined);
  assert.equal(match.scope, '*');
});
