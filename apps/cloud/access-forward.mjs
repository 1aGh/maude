// The control plane's access authority — Maude v2 S9.8 (V2-1.7 §5.6, §5.8).
//
// A cloud cell does not decide who may do what to a project (DDR-204). It
// FORWARDS: `/api/access/*` on the cell becomes `/internal/projects/:p/access/*`
// here, carrying the cell's derived secret and the email of the person its
// verified session belongs to (the vouched actor). Everything after that is
// decided from D1 — the actor's role is RE-DECIDED from the rows, never taken
// from the forwarded body, so a cell that lies about a role gains nothing.
//
// Two halves:
//   - primitives other modules share (the claim an account holds, grant
//     writes, ending access) — handoff.mjs, links.mjs and worker.mjs use them;
//   - the forwarded routes themselves, every change audited, invitations
//     capped per project per day.

import { CAPABILITIES, rankOf } from '../studio/access/roles.ts';
import { GRANT_ROLES, MAX_GRANTS, resolveAccess } from '../studio/access/scope.ts';
import { getAccountByEmail, normalizeEmail } from './accounts.mjs';
import { deriveCellSecret, secretsMatch } from './cell-token.mjs';
import { audit } from './db.mjs';
import { emailConfigured, inviteEmail, sendEmail } from './email.mjs';
import { createLink, endLinkGrants, LINK_ROLES, patchLink } from './links.mjs';
import { decideMembershipChange } from './membership.mjs';
import { decideAccess } from './project-access.mjs';

/** Invitations (new + resent) a project may send per rolling day (V2-1.7 §5.6). */
export const INVITE_CAP_PER_DAY = 50;
/** Same lifetime as every invitation the people page sends (and its e-mail promises). */
export const INVITE_TTL_MS = 14 * 86_400_000;
/** A comment thread id an invitation may point at (S6↔S9 §5.3). */
export const INVITE_THREAD = /^[A-Za-z0-9_-]{1,64}$/;

const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const refuse = (status, reason, error) => json({ error, reason }, status);
const NOT_ALLOWED = 'Ask the owner to change this.';

/**
 * A canvas path as the access claim keys it: designRoot-relative, forward
 * slashes, no `..`, no absolute path. Anything else is not a canvas.
 */
export function validCanvasPath(c) {
  if (typeof c !== 'string' || c.length === 0 || c.length > 512) return false;
  if (c.startsWith('/') || c.includes('\\') || c.includes('\0')) return false;
  return c.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

const byCanvas = (a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0);

// ------------------------------------------------------------- the claim

/**
 * The access claim an account holds on a project, from facts (pure).
 *
 * A project role comes from `decideAccess` (owner column, member rows). Canvas
 * grants ADD (G1): only a grant above the project role is carried, so an
 * owner / member / viewer whose grants change nothing keeps a v1-expressible
 * claim — and a byte-identical v1 token. No membership but a grant is a
 * canvas-only claim (`role: null`); a paused project admits nobody that way.
 */
export function decideClaim({ accountId, project, members = [], grants = [] }) {
  const base = decideAccess({ accountId, project, members });
  const mine = grants
    .filter((g) => g.account_id === accountId && GRANT_ROLES.includes(g.role))
    .map((g) => ({ c: g.canvas_path, r: g.role }))
    .filter((g) => validCanvasPath(g.c));
  if (base.ok) {
    const raised = mine.filter((g) => rankOf(g.r) > rankOf(base.role)).sort(byCanvas);
    return { ok: true, role: base.role, grants: raised.slice(0, MAX_GRANTS) };
  }
  if (base.reason !== 'no-access' || mine.length === 0) return base;
  if (project?.state === 'suspended') return { ok: false, reason: 'suspended' };
  return { ok: true, role: null, grants: mine.sort(byCanvas).slice(0, MAX_GRANTS) };
}

/** Read the facts for one project. An unreadable row is no access, never an error. */
export async function projectFacts(db, projectId) {
  try {
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first();
    const m = await db
      .prepare(
        // No `m.source`: this read must also work on a v16 D1 (a deploy meets
        // its migration within the hour), and nothing here needs it.
        `SELECT m.account_id, m.role, a.email, a.name
           FROM project_members m JOIN accounts a ON a.id = m.account_id
          WHERE m.project_id = ? ORDER BY a.email`
      )
      .bind(projectId)
      .all();
    let grants = [];
    try {
      const g = await db
        .prepare(
          `SELECT g.account_id, g.canvas_path, g.role, g.source, a.email, a.name
             FROM canvas_grants g JOIN accounts a ON a.id = g.account_id
            WHERE g.project_id = ? ORDER BY a.email, g.canvas_path`
        )
        .bind(projectId)
        .all();
      grants = g?.results ?? [];
    } catch {
      /* pre-v17 D1: no grants table yet — nobody holds a grant */
    }
    return { project, members: m?.results ?? [], grants };
  } catch {
    return { project: null, members: [], grants: [] };
  }
}

/** `{ project, verdict }` — the claim one account holds, re-decided from D1. */
export async function loadClaim(db, projectId, accountId) {
  const facts = await projectFacts(db, projectId);
  return { ...facts, verdict: decideClaim({ accountId, ...facts }) };
}

/** The claim as the matrix sees it. */
export const accessOf = (verdict) =>
  resolveAccess(verdict?.ok ? { v: 1, role: verdict.role, grants: verdict.grants } : null);

/**
 * Does this project's cell understand v2 credentials? Only a cell whose
 * public `/health` lists `roles-v2` gets an `m2.` token or an observer /
 * canvas grant (V2-1.7 §5.8 step 4). Unreachable or silent → no.
 */
export async function cellSupportsRolesV2(env, projectId, { timeoutMs = 5_000 } = {}) {
  try {
    const res = await fetch(`https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/health`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body?.capabilities) && body.capabilities.includes('roles-v2');
  } catch {
    return false;
  }
}

/** Refusal for a v2 claim on a cell that cannot hold it (V2-1.7 §5.8 step 4). */
export const SERVER_UPDATE = Object.freeze({
  error: 'This project’s server needs an update.',
  reason: 'server-update',
});

// ------------------------------------------------------------ the changes

/**
 * Tell the cell somebody's access changed, now (V2-1.7 §5.6): it sends that
 * person's connections `maude.access` and, for a narrowing, kicks after its
 * grace. Best-effort — the revocation row is the backstop the sweep reads.
 */
export async function notifyAccessChanged(env, projectId, body, { ctx = null } = {}) {
  if (!env.CELL_SECRET_MASTER) return { ok: false, reason: 'no cell secret' };
  const run = (async () => {
    try {
      const secret = await deriveCellSecret(env.CELL_SECRET_MASTER, projectId);
      const res = await fetch(
        `https://${projectId}.${env.CELL_ZONE ?? 'cloud.maude.sh'}/internal/access-changed`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        }
      );
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, reason: String(err?.message ?? err) };
    }
  })();
  if (ctx?.waitUntil) {
    ctx.waitUntil(run);
    return { ok: true, deferred: true };
  }
  return run;
}

/**
 * Somebody's access went DOWN (narrowed or ended). Their live sessions must
 * not keep the old reach: a revocation row (the 10-minute sweep's input) and
 * an immediate notice. A failed write never fails the change itself.
 */
export async function accessWentDown(env, projectId, email, { reason, now = Date.now(), ctx }) {
  if (!email) return;
  try {
    await env.DB.prepare(
      'INSERT INTO member_revocations (project_id, email, revoked_at) VALUES (?, ?, ?)'
    )
      .bind(projectId, email, now)
      .run();
  } catch {
    /* bounded by the token TTL either way */
  }
  const { verdict } = await loadClaim(
    env.DB,
    projectId,
    (await getAccountByEmail(env.DB, email))?.id
  );
  await notifyAccessChanged(
    env,
    projectId,
    { email, change: verdict.ok ? 'narrowed' : 'ended', ...(reason ? { reason } : {}) },
    { ctx }
  );
}

/**
 * Write one canvas grant. `mode: 'raise'` never lowers an existing grant (an
 * invite, a link, an approved request); `mode: 'set'` is the owner choosing
 * the role outright. Returns the role before and after, or a refusal.
 */
export async function writeGrant(
  db,
  { projectId, accountId, canvas, role, source, grantedBy = null, mode = 'raise', now = Date.now() }
) {
  const prev = await db
    .prepare(
      'SELECT role, source FROM canvas_grants WHERE project_id = ? AND account_id = ? AND canvas_path = ?'
    )
    .bind(projectId, accountId, canvas)
    .first();
  if (!prev) {
    const n = await db
      .prepare('SELECT COUNT(*) AS n FROM canvas_grants WHERE project_id = ? AND account_id = ?')
      .bind(projectId, accountId)
      .first();
    if ((n?.n ?? 0) >= MAX_GRANTS) return { ok: false, reason: 'too-many-canvases' };
  }
  if (prev && mode === 'raise' && rankOf(prev.role) >= rankOf(role)) {
    return { ok: true, before: prev.role, after: prev.role, changed: false };
  }
  await db
    .prepare(
      `INSERT INTO canvas_grants (project_id, account_id, canvas_path, role, source, granted_by, granted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (project_id, account_id, canvas_path)
       DO UPDATE SET role = excluded.role, source = excluded.source,
                     granted_by = excluded.granted_by, granted_at = excluded.granted_at`
    )
    .bind(projectId, accountId, canvas, role, source, grantedBy, now)
    .run();
  return { ok: true, before: prev?.role ?? null, after: role, changed: prev?.role !== role };
}

/**
 * Raise a PROJECT membership (an approved request, a project-scope link):
 * never lowers, never touches the owner. Returns whether anything changed.
 */
export async function raiseMembership(db, { project, accountId, role, source, now = Date.now() }) {
  if (project.account_id === accountId) return { changed: false };
  const prev = await db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND account_id = ?')
    .bind(project.id, accountId)
    .first();
  if (prev && rankOf(prev.role) >= rankOf(role)) return { changed: false };
  await db
    .prepare(
      `INSERT INTO project_members (project_id, account_id, role, added_at, source) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role, source = excluded.source`
    )
    .bind(project.id, accountId, role, now, source)
    .run();
  return { changed: true };
}

// --------------------------------------------------------- the forwarder

/** Who the forwarded call is FROM: the cell's derived secret, for this project only. */
async function cellAuthorized(request, env, projectId) {
  if (!env.CELL_SECRET_MASTER) return false;
  const offered = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const expected = await deriveCellSecret(env.CELL_SECRET_MASTER, projectId);
  return secretsMatch(offered, expected);
}

async function readBody(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  } catch {
    return {};
  }
}

const capsAt = (access, canvas) =>
  Object.fromEntries(CAPABILITIES.map((c) => [c, access.can(c, canvas)]));

/** Invitations sent from this project in the last day (the cap's count). */
async function invitesToday(db, projectId, now) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM audit_log
        WHERE project_id = ? AND action IN ('access.invite', 'access.invite-resend') AND at > ?`
    )
    .bind(projectId, now - 86_400_000)
    .first();
  return row?.n ?? 0;
}

async function mailInvite(env, { project, email, role, inviteUrl, invitedBy }) {
  if (!emailConfigured(env)) return { ok: false };
  try {
    return await sendEmail(env, {
      to: email,
      ...inviteEmail({ projectName: project.name || project.id, role, inviteUrl, invitedBy }),
    });
  } catch {
    return { ok: false };
  }
}

/**
 * Route `/internal/projects/:p/access/*`. Returns a Response, or null when the
 * path is not ours.
 */
export async function handleAccessForward(request, env, { ctx = null, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const m = /^\/internal\/projects\/([^/]+)\/access\/(.+)$/.exec(url.pathname);
  if (!m) return null;
  const projectId = m[1];
  if (!PROJECT_ID.test(projectId) || !(await cellAuthorized(request, env, projectId))) {
    return json({ error: 'unauthorized' }, 401);
  }
  const db = env.DB;

  // The vouched actor: an email the cell took from a VERIFIED session. Its
  // role is decided below from D1 and nowhere else.
  const actorEmail = normalizeEmail(request.headers.get('x-maude-actor') ?? '');
  const actor = actorEmail ? await getAccountByEmail(db, actorEmail) : null;
  const facts = await projectFacts(db, projectId);
  if (!facts.project) return refuse(404, 'no-access', 'This project is not available.');
  const verdict = decideClaim({ accountId: actor?.id ?? null, ...facts });
  const access = accessOf(verdict);
  const project = facts.project;
  let rest;
  try {
    rest = m[2].split('/').map(decodeURIComponent);
  } catch {
    return refuse(400, 'path', 'That is not an access route.');
  }
  const method = request.method;
  const isOwner = access.can('invite', null);
  const record = (action, detail) =>
    audit(db, {
      accountId: actor?.id ?? null,
      projectId,
      actor: `customer:${actorEmail}`,
      action,
      detail: JSON.stringify(detail),
    });

  // ---- GET me — the client's caps come from here, never from a guess
  if (method === 'GET' && rest.length === 1 && rest[0] === 'me') {
    const canvasCaps = Object.fromEntries(access.grants.map((g) => [g.c, capsAt(access, g.c)]));
    return json({
      role: access.role,
      grants: access.grants.map((g) => ({ c: g.c, r: g.r })),
      caps: capsAt(access, null),
      ...(access.grants.length ? { canvasCaps } : {}),
    });
  }

  if (!verdict.ok) return refuse(403, 'no-access', NOT_ALLOWED);

  // ---- GET people?canvas=c
  if (method === 'GET' && rest.length === 1 && rest[0] === 'people') {
    const canvas = url.searchParams.get('canvas');
    if (canvas !== null && !validCanvasPath(canvas)) return refuse(422, 'canvas', 'Not a canvas.');
    if (!access.can('read', canvas)) return refuse(403, 'not-in-scope', NOT_ALLOWED);
    return json({ people: await peopleFor(db, facts, { canvas, isOwner, now }) });
  }

  // ---- POST requests (Ask to edit) — any role WITHOUT edit on the scope
  if (method === 'POST' && rest.length === 1 && rest[0] === 'requests') {
    const body = await readBody(request);
    const canvas = body.canvas ?? null;
    if (canvas !== null && !validCanvasPath(canvas)) return refuse(422, 'canvas', 'Not a canvas.');
    if (!access.can('read', canvas)) return refuse(403, 'not-in-scope', NOT_ALLOWED);
    if (access.can('edit', canvas)) {
      return refuse(409, 'already-can-edit', 'You can already edit this.');
    }
    if (!access.can('request', canvas)) return refuse(403, 'not-allowed', NOT_ALLOWED);
    const id = `req_${crypto.randomUUID()}`;
    try {
      await db
        .prepare(
          'INSERT INTO access_requests (id, project_id, account_id, canvas_path, created_at) VALUES (?, ?, ?, ?, ?)'
        )
        .bind(id, projectId, actor.id, canvas, now)
        .run();
    } catch {
      return refuse(409, 'pending', 'You already asked. The owner has your request.');
    }
    await record('access.request', { id, canvas });
    return json({ id }, 201);
  }

  // Everything below changes who has access: the owner's call, project-level.
  if (!isOwner) return refuse(403, 'not-allowed', NOT_ALLOWED);

  // ---- GET requests
  if (method === 'GET' && rest.length === 1 && rest[0] === 'requests') {
    const { results } = await db
      .prepare(
        `SELECT r.id, r.canvas_path, r.created_at, a.email, a.name
           FROM access_requests r JOIN accounts a ON a.id = r.account_id
          WHERE r.project_id = ? AND r.decided_at IS NULL ORDER BY r.created_at`
      )
      .bind(projectId)
      .all();
    return json({
      requests: (results ?? []).map((r) => ({
        id: r.id,
        from: { name: r.name || r.email, email: r.email },
        ...(r.canvas_path ? { canvas: r.canvas_path } : {}),
        at: r.created_at,
      })),
    });
  }

  // ---- POST requests/:id/approve | decline
  if (method === 'POST' && rest.length === 3 && rest[0] === 'requests') {
    const [, id, verb] = rest;
    if (verb !== 'approve' && verb !== 'decline') return null;
    const req = await db
      .prepare(
        `SELECT r.*, a.email FROM access_requests r JOIN accounts a ON a.id = r.account_id
          WHERE r.id = ? AND r.project_id = ? AND r.decided_at IS NULL`
      )
      .bind(id, projectId)
      .first();
    if (!req) return refuse(404, 'gone', 'That request is no longer open.');
    let raised = false;
    if (verb === 'approve') {
      // A `member` grant at the request's scope (G1: never lowers).
      if (req.canvas_path) {
        const w = await writeGrant(db, {
          projectId,
          accountId: req.account_id,
          canvas: req.canvas_path,
          role: 'member',
          source: `request:${id}`,
          grantedBy: actor.id,
          now,
        });
        if (!w.ok)
          return refuse(422, w.reason, 'That person already has the most canvases allowed.');
        raised = w.changed;
      } else {
        raised = (
          await raiseMembership(db, {
            project,
            accountId: req.account_id,
            role: 'member',
            source: `request:${id}`,
            now,
          })
        ).changed;
      }
    }
    await db
      .prepare(
        'UPDATE access_requests SET decided_at = ?, decision = ?, decided_by = ? WHERE id = ? AND decided_at IS NULL'
      )
      .bind(now, verb === 'approve' ? 'approved' : 'declined', actor.id, id)
      .run();
    await record(`access.request-${verb}`, { id, canvas: req.canvas_path ?? null });
    if (raised)
      await notifyAccessChanged(env, projectId, { email: req.email, change: 'raised' }, { ctx });
    return json({ ok: true });
  }

  // ---- POST invites
  if (method === 'POST' && rest.length === 1 && rest[0] === 'invites') {
    const body = await readBody(request);
    const email = normalizeEmail(String(body.email ?? ''));
    const role = String(body.role ?? '');
    const canvas = body.canvas ?? null;
    if (!email || !email.includes('@') || email.length > 254) {
      return refuse(422, 'email', 'That does not look like an email address.');
    }
    if (!GRANT_ROLES.includes(role)) return refuse(422, 'unknown-role', 'That is not a role.');
    if (canvas !== null && !validCanvasPath(canvas)) return refuse(422, 'canvas', 'Not a canvas.');
    // The comment the invitation points at (S6↔S9 §5.3): a thread id on THIS
    // invitation's canvas, so never without one.
    const thread = body.thread ?? null;
    if (thread !== null && (canvas === null || !INVITE_THREAD.test(String(thread)))) {
      return refuse(422, 'bad-thread', 'That comment cannot be linked to this invitation.');
    }
    if ((await invitesToday(db, projectId, now)) >= INVITE_CAP_PER_DAY) {
      return refuse(
        429,
        'invite-cap',
        'That is a lot of invitations for one day. Try again tomorrow.'
      );
    }
    const existing = await getAccountByEmail(db, email);
    if (existing) {
      // Somebody with an account is ADDED, as the people page does — but an
      // invitation never lowers what they already have (G1).
      let raised = false;
      if (canvas) {
        const w = await writeGrant(db, {
          projectId,
          accountId: existing.id,
          canvas,
          role,
          source: 'invite',
          grantedBy: actor.id,
          now,
        });
        if (!w.ok)
          return refuse(422, w.reason, 'That person already has the most canvases allowed.');
        raised = w.changed;
      } else {
        raised = (
          await raiseMembership(db, { project, accountId: existing.id, role, source: null, now })
        ).changed;
      }
      await record('access.invite', { canvas, role, existing: true });
      if (raised) await notifyAccessChanged(env, projectId, { email, change: 'raised' }, { ctx });
      return json({ id: null, added: true });
    }
    const id = crypto.randomUUID();
    const expiresAt = now + INVITE_TTL_MS;
    try {
      // v18: who invited (an account id — the invite page shows a NAME, never
      // this person's e-mail) and the comment it points at.
      await db
        .prepare(
          `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path, invited_by, thread)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, projectId, email, role, now, expiresAt, canvas, actor.id, thread)
        .run();
    } catch {
      // The hour a deploy can meet a v17 D1 (the cron migrates): the
      // invitation still works; only the inviter's name and the comment wait.
      await db
        .prepare(
          `INSERT INTO project_invites (id, project_id, email, role, created_at, expires_at, canvas_path)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(id, projectId, email, role, now, expiresAt, canvas)
        .run();
    }
    await record('access.invite', { id, canvas, role });
    const inviteUrl = `${url.origin}/invite/${id}`;
    const sent = await mailInvite(env, { project, email, role, inviteUrl, invitedBy: actorEmail });
    // A failed send still made a real invitation; the OWNER gets the link to
    // pass on (the people page's rule) — it is theirs to share either way.
    return json({ id, expiresAt, sent: !!sent.ok, ...(sent.ok ? {} : { url: inviteUrl }) }, 201);
  }

  // ---- POST invites/:id/resend · DELETE invites/:id
  if (rest[0] === 'invites' && rest.length >= 2) {
    const id = rest[1];
    const inv = await db
      .prepare(
        'SELECT * FROM project_invites WHERE id = ? AND project_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL'
      )
      .bind(id, projectId)
      .first();
    if (method === 'POST' && rest.length === 3 && rest[2] === 'resend') {
      if (!inv) return refuse(404, 'gone', 'That invitation is no longer open.');
      if ((await invitesToday(db, projectId, now)) >= INVITE_CAP_PER_DAY) {
        return refuse(
          429,
          'invite-cap',
          'That is a lot of invitations for one day. Try again tomorrow.'
        );
      }
      const expiresAt = now + INVITE_TTL_MS;
      await db
        .prepare('UPDATE project_invites SET expires_at = ? WHERE id = ?')
        .bind(expiresAt, id)
        .run();
      await record('access.invite-resend', { id });
      await mailInvite(env, {
        project,
        email: inv.email,
        role: inv.role,
        inviteUrl: `${url.origin}/invite/${id}`,
        invitedBy: actorEmail,
      });
      return json({ expiresAt });
    }
    if (method === 'DELETE' && rest.length === 2) {
      if (!inv) return refuse(404, 'gone', 'That invitation is no longer open.');
      await db
        .prepare('UPDATE project_invites SET revoked_at = ? WHERE id = ?')
        .bind(now, id)
        .run();
      await record('access.invite-cancel', { id });
      return json(null, 204);
    }
    return null;
  }

  // ---- PATCH people/:id · DELETE people/:id?canvas=c
  if (rest[0] === 'people' && rest.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
    const target = await db
      .prepare('SELECT id, email FROM accounts WHERE id = ?')
      .bind(rest[1])
      .first();
    if (!target) return refuse(404, 'not-a-member', 'That person is not on this project.');
    const body = method === 'PATCH' ? await readBody(request) : {};
    const canvas = method === 'PATCH' ? (body.canvas ?? null) : url.searchParams.get('canvas');
    if (canvas !== null && !validCanvasPath(canvas)) return refuse(422, 'canvas', 'Not a canvas.');
    const before = accessOf(decideClaim({ accountId: target.id, ...facts }));

    if (canvas !== null) {
      if (method === 'PATCH') {
        const role = String(body.role ?? '');
        if (!GRANT_ROLES.includes(role)) return refuse(422, 'unknown-role', 'That is not a role.');
        const w = await writeGrant(db, {
          projectId,
          accountId: target.id,
          canvas,
          role,
          source: 'invite',
          grantedBy: actor.id,
          mode: 'set',
          now,
        });
        if (!w.ok)
          return refuse(422, w.reason, 'That person already has the most canvases allowed.');
      } else {
        const del = await db
          .prepare(
            'DELETE FROM canvas_grants WHERE project_id = ? AND account_id = ? AND canvas_path = ?'
          )
          .bind(projectId, target.id, canvas)
          .run();
        if (!del?.meta?.changes)
          return refuse(404, 'not-a-member', 'That person is not on this canvas.');
      }
    } else {
      const member = facts.members.find((x) => x.account_id === target.id);
      const decision = decideMembershipChange({
        actorRole: access.role,
        targetAccountId: target.id,
        targetRole: member?.role ?? null,
        newRole: method === 'DELETE' ? null : String(body.role ?? ''),
        ownerId: project.account_id,
      });
      if (!decision.ok) return refuse(422, decision.reason, decision.message);
      if (decision.action === 'remove') {
        await db
          .prepare('DELETE FROM project_members WHERE project_id = ? AND account_id = ?')
          .bind(projectId, target.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO project_members (project_id, account_id, role, added_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (project_id, account_id) DO UPDATE SET role = excluded.role, source = NULL`
          )
          .bind(projectId, target.id, String(body.role), now)
          .run();
      }
    }
    // Did their reach go down anywhere? A demotion, a narrowed grant, a
    // removal — each revokes the live sessions the old claim opened.
    const after = accessOf(await loadClaim(db, projectId, target.id).then((x) => x.verdict));
    const down = wentDown(before, after);
    const up = wentUp(before, after);
    await record(method === 'DELETE' ? 'access.remove' : 'access.role', {
      target: target.id,
      canvas,
      role: body.role ?? null,
    });
    if (down) await accessWentDown(env, projectId, target.email, { reason: 'removed', now, ctx });
    else if (up)
      await notifyAccessChanged(env, projectId, { email: target.email, change: 'raised' }, { ctx });
    return json(method === 'DELETE' ? null : { ok: true }, method === 'DELETE' ? 204 : 200);
  }

  // ---- POST links · PATCH links/:id
  if (method === 'POST' && rest.length === 1 && rest[0] === 'links') {
    const body = await readBody(request);
    const canvas = body.canvas ?? null;
    if (canvas !== null && !validCanvasPath(canvas)) return refuse(422, 'canvas', 'Not a canvas.');
    if (!LINK_ROLES.includes(body.role)) {
      return refuse(422, 'link-role', 'A link can give Can view or Can comment, never more.');
    }
    if (body.who !== 'team' && body.who !== 'anyone')
      return refuse(422, 'who', 'Who is this link for?');
    const expiresAt = body.expiresAt == null ? null : Date.parse(String(body.expiresAt));
    if (expiresAt !== null && !(expiresAt > now))
      return refuse(422, 'expires', 'Pick a date in the future.');
    const link = await createLink(db, {
      projectId,
      canvas,
      role: body.role,
      who: body.who,
      expiresAt,
      createdBy: actor.id,
      now,
    });
    await record('access.link-create', { id: link.id, canvas, role: body.role, who: body.who });
    return json({ id: link.id, url: link.url(url.origin) }, 201);
  }
  if (method === 'PATCH' && rest.length === 2 && rest[0] === 'links') {
    const body = await readBody(request);
    if (body.role !== undefined && !LINK_ROLES.includes(body.role)) {
      return refuse(422, 'link-role', 'A link can give Can view or Can comment, never more.');
    }
    if (body.who !== undefined && body.who !== 'team' && body.who !== 'anyone') {
      return refuse(422, 'who', 'Who is this link for?');
    }
    let expiresAt;
    if (body.expiresAt !== undefined) {
      expiresAt = body.expiresAt === null ? null : Date.parse(String(body.expiresAt));
      if (expiresAt !== null && !(expiresAt > now))
        return refuse(422, 'expires', 'Pick a date in the future.');
    }
    const out = await patchLink(env, {
      projectId,
      id: rest[1],
      role: body.role,
      who: body.who,
      expiresAt,
      off: body.off === true,
      now,
      ctx,
    });
    if (!out.ok) return refuse(404, 'gone', 'That link is no longer on.');
    await record(body.off === true ? 'access.link-off' : 'access.link-change', {
      id: rest[1],
      role: body.role ?? null,
      who: body.who ?? null,
    });
    return json({ id: rest[1], ...(out.url ? { url: out.url(url.origin) } : {}) });
  }

  return null;
}

/** Did any canvas (or the project) lose a capability between two claims? */
function wentDown(before, after) {
  const scopes = [null, ...new Set([...before.grants, ...after.grants].map((g) => g.c))];
  return scopes.some((c) => rankOf(after.roleFor(c)) < rankOf(before.roleFor(c)));
}

function wentUp(before, after) {
  const scopes = [null, ...new Set([...before.grants, ...after.grants].map((g) => g.c))];
  return scopes.some((c) => rankOf(after.roleFor(c)) > rankOf(before.roleFor(c)));
}

/**
 * People with access to `canvas` (or to the project). E-mails, pending
 * invitations and requests go to the owner only (V2-1.16 L17).
 */
async function peopleFor(db, facts, { canvas, isOwner, now }) {
  const { project, members, grants } = facts;
  const owner = await db
    .prepare('SELECT id, email, name FROM accounts WHERE id = ?')
    .bind(project.account_id)
    .first();
  const rows = new Map();
  const put = (id, email, name, role) => {
    const prev = rows.get(id);
    if (prev && rankOf(prev.role) >= rankOf(role)) return;
    rows.set(id, { id, name: name || email.split('@')[0], role, ...(isOwner ? { email } : {}) });
  };
  if (owner) put(owner.id, owner.email, owner.name, 'owner');
  for (const m of members)
    if (m.account_id !== project.account_id) put(m.account_id, m.email, m.name, m.role);
  for (const g of grants) {
    if (canvas !== null && g.canvas_path === canvas) put(g.account_id, g.email, g.name, g.role);
  }
  const people = [...rows.values()];
  if (!isOwner) return people;
  const { results: invites } = await db
    .prepare(
      `SELECT id, email, role, canvas_path, expires_at FROM project_invites
        WHERE project_id = ? AND redeemed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at`
    )
    .bind(project.id, now)
    .all();
  for (const i of invites ?? []) {
    if (i.canvas_path && i.canvas_path !== canvas) continue;
    people.push({
      id: i.id,
      name: i.email,
      role: i.role,
      email: i.email,
      state: 'invited',
      expiresAt: i.expires_at,
    });
  }
  const { results: requests } = await db
    .prepare(
      `SELECT r.id, r.canvas_path, a.email, a.name FROM access_requests r
         JOIN accounts a ON a.id = r.account_id
        WHERE r.project_id = ? AND r.decided_at IS NULL ORDER BY r.created_at`
    )
    .bind(project.id)
    .all();
  for (const r of requests ?? []) {
    if ((r.canvas_path ?? null) !== canvas) continue;
    people.push({
      id: r.id,
      name: r.name || r.email,
      role: null,
      email: r.email,
      state: 'requested',
    });
  }
  return people;
}
