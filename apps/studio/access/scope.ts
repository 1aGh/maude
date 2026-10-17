// Grants and the access claim — V2-1.7 §5.3 (S9.1).
//
// A credential carries an `AccessClaim`: the project role (or null) plus up to
// 256 canvas grants. `resolveAccess` turns it into the ONE `Access` object
// every door asks; `sees` / `writes` / `seesDoc` answer the file- and
// document-level questions over the server-computed closure (`closure.ts`).
//
// Fail closed everywhere: a malformed claim holds nothing, an unknown role is
// null (R1), a malformed or `owner` grant is dropped, and a grant never lowers
// (G1) or confers a project-only capability (PROJECT_ONLY).
//
// Pure and import-light (only `roles.ts`, types from `closure.ts`), so the hub
// can import it the way it imports `roles.ts`.

import type { Closure } from './closure.ts';
import {
  type Capability,
  maxRole,
  PROJECT_ONLY,
  type ProjectRole,
  projectRoleForAccount,
  can as roleCan,
} from './roles.ts';

/** The roles a canvas grant may carry. A grant never carries `owner`. */
export const GRANT_ROLES = Object.freeze(['observer', 'viewer', 'member'] as const);
export type GrantRole = (typeof GRANT_ROLES)[number];

/** One canvas grant. `c` is the canonical designRoot-relative canvas path (never a slug). */
export interface Grant {
  c: string;
  r: GrantRole;
}

/** The signed claim. `grants` ≤ MAX_GRANTS, sorted by `c` at mint. */
export interface AccessClaim {
  v: 1;
  role: ProjectRole | null;
  grants?: Grant[];
}

/** A claim with more grants than this is malformed and holds nothing. */
export const MAX_GRANTS = 256;

export interface Access {
  /** Project-level role; null = canvas-only session (or no access at all). */
  readonly role: ProjectRole | null;
  /** role === null && at least one grant. */
  readonly canvasOnly: boolean;
  /** The resolved grants, one per canvas (the higher role kept), sorted by `c`. */
  readonly grants: readonly Grant[];
  /** max(role, grant[canvas]); canvas null → role. */
  roleFor(canvas: string | null): ProjectRole | null;
  /** PROJECT_ONLY capabilities need the project role; everything else the effective role. */
  can(cap: Capability, canvas: string | null): boolean;
  /** role !== null || canvas ∈ grants. */
  seesCanvas(canvas: string): boolean;
  /** What the client said it understands (V2-1.7 §5.4). */
  readonly minted: { declaredAccess: 1 | 2 };
}

const isGrantRole = (r: unknown): r is GrantRole =>
  typeof r === 'string' && (GRANT_ROLES as readonly string[]).includes(r);

/** Parse a claim; null when it is malformed (the whole claim then holds nothing). */
function parseClaim(
  claim: unknown
): { role: ProjectRole | null; grants: Map<string, GrantRole> } | null {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return null;
  const c = claim as { v?: unknown; role?: unknown; grants?: unknown };
  if (c.v !== 1) return null;
  if (c.grants !== undefined && !Array.isArray(c.grants)) return null;
  const raw = (c.grants ?? []) as unknown[];
  if (raw.length > MAX_GRANTS) return null;
  // A claim carries PROJECT roles; an account role (`admin`) is not translated here —
  // the door that minted the claim already did that (`legacyClaim`).
  const role =
    typeof c.role === 'string' && projectRoleForAccount(c.role) === c.role
      ? (c.role as ProjectRole)
      : null;
  const grants = new Map<string, GrantRole>();
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const { c: canvas, r } = g as { c?: unknown; r?: unknown };
    if (typeof canvas !== 'string' || canvas === '' || !isGrantRole(r)) continue;
    const prev = grants.get(canvas);
    grants.set(canvas, (maxRole(prev ?? null, r) as GrantRole | null) ?? r);
  }
  return { role, grants };
}

/** Resolve a claim into the one Access object every door asks. */
export function resolveAccess(
  claim: AccessClaim | null | undefined,
  opts: { declaredAccess?: 1 | 2 } = {}
): Access {
  const parsed = parseClaim(claim);
  const role = parsed?.role ?? null;
  const grantMap = parsed?.grants ?? new Map<string, GrantRole>();
  const grants = Object.freeze(
    [...grantMap.entries()]
      .map(([c, r]) => Object.freeze({ c, r }))
      .sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0))
  );
  const roleFor = (canvas: string | null): ProjectRole | null =>
    canvas === null ? role : maxRole(role, grantMap.get(canvas) ?? null);
  return Object.freeze({
    role,
    canvasOnly: role === null && grants.length > 0,
    grants,
    roleFor,
    can(cap: Capability, canvas: string | null): boolean {
      if (PROJECT_ONLY.includes(cap)) return role !== null && roleCan(role, cap);
      return roleCan(roleFor(canvas), cap);
    },
    seesCanvas(canvas: string): boolean {
      return role !== null || grantMap.has(canvas);
    },
    minted: Object.freeze({ declaredAccess: opts.declaredAccess === 2 ? 2 : 1 }) as {
      declaredAccess: 1 | 2;
    },
  });
}

/** A v1 credential (role only) as a claim: the role translated at the one boundary. */
export function legacyClaim(role: string | null | undefined): AccessClaim {
  return { v: 1, role: projectRoleForAccount(role) };
}

/**
 * May this session read `rel` (designRoot-relative)? A project role reads every file (the
 * existing gates still apply); a canvas-only session reads its closure and nothing else.
 */
export function sees(access: Access, closure: Closure | null, rel: string): boolean {
  if (access.role !== null) return access.can('read', null);
  if (!access.canvasOnly || !closure) return false;
  return closure.read.has(rel);
}

const PHOTO_SIDECAR_RE = /^(assets\/.+)\.photo\.json$/;

/**
 * May this session write `rel`? G2:
 * - a project editor: yes (code modules / DS files stay behind the existing gates);
 * - otherwise only `owned` files of a canvas it may edit, plus create-only new files under
 *   `assets/`, plus a photo-edit sidecar of an asset whose every referrer it may edit.
 */
export function writes(
  access: Access,
  closure: Closure | null,
  rel: string,
  o: { exists: boolean }
): boolean {
  if (access.can('edit', null)) return true;
  if (!closure || access.grants.length === 0) return false;
  const owner = closure.ownedBy.get(rel);
  if (owner !== undefined) return access.can('edit', owner);
  const photo = PHOTO_SIDECAR_RE.exec(rel);
  if (photo) {
    const base = photo[1] as string;
    for (const [asset, users] of closure.assetUsers) {
      if (assetBase(asset) !== base) continue;
      if (users.size === 0) return false;
      for (const u of users) if (!access.can('edit', u)) return false;
      return true;
    }
  }
  // Create-only under assets/: a NEW file whose stem is no existing asset's — otherwise it
  // would attach a sidecar (photo edit, audio gain, captions…) to an asset other canvases use.
  if (
    !o.exists &&
    /^assets\/[^/]+$/.test(rel) &&
    !closure.assetStems.has(assetStem(rel)) &&
    access.grants.some((g) => access.can('edit', g.c))
  ) {
    return true;
  }
  return false;
}

/** `assets/<sha8>.photo.json` → `assets/<sha8>`: everything before the file name's first dot. */
export const assetStem = (rel: string): string => {
  const slash = rel.lastIndexOf('/');
  const dot = rel.indexOf('.', slash + 1);
  return dot > slash + 1 ? rel.slice(0, dot) : rel;
};

const assetBase = (rel: string): string => {
  const slash = rel.lastIndexOf('/');
  const dot = rel.lastIndexOf('.');
  return dot > slash ? rel.slice(0, dot) : rel;
};

/**
 * May this session open the Y.Doc `documentName` (`ws/<w>/<b>/<slug>`)? A project role: yes.
 * A canvas-only session: only when the slug is one of its granted canvases' slugs.
 */
export function seesDoc(
  access: Access,
  documentName: string,
  slugOf: (canvasPath: string) => string
): boolean {
  if (access.role !== null) return access.can('read', null);
  if (!access.canvasOnly) return false;
  const parts = String(documentName).split('/');
  if (parts.length !== 4 || parts[0] !== 'ws' || parts.some((p) => p === '')) return false;
  const slug = parts[3];
  return access.grants.some((g) => access.can('read', g.c) && slugOf(g.c) === slug);
}
