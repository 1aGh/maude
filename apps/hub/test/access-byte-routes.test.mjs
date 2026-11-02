// A19 on the hub — Can view is refused every byte route (V2-1.7 §7, S9.3).
//
// Observers are never minted an APP peer token (the mint door's 409), but the
// browser door does mint them a session, and that cookie is a peer token. Sent
// as a Bearer it used to open every hub GET. These routes hand project bytes
// away as files, so they need `export`, which Can view does not hold:
//
//   /_project-file/<rel> · /api/history/file · /assets/<key> ·
//   /api/projects/current/v1/{lane, blobs, bootstrap}
//
// Can comment (`viewer`) keeps every one of them, exactly as today (R3).
// A courtesy limit, not DRM: the browser still holds what it renders.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { OBSERVER_REFUSAL } from '../src/access-gate.mjs';
import { handleBrowserAuth } from '../src/browser-auth.mjs';
import { signAccessTokenV2 } from '../src/cloud-identity.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const KEY = 'k'.repeat(64);
const TENANT = 'alligators';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const BYTE_ROUTES = [
  '/_project-file/assets/a.png',
  '/api/history/file?sha=HEAD&path=assets/a.png',
  '/assets/a.png',
  '/api/projects/current/v1/lane?doc=ui/a.tsx&lane=html',
  '/api/projects/current/v1/blobs/abc',
  '/api/projects/current/v1/bootstrap',
];
// Served whole by this fixture, so the viewer's answer is checked as 200, not
// merely "not refused".
const SERVED = new Set([
  '/_project-file/assets/a.png',
  '/assets/a.png',
  '/api/projects/current/v1/bootstrap',
]);

const dirs = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};

let hub;
const tokens = {};
let savedEnv;

/** The browser door's session for a v2 observer: its cookie IS a peer token. */
async function observerCookie(dataDir) {
  const prev = {
    MAUDE_CLOUD_IDENTITY: process.env.MAUDE_CLOUD_IDENTITY,
    MAUDE_TENANT_ID: process.env.MAUDE_TENANT_ID,
    MAUDE_PROJECT_TOKEN_KEY: process.env.MAUDE_PROJECT_TOKEN_KEY,
  };
  process.env.MAUDE_CLOUD_IDENTITY = '1';
  process.env.MAUDE_TENANT_ID = TENANT;
  process.env.MAUDE_PROJECT_TOKEN_KEY = KEY;
  try {
    const projectToken = signAccessTokenV2(
      {
        email: 'o@x.test',
        project: TENANT,
        role: 'observer',
        iat: Date.now(),
        exp: Date.now() + 60_000,
      },
      KEY
    );
    const headers = {};
    const response = {
      setHeader: (k, v) => {
        headers[k.toLowerCase()] = v;
      },
      getHeader: (k) => headers[k.toLowerCase()],
      writeHead: (_s, h = {}) => {
        for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = v;
      },
      end: () => {},
    };
    await handleBrowserAuth({
      request: { url: '/auth/browser?code=mhc_x', headers: {} },
      response,
      path: '/auth/browser',
      method: 'GET',
      dataDir,
      secret: 'test-secret',
      env: { MAUDE_CONTROL_PLANE_URL: 'https://cp.test' },
      fetchImpl: async () => new Response(JSON.stringify({ token: projectToken }), { status: 200 }),
    });
    const value = /maude_studio=([^;]+)/.exec(String(headers['set-cookie'] ?? ''))?.[1];
    assert.ok(value, 'the browser door minted a session');
    return decodeURIComponent(value);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

before(async () => {
  const dataDir = tmp('maude-a19-data-');
  const repoDir = tmp('maude-a19-repo-');
  mkdirSync(join(repoDir, '.design', 'assets'), { recursive: true });
  writeFileSync(join(repoDir, '.design', 'assets', 'a.png'), PNG);
  writeFileSync(
    join(repoDir, '.design', 'config.json'),
    JSON.stringify({ name: 'a19', canvasGroups: [{ label: 'UI', path: 'ui' }] })
  );
  savedEnv = {
    HUB_WORKSPACE_MODE: process.env.HUB_WORKSPACE_MODE,
    MAUDE_STUDIO_CHILD: process.env.MAUDE_STUDIO_CHILD,
    MAUDE_REPO_DIR: process.env.MAUDE_REPO_DIR,
  };
  process.env.HUB_WORKSPACE_MODE = '1';
  process.env.MAUDE_STUDIO_CHILD = '0';
  process.env.MAUDE_REPO_DIR = repoDir;
  const peer = (label, fields) => addToken(dataDir, { label, scope: '*', ...fields }).value;
  tokens.owner = peer('owner', { role: 'owner', owner: 'o@x.test' });
  tokens.member = peer('member', { role: 'member', owner: 'm@x.test' });
  tokens.viewer = peer('viewer', { role: 'viewer', owner: 'v@x.test', readOnly: true });
  // A token minted before roles existed — the admin-console shape.
  tokens.legacyViewer = peer('legacy-viewer', { readOnly: true });
  tokens.observer = peer('observer', {
    role: 'observer',
    owner: 'b@x.test',
    readOnly: true,
    access: { v: 1, role: 'observer' },
  });
  tokens.observerCookie = await observerCookie(dataDir);
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  hub = { built, http: built.server.httpURL.replace('0.0.0.0', '127.0.0.1') };
});

after(async () => {
  for (const [k, v] of Object.entries(savedEnv ?? {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await hub?.built.stopJournal?.();
  await hub?.built.server.destroy();
  hub?.built.projectStore?.close?.();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function get(path, token) {
  const res = await fetch(`${hub.http}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, body };
}

describe('Can view: every byte route is 403', () => {
  for (const who of ['observer', 'observerCookie']) {
    for (const path of BYTE_ROUTES) {
      test(`${who} ${path}`, async () => {
        const r = await get(path, tokens[who]);
        assert.equal(r.status, 403);
        assert.deepEqual(r.body, OBSERVER_REFUSAL);
      });
    }
  }

  test('Can view still looks: the journal and the manifest answer it', async () => {
    for (const path of ['/api/journal?since=0', '/api/files']) {
      assert.equal((await get(path, tokens.observerCookie)).status, 200, path);
    }
  });
});

describe('Can comment keeps every byte route (R3)', () => {
  for (const path of BYTE_ROUTES) {
    test(path, async () => {
      const member = await get(path, tokens.member);
      for (const who of ['viewer', 'legacyViewer', 'owner']) {
        const r = await get(path, tokens[who]);
        assert.notEqual(r.status, 403, `${who}: ${JSON.stringify(r.body)}`);
        assert.equal(r.status, member.status, `${who} answers as a member does`);
        if (SERVED.has(path)) assert.equal(r.status, 200, who);
      }
    });
  }
});
