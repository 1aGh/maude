// Cloud identity mode — Cloud Phase 22 Tasks 1–3 (DDR-204).
//
// A cell is a hub, and a hub has always had its own users — because a hub was
// originally something one person self-hosted. Cloud inherited that shape
// without deciding on it, and the result was two password stores for one
// human: a customer with three projects had four accounts.
//
// In CLOUD mode the cell has no users of its own. It accepts a short-lived,
// project-scoped token the control plane mints after checking that this person
// has access to this project. Same ask-don't-hold shape as the mirror
// credential (DDR-201) — the cell verifies, it never stores an identity.
//
// IN SELF-HOSTED MODE NOTHING CHANGES. `users.mjs` is untouched and remains
// the whole product for a self-hoster. One code path with two configurations,
// not two code paths — the moment they fork, the self-hosted one starts
// rotting, because nobody on the cloud side ever runs it.
//
// A CONTROL-PLANE OUTAGE MUST NOT LOCK ANYONE OUT OF THEIR OWN WORK.
// Verification is offline: the token is signed with a key the cell already
// holds, so an already-issued token keeps working while the control plane is
// unreachable. Only obtaining a NEW one needs it. That asymmetry is the whole
// reason the token is signed rather than looked up.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { GRANT_ROLES, legacyClaim, MAX_GRANTS } from '../../studio/access/scope.ts';
import { isReadOnlyRole, ROLES } from './role-matrix.mjs';

/**
 * The v2 token prefix (V2-1.7 §5.4). `m2.<body>.<sig>` has THREE parts, so every
 * pre-v2 verifier — which requires exactly two — answers `malformed`: a claim an
 * old cell cannot honour (observer, canvas-only, grants) fails closed BY FORMAT.
 */
export const ACCESS_TOKEN_V2_PREFIX = 'm2';

/** How long an access token is good for. */
export const ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * True when this hub accepts control-plane project tokens.
 *
 * An EXPLICIT switch, never inferred (Phase 23 B1). The first wiring keyed
 * this on MAUDE_CONTROL_PLANE_URL && MAUDE_TENANT_ID — and adding the URL for
 * the MIRROR clock silently flipped the live cell into a mode with no working
 * browser sign-in. An env var that names a dependency must never double as
 * consent to a behavioral mode.
 *
 * Values: unset/'' → off. '1' → HYBRID: token exchange accepted IN ADDITION
 * to the local user store, so a workspace password keeps working while the
 * dashboard/desktop lanes migrate. 'strict' → tokens only (the DDR-204 end
 * state, once the browser handoff exists).
 */
export function cloudIdentityEnabled(env = process.env) {
  return env.MAUDE_CLOUD_IDENTITY === '1' || env.MAUDE_CLOUD_IDENTITY === 'strict';
}

/** Tokens-only — no local passwords. The end state, opt-in separately. */
export function cloudIdentityStrict(env = process.env) {
  return env.MAUDE_CLOUD_IDENTITY === 'strict';
}

/**
 * The key project tokens are verified against.
 *
 * Its OWN derived key (purpose `project-token`), never HUB_SECRET — HUB_SECRET
 * is already the admin bearer AND a wildcard peer token, and the admin console
 * asks operators to paste it into a browser. One value must not be all three
 * (Phase 23 B4 / the debate's BREAKER finding). Falls back to HUB_SECRET only
 * so pre-B4 tokens keep verifying during the rollout.
 */
export function projectTokenKey(env = process.env) {
  return env.MAUDE_PROJECT_TOKEN_KEY || env.HUB_SECRET || '';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/**
 * Sign a project access token.
 *
 * Deliberately NOT a JWT. A JWT brings an algorithm field that the verifier is
 * then obliged to distrust (`alg: none` and the RS256→HS256 confusion are both
 * real classes of bug), and we control both ends. One algorithm, no
 * negotiation, nothing to downgrade.
 *
 * The signing key is derived from the same per-cell secret the control plane
 * already derives (DDR-199 §6), so no new secret has to exist or be
 * distributed.
 */
export function signAccessToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac('sha256', secret).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

/**
 * Sign a v2 project access token: `m2.<body>.<sig>`.
 *
 * The MAC covers the PREFIX too (`m2.<body>`), never the body alone. Otherwise
 * stripping `m2.` would leave a valid v1 token — and an old cell reading a
 * canvas-only body (`role: null`) through its `?? 'member'` default would hand a
 * one-canvas guest the whole project. Same key (`projectTokenKey`) as v1.
 */
export function signAccessTokenV2(payload, secret) {
  const body = b64url(JSON.stringify({ ...payload, v: 2 }));
  const signed = `${ACCESS_TOKEN_V2_PREFIX}.${body}`;
  const mac = createHmac('sha256', secret).update(signed).digest();
  return `${signed}.${b64url(mac)}`;
}

/** Constant-time MAC check; false on any length or encoding mismatch. */
function macMatches(secret, signed, sig) {
  const expected = createHmac('sha256', secret).update(signed).digest();
  let offered;
  try {
    offered = Buffer.from(sig, 'base64url');
  } catch {
    return false;
  }
  // Length-check before timingSafeEqual, which THROWS on a length mismatch —
  // and a thrown comparison is a comparison that did not happen.
  return offered.length === expected.length && timingSafeEqual(offered, expected);
}

/** v2 grants: absent, or ≤ MAX_GRANTS well-formed `{c, r}` — anything else is malformed. */
function grantsValid(grants) {
  if (grants === undefined) return true;
  if (!Array.isArray(grants) || grants.length > MAX_GRANTS) return false;
  return grants.every(
    (g) =>
      g &&
      typeof g === 'object' &&
      typeof g.c === 'string' &&
      g.c.length > 0 &&
      GRANT_ROLES.includes(g.r)
  );
}

/**
 * Verify a project access token, offline.
 *
 * Returns the claims or a REASON — never a bare false. A sign-in that fails
 * with "invalid" and no reason is the failure mode that produces support
 * tickets nobody can answer.
 */
export function verifyAccessToken(token, secret, { now = Date.now(), tenantId } = {}) {
  const parts = String(token ?? '').split('.');
  const v2 = parts.length === 3 && parts[0] === ACCESS_TOKEN_V2_PREFIX;
  if (parts.length !== 2 && !v2) return { ok: false, reason: 'malformed' };
  const [body, sig] = v2 ? parts.slice(1) : parts;

  if (!macMatches(secret, v2 ? `${ACCESS_TOKEN_V2_PREFIX}.${body}` : body, sig)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
    return { ok: false, reason: 'malformed' };
  }

  // The audience check. Without it, a token minted for one project is a token
  // for every project that shares the master — which is every project.
  if (tenantId && claims.project !== tenantId) return { ok: false, reason: 'wrong-project' };
  if (!claims.email) return { ok: false, reason: 'malformed' };
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, reason: 'expired' };

  // H-1 (V2-1.7 §5.4): NO ROLE IS REFUSED, never defaulted. The old
  // `claims.role ?? 'member'` turned a body without a role into an editor.
  if (v2) {
    // v2 carries the PROJECT vocabulary only; `role: null` is a canvas-only
    // claim and must then carry at least one grant.
    const roleOk = claims.role === null || ROLES.includes(claims.role);
    if (claims.v !== 2 || !('role' in claims) || !roleOk || !grantsValid(claims.grants)) {
      return { ok: false, reason: 'malformed' };
    }
    if (claims.role === null && !(claims.grants?.length > 0)) {
      return { ok: false, reason: 'malformed' };
    }
  } else if (
    // A v1 body is byte-identical to today's: a role string, no version, no
    // grants, and never the v2-only `observer` — any of those is a v2 claim
    // that lost its prefix, refused rather than read as something wider.
    typeof claims.role !== 'string' ||
    claims.role.length === 0 ||
    claims.role === 'observer' ||
    'grants' in claims ||
    'v' in claims
  ) {
    return { ok: false, reason: 'malformed' };
  }

  return {
    ok: true,
    // `role` stays in whichever vocabulary the token spoke (a v1 token may say
    // `admin`); the minting door translates it (`projectRoleForAccount`).
    user: { email: claims.email, role: claims.role },
    // v2 only: `format: 2` and the `access` claim the minting door decides on.
    // A v1 verdict stays key-for-key what 1.9.1 returned (token-interop pins it).
    ...(v2
      ? {
          format: 2,
          access: {
            v: 1,
            role: claims.role,
            ...(claims.grants?.length
              ? { grants: claims.grants.map(({ c, r }) => ({ c, r })) }
              : {}),
          },
        }
      : {}),
    // Surfaced so the exchanged peer token can be CAPPED to the project
    // token's own lifetime (Phase 23 B2).
    expiresAt: claims.exp,
    // Surfaced so the revocation registry can tell a token minted BEFORE a
    // removal from one minted after it (a re-add must just work).
    issuedAt: claims.iat,
  };
}

/**
 * Mint the claims for one person's access to one project.
 *
 * Exported so the control plane and the cell agree on the shape by sharing it
 * rather than by both being careful.
 */
export function accessClaims(
  { email, project, role, grants },
  { now = Date.now(), ttlMs = ACCESS_TOKEN_TTL_MS } = {}
) {
  // H-1: every mint states the role. No default — a forgotten role must be a
  // loud mint failure, never an editor.
  if (role === undefined) throw new Error('accessClaims: a role is required (H-1)');
  return {
    email,
    project,
    role,
    ...(grants?.length ? { grants } : {}),
    iat: now,
    exp: now + ttlMs,
  };
}

/**
 * The claim a verified sign-in carries, in the PROJECT vocabulary: a v2 token's
 * own claim, else the v1 role translated at the one boundary (`admin` → owner).
 */
export function claimOf(result) {
  return result?.access ?? legacyClaim(result?.user?.role ?? null);
}

/**
 * The `addToken` fields for a session the mint door (`peerTokenDoor`) allowed.
 *
 * INTERIM, FAIL CLOSED (S9.2 → S9.4/S9.5): no door on this hub reads `access`
 * yet, so the stored fields must not let an old door widen a v2 claim.
 *  - `readOnly` is the PROJECT role's projection only — a grant never lifts it
 *    here, because every existing door reads `read_only` for every document.
 *  - A canvas-only session (`role: null`) gets no wildcard `scope` (DDR-053's
 *    label-bound default), so every scope-checking door refuses it until
 *    `access-files` / `access-docs` answer from the claim.
 * Unreachable until the control plane mints `m2.` for this cell (`roles-v2`).
 */
export function peerSessionFields(door, { scope = '*' } = {}) {
  const role = door.claim.role;
  return {
    role,
    readOnly: isReadOnlyRole(role),
    ...(role === null ? {} : { scope }),
    ...(door.v2 ? { access: door.claim } : {}),
  };
}

/**
 * What a cloud-mode cell says when someone tries a local password.
 *
 * It must not read as "wrong password" — the password is not wrong, it is not
 * a thing that exists here — and it must say where to go instead.
 */
export const LOCAL_PASSWORD_REFUSED = {
  ok: false,
  reason: 'cloud-identity',
  message:
    'This project uses your Maude account. Sign in at the Maude dashboard and open the project from there.',
};

/**
 * Authenticate in whichever mode this hub is running.
 *
 * ONE function with two configurations. A separate cloud path would leave the
 * self-hosted one to rot, because nobody on the cloud side would ever run it.
 *
 * @param {object} deps
 * @param {(email: string, password: string) => object} deps.local  users.mjs authenticate, bound to its dataDir
 */
export function authenticateForMode(
  { email, password, token },
  { local, revoked, env = process.env, secret, now = Date.now() }
) {
  // HUB_OIDC_MODE=strict means OIDC is the ONLY way in — password sign-in is
  // refused (Track C B1-a). Checked inline (not via an import of oidc-routes,
  // which would cycle through users.mjs) and BEFORE the local fall-through, so
  // both password doors inherit it. `oidcConfig` already forbids strict from
  // coexisting with MAUDE_CLOUD_IDENTITY, so this is the whole rule.
  if (env.HUB_OIDC_MODE === 'strict' && (email || password)) {
    return { ok: false, reason: 'password-refused-oidc-strict' };
  }
  if (!cloudIdentityEnabled(env)) {
    return local(email, password);
  }

  if (token) {
    const key = secret ?? projectTokenKey(env);
    const verdict = verifyAccessToken(token, key, { now, tenantId: env.MAUDE_TENANT_ID });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    // A viewer USED TO BE REFUSED HERE (Phase 23 B2 / the debate's BREAKER
    // finding), because peer tokens were write-capable and letting one in
    // would have been a silent promotion from "can look" to "can change" —
    // the People page's "cannot change anything" promise, quietly broken.
    //
    // Cloud Phase 25 C1 closes that properly instead of refusing: the session
    // this mints carries `readOnly`, Hocuspocus drops the peer's SyncStep2 and
    // Update messages, and every mutating HTTP route refuses. So the viewer
    // gets in and genuinely cannot write, which is what the role always meant
    // and what the invitation email has been promising since Phase 20.
    //
    // The old refusal also pointed at "the shared gallery link" — a surface
    // Phase 25 C4 deletes. It was already sending people nowhere.
    // A token minted BEFORE the person was removed or demoted is spent, even
    // though its signature and expiry are both still good. Offline
    // verification cannot recall a token, so the door has to remember
    // (validate 2026-07-30, attacker A2/A3) — otherwise the revocation sweep
    // ends sessions the holder simply re-opens.
    if (revoked?.(verdict.user.email, verdict.issuedAt)) {
      return {
        ok: false,
        reason: 'access-withdrawn',
        message: 'Your access to this project was removed. Ask whoever runs it to add you again.',
      };
    }
    // The exchanged session must die WITH the project token, not outlive it
    // by 30 days — "removal lands within 12 hours" is a written promise.
    // `access` (v2 tokens only) is the claim the minting door decides on.
    return {
      ok: true,
      user: verdict.user,
      expiresAt: verdict.expiresAt,
      ...(verdict.access ? { format: verdict.format, access: verdict.access } : {}),
    };
  }

  // HYBRID keeps the local user store alive alongside tokens; STRICT is the
  // end state where a password is not a thing here at all.
  if (!cloudIdentityStrict(env)) return local(email, password);
  return LOCAL_PASSWORD_REFUSED;
}
