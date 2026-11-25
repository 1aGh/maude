// How an owner's projects are used — the reads behind the dashboard's overview
// (canvas 16, cl-account). Effects layer: D1 for the facts D1 holds, Analytics
// Engine (analytics.mjs `ownerMetrics`) for the ones the edge has been
// recording. No decision lives here; dashboard.mjs renders what it is given.
//
// TWO RULES, both tests:
//   - A FIGURE NOBODY RECORDS IS NOT SHOWN. There is no count of edits
//     anywhere on the plane, so there is no Edits tile — not an estimate, not
//     a dash.
//   - ONLY PROJECTS THE ACCOUNT OWNS. The plan of a project, and how it is
//     used, is its owner's business; a member's dashboard gets neither.

import { ownerMetrics } from './analytics.mjs';
import { changesView } from './changes.mjs';
import { ownerPlan } from './plan-copy.mjs';

const DAY_MS = 86_400_000;

async function rows(db, sql, ...args) {
  try {
    const res = await db
      .prepare(sql)
      .bind(...args)
      .all();
    return res?.results ?? [];
  } catch {
    return null; // unreadable is unknown, never empty
  }
}

/**
 * The plan line of every project this account OWNS: `Map<projectId, ownerPlan>`.
 * `SELECT *` on purpose — the plan columns arrived in D1 v19 and v21, and a
 * database the hourly migration has not reached yet must still list projects.
 */
export async function ownerPlans(env, accountId, { now = Date.now() } = {}) {
  const owned = await rows(
    env.DB,
    `SELECT * FROM projects WHERE account_id = ? AND state != 'purged'`,
    accountId
  );
  return new Map((owned ?? []).map((p) => [p.id, ownerPlan(p, { now })]));
}

/**
 * The overview, or null when the account owns no project.
 *
 * @returns {Promise<null | {
 *   projects: number, people: number|null,
 *   invites: {sent: number, joined: number, waiting: number}|null,
 *   activeThisWeek: number|null, canvases: number|null, exports: number|null,
 *   storageBytes: number|null, opens: Record<string, number>|null, sampled: boolean }>}
 */
export async function ownerOverview(env, accountId, { now = Date.now() } = {}) {
  // `SELECT *`: the Changes column arrived in D1 v24, and a database the
  // hourly migration has not reached yet must still draw the dashboard.
  const owned = await rows(
    env.DB,
    `SELECT * FROM projects WHERE account_id = ? AND state != 'purged'`,
    accountId
  );
  if (!owned?.length) return null;
  const ids = owned.map((p) => p.id);

  // People: everyone on a project this account owns — members and people with
  // one canvas — and the owner. Distinct: Jonas on two projects is one person.
  const members = await rows(
    env.DB,
    `SELECT m.account_id AS id FROM project_members m JOIN projects p ON p.id = m.project_id
      WHERE p.account_id = ?1 AND p.state != 'purged'
     UNION
     SELECT g.account_id AS id FROM canvas_grants g JOIN projects p ON p.id = g.project_id
      WHERE p.account_id = ?1 AND p.state != 'purged'`,
    accountId
  );
  const people = members === null ? null : new Set([accountId, ...members.map((m) => m.id)]).size;

  // Invitations, last 30 days: sent, of those joined, and still open right now.
  const invited = await rows(
    env.DB,
    `SELECT i.redeemed_at, i.revoked_at, i.expires_at
       FROM project_invites i JOIN projects p ON p.id = i.project_id
      WHERE p.account_id = ? AND p.state != 'purged' AND i.created_at > ?`,
    accountId,
    now - 30 * DAY_MS
  );
  const invites =
    invited === null
      ? null
      : {
          sent: invited.length,
          joined: invited.filter((i) => i.redeemed_at).length,
          waiting: invited.filter((i) => !i.redeemed_at && !i.revoked_at && i.expires_at > now)
            .length,
        };

  // Faces on a project card: who is in it, as an initial. Names and addresses
  // of people on projects THIS account owns — what its People page already
  // shows — and never more than three a card.
  const inside = await rows(
    env.DB,
    `SELECT m.project_id AS project, a.email, a.name
       FROM project_members m
       JOIN projects p ON p.id = m.project_id
       JOIN accounts a ON a.id = m.account_id
      WHERE p.account_id = ? AND p.state != 'purged' AND m.role != 'owner'
      ORDER BY m.project_id, a.email`,
    accountId
  );
  const faces = new Map();
  for (const row of inside ?? []) {
    const list = faces.get(row.project) ?? [];
    if (list.length < 3) list.push({ email: row.email, name: row.name });
    faces.set(row.project, list);
  }

  const metrics = await ownerMetrics(env, ids);
  const m = metrics.ok ? metrics : null;
  return {
    projects: ids.length,
    people,
    invites,
    activeThisWeek: m?.activeThisWeek ?? null,
    canvases: m?.canvases ?? null,
    exports: m?.exports ?? null,
    storageBytes: m?.storageBytes ?? null,
    opens: m?.opens ?? null,
    sampled: m?.sampled ?? false,
    // From D1, whatever analytics is doing: what each project's workspace
    // last reported (changes.mjs). null when none reports — no tile, no chart.
    changes: changesView(owned, { now }),
    faces,
  };
}
