// GET /api/home — Maude v2 S6.14 (V2-1.1 §5.7, S6-S9 §5.4, V2-1.16 L14).
//
// Home's cloud source: the projects this account can open, and "Shared with
// you" — the account's OWN memberships of other people's projects plus its OWN
// canvas grants. Everything is read for the caller's account id only: no row
// that names anybody else is ever loaded, so nothing about them can reach the
// answer. Names, never e-mails (L17): `ownerName` / `grantedBy` are
// `accounts.name` or null, and the only address in the body is the caller's.
//
// What a row means is decided by the SAME rule every other door uses
// (`decideClaim`): a project the caller cannot open — purged, paused for a
// non-owner, or simply not theirs — is absent, and absent reads the same
// whichever of those it is (no existence oracle). A link grant lives only as
// long as its link: off, expired, turned into a team link or missing, it is
// dropped here at once rather than at the next hourly sweep.
//
// Auth: the device's Bearer `mpt_…` (Home's own credential, as GET
// /api/projects), or the signed-in browser session when no Bearer is sent.
// A Bearer that is present but dead is signed out — it never falls through to
// a cookie on the same request. Roles go out as stored; there is no `roles`
// advertisement here (the Q13 flip, ROLES_V2_ADVERTISED, is the hub's).
//
// `account.plan` (S9.20b, decision v2-lead-plan-words-via-home-route): the
// desktop's Settings › Account says "Free trial · N days left" from here, so the
// app never computes trial days itself. It is S9.15's `trialView` cut down to the
// state, the days left and the plan name — no dates, no customer or
// subscription id, no price — and nothing on this path calls Stripe.

import { maxRole } from '../studio/access/roles.ts';
import { GRANT_ROLES } from '../studio/access/scope.ts';
import { decideClaim, validCanvasPath } from './access-forward.mjs';
import { trialView } from './billing.mjs';
import { personalTokenAccount } from './device-auth.mjs';
import { pendingInvitesFor } from './invites.mjs';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

const signedOut = () => json({ reason: 'signed-out', error: 'Sign in from the app first.' }, 401);

/** The plan words' facts for one account — S9.15's trial view, nothing else (pure). */
export function accountPlan(account, { now = Date.now() } = {}) {
  const t = trialView(account, { now });
  return { state: t.state, daysLeft: t.daysLeft, name: 'Free trial' };
}

/** `ui/web/Mapa-arealu.tsx` → `Mapa-arealu`. The control plane holds no canvas meta. */
export function canvasName(path) {
  const base = String(path).split('/').pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || base;
}

/** A link-sourced row stands only while its link is on, unexpired and still `anyone`. */
function linkAlive(row, now) {
  if (!String(row.source ?? '').startsWith('link:')) return true;
  return (
    row.link_id != null &&
    row.link_revoked_at == null &&
    row.link_who === 'anyone' &&
    (row.link_expires_at == null || row.link_expires_at > now)
  );
}

const LINK_JOIN = (alias) =>
  `LEFT JOIN share_links l ON l.project_id = ${alias}.project_id AND ${alias}.source = 'link:' || l.id`;
const LINK_COLS =
  'l.id AS link_id, l.revoked_at AS link_revoked_at, l.expires_at AS link_expires_at, l.who AS link_who';
const PROJECT_COLS = `p.id AS p_id, p.account_id AS p_owner, p.name AS p_name, p.state AS p_state,
  p.state_since AS p_state_since, p.last_checkpoint AS p_last_checkpoint, o.name AS owner_name`;

/** Every row about the caller, and only the caller. */
async function readRows(db, accountId) {
  const owned = await db
    .prepare(
      `SELECT p.id AS p_id, p.account_id AS p_owner, p.name AS p_name, p.state AS p_state,
              p.state_since AS p_state_since, p.last_checkpoint AS p_last_checkpoint, NULL AS owner_name
         FROM projects p WHERE p.account_id = ?`
    )
    .bind(accountId)
    .all();

  let memberships;
  try {
    memberships = await db
      .prepare(
        `SELECT m.role, m.added_at, m.source, ${LINK_COLS}, ${PROJECT_COLS}
           FROM project_members m
           JOIN projects p ON p.id = m.project_id
           LEFT JOIN accounts o ON o.id = p.account_id
           ${LINK_JOIN('m')}
          WHERE m.account_id = ?`
      )
      .bind(accountId)
      .all();
  } catch {
    // A pre-v17 D1 (no `source`, no `share_links`): every membership is direct.
    memberships = await db
      .prepare(
        `SELECT m.role, m.added_at, NULL AS source, ${PROJECT_COLS}
           FROM project_members m
           JOIN projects p ON p.id = m.project_id
           LEFT JOIN accounts o ON o.id = p.account_id
          WHERE m.account_id = ?`
      )
      .bind(accountId)
      .all();
  }

  let grants = { results: [] };
  try {
    grants = await db
      .prepare(
        `SELECT g.canvas_path, g.role, g.source, g.granted_at, gb.name AS granted_by_name,
                ${LINK_COLS}, ${PROJECT_COLS}
           FROM canvas_grants g
           JOIN projects p ON p.id = g.project_id
           LEFT JOIN accounts o ON o.id = p.account_id
           LEFT JOIN accounts gb ON gb.id = g.granted_by
           ${LINK_JOIN('g')}
          WHERE g.account_id = ?`
      )
      .bind(accountId)
      .all();
  } catch {
    /* pre-v17 D1: no grants table yet — nobody holds a grant */
  }
  return {
    owned: owned?.results ?? [],
    memberships: memberships?.results ?? [],
    grants: grants?.results ?? [],
  };
}

/** The caller's own `trial_started_at` (null on a pre-v19 D1, which has no trial yet). */
async function trialStartedAt(db, caller) {
  if (caller.trial_started_at !== undefined) return caller.trial_started_at ?? null;
  try {
    const row = await db
      .prepare('SELECT trial_started_at FROM accounts WHERE id = ?')
      .bind(caller.id)
      .first();
    return row?.trial_started_at ?? null;
  } catch {
    return null;
  }
}

/**
 * The Home answer for one account (pure over the rows `readRows` returns).
 * Exported for the test; the route is `handleHomeApi`.
 */
export function homeFor({ account, owned, memberships, grants, cellZone, now = Date.now() }) {
  const byProject = new Map();
  const slot = (row) => {
    let s = byProject.get(row.p_id);
    if (!s) {
      s = {
        project: {
          id: row.p_id,
          account_id: row.p_owner,
          name: row.p_name,
          state: row.p_state,
          state_since: row.p_state_since,
          last_checkpoint: row.p_last_checkpoint,
          ownerName: row.p_owner === account.id ? null : (row.owner_name ?? null),
        },
        members: [],
        grants: [],
        memberRow: null,
      };
      byProject.set(row.p_id, s);
    }
    return s;
  };
  for (const row of owned) slot(row);
  for (const row of memberships) {
    if (!linkAlive(row, now)) continue;
    const s = slot(row);
    s.members.push({ account_id: account.id, role: row.role });
    s.memberRow = row;
  }
  for (const row of grants) {
    if (!linkAlive(row, now)) continue;
    const s = slot(row);
    s.grants.push({ ...row, account_id: account.id });
  }

  const projects = [];
  const shared = [];
  for (const s of byProject.values()) {
    const verdict = decideClaim({
      accountId: account.id,
      project: s.project,
      members: s.members,
      grants: s.grants,
    });
    if (!verdict.ok) continue; // purged, paused, or not theirs: all read as absent
    const p = s.project;
    if (verdict.role !== null) {
      projects.push({
        id: p.id,
        name: p.name,
        role: verdict.role,
        ownerName: p.ownerName,
        state: p.state,
        url: `https://${p.id}.${cellZone}`,
        updatedAt: p.last_checkpoint ?? p.state_since ?? null,
      });
    }
    if (verdict.role === 'owner') continue; // nothing of your own is "shared with you"
    const base = { projectId: p.id, projectName: p.name, ownerName: p.ownerName };
    if (verdict.role !== null && s.memberRow) {
      shared.push({
        ...base,
        canvas: null,
        role: verdict.role,
        grantedAt: s.memberRow.added_at ?? null,
        grantedBy: null,
      });
    }
    for (const g of s.grants) {
      // Only what the claim would honour: a grant role on a canvas path.
      if (!GRANT_ROLES.includes(g.role) || !validCanvasPath(g.canvas_path)) continue;
      shared.push({
        ...base,
        canvas: { path: g.canvas_path, name: canvasName(g.canvas_path) },
        role: maxRole(verdict.role, g.role),
        grantedAt: g.granted_at ?? null,
        grantedBy: g.granted_by_name ?? null,
      });
    }
  }

  projects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
  shared.sort(
    (a, b) =>
      (b.grantedAt ?? 0) - (a.grantedAt ?? 0) ||
      (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0) ||
      (a.canvas?.path ?? '').localeCompare(b.canvas?.path ?? '')
  );
  return {
    account: { email: account.email, plan: accountPlan(account, { now }) },
    projects,
    shared,
  };
}

/** Route GET /api/home. Returns a Response, or null when the path is not ours. */
export async function handleHomeApi(request, env, { account = null, now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/home') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const hasBearer = /^Bearer\s+/i.test(request.headers.get('authorization') ?? '');
  const caller = hasBearer ? await personalTokenAccount(env, request, { now }) : account;
  if (!caller?.id || !caller.email) return signedOut();

  const rows = await readRows(env.DB, caller.id);
  // `invited` (gate-b-sec3, additive): invitations addressed to this account that wait for its accept — a v1 Home
  // ignores the key. No invite id, no e-mail but the caller's own.
  const invited = await pendingInvitesFor(env, caller, { now });
  return json({
    ...homeFor({
      // The session's account row carries no trial column; read it for the caller, so the
      // device token and the browser session answer the same plan.
      account: { ...caller, trial_started_at: await trialStartedAt(env.DB, caller) },
      ...rows,
      cellZone: env.CELL_ZONE ?? 'cloud.maude.sh',
      now,
    }),
    invited,
  });
}
