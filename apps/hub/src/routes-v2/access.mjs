// The access API — V2-1.7 §5.6 on the hub (S9.6).
//
// ONE JSON API, TWO AUTHORITIES. The client always calls its project server:
//
//   - SELF-HOSTED: this hub is the authority. People are `users.mjs` accounts
//     (admin → Owner, member → Can edit, a canvas-only member's claim in
//     `users.access`); invitations are `invites.mjs` rows (a canvas invite
//     carries its claim in `invites.access`); Ask to edit is the
//     `access_requests` table beside them. A self-hosted hub has no view-only
//     accounts, so no Can comment / Can view invites and no links.
//   - CLOUD (`MAUDE_CLOUD_IDENTITY`): this cell decides NOTHING. It forwards to
//     the control plane at `/internal/projects/:p/access/*` with its derived
//     secret and the e-mail of the VERIFIED session (`x-maude-actor`); the
//     control plane re-decides the actor's role from D1 (S9.8).
//
// Every route is a row in the hub's one table (`routes-v2/index.mjs`); the
// access gate (`access-gate.mjs`) has already applied the row's capability
// when a handler here runs. What a handler re-asks, it asks the one predicate
// module (`apps/studio/access/scope.ts`) — never a role string compared here.
//
// U1 (V2-1.16): a canvas the session cannot see answers exactly as a canvas
// that does not exist, and no error body ever echoes a path from the request.

import { timingSafeEqual } from 'node:crypto';

import { GRANT_ROLES, resolveAccess } from '../../../studio/access/scope.ts';
import { claimForMatch, NOT_IN_SCOPE_REFUSAL, presentedBearer } from '../access-gate.mjs';
import { cloudIdentityEnabled } from '../cloud-identity.mjs';
import { endedSessionReason, rememberEndedSessions } from '../ended-sessions.mjs';
import {
  canvasOfInvite,
  createAccessRequest,
  createInvite,
  decideAccessRequest,
  getInvite,
  getOpenAccessRequest,
  inviteUrl,
  listInvites,
  listOpenAccessRequests,
  reissueInvite,
  revokeInvite,
  revokeInvitesForEmail,
} from '../invites.mjs';
import { CAPABILITIES, projectRoleForAccount, ROLES } from '../role-matrix.mjs';
import { revokeTokensForOwner } from '../tokens.mjs';
import {
  assertValidEmail,
  getUser,
  getUserById,
  listUsers,
  removeUser,
  setUserAccess,
} from '../users.mjs';
import {
  ACCESS_CHANGES,
  ACCESS_REASONS,
  createAccessNotices,
  DEFAULT_GRACE_MS,
} from './notices.mjs';

/**
 * V2-1.7 §5.8 step 4 / S9-slices Q13 — `roles-v2` (Can view, This canvas,
 * links) is advertised by ONE lead step, after S9.5, S9.8 and S9.12 are green.
 * Until then a cloud cell reports the v1 roles and project scope, the control
 * plane mints it no `m2.` token, and this hub stores no canvas grant. THE FLIP
 * IS THIS LINE (a hub config `rolesV2` overrides it for tests).
 */
export const ROLES_V2_ADVERTISED = false;

export const ROLES_V2_CAPABILITY = 'roles-v2';

/** Invitations one project may send per rolling day (V2-1.7 §5.6, as the control plane). */
export const INVITE_CAP_PER_DAY = 50;

const NOT_ALLOWED = 'Ask the owner to change this.';
/** S9.21 — past `ACCESS_REQUEST_LIMIT` (invites.mjs); the control plane says the same. */
const ASKED_TOO_OFTEN = 'You asked several times today. Try again tomorrow.';
const BODY_LIMIT = 64 * 1024;
const PREFIX = '/api/access/';

/**
 * The `/health.access` posture (V2-1.7 §5.6) — what this project's server can
 * hold, which the Share sheet reads (scope segment, role list, link row,
 * request block). Roles are listed weakest first, as the matrix lists them.
 */
export function accessPosture({ env = process.env, rolesV2 = ROLES_V2_ADVERTISED } = {}) {
  if (cloudIdentityEnabled(env)) {
    return rolesV2
      ? {
          authority: 'control-plane',
          roles: [...ROLES],
          scopes: ['project', 'canvas'],
          links: true,
          requests: true,
        }
      : {
          authority: 'control-plane',
          roles: ROLES.filter((r) => r !== 'observer'),
          scopes: ['project'],
          links: false,
          requests: true,
        };
  }
  // Self-hosted: accounts are admin | member (§5.8) — no view-only accounts,
  // so no link either (co-share-advanced, column 3).
  return {
    authority: 'hub',
    roles: ['member', 'owner'],
    scopes: rolesV2 ? ['project', 'canvas'] : ['project'],
    links: false,
    requests: true,
  };
}

/** The `/health` capability list with `roles-v2` added once it is advertised. */
export function withRolesV2(capabilities, { rolesV2 = ROLES_V2_ADVERTISED } = {}) {
  return rolesV2 ? [...capabilities, ROLES_V2_CAPABILITY] : capabilities;
}

// ------------------------------------------------------------------ helpers

/** A canvas path as the claim keys it: designRoot-relative, no `..`, no absolute. */
export function validCanvasPath(c) {
  if (typeof c !== 'string' || c.length === 0 || c.length > 512) return false;
  if (c.startsWith('/') || c.includes('\\') || c.includes('\0')) return false;
  return c.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

const capsAt = (access, canvas) =>
  Object.fromEntries(CAPABILITIES.map((c) => [c, access.can(c, canvas)]));

const nameOf = (email) => String(email ?? '').split('@')[0];
/**
 * The control plane's `from.name` on a forwarded Ask to edit: a short, non-empty string, or null.
 * Control and format characters (bidi overrides, zero-width marks) are dropped and the rest is
 * NFC, so a name cannot reorder or hide what the owner reads next to it.
 */
const forwardedName = (from) => {
  const n =
    typeof from?.name === 'string'
      ? from.name
          .normalize('NFC')
          .replace(/[\p{Cc}\p{Cf}]/gu, '')
          .trim()
      : '';
  return n && n.length <= 80 ? n : null;
};

const refusal = (status, reason, error) => ({ status, body: { error, reason } });

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        finish(null);
        request.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (chunks.length === 0) return finish({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finish(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null);
      } catch {
        finish(null);
      }
    });
    request.on('error', () => finish(null));
  });
}

function secretMatches(request, secret) {
  if (!secret) return false;
  const offered = String(request?.headers?.authorization ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (offered.length === 0 || offered.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(offered), Buffer.from(secret));
  } catch {
    return false;
  }
}

function answer(ctx, { status, body }) {
  if (status === 204) {
    ctx.response.writeHead(204, { 'Cache-Control': 'no-store' });
    ctx.response.end();
    return true;
  }
  ctx.respondJson(status, body);
  return true;
}

// ------------------------------------------------------------ the service

/**
 * Everything the access rows need from the hub that runs them. `server.mjs`
 * builds ONE per hub and hands it to `runHubRoutes` as `deps.access`.
 *
 * @param {{
 *   dataDir: string, secret?: string, publicUrl?: string, env?: object,
 *   rolesV2?: boolean, graceMs?: number,
 *   connections: () => Iterable<object>,
 *   kickLabel: (label: string) => number,
 *   kickEmail?: (email: string) => number,
 *   sweepNow?: () => unknown,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 * }} opts
 */
export function createAccessService({
  dataDir,
  secret = '',
  publicUrl = '',
  env = process.env,
  rolesV2 = ROLES_V2_ADVERTISED,
  graceMs = DEFAULT_GRACE_MS,
  connections,
  kickLabel,
  // S9.12b (U6) — sockets keyed by person rather than token (the studio proxy's splices).
  kickEmail = () => 0,
  sweepNow = null,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const cloud = () => cloudIdentityEnabled(env);
  const posture = () => accessPosture({ env, rolesV2 });

  // A narrowing / an ending, after the grace: what the person's old claim
  // minted dies, and every socket it opened is closed. In a cloud cell the
  // revocation sweep runs FIRST, so the project token the old claim rode is
  // refused at the next `/auth/login` (on the control plane's clock).
  async function endSessions(email) {
    if (cloud() && sweepNow) {
      try {
        await sweepNow();
      } catch {
        /* the periodic sweep is the backstop */
      }
    }
    let n = 0;
    for (const label of revokeTokensForOwner(dataDir, email)) n += kickLabel(label);
    n += kickEmail(email);
    return n;
  }

  const notices = createAccessNotices({
    connections,
    endSessions: (email) => endSessions(email),
    // S9.21d — the ended person's cookies hear why at the studio door's 401.
    remember: (email, reason) => rememberEndedSessions(dataDir, email, reason, now()),
    graceMs,
    now,
  });

  return {
    dataDir,
    secret,
    publicUrl,
    env,
    cloud,
    posture,
    notices,
    fetchImpl,
    now,
    rolesV2Options: { rolesV2 },
  };
}

// --------------------------------------------------------- the forwarder

async function forward(ctx, svc, { rest, actor }) {
  const base = String(svc.env.MAUDE_CONTROL_PLANE_URL ?? '').replace(/\/+$/, '');
  const project = String(svc.env.MAUDE_TENANT_ID ?? '');
  if (!base || !project || !svc.secret) {
    return answer(
      ctx,
      refusal(503, 'control-plane', 'Sharing is not available right now. Try again in a minute.')
    );
  }
  const method = ctx.method;
  const search = ctx.request.url.includes('?')
    ? ctx.request.url.slice(ctx.request.url.indexOf('?'))
    : '';
  let body = null;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
    body = await readJson(ctx.request);
    if (body === null) return answer(ctx, refusal(400, 'body', 'That is not a JSON object.'));
  }
  let res;
  try {
    res = await svc.fetchImpl(`${base}/internal/projects/${project}/access/${rest}${search}`, {
      method,
      headers: {
        // Built here, never copied: the actor is the VERIFIED session's
        // e-mail, and nothing the client sent rides along.
        authorization: `Bearer ${svc.secret}`,
        'x-maude-actor': actor,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return answer(
      ctx,
      refusal(503, 'control-plane', 'Sharing is not available right now. Try again in a minute.')
    );
  }
  if (res.status === 204) return answer(ctx, { status: 204 });
  let payload;
  try {
    payload = await res.json();
  } catch {
    return answer(
      ctx,
      refusal(502, 'control-plane', 'Sharing is not available right now. Try again in a minute.')
    );
  }
  // Ask to edit reached the authority: the owners on THIS cell hear it now.
  if (method === 'POST' && rest === 'requests' && res.status === 201 && payload?.id) {
    svc.notices.accessRequested({
      id: String(payload.id),
      // the control plane's own name for the asker (what the owner's request list shows), else the
      // verified e-mail's local part — an older control plane answers `{ id }` only
      from: { name: forwardedName(payload.from) ?? nameOf(actor) },
      canvas: typeof body?.canvas === 'string' ? body.canvas : null,
      at: svc.now(),
    });
  }
  return answer(ctx, { status: res.status, body: payload });
}

// ------------------------------------------------- the self-hosted authority

function peopleFor(svc, access, canvas) {
  const isOwner = access.can('invite', null);
  const rows = [];
  for (const user of listUsers(svc.dataDir)) {
    if (user.disabled || !user.id) continue;
    let role;
    if (user.access) {
      // A canvas-only person is on this list only for a canvas they hold.
      if (canvas === null || !user.access.grants.some((g) => g.c === canvas)) continue;
      role = 'member';
    } else {
      role = projectRoleForAccount(user.role);
      if (!role) continue;
    }
    rows.push({
      id: user.id,
      name: nameOf(user.email),
      role,
      ...(isOwner ? { email: user.email } : {}),
    });
  }
  // E-mails, pending invitations and requests: `invite` holders only (L17).
  if (!isOwner) return rows;
  const at = svc.now();
  for (const inv of listInvites(svc.dataDir, { now: at })) {
    if (inv.status !== 'open') continue;
    const on = canvasOfInvite(inv);
    if (on !== null && on !== canvas) continue;
    rows.push({
      id: inv.id,
      name: inv.email ?? 'Invitation link',
      role: projectRoleForAccount(inv.role) ?? 'member',
      ...(inv.email ? { email: inv.email } : {}),
      state: 'invited',
      invitedAt: inv.createdAt,
      expiresAt: inv.expiresAt,
    });
  }
  for (const req of listOpenAccessRequests(svc.dataDir)) {
    if ((req.canvas ?? null) !== canvas) continue;
    rows.push({
      id: req.id,
      name: nameOf(req.email),
      role: null,
      email: req.email,
      state: 'requested',
    });
  }
  return rows;
}

function invitesToday(svc) {
  const since = svc.now() - 86_400_000;
  return listInvites(svc.dataDir, { now: svc.now() }).filter((i) => i.createdAt > since).length;
}

/** A canvas-only claim with one more `member` grant. */
const withGrant = (claim, canvas) => ({
  v: 1,
  role: null,
  grants: [...(claim?.grants ?? []).filter((g) => g.c !== canvas), { c: canvas, r: 'member' }],
});

/** Validate the `{ role, canvas }` a write names, against what this hub can hold. */
function checkRoleAndScope(svc, role, canvas) {
  if (canvas !== null && !validCanvasPath(canvas)) return refusal(422, 'canvas', 'Not a canvas.');
  if (!GRANT_ROLES.includes(role)) {
    return role === 'owner'
      ? refusal(422, 'owner-immutable', 'Making someone the owner is its own step.')
      : refusal(422, 'unknown-role', 'That is not a role.');
  }
  const p = svc.posture();
  if (!p.roles.includes(role)) {
    return refusal(
      422,
      'role-unsupported',
      'Not on this hub — it has no view-only accounts, so no link either.'
    );
  }
  if (canvas !== null && !p.scopes.includes('canvas')) {
    return refusal(422, 'scope-unsupported', 'This hub shares whole projects only.');
  }
  return null;
}

/**
 * Raise one existing account to `role` at `canvas` (never lowers — G1).
 * Returns true when the account's access went up.
 */
function raiseAccount(svc, user, canvas) {
  if (!user.access) return false; // a project role already sees every canvas
  if (canvas === null) {
    setUserAccess(svc.dataDir, user.email, null);
    return true;
  }
  if (user.access.grants.some((g) => g.c === canvas)) return false;
  setUserAccess(svc.dataDir, user.email, withGrant(user.access, canvas));
  return true;
}

async function selfHosted(ctx, svc, { rest, access, actor }) {
  const { method } = ctx;
  const parts = rest.split('/');
  const query = new URL(ctx.request.url, 'http://hub.invalid').searchParams;
  const isOwner = access.can('invite', null);

  // ---- GET people?canvas=c
  if (parts.length === 1 && parts[0] === 'people') {
    if (method !== 'GET') return answer(ctx, refusal(405, 'method', 'Not here.'));
    const canvas = query.get('canvas');
    if (canvas !== null && !validCanvasPath(canvas)) {
      return answer(ctx, { status: 403, body: { ...NOT_IN_SCOPE_REFUSAL } });
    }
    if (!access.can('read', canvas)) {
      return answer(ctx, { status: 403, body: { ...NOT_IN_SCOPE_REFUSAL } });
    }
    return answer(ctx, { status: 200, body: { people: peopleFor(svc, access, canvas) } });
  }

  // ---- POST / GET requests (Ask to edit)
  if (parts.length === 1 && parts[0] === 'requests') {
    if (method === 'GET') {
      if (!isOwner) return answer(ctx, refusal(403, 'not-allowed', NOT_ALLOWED));
      return answer(ctx, {
        status: 200,
        body: {
          requests: listOpenAccessRequests(svc.dataDir).map((r) => ({
            id: r.id,
            from: { name: nameOf(r.email), email: r.email },
            ...(r.canvas ? { canvas: r.canvas } : {}),
            at: r.createdAt,
          })),
        },
      });
    }
    if (method !== 'POST') return answer(ctx, refusal(405, 'method', 'Not here.'));
    const body = await readJson(ctx.request);
    if (body === null) return answer(ctx, refusal(400, 'body', 'That is not a JSON object.'));
    const canvas = body.canvas ?? null;
    if (canvas !== null && !validCanvasPath(canvas)) {
      return answer(ctx, { status: 403, body: { ...NOT_IN_SCOPE_REFUSAL } });
    }
    if (!access.can('read', canvas)) {
      return answer(ctx, { status: 403, body: { ...NOT_IN_SCOPE_REFUSAL } });
    }
    if (access.can('edit', canvas)) {
      return answer(ctx, refusal(409, 'already-can-edit', 'You can already edit this.'));
    }
    if (!access.can('request', canvas) || !actor) {
      return answer(ctx, refusal(403, 'not-allowed', NOT_ALLOWED));
    }
    const made = createAccessRequest(svc.dataDir, { email: actor, canvas }, svc.now());
    if (!made.ok && made.reason === 'rate-limited') {
      return answer(ctx, refusal(429, 'rate-limited', ASKED_TOO_OFTEN));
    }
    if (!made.ok) {
      return answer(ctx, refusal(409, 'pending', 'You already asked. The owner has your request.'));
    }
    svc.notices.accessRequested({
      id: made.request.id,
      from: { name: nameOf(actor) },
      canvas,
      at: made.request.createdAt,
    });
    return answer(ctx, { status: 201, body: { id: made.request.id } });
  }

  // Everything below changes who has access: the owner's call, project-level.
  // (The row's gate already asked for `invite`; this is the same predicate.)
  if (!isOwner) return answer(ctx, refusal(403, 'not-allowed', NOT_ALLOWED));

  // ---- POST requests/:id/approve | decline
  if (parts.length === 3 && parts[0] === 'requests' && method === 'POST') {
    const verb = parts[2];
    if (verb !== 'approve' && verb !== 'decline')
      return answer(ctx, refusal(404, 'gone', 'Not here.'));
    const req = getOpenAccessRequest(svc.dataDir, parts[1]);
    if (!req) return answer(ctx, refusal(404, 'gone', 'That request is no longer open.'));
    let raised = false;
    if (verb === 'approve') {
      const user = getUser(svc.dataDir, req.email);
      if (!user) {
        return answer(
          ctx,
          refusal(422, 'no-account', 'That person has no account on this hub. Invite them instead.')
        );
      }
      raised = raiseAccount(svc, user, req.canvas);
    }
    if (
      !decideAccessRequest(svc.dataDir, req.id, {
        decision: verb === 'approve' ? 'approved' : 'declined',
        by: actor,
      })
    ) {
      return answer(ctx, refusal(404, 'gone', 'That request is no longer open.'));
    }
    if (raised) svc.notices.accessChanged({ email: req.email, change: 'raised' });
    return answer(ctx, { status: 200, body: { ok: true } });
  }

  // ---- POST invites
  if (parts.length === 1 && parts[0] === 'invites') {
    if (method !== 'POST') return answer(ctx, refusal(405, 'method', 'Not here.'));
    const body = await readJson(ctx.request);
    if (body === null) return answer(ctx, refusal(400, 'body', 'That is not a JSON object.'));
    const role = body.role ?? 'member';
    const canvas = body.canvas ?? null;
    let email;
    try {
      email = assertValidEmail(body.email);
    } catch {
      return answer(ctx, refusal(422, 'email', 'That does not look like an email address.'));
    }
    const bad = checkRoleAndScope(svc, role, canvas);
    if (bad) return answer(ctx, bad);
    // One answer whoever the address belongs to (gate-b-sec3 finding 1, the cloud's rule): no account lookup, so
    // neither the body nor the timing says whether this hub knows the address, and an account holder is never
    // raised behind their back — they accept the link by signing in as that address (POST /join).
    if (invitesToday(svc) >= INVITE_CAP_PER_DAY) {
      return answer(
        ctx,
        refusal(429, 'invite-cap', 'That is a lot of invitations for one day. Try again tomorrow.')
      );
    }
    const made = createInvite(svc.dataDir, {
      email,
      role: 'member',
      createdBy: actor,
      access: canvas === null ? null : withGrant(null, canvas),
    });
    // A self-hosted hub sends no mail (S9-slices Q7): the owner passes the link on.
    return answer(ctx, {
      status: 201,
      body: {
        id: made.id,
        expiresAt: made.expiresAt,
        sent: false,
        url: inviteUrl(svc.publicUrl, made.value),
      },
    });
  }

  // ---- POST invites/:id/resend · DELETE invites/:id
  if (parts[0] === 'invites' && parts.length >= 2) {
    const inv = getInvite(svc.dataDir, parts[1], svc.now());
    const open = inv && inv.status === 'open' ? inv : null;
    if (method === 'POST' && parts.length === 3 && parts[2] === 'resend') {
      const again = open ? reissueInvite(svc.dataDir, open.id, {}, svc.now()) : null;
      if (!again) return answer(ctx, refusal(404, 'gone', 'That invitation is no longer open.'));
      return answer(ctx, {
        status: 200,
        body: { expiresAt: again.expiresAt, url: inviteUrl(svc.publicUrl, again.value) },
      });
    }
    if (method === 'DELETE' && parts.length === 2) {
      if (!open || !revokeInvite(svc.dataDir, open.id)) {
        return answer(ctx, refusal(404, 'gone', 'That invitation is no longer open.'));
      }
      return answer(ctx, { status: 204 });
    }
    return answer(ctx, refusal(404, 'gone', 'Not here.'));
  }

  // ---- PATCH / DELETE people/:id
  if (parts[0] === 'people' && parts.length === 2 && (method === 'PATCH' || method === 'DELETE')) {
    const target = getUserById(svc.dataDir, parts[1]);
    if (!target)
      return answer(ctx, refusal(404, 'not-a-member', 'That person is not on this project.'));
    // The owner cannot be changed or removed here; transfer is its own step.
    if (projectRoleForAccount(target.role) === 'owner' && !target.access) {
      return answer(
        ctx,
        refusal(422, 'owner-immutable', 'The owner stays the owner. Transfer is its own step.')
      );
    }
    if (method === 'PATCH') {
      const body = await readJson(ctx.request);
      if (body === null) return answer(ctx, refusal(400, 'body', 'That is not a JSON object.'));
      const canvas = body.canvas ?? null;
      const bad = checkRoleAndScope(svc, String(body.role ?? ''), canvas);
      if (bad) return answer(ctx, bad);
      if (raiseAccount(svc, target, canvas)) {
        svc.notices.accessChanged({ email: target.email, change: 'raised' });
      }
      return answer(ctx, { status: 200, body: { ok: true } });
    }
    const canvas = query.get('canvas');
    if (canvas !== null) {
      if (!validCanvasPath(canvas) || !target.access?.grants.some((g) => g.c === canvas)) {
        return answer(ctx, refusal(404, 'not-a-member', 'That person is not on this canvas.'));
      }
      const grants = target.access.grants.filter((g) => g.c !== canvas);
      if (grants.length > 0) {
        setUserAccess(svc.dataDir, target.email, { v: 1, role: null, grants });
        svc.notices.accessChanged({ email: target.email, change: 'narrowed' });
        return answer(ctx, { status: 204 });
      }
    }
    // The membership (or a canvas-only person's last canvas): the account goes.
    removeUser(svc.dataDir, target.email);
    revokeInvitesForEmail(svc.dataDir, target.email);
    svc.notices.accessChanged({ email: target.email, change: 'ended', reason: 'removed' });
    return answer(ctx, { status: 204 });
  }

  // ---- POST links · PATCH links/:id — no links on a self-hosted hub
  if (parts[0] === 'links') {
    if (method === 'POST' && parts.length === 1) {
      const body = await readJson(ctx.request);
      if (body === null) return answer(ctx, refusal(400, 'body', 'That is not a JSON object.'));
      if (body.role !== 'observer' && body.role !== 'viewer') {
        return answer(
          ctx,
          refusal(422, 'link-role', 'A link can give Can view or Can comment, never more.')
        );
      }
      return answer(
        ctx,
        refusal(
          422,
          'role-unsupported',
          'Not on this hub — it has no view-only accounts, so no link either.'
        )
      );
    }
    return answer(ctx, refusal(404, 'gone', 'That link is no longer on.'));
  }

  return answer(ctx, refusal(404, 'gone', 'Not here.'));
}

// -------------------------------------------------------------- the handler

/**
 * Every `/api/access/*` row's handler. The gate has run; this answers.
 *
 * @param {object} ctx `runHubRoutes`' context, with `deps.access` the service
 */
export async function handleAccessRoute(ctx) {
  const svc = ctx.deps?.access;
  if (!svc) return false; // a hub that did not build the service: Hocuspocus' 404
  const token = presentedBearer(ctx.request);
  let match = null;
  try {
    match = token ? ctx.verify(token) : null;
  } catch {
    match = null;
  }
  if (!match) {
    // P8 G1a — a Can view desktop holds no hub socket, so no notice reaches it: it polls `me` with its stored
    // bearer. When an access notice ENDED that bearer's own session, its 401 says why (the S9.21d memo, keyed
    // by this exact token's digest — every other bearer, forged or live, gets today's answer).
    const ended = token && svc.dataDir ? endedSessionReason(svc.dataDir, token) : null;
    if (ended) return answer(ctx, refusal(401, ended, 'Your access to this project ended.'));
    return answer(ctx, refusal(401, 'unauthorized', 'Sign in to see who has access.'));
  }
  const rest = ctx.path.slice(PREFIX.length);
  const actor = typeof match.owner === 'string' && match.owner ? match.owner.toLowerCase() : null;
  const access = resolveAccess(claimForMatch(match));

  if (svc.cloud()) {
    // The control plane decides; it needs to know WHO is asking.
    if (!actor) return answer(ctx, refusal(403, 'not-allowed', NOT_ALLOWED));
    return forward(ctx, svc, { rest, actor });
  }

  // ---- GET me — the client's caps come from here, never from a guess
  if (rest === 'me') {
    if (ctx.method !== 'GET') return answer(ctx, refusal(405, 'method', 'Not here.'));
    const grants = access.grants.map((g) => ({ c: g.c, r: g.r }));
    return answer(ctx, {
      status: 200,
      body: {
        role: access.role,
        grants,
        caps: capsAt(access, null),
        ...(grants.length
          ? { canvasCaps: Object.fromEntries(grants.map((g) => [g.c, capsAt(access, g.c)])) }
          : {}),
      },
    });
  }
  return selfHosted(ctx, svc, { rest, access, actor });
}

/**
 * `POST /internal/access-changed` — the control plane telling this cell that
 * somebody's access changed (V2-1.7 §5.6, S9.8 `notifyAccessChanged`). Only
 * the tenant's own derived secret may ask. The body names a person and a
 * direction, never a grant: the notice it sends carries none either.
 */
export async function handleAccessChanged(ctx) {
  const svc = ctx.deps?.access;
  if (!svc) return false;
  if (ctx.method !== 'POST') return answer(ctx, refusal(405, 'method', 'Not here.'));
  if (!secretMatches(ctx.request, svc.secret)) {
    return answer(ctx, { status: 401, body: { error: 'unauthorized' } });
  }
  const body = await readJson(ctx.request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !ACCESS_CHANGES.includes(body?.change)) {
    return answer(ctx, refusal(422, 'body', 'An email and a change are required.'));
  }
  const reason = ACCESS_REASONS.includes(body.reason) ? body.reason : undefined;
  const { sent } = svc.notices.accessChanged({
    email,
    change: body.change,
    reason,
    // P8 G1a — who narrowed and the role now; notices.mjs keeps only a clean name and a wire role
    by: typeof body.by === 'string' ? body.by : undefined,
    role: typeof body.role === 'string' ? body.role : undefined,
  });
  return answer(ctx, { status: 202, body: { ok: true, sent } });
}

// ----------------------------------------------------------------- the rows

const row = (path, safe, unsafe, scope, handler, canvasDoor) =>
  Object.freeze({
    path,
    cap: Object.freeze({ safe, unsafe }),
    scope,
    handler,
    ...(canvasDoor ? { canvasDoor: true } : {}),
  });

/**
 * The access API's rows (V2-1.7 §5.6). Capabilities are the gate's FLOOR; the
 * handler asks the same predicate per scope. `canvasDoor` marks the rows whose
 * handler answers a canvas-only session itself (me, people, Ask to edit);
 * every other row is project-level `invite`, which no canvas grant carries.
 *
 * POST requests is gated at `read`, not `request`: a person who can already
 * edit must hear 409 `already-can-edit`, not the read-only refusal.
 */
export const ACCESS_ROWS = Object.freeze([
  row('/api/access/me', 'read', 'read', 'filtered', handleAccessRoute, true),
  row('/api/access/people', 'read', 'invite', 'filtered', handleAccessRoute, true),
  row('/api/access/people/*', 'invite', 'invite', 'project', handleAccessRoute),
  row('/api/access/invites', 'invite', 'invite', 'project', handleAccessRoute),
  row('/api/access/invites/*', 'invite', 'invite', 'project', handleAccessRoute),
  row('/api/access/links', 'invite', 'invite', 'project', handleAccessRoute),
  row('/api/access/links/*', 'invite', 'invite', 'project', handleAccessRoute),
  row('/api/access/requests', 'invite', 'read', 'filtered', handleAccessRoute, true),
  row('/api/access/requests/*', 'invite', 'invite', 'project', handleAccessRoute),
  row('/internal/access-changed', null, null, 'none', handleAccessChanged),
]);
