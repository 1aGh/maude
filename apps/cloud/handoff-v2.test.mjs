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
