// Control-plane D1 access — Cloud Phase 12.
//
// One module owns every SQL string, so the Worker stays a router and the tests
// exercise the same statements production runs. D1 IS SQLite, so tests bind
// these functions to better-sqlite3 through the same minimal interface
// (`prepare(sql).bind(...).all()/first()/run()`) instead of mocking an API
// nobody has seen misbehave (DDR-196 rejected fictional mocks).

/**
 * Wrap a synchronous SQLite handle (node:sqlite `DatabaseSync` or
 * better-sqlite3 — both expose prepare().all/get/run) in the D1 binding shape,
 * for tests and local tools. Callers use .run() for writes and .all()/.first()
 * for reads, so the mapping is direct.
 */
export function d1FromSqlite(sqlite) {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      const make = (args) => ({
        all: async () => ({ results: stmt.all(...args) }),
        first: async () => stmt.get(...args) ?? null,
        run: async () => {
          const info = stmt.run(...args);
          return { success: true, meta: { changes: Number(info.changes) } };
        },
      });
      return { bind: (...args) => make(args), ...make([]) };
    },
  };
}

// ------------------------------------------------------------------ projects

export async function getProject(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first();
}

export async function getProjectBySubscription(db, subscriptionId) {
  return db
    .prepare('SELECT * FROM projects WHERE subscription_id = ?')
    .bind(subscriptionId)
    .first();
}

export async function listProjects(db) {
  const { results } = await db.prepare('SELECT * FROM projects ORDER BY id').all();
  return results ?? [];
}

/** Row → the tenant shape reconcile.mjs speaks. One translation, one place. */
export function tenantFromRow(row) {
  return {
    id: row.id,
    state: row.state,
    stateSince: row.state_since,
    cellRunning: !!row.cell_running,
    exportSent: !!row.export_sent_at,
    adverseSince: typeof row.adverse_since === 'number' ? row.adverse_since : null,
    // A3 (S9.15): set only on a trial project. Read-only for reconcile —
    // `saveTenant` never writes either of these.
    trialEndsAt: row.trial_ends_at ?? null,
    subscriptionId: row.subscription_id ?? null,
  };
}

/** Persist a settled tenant back. Only the columns reconcile can change. */
export async function saveTenant(db, tenant, { now = Date.now() } = {}) {
  return db
    .prepare(
      'UPDATE projects SET state = ?, state_since = ?, cell_running = ?, adverse_since = ?, ' +
        'export_sent_at = CASE WHEN ? THEN COALESCE(export_sent_at, ?) ELSE export_sent_at END ' +
        'WHERE id = ?'
    )
    .bind(
      tenant.state,
      tenant.stateSince,
      tenant.cellRunning ? 1 : 0,
      tenant.adverseSince ?? null,
      tenant.exportSent ? 1 : 0,
      now,
      tenant.id
    )
    .run();
}

// -------------------------------------------------------------------- jobs
//
// A job is always "reconcile this project" (schema comment). The queue-less
// Free tier works because the webhook only INSERTS a row; the cron drains
// them. Queues, when Phase 11 unlocks them, becomes a faster drain of the
// same table — never a second source of truth.

export async function enqueueReconcile(db, { projectId, reason }, { now = Date.now() } = {}) {
  const id = `job_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db
    .prepare('INSERT INTO jobs (id, project_id, reason, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, projectId, reason, now)
    .run();
  return id;
}

export async function pendingJobs(db, { limit = 50 } = {}) {
  const { results } = await db
    .prepare('SELECT * FROM jobs WHERE finished_at IS NULL ORDER BY created_at LIMIT ?')
    .bind(limit)
    .all();
  return results ?? [];
}

export async function finishJob(db, id, outcome, detail, { now = Date.now() } = {}) {
  return db
    .prepare(
      'UPDATE jobs SET started_at = COALESCE(started_at, ?), finished_at = ?, outcome = ?, detail = ? WHERE id = ?'
    )
    .bind(now, now, outcome, detail ?? null, id)
    .run();
}

// -------------------------------------------------------------------- audit

export async function audit(
  db,
  { accountId = null, projectId = null, actor, action, reason = null, detail = null },
  { now = Date.now() } = {}
) {
  const id = `aud_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await db
    .prepare(
      'INSERT INTO audit_log (id, account_id, project_id, at, actor, action, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(id, accountId, projectId, now, actor, action, reason, detail)
    .run();
  return id;
}
