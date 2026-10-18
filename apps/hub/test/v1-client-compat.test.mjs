// v1 client compatibility — the S9 hub bar (S9-slices §3).
//
// Every S9 hub slice EXTENDS this file. It drives the new hub with a FROZEN
// 1.9.1 desktop: today's project-token credential, today's request shapes,
// and no `X-Maude-Access` header. For owner, member and viewer every door must
// answer exactly as 1.9.1 does; a claim 1.9.1 cannot honour must fail CLOSED —
// by format on an old cell (`m2.` → malformed) and by version at the new
// cell's mint door (426 "Update Maude to open this project.").
//
// Never "update" the frozen parts below to match a new hub. If one has to
// change, a v1.9.x desktop in the field just broke.
//
// Extensions to come (S9-slices §3): file PUT, the comment path (S9.3 / S9.7),
// canvas-scoped doors refusing as a missing path (S9.4 / S9.5).

import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { accessClaims, signAccessToken, signAccessTokenV2 } from '../src/cloud-identity.mjs';
import { createHub } from '../src/server.mjs';
import { closeUsers } from '../src/users.mjs';

const BASE_PORT = Number.parseInt(process.env.HUB_V1_COMPAT_TEST_PORT ?? '15380', 10);
const SECRET = 'test-admin-secret';
const TOKEN_KEY = 'k'.repeat(64);
const TENANT = 'alligators';

// ---------------------------------------------------------------- FROZEN 1.9.1

/** The 1.9.1 cell's `verifyAccessToken`, verbatim. The old cell. */
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

/** The 1.9.1 desktop's cell sign-in: JSON `{ token }`, no access declaration. */
function v1Login(port, projectToken) {
  return fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: projectToken }),
  });
}

/** The 1.9.1 desktop's journal cursor read. */
function v1JournalPull(port, peerToken) {
  return fetch(`http://127.0.0.1:${port}/api/journal?since=0`, {
    headers: { authorization: `Bearer ${peerToken}` },
  });
}

/** The 1.9.1 desktop's Yjs auth: resolves 'synced' or the auth-failure reason. */
function v1YjsAuth(port, peerToken, name = 'compat-doc') {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const timer = setTimeout(() => {
      provider.destroy();
      reject(new Error('no sync or auth failure within 3s'));
    }, 3000);
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name,
      token: peerToken,
      document: doc,
      connect: true,
      onSynced: () => {
        clearTimeout(timer);
        provider.destroy();
        resolve('synced');
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timer);
        provider.destroy();
        resolve(reason);
      },
    });
  });
}

// ------------------------------------------------------------------- the hub

let hub;
let dataDir;
let PORT;
let portCounter = 0;
let savedEnv;

beforeEach(async () => {
  PORT = BASE_PORT + portCounter++;
  dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-v1-compat-'));
  savedEnv = {
    MAUDE_CLOUD_IDENTITY: process.env.MAUDE_CLOUD_IDENTITY,
    MAUDE_TENANT_ID: process.env.MAUDE_TENANT_ID,
    MAUDE_PROJECT_TOKEN_KEY: process.env.MAUDE_PROJECT_TOKEN_KEY,
  };
  process.env.MAUDE_CLOUD_IDENTITY = '1';
  process.env.MAUDE_TENANT_ID = TENANT;
  process.env.MAUDE_PROJECT_TOKEN_KEY = TOKEN_KEY;
  hub = createHub({
    port: PORT,
    dataDir,
    secret: SECRET,
    publicUrl: `https://hub.example.com:${PORT}`,
    verbose: false,
  }).server;
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

/** Today's control-plane credential, as the 1.x control plane mints it. */
const v1ProjectToken = (role) =>
  signAccessToken(accessClaims({ email: `${role}@example.com`, project: TENANT, role }), TOKEN_KEY);

const v2ProjectToken = (claim) =>
  signAccessTokenV2(
    {
      email: 'guest@example.com',
      project: TENANT,
      iat: Date.now(),
      exp: Date.now() + 60_000,
      ...claim,
    },
    TOKEN_KEY
  );

// ------------------------------------------------------------------- S9.2

describe('S9.2 — credentials: a 1.9.1 desktop keeps working', () => {
  for (const role of ['owner', 'member', 'viewer']) {
    test(`${role}: sign-in answers today's shape, and the peer token opens journal + Yjs`, async () => {
      const res = await v1Login(PORT, v1ProjectToken(role));
      assert.equal(res.status, 200);
      const body = await res.json();
      // The exact keys 1.9.1 reads — nothing removed, nothing renamed.
      assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'label', 'scope', 'token', 'user']);
      assert.deepEqual(body.user, { email: `${role}@example.com`, role });
      assert.equal(body.scope, '*');
      assert.match(body.token, /^mau_/);

      const journal = await v1JournalPull(PORT, body.token);
      assert.equal(journal.status, 200);

      assert.equal(await v1YjsAuth(PORT, body.token), 'synced');
    });
  }

  test('an old cell reads every m2. token as malformed — the format fence', () => {
    for (const claim of [
      { role: 'observer' },
      { role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
      { role: 'viewer', grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    ]) {
      assert.deepEqual(verifyAccessTokenV191(v2ProjectToken(claim), TOKEN_KEY), {
        ok: false,
        reason: 'malformed',
      });
    }
  });

  test('a v1 client presenting a v2 claim gets 426, in words it can show (S9.2)', async () => {
    const res = await v1Login(PORT, v2ProjectToken({ role: 'observer' }));
    assert.equal(res.status, 426);
    const body = await res.json();
    // 1.9.1 surfaces `error` verbatim.
    assert.equal(body.error, 'Update Maude to open this project.');
    assert.equal(body.token, undefined);
  });
});

// ------------------------------------------------------------------- S9.3

/** The 1.9.1 desktop's file-plane write: PUT through the one door, no declaration. */
function v1FilePut(port, peerToken) {
  return fetch(`http://127.0.0.1:${port}/api/file/assets/a.png`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${peerToken}`, 'content-type': 'image/png' },
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
}

/** The 1.9.1 desktop's byte pulls. */
const V1_BYTE_PULLS = ['/_project-file/assets/a.png', '/assets/a.png', '/api/history/file'];

describe('S9.3 — the capability gate: a 1.9.1 desktop sees today’s answers', () => {
  for (const role of ['owner', 'member', 'viewer']) {
    test(`${role}: byte pulls are not refused; sign-out works; a write is judged as today`, async () => {
      const { token } = await (await v1Login(PORT, v1ProjectToken(role))).json();
      for (const path of V1_BYTE_PULLS) {
        const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        assert.notEqual(res.status, 403, `${role} ${path}`);
      }
      const put = await v1FilePut(PORT, token);
      const putBody = await put.json().catch(() => null);
      if (role === 'viewer') {
        // Byte for byte what 1.9.1 shows a viewer today.
        assert.equal(put.status, 403);
        assert.deepEqual(putBody, {
          error: 'You can look at this project, comment and download it, but not change it.',
          reason: 'read-only',
        });
      } else {
        assert.notEqual(putBody?.reason, 'read-only', `${role} is not a read-only session`);
      }
      const logout = await fetch(`http://127.0.0.1:${PORT}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(logout.status, 200, `${role} signs out`);
    });
  }
});

// ------------------------------------------------------------------- S9.5

/** The 1.9.1 desktop's document listing and history reads. */
const v1Get = (port, peerToken, path) =>
  fetch(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${peerToken}` } });

describe('S9.5 — the document doors: a 1.9.1 desktop sees today’s answers', () => {
  for (const role of ['owner', 'member', 'viewer']) {
    test(`${role}: every namespaced document opens; listing, history and bootstrap answer`, async () => {
      const { token } = await (await v1Login(PORT, v1ProjectToken(role))).json();
      for (const name of [
        'ws/alligators/main/ui-home',
        'ws/alligators/main/ui-other',
        'flat-doc',
      ]) {
        assert.equal(await v1YjsAuth(PORT, token, name), 'synced', `${role} ${name}`);
      }
      const docs = await v1Get(PORT, token, '/api/documents');
      assert.equal(docs.status, 200);
      assert.deepEqual(Object.keys(await docs.json()).sort(), ['count', 'documents', 'tombstones']);
      const history = await v1Get(PORT, token, '/api/history');
      assert.equal(history.status, 200, `${role} reads the project-wide log`);
      const boot = await v1Get(PORT, token, '/api/projects/current/v1/bootstrap');
      assert.equal(boot.status, 200, `${role} bootstrap`);
      const body = await boot.json();
      assert.equal(Array.isArray(body.docs), true);
      assert.equal(body.you.readOnly, role === 'viewer');
    });
  }
});
