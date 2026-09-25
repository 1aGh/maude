// Phase 23 B2 — a removal writes a revocation the cell can consume.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { deriveCellSecret } from './cell-token.mjs';
import { d1FromSqlite } from './db.mjs';
import { applySchema } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';
import worker from './worker.mjs';

const PASSWORD = 'a-long-enough-password';
const form = (f) => new URLSearchParams(f).toString();

async function freshEnv(extra = {}) {
  const sqlite = new DatabaseSync(':memory:');
  const DB = d1FromSqlite(sqlite);
  await applySchema(DB, SCHEMA_SQL);
  return { env: { DB, CELL_SECRET_MASTER: 'master', ...extra }, sqlite };
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

test('removing a member writes a revocation; the cell reads it with its derived secret', async () => {
  const { env, sqlite } = await freshEnv();
  const owner = await signedIn(env, 'owner@example.com');
  await signedIn(env, 'member@example.com');
  const ownerId = sqlite
    .prepare("SELECT id FROM accounts WHERE email = 'owner@example.com'")
    .get().id;
  const memberId = sqlite
    .prepare("SELECT id FROM accounts WHERE email = 'member@example.com'")
    .get().id;
  sqlite
    .prepare(
      "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES ('alligators', ?, 'Alligators', 'active', 1, 1)"
    )
    .run(ownerId);
  sqlite
    .prepare(
      "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', ?, 'member', 1)"
    )
    .run(memberId);

  // The cell is asked to sweep NOW (G5) — record the knock instead of sending it.
  const knocks = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    knocks.push({ url: String(url), init });
    return new Response(JSON.stringify({ ran: true, seen: 1, revoked: 1 }), { status: 200 });
  };
  let res;
  try {
    res = await worker.fetch(
      new Request('https://cloud.test/projects/alligators/people', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `maude_session=${owner}`,
        },
        body: form({ do: 'remove', account: memberId }),
      }),
      env
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(res.status < 400, `removal succeeded (${res.status})`);
  const expectedSecret = await deriveCellSecret('master', 'alligators');
  assert.equal(knocks.length, 1, 'the cell is asked once, right after the removal');
  assert.equal(knocks[0].url, 'https://alligators.cloud.maude.sh/internal/revocation-sweep');
  assert.equal(knocks[0].init.method, 'POST');
  assert.equal(knocks[0].init.headers.authorization, `Bearer ${expectedSecret}`);
  assert.equal(knocks[0].init.redirect, 'manual', 'never follows the cell elsewhere');

  const row = sqlite.prepare('SELECT * FROM member_revocations').get();
  assert.equal(row.project_id, 'alligators');
  assert.equal(row.email, 'member@example.com');

  // The cell's read: derived secret in, emails out. Wrong secret learns nothing.
  const secret = await deriveCellSecret('master', 'alligators');
  const ok = await worker.fetch(
    new Request('https://cloud.test/internal/revocations?tenant=alligators&since=0', {
      headers: { authorization: `Bearer ${secret}` },
    }),
    env
  );
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.revocations.length, 1);
  assert.equal(body.revocations[0].email, 'member@example.com');

  const bad = await worker.fetch(
    new Request('https://cloud.test/internal/revocations?tenant=alligators&since=0', {
      headers: { authorization: 'Bearer nope' },
    }),
    env
  );
  assert.equal(bad.status, 401);

  // `since` bounds the window — the sweep never replays ancient history.
  const later = await worker.fetch(
    new Request(
      `https://cloud.test/internal/revocations?tenant=alligators&since=${Date.now() + 60_000}`,
      {
        headers: { authorization: `Bearer ${secret}` },
      }
    ),
    env
  );
  assert.deepEqual((await later.json()).revocations, []);
});
