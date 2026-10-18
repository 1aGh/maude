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
// Extensions to come (S9-slices §3): the comment path (S9.7), the canvas-scoped
// document doors (S9.5). S9.4 pins the file plane below.

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
import { closeUsers, createUser } from '../src/users.mjs';
import { A_VISIBLE, B_ONLY, bootAclHub, call } from './_acl-files-fixture.mjs';

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

// ------------------------------------------------------------------- S9.4

/** The 1.9.1 desktop's file-plane reads and probes (manifest, bytes, presence). */
const V1_FILE_PLANE_READS = [
  '/api/files',
  '/_project-file/assets/b-only.png',
  '/assets/b-only.png',
  '/assets/shared.png',
  '/_asset-file/assets/b-only.png',
];

describe('S9.4 — the canvas-scoped file plane: a 1.9.1 desktop sees the whole project', () => {
  for (const role of ['owner', 'member', 'viewer']) {
    test(`${role}: journal, manifest, bytes, presence and probe answer as today`, async () => {
      const acl = await bootAclHub(`maude-v1-s94-${role}`);
      try {
        const res = await fetch(`${acl.http}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: v1ProjectToken(role) }),
        });
        assert.equal(res.status, 200);
        const { token } = await res.json();
        const journal = await call(acl, 'GET', '/api/journal?since=0', token);
        assert.equal(journal.status, 200);
        const journalPaths = journal.body.entries.map((e) => e.path);
        for (const p of [...A_VISIBLE, ...B_ONLY]) {
          assert.ok(journalPaths.includes(p), `${role} journal ${p}`);
        }
        // The real head, not a visible one (U7).
        assert.equal(journal.body.head, Math.max(...journal.body.entries.map((e) => e.seq)));
        for (const path of V1_FILE_PLANE_READS) {
          assert.equal((await call(acl, 'GET', path, token)).status, 200, `${role} ${path}`);
        }
        const files = await call(acl, 'GET', '/api/files', token);
        for (const p of [...A_VISIBLE, ...B_ONLY]) {
          assert.ok(
            files.body.files.some((f) => f.path === p),
            `${role} manifest ${p}`
          );
        }
        const probe = await call(acl, 'POST', '/_asset-probe', token, {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            paths: ['assets/a-only.png', 'assets/b-only.png', 'assets/nope.png'],
          }),
        });
        if (role === 'viewer') {
          // 1.9.1's read-only gate refused every non-GET outside its allowlist,
          // the probe included (it serves the push sweep).
          assert.equal(probe.status, 403);
          assert.equal(probe.body?.reason, 'read-only');
        } else {
          assert.deepEqual(probe.body.present.sort(), ['assets/a-only.png', 'assets/b-only.png']);
        }
        // A write to another canvas's sidecar is judged exactly as today.
        const put = await call(acl, 'PUT', '/api/file/assets/b-only.photo.json', token, {
          body: '{"v":1}',
        });
        if (role === 'viewer') {
          assert.equal(put.status, 403);
          assert.equal(put.body?.reason, 'read-only');
        } else {
          assert.equal(put.status, 200, `${role}: ${JSON.stringify(put.body)}`);
        }
      } finally {
        await acl.stop();
      }
    });
  }
});

// ------------------------------------------------------------------- S9.6

/** The 1.9.1 desktop's self-hosted sign-in: e-mail + password, no access declaration. */
function v1PasswordLogin(port, email, password) {
  return fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

describe('S9.6 — the access columns: a 1.9.1 desktop sees today’s answers', () => {
  const PW = 'correct horse battery staple';

  for (const role of ['admin', 'member']) {
    test(`${role} account: a password sign-in keeps today's shape, and Yjs opens`, async () => {
      createUser(dataDir, { email: `${role}@self.test`, password: PW, role });
      const res = await v1PasswordLogin(PORT, `${role}@self.test`, PW);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'label', 'scope', 'token', 'user']);
      assert.deepEqual(body.user, { email: `${role}@self.test`, role });
      assert.equal(await v1YjsAuth(PORT, body.token), 'synced');
    });
  }

  test('a canvas-only account is never a project-wide v1 session (426)', async () => {
    createUser(dataDir, {
      email: 'guest@self.test',
      password: PW,
      role: 'member',
      access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] },
    });
    const res = await v1PasswordLogin(PORT, 'guest@self.test', PW);
    assert.equal(res.status, 426);
    assert.equal((await res.json()).token, undefined);
  });

  test('/health keeps every field 1.9.1 reads; `access` is additive', async () => {
    const body = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    assert.equal(typeof body.ok, 'boolean');
    assert.equal(typeof body.version, 'string');
    assert.ok(Array.isArray(body.capabilities));
    assert.equal(body.capabilities.includes('roles-v2'), false, 'not before the Q13 flip');
    assert.equal(typeof body.access, 'object');
  });
});

// ------------------------------------------------------------------- S9.7

/**
 * The 1.9.1 desktop's comment path, FROZEN: it pushes a comment straight into
 * the canvas doc's Y `comments` array on its own connection and leaves. It
 * never calls `POST /api/comments` (that door is v2's, additive).
 */
function v1YjsSession(port, peerToken, name, onSynced) {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const timer = setTimeout(() => {
      provider.destroy();
      reject(new Error('no sync within 3s'));
    }, 3000);
    const provider = new HocuspocusProvider({
      url: `ws://127.0.0.1:${port}`,
      name,
      token: peerToken,
      document: doc,
      onSynced: () => {
        clearTimeout(timer);
        const out = onSynced(doc);
        setTimeout(() => {
          provider.destroy();
          resolve(out);
        }, 300);
      },
    });
  });
}

describe('S9.7 — the comment path: a 1.9.1 desktop sees today’s answers', () => {
  test('owner / member comments land on the Y lane as today; a viewer’s is dropped as today', async () => {
    const tokens = {};
    for (const role of ['owner', 'member', 'viewer']) {
      tokens[role] = (await (await v1Login(PORT, v1ProjectToken(role))).json()).token;
    }
    const name = 'ws/alligators/main/ui-home';
    for (const role of ['owner', 'member', 'viewer']) {
      await v1YjsSession(PORT, tokens[role], name, (doc) =>
        doc
          .getArray('comments')
          .push([{ id: `c_v1${role}`, file: '.design/ui/home.tsx', text: role, status: 'open' }])
      );
    }
    const list = await v1YjsSession(PORT, tokens.owner, name, (doc) =>
      doc.getArray('comments').toArray()
    );
    assert.deepEqual(list.map((c) => c.id).sort(), ['c_v1member', 'c_v1owner']);
  });
});
