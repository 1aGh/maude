// The hourly platform check, said once instead of a hundred times.
//
// The reconciler writes a `reconcile` row for every project every hour. In a
// log capped at N rows that is N hours of history and nothing else: on
// 2026-11-25 the operator's project page (LIMIT 50) and the owner's Activity
// (LIMIT 200) showed only "system reconcile — Reason: —", and the moves, Promo
// marks and invitations they exist to show had been pushed off the end.
//
// So the plain hourly check (no reason — a reason means somebody asked for it,
// and that one is worth its own row) stays OUT of the capped list, and comes
// back as ONE row: the latest check, with how many ran in the last week.

const WEEK = 7 * 86_400_000;

/** SQL that keeps the routine check out of a capped list. */
export const NOT_ROUTINE = "NOT (action = 'reconcile' AND reason IS NULL)";

/**
 * `entries` (newest first) with the latest routine check folded in at its place.
 * The folded row carries `count` — how many routine checks ran in the last 7 days.
 */
export async function withRoutineCheck(db, projectId, entries, { now = Date.now() } = {}) {
  const row = await db
    .prepare(
      `SELECT MAX(at) AS at, SUM(CASE WHEN at > ? THEN 1 ELSE 0 END) AS n FROM audit_log
        WHERE project_id = ? AND action = 'reconcile' AND reason IS NULL`
    )
    .bind(now - WEEK, projectId)
    .first()
    .catch(() => null);
  if (!row?.at) return entries;
  const folded = { at: row.at, actor: 'system', action: 'reconcile', reason: null, count: row.n };
  const out = [...entries, folded];
  out.sort((a, b) => Number(b.at) - Number(a.at));
  return out;
}

/** "· 168 times this week" for a folded row, '' for any other. */
export function routineCount(entry) {
  const n = Number(entry?.count ?? 0);
  return n > 1 ? ` · ${n} times this week` : '';
}
