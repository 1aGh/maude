// D1 v17 — Can view, canvas grants, links, requests (V2-1.7 §5.8, S9.8).
//
// The live D1 is at v16. These tests build a v16 database with rows in it,
// run the real `applySchema`, and assert the rebuild copied every row
// verbatim, admits `observer`, keeps its foreign keys, is idempotent, and —
// through a D1-shaped `batch()` — lands atomically or not at all.

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { applySchema, MIGRATIONS, schemaStatements } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';

// v17 is no longer the newest migration (S9.14a added v18); "fully migrated"
// is whatever the newest declared version is, so these stay about v17.
const LATEST = Math.max(...MIGRATIONS.map((m) => m.version));

/**
 * The D1 binding shape WITH `batch()` — lazy prepare (D1 compiles at run
 * time, so a batch may reference a table an earlier statement creates) and
 * one transaction per batch, rolled back on the first failure, as D1 does.
 */
function d1WithBatch(sqlite, { failOn = null } = {}) {
  const make = (sql, args) => ({
    sql,
    args,
    bind: (...a) => make(sql, a),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    run: async () => {
      const info = sqlite.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  return {
    prepare: (sql) => make(sql, []),
    async batch(stmts) {
      sqlite.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) {
          if (failOn && failOn(s.sql)) throw new Error(`injected failure: ${s.sql.slice(0, 40)}`);
          out.push(await s.run());
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

/** A database exactly as the live D1 is today: baseline + v2..v16, with rows. */
function v16Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of schemaStatements(SCHEMA_SQL)) sqlite.exec(sql);
  for (const m of MIGRATIONS.filter((x) => x.version <= 16)) {
    for (const sql of m.statements) sqlite.exec(sql);
    sqlite
      .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(m.version, 1);
  }
  const acct = sqlite.prepare('INSERT INTO accounts (id, email, created_at) VALUES (?, ?, 1)');
  for (const [id, email] of [
    ['a1', 'owner@example.com'],
    ['a2', 'member@example.com'],
    ['a3', 'viewer@example.com'],
    ['a4', 'other@example.com'],
  ]) {
    acct.run(id, email);
  }
  sqlite
    .prepare(
      "INSERT INTO projects (id, account_id, name, state, state_since, created_at) VALUES ('alligators', 'a1', 'A', 'active', 1, 1)"
    )
    .run();
  const mem = sqlite.prepare(
    'INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)'
  );
  mem.run('alligators', 'a2', 'member', 11);
  mem.run('alligators', 'a3', 'viewer', 12);
  mem.run('alligators', 'a1', 'owner', 13);
  const inv = sqlite.prepare(
    `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, redeemed_at, revoked_at)
     VALUES (?, 'alligators', ?, ?, ?, ?, ?, ?)`
  );
  inv.run('i-1', 'new@example.com', 'member', 100, 200, null, null);
  inv.run('i-2', 'gone@example.com', 'viewer', 101, 201, 150, null);
  inv.run('i-3', 'nope@example.com', 'viewer', 102, 202, null, 160);
  sqlite
    .prepare(
      `INSERT INTO handoff_codes (id, project_id, account_id, role, created_at, expires_at, surface)
       VALUES ('h1', 'alligators', 'a2', 'member', 1, 2, 'browser')`
    )
    .run();
  return sqlite;
}

const rows = (sqlite, sql) =>
  sqlite
    .prepare(sql)
    .all()
    .map((r) => ({ ...r }));
const MEMBERS =
  'SELECT project_id, account_id, role, added_at FROM project_members ORDER BY account_id';
const INVITES =
  'SELECT id, project_id, email, role, created_at, expires_at, redeemed_at, revoked_at FROM project_invites ORDER BY id';

test('v17 copies every member and invite row verbatim', async () => {
  const sqlite = v16Fixture();
  const beforeMembers = rows(sqlite, MEMBERS);
  const beforeInvites = rows(sqlite, INVITES);
  const out = await applySchema(d1WithBatch(sqlite), SCHEMA_SQL);
  assert.equal(out.version, LATEST);
  assert.deepEqual(rows(sqlite, MEMBERS), beforeMembers);
  assert.deepEqual(rows(sqlite, INVITES), beforeInvites);
  // The new columns start empty on every existing row: no role was rewritten.
  assert.deepEqual(rows(sqlite, 'SELECT DISTINCT source FROM project_members'), [{ source: null }]);
  assert.deepEqual(rows(sqlite, 'SELECT DISTINCT canvas_path FROM project_invites'), [
    { canvas_path: null },
  ]);
  const code = sqlite.prepare("SELECT * FROM handoff_codes WHERE id = 'h1'").get();
  assert.equal(code.role, 'member');
  assert.equal(code.surface, 'browser');
  assert.equal(code.access, null);
  assert.equal(code.landing, null);
});

test('v17 admits observer and still refuses anything outside the matrix', async () => {
  const sqlite = v16Fixture();
  // Red on v16: the CHECK pins viewer/member/owner.
  assert.throws(() =>
    sqlite
      .prepare(
        "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', 'a4', 'observer', 1)"
      )
      .run()
  );
  await applySchema(d1WithBatch(sqlite), SCHEMA_SQL);
  sqlite
    .prepare(
      "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', 'a4', 'observer', 1)"
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path)
       VALUES ('i-4', 'alligators', 'v@example.com', 'observer', 1, 2, 'ui/a.tsx')`
    )
    .run();
  for (const bad of ['admin', 'Owner', '']) {
    assert.throws(() =>
      sqlite
        .prepare(
          "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', 'a4', ?, 1) ON CONFLICT DO UPDATE SET role = excluded.role"
        )
        .run(bad)
    );
  }
  // An invitation never makes an owner; a grant never carries owner.
  assert.throws(() =>
    sqlite
      .prepare(
        "INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at) VALUES ('i-5', 'alligators', 'o@example.com', 'owner', 1, 2)"
      )
      .run()
  );
  assert.throws(() =>
    sqlite
      .prepare(
        "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES ('alligators', 'a4', 'ui/a.tsx', 'owner', 'invite', 1)"
      )
      .run()
  );
  // Links give Can view or Can comment, never more.
  assert.throws(() =>
    sqlite
      .prepare(
        "INSERT INTO share_links (id, project_id, role, who, created_by, created_at) VALUES ('l1', 'alligators', 'member', 'anyone', 'a1', 1)"
      )
      .run()
  );
});

test('v17 foreign keys hold: grants and links die with their project', async () => {
  const sqlite = v16Fixture();
  await applySchema(d1WithBatch(sqlite), SCHEMA_SQL);
  assert.throws(
    () =>
      sqlite
        .prepare(
          "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES ('nope', 'a4', 'ui/a.tsx', 'viewer', 'invite', 1)"
        )
        .run(),
    /FOREIGN KEY/
  );
  assert.throws(
    () =>
      sqlite
        .prepare(
          "INSERT INTO project_members (project_id, account_id, role, added_at) VALUES ('alligators', 'ghost', 'viewer', 1)"
        )
        .run(),
    /FOREIGN KEY/
  );
  sqlite
    .prepare(
      "INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_at) VALUES ('alligators', 'a4', 'ui/a.tsx', 'viewer', 'invite', 1)"
    )
    .run();
  sqlite.prepare("DELETE FROM accounts WHERE id = 'a4'").run();
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM canvas_grants').get().n, 0);
  assert.equal(
    sqlite.prepare('PRAGMA foreign_key_check').all().length,
    0,
    'no dangling reference after the rebuild'
  );
  // Indexes the rebuild dropped with the old tables are back.
  const idx = rows(sqlite, "SELECT name FROM sqlite_master WHERE type = 'index'").map(
    (r) => r.name
  );
  for (const name of ['members_account', 'project_invites_email', 'access_requests_open']) {
    assert.ok(idx.includes(name), name);
  }
});

test('one open request per person per scope; a decided one frees the slot', async () => {
  const sqlite = v16Fixture();
  await applySchema(d1WithBatch(sqlite), SCHEMA_SQL);
  const add = sqlite.prepare(
    "INSERT INTO access_requests (id, project_id, account_id, canvas_path, created_at) VALUES (?, 'alligators', 'a3', ?, 1)"
  );
  add.run('r1', null);
  assert.throws(() => add.run('r2', null), /UNIQUE/);
  add.run('r3', 'ui/a.tsx');
  sqlite
    .prepare("UPDATE access_requests SET decided_at = 2, decision = 'declined' WHERE id = 'r1'")
    .run();
  add.run('r4', null);
});

test('v17 is idempotent — a second run neither fails nor re-migrates', async () => {
  const sqlite = v16Fixture();
  const db = d1WithBatch(sqlite);
  await applySchema(db, SCHEMA_SQL);
  const after = rows(sqlite, MEMBERS);
  const second = await applySchema(db, SCHEMA_SQL);
  assert.equal(second.version, LATEST);
  assert.deepEqual(rows(sqlite, MEMBERS), after);
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 17').get().n,
    1
  );
  // The plain (batch-less) local-tool shape reaches the same end state.
  const fresh = new DatabaseSync(':memory:');
  assert.equal((await applySchema(d1FromSqlite(fresh), SCHEMA_SQL)).version, LATEST);
  assert.equal((await applySchema(d1FromSqlite(fresh), SCHEMA_SQL)).version, LATEST);
});

test('a failure part-way through v17 leaves v16 intact, and a re-run completes', async () => {
  const sqlite = v16Fixture();
  const before = rows(sqlite, MEMBERS);
  // Fail AFTER the old table was dropped — the one moment a non-atomic
  // rebuild would lose the membership table.
  const flaky = d1WithBatch(sqlite, {
    failOn: (sql) => sql.startsWith('ALTER TABLE project_members_v2'),
  });
  await assert.rejects(applySchema(flaky, SCHEMA_SQL), /injected failure/);
  assert.deepEqual(rows(sqlite, MEMBERS), before);
  assert.equal(sqlite.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 16);
  assert.equal(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'project_members_v2'").get(),
    undefined
  );
  assert.equal((await applySchema(d1WithBatch(sqlite), SCHEMA_SQL)).version, LATEST);
  assert.deepEqual(rows(sqlite, MEMBERS), before);
});
