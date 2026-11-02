// gate-b-sec3 — an invitation never says whether the address has an account, and never adds anybody silently.
//
// Finding 1: POST /access/invites answered an account holder 200 `{id:null, added:true}` (and added them at once)
// but a newcomer 201 with an invite id — an account-existence oracle, and a membership nobody accepted. Now both get
// the same pending invitation; the account holder accepts it (the e-mail link, the Join sheet, or Home › Shared with
// you via /api/invites/pending/*) or leaves it. Finding 2: redeem is single-use under a race and never lowers a role.
// Finding 4: Ask to edit's limit holds under parallel POSTs.
//
// Real SQLite behind the D1 shape, the live worker, no route mocked; the cell's notices answer 204.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ACCESS_REQUEST_LIMIT } from './access-forward.mjs';
import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'master';
const P = 'alligators';
const POSTER = 'brand/Combine-kampan.tsx';

async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  const acct = sqlite.prepare(
    'INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, 1)'
  );
  acct.run('a1', 'tereza@example.com', 'Tereza');
  acct.run('a2', 'jonas@example.com', 'Jonas'); // has an account, not on the project
  acct.run('a3', 'member@example.com', 'Member'); // already a member
  acct.run('a4', 'observer@example.com', 'Observer');
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES (?, 'a1', 'Alligators brand', 'active', 1, 1)`
    )
    .run(P);
  const mem = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, 1)'
  );
  mem.run(P, 'a3', 'member');
  mem.run(P, 'a4', 'observer');
  return { env: { DB, CELL_SECRET_MASTER: MASTER, CELL_ZONE: 'cloud.test' }, sqlite };
}

async function access(env, path, { method = 'POST', actor = 'tereza@example.com', body } = {}) {
  const secret = await deriveCellSecret(MASTER, P);
  return worker.fetch(
    new Request(`https://cloud.test/internal/projects/${P}/access/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        'x-maude-actor': actor,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
}
const invite = (env, body) => access(env, 'invites', { body });

async function tokenFor(sqlite, id) {
  const token = `mpt_${id.padEnd(48, '0')}`;
  sqlite
    .prepare('INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, 1)')
    .run(await sha256Hex(token), id, 'Maude on macOS');
  return token;
}

const pending = (env, verb, token, body, { v2 = true } = {}) =>
  worker.fetch(
    new Request(`https://cloud.test/api/invites/pending/${verb}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(v2 ? { 'x-maude-access': '2' } : {}),
      },
      body: JSON.stringify(body),
    }),
    env
  );

const acceptById = (env, id, token) =>
  worker.fetch(
    new Request(`https://cloud.test/api/invites/${id}/accept`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-maude-access': '2' },
    }),
    env
  );

const home = async (env, token) =>
  (
    await worker.fetch(
      new Request('https://cloud.test/api/home', { headers: { authorization: `Bearer ${token}` } }),
      env
    )
  ).json();

const roleOf = (sqlite, id) =>
  sqlite
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND account_id = ?')
    .get(P, id)?.role ?? null;

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url) =>
    String(url).endsWith('/health')
      ? Response.json({ capabilities: ['roles-v2'] })
      : new Response(null, { status: 204 });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('an invitation does not reveal whether the address has an account (finding 1)', () => {
  it('an existing and a new address get byte-equal answers apart from the id', async () => {
    const { env } = await fixture();
    const known = await invite(env, { email: 'jonas@example.com', role: 'member' });
    const unknown = await invite(env, { email: 'nobody-yet@example.com', role: 'member' });
    assert.equal(known.status, 201);
    assert.equal(unknown.status, 201);
    const a = await known.text();
    const b = await unknown.text();
    const ja = JSON.parse(a);
    const jb = JSON.parse(b);
    assert.match(ja.id, /^[0-9a-f-]{36}$/);
    assert.match(jb.id, /^[0-9a-f-]{36}$/);
    // the clock moves between two calls; the shape and everything else may not
    const norm = (text, j) =>
      text.replaceAll(j.id, '<id>').replace(String(j.expiresAt), '<expires>');
    assert.equal(norm(a, ja), norm(b, jb));
    assert.deepEqual(Object.keys(ja), Object.keys(jb));
    assert.equal(known.headers.get('content-type'), unknown.headers.get('content-type'));
  });

  it('an existing account is not a member — no membership, no grant — until it accepts', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'jonas@example.com', role: 'member' });
    await invite(env, { email: 'jonas@example.com', role: 'viewer', canvas: POSTER });
    assert.equal(roleOf(sqlite, 'a2'), null);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM canvas_grants WHERE account_id = 'a2'").get().n,
      0
    );
    // the claim agrees: the project is not theirs to open yet
    const token = await tokenFor(sqlite, 'a2');
    const h = await home(env, token);
    assert.equal(h.projects.length, 0);
    assert.equal(h.shared.length, 0);
    // …but Home lists the invitations waiting for them, by name, with no id and no address
    const rows = h.invited
      .map((i) => [i.projectId, i.projectName, i.fromName, i.canvas?.path ?? '', i.role])
      .sort((x, y) => x[3].localeCompare(y[3]));
    assert.deepEqual(rows, [
      [P, 'Alligators brand', 'Tereza', '', 'member'],
      [P, 'Alligators brand', 'Tereza', POSTER, 'viewer'],
    ]);
    const raw = JSON.stringify(h.invited);
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(raw), 'no invite id reaches Home');
    assert.ok(!raw.includes('tereza@example.com'), 'no inviter address reaches Home');
  });

  it('accept (Home) makes them a member with the invited role and hands the app a code', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'jonas@example.com', role: 'viewer' });
    const token = await tokenFor(sqlite, 'a2');
    const res = await pending(env, 'accept', token, { projectId: P });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.match(j.code, /^mhc_/);
    assert.deepEqual(j.landing, { project: P });
    assert.equal(roleOf(sqlite, 'a2'), 'viewer');
    assert.equal((await home(env, token)).invited.length, 0, 'accepted is no longer pending');
    // spent: a second accept finds nothing
    assert.equal((await pending(env, 'accept', token, { projectId: P })).status, 404);
  });

  it('accept from the e-mail link (the id lane) works for an account holder too', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (
      await invite(env, { email: 'jonas@example.com', role: 'viewer', canvas: POSTER })
    ).json();
    const token = await tokenFor(sqlite, 'a2');
    assert.equal((await acceptById(env, id, token)).status, 200);
    assert.deepEqual(
      {
        ...sqlite.prepare("SELECT role, source FROM canvas_grants WHERE account_id = 'a2'").get(),
      },
      { role: 'viewer', source: 'invite' }
    );
  });

  it('leave removes the pending entry and adds nothing', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'jonas@example.com', role: 'member' });
    const token = await tokenFor(sqlite, 'a2');
    assert.equal((await home(env, token)).invited.length, 1);
    const res = await pending(env, 'leave', token, { projectId: P });
    assert.equal(res.status, 200);
    assert.equal((await home(env, token)).invited.length, 0);
    assert.equal(roleOf(sqlite, 'a2'), null);
    assert.ok(sqlite.prepare('SELECT revoked_at FROM project_invites').get().revoked_at > 0);
    assert.equal((await pending(env, 'accept', token, { projectId: P })).status, 404);
  });

  it('only the addressed account can accept or leave; another account hears one 404', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'jonas@example.com', role: 'member' });
    const other = await tokenFor(sqlite, 'a4');
    assert.equal((await pending(env, 'accept', other, { projectId: P })).status, 404);
    assert.equal((await pending(env, 'leave', other, { projectId: P })).status, 404);
    assert.equal(roleOf(sqlite, 'a4'), 'observer');
    assert.equal(
      (
        await worker.fetch(
          new Request('https://cloud.test/api/invites/pending/accept', {
            method: 'POST',
            body: JSON.stringify({ projectId: P }),
          }),
          env
        )
      ).status,
      401,
      'no Bearer, no accept (a cookie never presses it)'
    );
  });
});

describe('redeem (finding 2)', () => {
  it('never lowers: a member invited as Can view stays a member after accepting', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'member@example.com', role: 'observer' });
    const token = await tokenFor(sqlite, 'a3');
    assert.equal((await pending(env, 'accept', token, { projectId: P })).status, 200);
    assert.equal(roleOf(sqlite, 'a3'), 'member');
  });

  it('an invitation for more raises', async () => {
    const { env, sqlite } = await fixture();
    await invite(env, { email: 'observer@example.com', role: 'member' });
    const token = await tokenFor(sqlite, 'a4');
    assert.equal((await pending(env, 'accept', token, { projectId: P })).status, 200);
    assert.equal(roleOf(sqlite, 'a4'), 'member');
  });

  it('single use under a race: two accepts at once redeem it once', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (await invite(env, { email: 'jonas@example.com', role: 'viewer' })).json();
    const token = await tokenFor(sqlite, 'a2');
    await Promise.all([acceptById(env, id, token), acceptById(env, id, token)]);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invite.redeem'").get().n,
      1
    );
  });
});

/** D1 as the network makes it: every statement resolves on a later turn, so parallel requests interleave the way
 *  concurrent Worker invocations do (a synchronous SQLite shim would otherwise run them one after another). */
function interleaved(db) {
  const later = (v) => new Promise((r) => setTimeout(() => r(v), 1));
  const wrap = (stmt) => ({
    bind: (...a) => wrap(stmt.bind(...a)),
    first: async (...a) => later(await stmt.first(...a)),
    all: async (...a) => later(await stmt.all(...a)),
    run: async (...a) => later(await stmt.run(...a)),
  });
  return { ...db, prepare: (sql) => wrap(db.prepare(sql)), batch: db.batch?.bind(db) };
}

describe('Ask to edit (finding 4)', () => {
  it(`the ${ACCESS_REQUEST_LIMIT.max}-per-day limit holds for parallel POSTs`, async () => {
    const { env: base, sqlite } = await fixture();
    const env = { ...base, DB: interleaved(base.DB) };
    const canvases = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `ui/${x}.tsx`);
    const res = await Promise.all(
      canvases.map((canvas) =>
        access(env, 'requests', { actor: 'observer@example.com', body: { canvas } })
      )
    );
    const codes = res.map((r) => r.status).sort();
    assert.equal(codes.filter((c) => c === 201).length, ACCESS_REQUEST_LIMIT.max);
    assert.ok(codes.filter((c) => c !== 201).every((c) => c === 429));
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM access_requests WHERE account_id = 'a4'").get().n,
      ACCESS_REQUEST_LIMIT.max
    );
  });
});
