// The hub's access gate — V2-1.16 §5.2, V2-1.7 A19 (S9.3).
//
// THE ONLY HUB MODULE THAT TURNS A CREDENTIAL INTO AN `Access`. Every door that
// asks "may this session do X" asks it here, through the one predicate module
// (`apps/studio/access/scope.ts`) the studio, the cloud and the cells import too.
// A second copy of "what a role means" in a handler is how two doors drift.
//
// What S9.3 puts here:
//   - `peerAccess(match)` — a verified peer token (`tokens.mjs verifyToken`) as an
//     Access. Its `closure()` is null until S9.4 computes the canvas closure;
//   - `hubAccessRefusal(...)` — the ONE capability check `onRequest` runs, for
//     every classified hub route (`routes-v2/index.mjs`). It replaces the
//     `bearer.readOnly` check + `readOnlyAllowedPath` allowlist: a write needs
//     `edit` unless its row names another capability (`session` to sign out,
//     `export` to download), and a byte route needs `export` on a GET too —
//     which is A19: Can view (`observer`) is refused every download.
//
// A COURTESY LIMIT, NOT DRM (V2-1.7 §4 decision 4). A viewer's browser still
// holds every byte it renders; this refuses the routes that hand project bytes
// away as files.

import { legacyClaim, resolveAccess } from '../../studio/access/scope.ts';

/** Today's refusal for a read-only session (Cloud Phase 25 C1) — v1.9.1 shows it verbatim. */
export const READ_ONLY_REFUSAL = Object.freeze({
  error: 'You can look at this project, comment and download it, but not change it.',
  reason: 'read-only',
});

/** Can view's refusal (V2-1.7 §5.9 copy) — it holds no comment and no download. */
export const OBSERVER_REFUSAL = Object.freeze({
  error: 'You can look at this project, not change it.',
  reason: 'read-only',
});

/** U1 — invisible answers exactly as missing; the copy never says why (V2-1.7 G2). */
export const NOT_IN_SCOPE_REFUSAL = Object.freeze({
  error: 'not-in-scope',
  reason: 'not-in-scope',
});

/**
 * A paused cloud project (A3, Maude v2 S9.15 · S9-slices Q11): the trial ended
 * with no plan. 402, not 403 — a v2 client shows the plan callout on it and
 * never renews credentials. The owner hears the contract's sentence; anyone
 * else hears that editing is paused, and nothing about billing. The control
 * plane's project-access.mjs carries the same two strings.
 */
export const PLAN_OWNER_REFUSAL = Object.freeze({
  error: 'Choose a plan to keep editing.',
  reason: 'plan',
});
export const PLAN_PAUSED_REFUSAL = Object.freeze({
  error: 'Editing is paused for this project. Its owner can turn it back on.',
  reason: 'plan',
});

/**
 * What a paused project keeps: reading it, keeping your own place in it,
 * asking for access, and taking a copy home. Everything else changes the
 * project (or pushes it somewhere), and pauses.
 */
const PAUSE_KEEPS = new Set(['read', 'session', 'request', 'export']);

/**
 * Whether this cell's project is paused. An EXPLICIT value, never inferred
 * (same rule as `cloudIdentityEnabled`): the control plane starts the cell with
 * `MAUDE_PLAN_STATE=paused` (`/internal/cell-config` `planState`), and only
 * that exact value pauses. A self-hosted hub never sets it.
 */
export function planPausedFromEnv(env = process.env) {
  return env.MAUDE_PLAN_STATE === 'paused';
}

/**
 * Capabilities the `read_only` projection on a peer token can never hold. A token
 * stored read-only stays read-only whatever its role column says — the bit is what
 * every pre-v2 door reads, so the gate must never be wider than it.
 */
const WRITE_CAPABILITIES = new Set([
  'annotate',
  'edit',
  'trash',
  'summon',
  'invite',
  'delete',
  'mirror',
]);

/**
 * The access claim a verified peer token carries.
 *
 *  - `access` column set → the claim the mint door decided (S9.2);
 *  - the operator's env secret → the project's owner;
 *  - a role column → `legacyClaim(role)` (an account role is translated);
 *  - NO role at all — a token minted before roles existed, a machine token, an
 *    admin-console invite — keeps exactly what it has always had: the `read_only`
 *    bit says viewer or member. Refusing it would break every self-hosted
 *    desktop linked through the admin console (U7: project-level sessions are
 *    unchanged); treating it as owner would be an escalation.
 */
export function claimForMatch(match) {
  if (!match) return null;
  if (match.access) return match.access;
  if (match.source === 'env') return { v: 1, role: 'owner' };
  if (match.role) return legacyClaim(match.role);
  return legacyClaim(match.readOnly ? 'viewer' : 'member');
}

/**
 * A verified peer token as the one Access object every door asks.
 *
 * @param {object | null} match `verifyToken`'s result
 * @returns {{ access: import('../../studio/access/scope.ts').Access, readOnly: boolean, closure: () => null } | null}
 */
export function peerAccess(match) {
  if (!match) return null;
  return {
    access: resolveAccess(claimForMatch(match)),
    readOnly: !!match.readOnly,
    // S9.4 computes the canvas closure (V2-1.7 G2–G4) for canvas-only sessions.
    closure: () => null,
  };
}

/** The bearer a request presents, or null. */
export function presentedBearer(request) {
  const raw = request?.headers?.authorization;
  const value = (typeof raw === 'string' ? raw : '').replace(/^Bearer\s+/i, '').trim();
  return value || null;
}

/**
 * The capability check `onRequest` runs once per request.
 *
 * `capability` is the classified row's answer for this method (null = no check).
 * Only a request that PRESENTS a credential that VERIFIES is judged here: an
 * absent or wrong token falls through to its handler, which answers its own 401
 * exactly as today.
 *
 * `canvasDoor` (S9.4/S9.5): the row's handler answers a canvas-only session
 * itself — it filters or refuses per target (V2-1.16 L1–L6), so the gate only
 * asks whether ANY granted canvas holds the capability.
 *
 * `plan` (A3): `'paused'` refuses every capability a paused project does not
 * keep with 402 — AFTER the role check, so a role that could not write anyway
 * keeps today's 403 and learns nothing new. Defaults to this cell's env.
 *
 * @param {{ request: object, capability: string | null, scope: string, canvasDoor?: boolean, verify: (token: string) => object | null, plan?: string | null }} ctx
 * @returns {{ status: number, body: object } | null} a refusal, or null to go on
 */
export function hubAccessRefusal({
  request,
  capability,
  scope,
  canvasDoor = false,
  verify,
  plan = planPausedFromEnv() ? 'paused' : null,
}) {
  if (!capability) return null;
  const token = presentedBearer(request);
  if (!token) return null;
  let match;
  try {
    match = verify(token);
  } catch {
    match = null;
  }
  const peer = peerAccess(match);
  if (!peer) return null;
  const { access } = peer;
  // FAIL CLOSED (S9.3): a canvas-only session reaches no project route whose
  // door does not answer for it (`canvasDoor`, S9.4/S9.5). It gets the U1
  // answer, the same one a missing path gives it.
  if (access.canvasOnly && scope !== 'none' && !canvasDoor) {
    return { status: 403, body: { ...NOT_IN_SCOPE_REFUSAL } };
  }
  // A canvas-only session holds nothing at canvas `null` (lead decision: even
  // `session` must pass a canvas). A route that is no project's at all (scope
  // `none` — sign out) asks whether ANY granted canvas carries the capability.
  const held = access.canvasOnly
    ? access.grants.some((g) => access.can(capability, g.c))
    : access.can(capability, null);
  // The stored `read_only` bit is the fail-closed projection every door that
  // does not read the claim relies on (`peerSessionFields`: a canvas-only
  // session is stored read-only). A canvasDoor handler DOES read the claim and
  // judges each target itself, so there the claim is authoritative.
  const claimDecides = access.canvasOnly && canvasDoor;
  const allowed = held && (claimDecides || !(peer.readOnly && WRITE_CAPABILITIES.has(capability)));
  if (allowed) {
    if (plan === 'paused' && !PAUSE_KEEPS.has(capability)) {
      return {
        status: 402,
        body: { ...(access.role === 'owner' ? PLAN_OWNER_REFUSAL : PLAN_PAUSED_REFUSAL) },
      };
    }
    return null;
  }
  if (access.role === 'observer') return { status: 403, body: { ...OBSERVER_REFUSAL } };
  return { status: 403, body: { ...READ_ONLY_REFUSAL } };
}
