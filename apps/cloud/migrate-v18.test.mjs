// D1 v18 — who invited you, and to which comment (S6↔S9 contract §5.3, S9.14a).
//
// Self-contained on purpose: it builds a v17 database by applying everything
// and then rolling v18 back by hand, so it never depends on how many
// migrations exist (another test's count is somebody else's business).

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import { d1FromSqlite } from './db.mjs';
import { applySchema, MIGRATIONS } from './migrate.mjs';
import { SCHEMA_SQL } from './schema.mjs';

const cols = (sqlite) =>
  sqlite
    .prepare("SELECT name FROM pragma_table_info('project_invites')")
    .all()
    .map((c) => c.name);

/** A database exactly as v17 left it, holding one pre-v18 invitation. */
async function v17Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  // Apply only up to v17: run the full set, then undo v18's two columns. SQLite
  // has DROP COLUMN since 3.35, which node:sqlite ships.
  await applySchema(d1FromSqlite(sqlite), SCHEMA_SQL);
  if (cols(sqlite).includes('invited_by')) {
    sqlite.exec('ALTER TABLE project_invites DROP COLUMN invited_by');
    sqlite.exec('ALTER TABLE project_invites DROP COLUMN thread');
  }
  sqlite.prepare('DELETE FROM schema_migrations WHERE version >= 18').run();
  sqlite
    .prepare(`INSERT INTO accounts (id, email, created_at) VALUES ('a1', 'owner@example.com', 1)`)
    .run();
  sqlite
    .prepare(
      `INSERT INTO projects (id, account_id, name, state, state_since, created_at)
       VALUES ('alligators', 'a1', 'Alligators brand', 'active', 1, 1)`
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path)
       VALUES ('i-old', 'alligators', 'new@example.com', 'viewer', 1, 9e15, 'ui/poster.tsx')`
    )
    .run();
  return sqlite;
}

test('v18 adds invited_by + thread; rows from before it keep NULL in both', async () => {
  const sqlite = await v17Fixture();
  assert.ok(!cols(sqlite).includes('invited_by'), 'fixture is genuinely pre-v18');
  const out = await applySchema(d1FromSqlite(sqlite), SCHEMA_SQL);
  assert.ok(out.version >= 18);
  assert.ok(cols(sqlite).includes('invited_by'));
  assert.ok(cols(sqlite).includes('thread'));
  const row = sqlite.prepare("SELECT * FROM project_invites WHERE id = 'i-old'").get();
  assert.equal(row.invited_by, null);
  assert.equal(row.thread, null);
  assert.equal(row.canvas_path, 'ui/poster.tsx', 'nothing else on the row moved');
});

test('v18 is idempotent — a second run neither fails nor re-migrates', async () => {
  const sqlite = await v17Fixture();
  const db = d1FromSqlite(sqlite);
  await applySchema(db, SCHEMA_SQL);
  await applySchema(db, SCHEMA_SQL); // a second ALTER ADD COLUMN would throw
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 18').get().n,
    1
  );
});

test('v18 is a declared migration with exactly the two contract columns', () => {
  const m = MIGRATIONS.find((x) => x.version === 18);
  assert.ok(m, 'v18 exists');
  assert.deepEqual(m.statements, [
    'ALTER TABLE project_invites ADD COLUMN invited_by TEXT;',
    'ALTER TABLE project_invites ADD COLUMN thread TEXT;',
  ]);
});
