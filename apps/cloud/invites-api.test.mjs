// The app's half of an invitation — S6↔S9 contract §5.2 + §5.3 (Maude v2 S9.14a).
//
//   GET  /api/invites/<id>/peek    no auth; the invite page's facts; ONE 404
//   POST /api/invites/<id>/accept  Bearer mpt_… → { code, landing } · 401 · 403 · 404 · 426
//   landingAfterSignIn             the device-token "which project first" hint
//
// Real SQLite behind the D1 shape, real Requests through the live Worker. An
// invitation is created the way production creates one — through the access
// authority a cell forwards to — so `invited_by` and `thread` are proven
// end to end, not planted.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { landingAfterSignIn } from './invites.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const MASTER = 'master';
const P = 'alligators';
const POSTER = 'brand/Combine-kampan.tsx';
const DEAD = 'This invitation link is not valid. Ask the person who invited you for a new one.';

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
  acct.run('a9', 'nameless@example.com', null);
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES (?, 'a1', 'Alligators brand', 'active', 1, 1)`
    )
    .run(P);
  return { env: { DB, CELL_SECRET_MASTER: MASTER, CELL_ZONE: 'cloud.test' }, sqlite };
}

/** Create an invitation the way a cell does: through the access authority. */
async function invite(env, body, actor = 'tereza@example.com') {
  const secret = await deriveCellSecret(MASTER, P);
  const res = await worker.fetch(
    new Request(`https://cloud.test/internal/projects/${P}/access/invites`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'x-maude-actor': actor,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env
  );
  return res;
}

/** A signed-up account plus a personal token for it (the app's credential). */
async function appAccount(sqlite, { id, email, name = null }) {
  sqlite
    .prepare('INSERT INTO accounts (id, email, name, created_at) VALUES (?, ?, ?, 1)')
    .run(id, email, name);
  const token = `mpt_${id.padEnd(48, '0')}`;
  sqlite
    .prepare('INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, 1)')
    .run(await sha256Hex(token), id, 'Maude on macOS');
  return token;
}

const peek = (env, id, headers = {}) =>
  worker.fetch(new Request(`https://cloud.test/api/invites/${id}/peek`, { headers }), env);

const accept = (env, id, token, { v2 = true, headers = {} } = {}) =>
  worker.fetch(
    new Request(`https://cloud.test/api/invites/${id}/accept`, {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(v2 ? { 'x-maude-access': '2' } : {}),
        ...headers,
      },
    }),
    env
  );

// The forwarder notifies cells; nothing here is about that, so it answers 204.
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

describe('POST /api/access/invite records the inviter and the comment (v18)', () => {
  it('invited_by = the actor’s account id; thread only with a canvas', async () => {
    const { env, sqlite } = await fixture();
    const ok = await invite(env, {
      email: 'jonas@example.com',
      role: 'viewer',
      canvas: POSTER,
      thread: 't_9Xy-1',
    });
    assert.equal(ok.status, 201);
    const { id } = await ok.json();
    const row = sqlite.prepare('SELECT * FROM project_invites WHERE id = ?').get(id);
    assert.equal(row.invited_by, 'a1');
    assert.equal(row.thread, 't_9Xy-1');

    for (const bad of [
      { email: 'x@example.com', role: 'viewer', thread: 't1' }, // no canvas
      { email: 'x@example.com', role: 'viewer', canvas: POSTER, thread: 'has space' },
      { email: 'x@example.com', role: 'viewer', canvas: POSTER, thread: 'x'.repeat(65) },
    ]) {
      const res = await invite(env, bad);
      assert.equal(res.status, 422, JSON.stringify(bad));
      assert.equal((await res.json()).reason, 'bad-thread');
    }
  });
});

describe('GET /api/invites/<id>/peek', () => {
  it('answers exactly the invite page’s facts — a name, never the inviter’s e-mail', async () => {
    const { env } = await fixture();
    const { id } = await (
      await invite(env, {
        email: 'jonas@example.com',
        role: 'viewer',
        canvas: POSTER,
        thread: 't1',
      })
    ).json();
    const res = await peek(env, id);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(body, {
      projectName: 'Alligators brand',
      fromName: 'Tereza',
      email: 'jonas@example.com',
      role: 'viewer',
      canvas: { path: POSTER, name: 'Combine-kampan' },
      thread: 't1',
    });
    assert.ok(!JSON.stringify(body).includes('tereza@example.com'));
  });

  it('a project-wide invitation has no canvas/thread keys; an unnamed inviter is null', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (await invite(env, { email: 'jonas@example.com', role: 'member' })).json();
    const named = await (await peek(env, id)).json();
    assert.equal(named.fromName, 'Tereza');
    assert.ok(!('canvas' in named) && !('thread' in named));
    // O3: an inviter with no name → null (never their address instead).
    sqlite.prepare("UPDATE accounts SET name = NULL WHERE id = 'a1'").run();
    assert.equal((await (await peek(env, id)).json()).fromName, null);
    // A pre-v18 row (no inviter recorded) reads the same way.
    sqlite.prepare('UPDATE project_invites SET invited_by = NULL WHERE id = ?').run(id);
    assert.equal((await (await peek(env, id)).json()).fromName, null);
  });

  it('wrong, malformed, expired, revoked and spent ids get ONE byte-identical 404', async () => {
    const { env, sqlite } = await fixture();
    const make = async (email) => (await (await invite(env, { email, role: 'viewer' })).json()).id;
    const expired = await make('e@example.com');
    const revoked = await make('r@example.com');
    const spent = await make('s@example.com');
    sqlite.prepare('UPDATE project_invites SET expires_at = 1 WHERE id = ?').run(expired);
    sqlite.prepare('UPDATE project_invites SET revoked_at = 5 WHERE id = ?').run(revoked);
    sqlite
      .prepare('UPDATE project_invites SET redeemed_at = ? WHERE id = ?')
      .run(Date.now(), spent);
    const answers = [];
    for (const id of [crypto.randomUUID(), 'not-an-id', '%E0%A4%A', expired, revoked, spent]) {
      const res = await peek(env, id);
      answers.push({
        status: res.status,
        body: await res.text(),
        headers: [...res.headers].filter(([k]) => k !== 'date'),
      });
    }
    for (const a of answers) assert.deepEqual(a, answers[0]);
    assert.equal(answers[0].status, 404);
    assert.deepEqual(JSON.parse(answers[0].body), { reason: 'gone', error: DEAD });
  });

  it('is rate-limited per client: the 31st peek in a minute is 429 with Retry-After', async () => {
    const { env } = await fixture();
    const id = crypto.randomUUID();
    const from = { 'cf-connecting-ip': '203.0.113.9' };
    for (let i = 0; i < 30; i++) assert.equal((await peek(env, id, from)).status, 404);
    const limited = await peek(env, id, from);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    // Another client's budget is its own.
    assert.equal((await peek(env, id, { 'cf-connecting-ip': '203.0.113.10' })).status, 404);
  });
});

describe('POST /api/invites/<id>/accept', () => {
  it('the invited person → 200 {code, landing}; the code trades on the link lane', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (
      await invite(env, {
        email: 'jonas@example.com',
        role: 'viewer',
        canvas: POSTER,
        thread: 't1',
      })
    ).json();
    const token = await appAccount(sqlite, { id: 'a2', email: 'Jonas@Example.com' });
    const res = await accept(env, id, token);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.code, /^mhc_[0-9a-f]{64}$/);
    assert.deepEqual(body.landing, { project: P, canvas: POSTER, thread: 't1' });
    const row = sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(id);
    assert.ok(row.redeemed_at > 0, 'redeemed');
    const grant = sqlite
      .prepare("SELECT role FROM canvas_grants WHERE account_id = 'a2' AND canvas_path = ?")
      .get(POSTER);
    assert.equal(grant.role, 'viewer');
    // The code is a real handoff code: one row, short-lived.
    const code = sqlite.prepare('SELECT * FROM handoff_codes').get();
    assert.equal(code.account_id, 'a2');
    assert.equal(code.surface, 'app');
  });

  it('is idempotent for the same person — a re-accept is 200 with a FRESH code', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (await invite(env, { email: 'jonas@example.com', role: 'member' })).json();
    const token = await appAccount(sqlite, { id: 'a2', email: 'jonas@example.com' });
    const first = await (await accept(env, id, token)).json();
    const again = await accept(env, id, token);
    assert.equal(again.status, 200);
    const second = await again.json();
    assert.notEqual(second.code, first.code);
    assert.deepEqual(second.landing, { project: P });
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'invite.redeem'").get().n,
      1,
      'redeemed once, not twice'
    );
    // …but only within the half hour.
    sqlite
      .prepare('UPDATE project_invites SET redeemed_at = ? WHERE id = ?')
      .run(Date.now() - 31 * 60_000, id);
    assert.equal((await accept(env, id, token)).status, 404);
  });

  it('another account → 403 other-account, and the invitation is NOT redeemed', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (await invite(env, { email: 'jonas@example.com', role: 'member' })).json();
    const other = await appAccount(sqlite, { id: 'a3', email: 'petra@example.com' });
    const res = await accept(env, id, other);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { reason: 'other-account', email: 'jonas@example.com' });
    const row = sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(id);
    assert.equal(row.redeemed_at, null);
    assert.equal(
      sqlite.prepare("SELECT COUNT(*) AS n FROM project_members WHERE account_id = 'a3'").get().n,
      0
    );
    // Once spent by its own person, anybody else gets the dead-link 404.
    const mine = await appAccount(sqlite, { id: 'a2', email: 'jonas@example.com' });
    assert.equal((await accept(env, id, mine)).status, 200);
    assert.equal((await accept(env, id, other)).status, 404);
  });

  it('no or a bad token → 401 signed-out; a dead id → 404 gone', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (await invite(env, { email: 'jonas@example.com', role: 'member' })).json();
    assert.deepEqual(await (await accept(env, id, null)).json(), { reason: 'signed-out' });
    assert.equal((await accept(env, id, 'mpt_nope')).status, 401);
    const token = await appAccount(sqlite, { id: 'a2', email: 'jonas@example.com' });
    const gone = await accept(env, crypto.randomUUID(), token);
    assert.equal(gone.status, 404);
    assert.deepEqual(await gone.json(), { reason: 'gone', error: DEAD });
  });

  it('a canvas invitation without X-Maude-Access: 2 → 426, before anything is redeemed', async () => {
    const { env, sqlite } = await fixture();
    const { id } = await (
      await invite(env, { email: 'jonas@example.com', role: 'viewer', canvas: POSTER })
    ).json();
    // Both invitations exist before the account does (an address WITH an
    // account is added directly and gets no invitation row — O1).
    const { id: whole } = await (
      await invite(env, { email: 'jonas@example.com', role: 'member' })
    ).json();
    const token = await appAccount(sqlite, { id: 'a2', email: 'jonas@example.com' });
    const res = await accept(env, id, token, { v2: false });
    assert.equal(res.status, 426);
    assert.equal((await res.json()).reason, 'access-version');
    const row = sqlite.prepare('SELECT redeemed_at FROM project_invites WHERE id = ?').get(id);
    assert.equal(row.redeemed_at, null);
    // A project-wide invitation is v1-expressible: no header needed.
    assert.equal((await accept(env, whole, token, { v2: false })).status, 200);
  });

  it('only POST; peek only GET', async () => {
    const { env } = await fixture();
    const id = crypto.randomUUID();
    const g = await worker.fetch(new Request(`https://cloud.test/api/invites/${id}/accept`), env);
    assert.equal(g.status, 405);
    const p = await worker.fetch(
      new Request(`https://cloud.test/api/invites/${id}/peek`, { method: 'POST' }),
      env
    );
    assert.equal(p.status, 405);
  });
});

describe('landingAfterSignIn — the device-token hint (§5.2)', () => {
  async function redeemed(sqlite, env, { canvas = null, thread = null, ago = 10 * 60_000 } = {}) {
    const body = { email: 'jonas@example.com', role: 'viewer', ...(canvas ? { canvas } : {}) };
    if (thread) body.thread = thread;
    const { id } = await (await invite(env, body)).json();
    const token = await appAccount(sqlite, { id: 'a2', email: 'jonas@example.com' });
    assert.equal((await accept(env, id, token)).status, 200);
    sqlite
      .prepare('UPDATE project_invites SET redeemed_at = ? WHERE id = ?')
      .run(Date.now() - ago, id);
    return id;
  }

  it('redeemed 10 min ago → landing with canvas + thread', async () => {
    const { env, sqlite } = await fixture();
    await redeemed(sqlite, env, { canvas: POSTER, thread: 't1' });
    assert.deepEqual(
      await landingAfterSignIn(env, { accountId: 'a2', email: 'jonas@example.com' }),
      { project: P, canvas: POSTER, thread: 't1' }
    );
  });

  it('31 min ago → none', async () => {
    const { env, sqlite } = await fixture();
    await redeemed(sqlite, env, { canvas: POSTER, ago: 31 * 60_000 });
    assert.equal(
      await landingAfterSignIn(env, { accountId: 'a2', email: 'jonas@example.com' }),
      null
    );
  });

  it('a canvas the claim cannot see → {project} alone (the thread goes with it)', async () => {
    const { env, sqlite } = await fixture();
    await redeemed(sqlite, env, { canvas: POSTER, thread: 't1' });
    // The grant is narrowed away but the person stays on the project.
    sqlite.prepare("DELETE FROM canvas_grants WHERE account_id = 'a2'").run();
    sqlite
      .prepare(
        "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES (?, 'a2', 'brand/Other.tsx', 'viewer', 'invite', 1)"
      )
      .run(P);
    assert.deepEqual(
      await landingAfterSignIn(env, { accountId: 'a2', email: 'jonas@example.com' }),
      { project: P }
    );
  });

  it('access removed between redeem and token → no landing', async () => {
    const { env, sqlite } = await fixture();
    await redeemed(sqlite, env, { canvas: POSTER });
    sqlite.prepare("DELETE FROM canvas_grants WHERE account_id = 'a2'").run();
    assert.equal(
      await landingAfterSignIn(env, { accountId: 'a2', email: 'jonas@example.com' }),
      null
    );
  });
});
