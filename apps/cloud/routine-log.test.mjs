// The hourly platform check must not push real history off a capped log.
// Live finding 2026-11-25: the operator's project page (LIMIT 50) and the
// owner's Activity (LIMIT 200) showed nothing but "system reconcile".

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { d1FromSqlite } from './db.mjs';
import { MIGRATIONS } from './migrate.mjs';
import { handleOperatorRoutes } from './operator-routes.mjs';
import { activityEntries } from './project-admin.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, 'schema.sql'), 'utf8');
const OPERATOR = { id: 'acct_op', email: 'op@example.com' };
const NOW = Date.now();
const HOUR = 3_600_000;

function fresh() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA);
  for (const m of MIGRATIONS) for (const stmt of m.statements) sqlite.exec(stmt);
  sqlite.exec(
    `INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES ${MIGRATIONS.map((m) => `(${m.version}, 0)`).join(',')}`
  );
  sqlite.exec(
    `INSERT INTO accounts (id, email, created_at) VALUES ('acct_1', 'a@example.com', 1000), ('acct_op', 'op@example.com', 900)`
  );
  sqlite.exec(
    `INSERT INTO projects (id, account_id, name, state, state_since, plan, cell_running, created_at)
       VALUES ('alligators', 'acct_1', 'Brno Alligators', 'active', 0, 'project', 1, 1000)`
  );
  // A real event five days ago, then an hourly check every hour since.
  const ins = sqlite.prepare(
    'INSERT INTO audit_log (at, project_id, account_id, actor, action, reason) VALUES (?, ?, ?, ?, ?, ?)'
  );
  ins.run(
    NOW - 5 * 24 * HOUR,
    'alligators',
    'acct_1',
    'operator:op@example.com',
    'operator.promo.set',
    'demo for a partner'
  );
  for (let h = 1; h <= 5 * 24 - 1; h++)
    ins.run(NOW - h * HOUR, 'alligators', null, 'system', 'reconcile', null);
  return {
    sqlite,
    env: { DB: d1FromSqlite(sqlite), OPERATOR_ACCOUNT_IDS: 'acct_op', CELL_SECRET_MASTER: 'm' },
  };
}

describe('the routine check is one row, and real history survives it', () => {
  it('operator project page: the Promo mark is still there, the check is said once', async () => {
    const { env } = fresh();
    const res = await handleOperatorRoutes(
      new Request('https://cloud.maude.sh/operator/projects/alligators', {
        headers: { cookie: 'maude_session=s' },
      }),
      env,
      { account: OPERATOR, ctx: { waitUntil: (p) => p } }
    );
    const body = await res.text();
    assert.match(body, /demo for a partner/);
    assert.equal(body.match(/Routine platform check/g)?.length ?? 0, 1);
    assert.match(body, /119 times this week/);
  });

  it('owner Activity: the same', async () => {
    const { env } = fresh();
    const entries = await activityEntries(env, {
      project: { id: 'alligators', account_id: 'acct_1' },
      viewerId: 'acct_1',
    });
    assert.ok(entries.some((e) => e.reason === 'demo for a partner'));
    assert.equal(entries.filter((e) => e.action === 'reconcile').length, 1);
    assert.equal(entries.find((e) => e.action === 'reconcile').count, 119);
  });
});
