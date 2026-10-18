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
// Pure and import-light (only `roles.ts`, types from `closure.ts`, `node:crypto`
// for the per-use photo-edit hash), so the hub can import it the way it imports
// `roles.ts`.

import { createHash } from 'node:crypto';

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
 * The per-use photo edit `assets/<img8>.<edit8>.photo.json` (contract S8-asset-sidecars §5.1):
 * `edit8` is the first 8 (on a collision up to 16) hex of `photoEditHash(edit)`.
 */
export const PER_USE_PHOTO_RE = /^(assets\/[^/.]+)\.([0-9a-f]{8,16})\.photo\.json$/;

/** Canonical JSON: keys sorted recursively, no whitespace, `JSON.stringify` numbers. */
function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

/** The full sha256 hex of a PhotoEdit's canonical JSON — a per-use file's name is its prefix. */
export function photoEditHash(edit: unknown): string {
  return createHash('sha256').update(canonicalJson(edit), 'utf8').digest('hex');
}

/** Does `body` (the bytes about to be written) hash to the per-use name's `edit8`? */
function bodyHashesTo(body: string | Uint8Array | undefined, edit8: string): boolean {
  if (body === undefined) return false;
  try {
    const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
    return photoEditHash(JSON.parse(text)).startsWith(edit8);
  } catch {
    return false;
  }
}

/**
 * May this session write `rel`? G2:
 * - a project editor: yes (code modules / DS files stay behind the existing gates);
 * - otherwise only `owned` files of a canvas it may edit, plus create-only new files under
 *   `assets/`, plus a photo-edit sidecar of an asset whose every referrer it may edit;
 * - S8 §5.6: plus CREATE of a per-use edit `assets/<img8>.<edit8>.photo.json` for an asset a
 *   canvas it may edit references, only when `body` hashes to `edit8` — never over existing
 *   bytes (same name ⇒ same bytes: the route answers a rewrite as a no-op before asking).
 */
export function writes(
  access: Access,
  closure: Closure | null,
  rel: string,
  o: { exists: boolean; body?: string | Uint8Array }
): boolean {
  if (access.can('edit', null)) return true;
  if (!closure || access.grants.length === 0) return false;
  const owner = closure.ownedBy.get(rel);
  if (owner !== undefined) return access.can('edit', owner);
  const perUse = PER_USE_PHOTO_RE.exec(rel);
  if (perUse) {
    if (o.exists || !bodyHashesTo(o.body, perUse[2] as string)) return false;
    for (const [asset, users] of closure.assetUsers) {
      if (assetBase(asset) !== perUse[1]) continue;
      for (const u of users) if (access.can('edit', u)) return true;
    }
    return false;
  }
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

/** `assets/<sha8>.<ext>` — the content-addressed asset name (V2-1.16 L20). */
const CONTENT_ADDRESSED_ASSET = /^assets\/([0-9a-f]{8})\.[A-Za-z0-9]{1,16}$/;

/**
 * Is `rel` a NEW top-level asset that a canvas-only session must content-address
 * (V2-5 sweep-fix, lead decision)? `writes()` lets such a session create a new
 * `assets/` file; a chosen name would make its refusal (the name is already held
 * by a canvas it cannot see) differ from a free name's success — an existence
 * oracle. So the create must be named by its own bytes.
 */
export const isAssetCreate = (rel: string, o: { exists: boolean }): boolean =>
  !o.exists && /^assets\/[^/]+$/.test(rel);

/**
 * `rel` is `assets/<sha8>.<ext>` whose `<sha8>` opens `sha256` (lowercase hex of
 * the bytes). `sha256` null checks the name's shape only — the door's check
 * before a body is read; the bytes are checked again once hashed.
 */
export function contentAddressedAsset(rel: string, sha256: string | null): boolean {
  const m = CONTENT_ADDRESSED_ASSET.exec(rel);
  if (!m) return false;
  if (sha256 === null) return true;
  return typeof sha256 === 'string' && sha256.toLowerCase().startsWith(m[1] as string);
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

// ---------------------------------------------------------------------------
// THE PEER-TOKEN MINT DOOR — V2-1.7 §5.4 (S9.2).
//
// One decision for every door that turns a claim into a peer credential: the
// hub's `/auth/login`, the cloud handoff exchange, and (browser lane) the
// cell's browser sign-in. A v1 client must keep getting exactly today's answer
// for owner / member / viewer; a claim it cannot honour (observer, canvas-only,
// grants) is refused by VERSION (426, never 403 — V2-1.12), and an observer
// whose client did declare is sent to the browser door (409) — no peer token,
// so no local file-plane copy (A19).

/** The access-claim version a client declares with `X-Maude-Access`. */
export const ACCESS_VERSION = 2 as const;

/** `X-Maude-Access` → what the client understands. Absent, garbage or `1` → 1. */
export function declaredAccessOf(value: unknown): 1 | 2 {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(n) && n >= ACCESS_VERSION ? 2 : 1;
}

/** The 426 body (V2-1.7 §5.4, copy per §5.9). */
export const ACCESS_VERSION_REFUSAL = Object.freeze({
  error: 'Update Maude to open this project.',
  reason: 'access-version',
  minAccess: ACCESS_VERSION,
});

export type PeerDoor =
  /** Mint. `v2` → the credential carries `claim` (peer `access` column / `m2.` token). */
  | { outcome: 'mint'; claim: AccessClaim; v2: boolean }
  | { outcome: 'update'; status: 426; body: typeof ACCESS_VERSION_REFUSAL }
  | { outcome: 'browser-door'; status: 409; body: { reason: 'browser-door'; url: string } }
  /** No role and no grant: holds nothing. The door answers with its own refusal. */
  | { outcome: 'none' };

/** A canvas path as URL path segments (`/` kept, every segment encoded). */
const canvasUrlPath = (c: string): string => c.split('/').map(encodeURIComponent).join('/');

/**
 * Decide one mint. `claim` is in the PROJECT vocabulary (translate an account role with
 * `legacyClaim` first). `doorUrl` is the cell's public shell URL; `browserLane` is the
 * cell's own browser sign-in, which IS the browser door and so never answers 409.
 */
export function peerTokenDoor(
  claim: AccessClaim | null | undefined,
  opts: { declaredAccess?: 1 | 2; doorUrl?: string | null; browserLane?: boolean } = {}
): PeerDoor {
  const access = resolveAccess(claim);
  const { role, grants } = access;
  if (role === null && grants.length === 0) return { outcome: 'none' };
  if (role !== null && role !== 'observer' && grants.length === 0) {
    // v1-expressible: byte-identical to today, declared or not.
    return { outcome: 'mint', claim: { v: 1, role }, v2: false };
  }
  if (opts.declaredAccess !== ACCESS_VERSION) {
    return { outcome: 'update', status: 426, body: ACCESS_VERSION_REFUSAL };
  }
  const normalized: AccessClaim = {
    v: 1,
    role,
    ...(grants.length ? { grants: grants.map((g) => ({ c: g.c, r: g.r })) } : {}),
  };
  if (!opts.browserLane) {
    const observerGrant = role === null ? grants.find((g) => g.r === 'observer') : undefined;
    if (role === 'observer' || observerGrant) {
      const base = String(opts.doorUrl ?? '').replace(/\/+$/, '');
      const url = observerGrant ? `${base}/c/${canvasUrlPath(observerGrant.c)}` : base;
      return { outcome: 'browser-door', status: 409, body: { reason: 'browser-door', url } };
    }
  }
  return { outcome: 'mint', claim: normalized, v2: true };
}
