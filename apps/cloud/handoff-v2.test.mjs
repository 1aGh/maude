// Credentials v2 on the control plane — V2-1.7 §5.4 (S9.2).
//
// mintProjectToken: v1 bytes for owner / member / viewer without grants (an
// old cell keeps verifying them), `m2.` for observer, canvas-only or grants
// (an old cell reads them as malformed), and NO default role (H-1).
// The handoff exchange is a mint door: a viewer reaches the app lane only when
// the client declares `X-Maude-Access: 2`.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { verifyAccessToken } from '../hub/src/cloud-identity.mjs';
import { deriveCellSecret, mintProjectToken } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { redeemPendingInvite } from './invites.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'master';
const NOW = Date.now();

async function key(project = 'alligators') {
  return deriveCellSecret(MASTER, project, 'project-token');
}

test('owner / member / viewer mint byte-identical v1 tokens the cell verifies', async () => {
  for (const role of ['owner', 'member', 'viewer']) {
    const { token, claims } = await mintProjectToken(
      { master: MASTER, project: 'alligators', email: 'a@x.test', role },
      { now: NOW }
    );
    assert.equal(token.split('.').length, 2);
    assert.deepEqual(Object.keys(claims), ['email', 'project', 'role', 'iat', 'exp']);
    const v = verifyAccessToken(token, await key(), { now: NOW, tenantId: 'alligators' });
    assert.equal(v.ok, true);
    assert.equal(v.format, undefined);
    assert.equal(v.user.role, role);
  }
});

test('observer, canvas-only and grants mint m2. tokens; the cell reads their claim', async () => {
  const cases = [
    { role: 'observer' },
    {
      role: null,
      grants: [
        { c: 'ui/b.tsx', r: 'member' },
        { c: 'ui/a.tsx', r: 'viewer' },
      ],
    },
    { role: 'viewer', grants: [{ c: 'ui/a.tsx', r: 'member' }] },
  ];
  for (const c of cases) {
    const { token, claims } = await mintProjectToken(
      { master: MASTER, project: 'alligators', email: 'g@x.test', ...c },
      { now: NOW }
    );
    assert.match(token, /^m2\.[^.]+\.[^.]+$/);
    assert.equal(claims.v, 2);
    const v = verifyAccessToken(token, await key(), { now: NOW, tenantId: 'alligators' });
    assert.equal(v.ok, true, JSON.stringify(c));
    assert.equal(v.format, 2);
    assert.equal(v.access.role, c.role);
    if (c.grants) {
      // Sorted by canvas at mint.
      assert.deepEqual(
        v.access.grants.map((g) => g.c),
        [...c.grants.map((g) => g.c)].sort()
      );
    }
  }
});

test('H-1 at mint: no role, an unknown role, or role null without a grant throws', async () => {
  for (const over of [{}, { role: 'admin' }, { role: null }, { role: null, grants: [] }]) {
    await assert.rejects(
      mintProjectToken({ master: MASTER, project: 'alligators', email: 'a@x.test', ...over }),
      /role/
    );
  }
  await assert.rejects(
    mintProjectToken({
      master: MASTER,
      project: 'alligators',
      email: 'a@x.test',
      role: null,
      grants: [{ c: 'ui/a.tsx', r: 'owner' }],
    }),
    /grant/
  );
});

// --------------------------------------------------- the handoff mint door

const PASSWORD = 'a-long-enough-password';
const form = (f) => new URLSearchParams(f).toString();

async function freshEnv() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, CELL_SECRET_MASTER: MASTER }, sqlite };
}

async function signedIn(env, email) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

async function viewerProject() {
  const { env, sqlite } = await freshEnv();
  await signedIn(env, 'owner@example.com');
  const viewer = await signedIn(env, 'viewer@example.com');
  const id = (email) => sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(email).id;
  sqlite
    .prepare(
      "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES ('alligators', ?, 'A', 'active', 1, 1)"
    )
    .run(id('owner@example.com'));
  sqlite
    .prepare(
      "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', ?, 'viewer', 1)"
    )
    .run(id('viewer@example.com'));
  return { env, viewer };
}

const mint = (env, session, headers = {}) =>
  worker.fetch(
    new Request('https://cloud.test/projects/alligators/handoff', {
      method: 'POST',
      headers: { cookie: `maude_session=${session}`, accept: 'application/json', ...headers },
    }),
    env
  );

const exchange = (env, code, headers = {}) =>
  worker.fetch(
    new Request('https://cloud.test/auth/handoff/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ code }),
    }),
    env
  );

test('a viewer reaches the APP lane only when the client declares X-Maude-Access: 2', async () => {
  const { env, viewer } = await viewerProject();
  // Undeclared (a v1 app, or the dashboard's own form): today's refusal.
  assert.equal((await mint(env, viewer)).status, 403);

  const declared = await mint(env, viewer, { 'x-maude-access': '2' });
  assert.equal(declared.status, 200);
  const { code } = await declared.json();

  const ex = await exchange(env, code, { 'x-maude-access': '2' });
  assert.equal(ex.status, 200);
  const grant = await ex.json();
  assert.equal(grant.role, 'viewer');
  const v = verifyAccessToken(grant.token, await key(), { tenantId: 'alligators' });
  assert.equal(v.ok, true);
  assert.equal(v.format, undefined, 'a viewer is v1-expressible: byte-identical v1 token');
});

test('a declared viewer code presented by an undeclared client is refused at exchange', async () => {
  const { env, viewer } = await viewerProject();
  const { code } = await (await mint(env, viewer, { 'x-maude-access': '2' })).json();
  const ex = await exchange(env, code);
  assert.equal(ex.status, 400);
});

// ------------------------------------------- S9.8: the claim, landing, roles-v2

let ipSeq = 0;
async function signedInFrom(env, email) {
  const res = await worker.fetch(
    new Request('https://cloud.test/auth/signup', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // One client per sign-up: the plane budgets five a minute per client.
        'cf-connecting-ip': `10.9.0.${++ipSeq % 250}`,
      },
      body: form({ email, password: PASSWORD, disclosure: 'yes' }),
    }),
    env
  );
  return /maude_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
}

/** owner + an observer member + a member + a canvas-only member of ui/a.tsx. */
async function v2Project() {
  const { env, sqlite } = await freshEnv();
  env.CELL_ZONE = 'cloud.test';
  const s = {};
  for (const who of ['owner', 'observer', 'canvas', 'member']) {
    s[who] = await signedInFrom(env, `${who}@example.com`);
  }
  const id = (who) =>
    sqlite.prepare('SELECT id FROM accounts WHERE email = ?').get(`${who}@example.com`).id;
  sqlite
    .prepare(
      "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES ('alligators', ?, 'A', 'active', 1, 1)"
    )
    .run(id('owner'));
  const mem = sqlite.prepare(
    "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', ?, ?, 1)"
  );
  mem.run(id('observer'), 'observer');
  mem.run(id('member'), 'member');
  sqlite
    .prepare(
      "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES ('alligators', ?, 'ui/a.tsx', 'member', 'invite', 1)"
    )
    .run(id('canvas'));
  return { env, sqlite, s };
}

function stubHealth(rolesV2) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ capabilities: rolesV2 ? ['roles-v2'] : ['studio'] })
      : new Response(null, { status: 204 });
  return () => {
    globalThis.fetch = real;
  };
}

async function browserCode(env, session, query = '') {
  const res = await worker.fetch(
    new Request(`https://cloud.test/projects/alligators/browser${query}`, {
      headers: { cookie: `maude_session=${session}` },
    }),
    env
  );
  const loc = res.headers.get('location') ?? '';
  return decodeURIComponent(/[?&]code=([^&]+)/.exec(loc)?.[1] ?? '');
}

test('a canvas-only person opens the browser lane; v2 only for a roles-v2 cell', async () => {
  const { env, s } = await v2Project();
  const restore = stubHealth(false);
  try {
    const code = await browserCode(env, s.canvas);
    assert.match(code, /^mhc_/);
    const old = await exchange(env, code, { 'x-maude-access': '2' });
    assert.equal(old.status, 409);
    assert.equal((await old.json()).reason, 'server-update');
  } finally {
    restore();
  }
  const restore2 = stubHealth(true);
  try {
    const ex = await exchange(env, await browserCode(env, s.canvas), { 'x-maude-access': '2' });
    assert.equal(ex.status, 200);
    const body = await ex.json();
    assert.equal(body.role, null);
    const v = verifyAccessToken(body.token, await key(), { tenantId: 'alligators' });
    assert.equal(v.format, 2);
    assert.deepEqual(v.access.grants, [{ c: 'ui/a.tsx', r: 'member' }]);
  } finally {
    restore2();
  }
});

test('landing: a canvas the claim sees comes back from the exchange; one it cannot is dropped', async () => {
  const { env, s } = await v2Project();
  const restore = stubHealth(true);
  try {
    const seen = await exchange(
      env,
      await browserCode(env, s.canvas, `?canvas=${encodeURIComponent('ui/a.tsx')}`),
      { 'x-maude-access': '2' }
    );
    assert.deepEqual((await seen.json()).landing, { project: 'alligators', canvas: 'ui/a.tsx' });
    const unseen = await exchange(
      env,
      await browserCode(env, s.canvas, `?canvas=${encodeURIComponent('ui/b.tsx')}`),
      { 'x-maude-access': '2' }
    );
    assert.equal((await unseen.json()).landing, undefined);
    // A v1 member's exchange is unchanged: no landing key at all, v1 bytes.
    const m = await exchange(env, await browserCode(env, s.member));
    const mb = await m.json();
    assert.equal(mb.role, 'member');
    assert.ok(!('landing' in mb));
    assert.equal(mb.token.split('.').length, 2);
  } finally {
    restore();
  }
});

test('/projects/open is a mint door: Can view → 426 undeclared, 409 browser-door declared', async () => {
  const { env, s } = await v2Project();
  const open = (session, headers = {}) =>
    worker.fetch(
      new Request('https://cloud.test/projects/open', {
        method: 'POST',
        headers: {
          cookie: `maude_session=${session}`,
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          ...headers,
        },
        body: JSON.stringify({ project: 'alligators' }),
      }),
      env
    );
  const restore = stubHealth(true);
  try {
    assert.equal((await open(s.observer)).status, 426);
    const declared = await open(s.observer, { 'x-maude-access': '2' });
    assert.equal(declared.status, 409);
    assert.equal((await declared.json()).reason, 'browser-door');
    const member = await open(s.member);
    assert.equal(member.status, 200);
    assert.equal((await member.json()).token.split('.').length, 2);
  } finally {
    restore();
  }
});

test('the pending invitation: the page remembers it, sign-in redeems it, the exchange lands there', async () => {
  const { env, sqlite } = await v2Project();
  const inviteId = '0f0f0f0f-0000-4000-8000-000000000001';
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path)
       VALUES (?, 'alligators', 'late@example.com', 'member', ?, ?, 'ui/c.tsx')`
    )
    .run(inviteId, Date.now(), Date.now() + 86_400_000);
  const page = await worker.fetch(new Request(`https://cloud.test/invite/${inviteId}`), env);
  const cookie = page.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`maude_pending_invite=${inviteId}; Path=/; Max-Age=1800;`));
  assert.match(cookie, /HttpOnly/);
  const late = await signedInFrom(env, 'late@example.com');
  const lateAccount = sqlite
    .prepare("SELECT * FROM accounts WHERE email = 'late@example.com'")
    .get();
  const req = new Request('https://cloud.test/login', {
    headers: { cookie: `maude_pending_invite=${inviteId}` },
  });
  // Somebody else signing in from the same browser does NOT redeem it.
  const other = sqlite.prepare("SELECT * FROM accounts WHERE email = 'member@example.com'").get();
  const wrong = await redeemPendingInvite(env, req, other);
  assert.equal(wrong.redeemed, null);
  assert.match(wrong.clear, /Max-Age=0/);
  const ok = await redeemPendingInvite(env, req, lateAccount);
  assert.deepEqual(ok.redeemed, { id: inviteId, project: 'alligators' });
  const restore = stubHealth(true);
  try {
    const ex = await exchange(env, await browserCode(env, late), { 'x-maude-access': '2' });
    assert.equal(ex.status, 200);
    assert.deepEqual((await ex.json()).landing, { project: 'alligators', canvas: 'ui/c.tsx' });
  } finally {
    restore();
  }
});
