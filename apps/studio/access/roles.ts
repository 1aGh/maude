// THE role matrix — V2-1.7 §5.1–§5.2 (S9.1). One table, one authority.
//
// PURE and ZERO-DEP on purpose: the hub re-exports this file
// (`apps/hub/src/role-matrix.mjs`, run by Node's type stripping and bundled by
// the hub image), the control plane imports it (`apps/cloud/project-access.mjs`,
// `membership.mjs`), and the studio reads it (`sync/hubs-config.ts`). So keep it
// to erasable TypeScript — no enums, no namespaces, no parameter properties —
// and no imports at all.
//
// Why one table (decision d_b219fd3d7a46532d40cab867): a role must mean the
// same thing in the browser and in the desktop app, at the cell and at the
// control plane. Two copies drift, and the weaker one becomes the way in. The
// control plane had its own (with no `export` row) until this file landed.
//
// The rows that catch people out:
//   - COMMENT is the one write a `viewer` (Can comment) holds — "look, comment
//     and download" — and therefore exactly where a scope bug turns "may leave a
//     note" into "may edit the project".
//   - ANNOTATE sits with `edit`, not `comment`: an annotation is drawn ON the
//     design and versioned with it (`*.annotations.json`, DDR-242), a comment
//     is a note ABOUT it in a separate store.
//   - REQUEST (Ask to edit) is held exactly by the roles WITHOUT edit (R5).
//   - `observer` (Can view, Gate 0 A6/A19) is look-only: read, session, request.

/** Every project role, WEAKEST FIRST. `rankOf` is the index. */
export const ROLES = Object.freeze(['observer', 'viewer', 'member', 'owner'] as const);
export type ProjectRole = (typeof ROLES)[number];

/**
 * The pre-v2 project roles — what a v1 token, a v1.9.x desktop's `hubs.json`
 * and today's D1 `project_members.role` CHECK can name. The control plane keeps
 * storing and offering exactly these until its D1 v2 migration (V2-1.7 §5.8)
 * lands; the R3 parity test pins their rows.
 */
export const V1_ROLES = Object.freeze(['viewer', 'member', 'owner'] as const);

/** Every capability the product distinguishes (V2-1.7 §5.2 order). */
export const CAPABILITIES = Object.freeze([
  'read',
  // Keeping your own place in a project you may read: camera, tabs, prefs,
  // tree state, bug report (DDR-115 per-user runtime state). Every role holds
  // it — a reviewer who cannot pan is not reviewing.
  'session',
  'request',
  'comment',
  'export',
  'annotate',
  'edit',
  'trash',
  'summon',
  'invite',
  'delete',
  'mirror',
] as const);
export type Capability = (typeof CAPABILITIES)[number];

type Row = Readonly<Record<Capability, boolean>>;

const row = (held: readonly Capability[]): Row =>
  Object.freeze(
    Object.fromEntries(CAPABILITIES.map((c) => [c, held.includes(c)])) as Record<
      Capability,
      boolean
    >
  );

/** THE MATRIX. `invite`, `delete`, `mirror` are owner-only (PROJECT_ONLY). */
const MATRIX: Readonly<Record<ProjectRole, Row>> = Object.freeze({
  owner: row([
    'read',
    'session',
    'comment',
    'export',
    'annotate',
    'edit',
    'trash',
    'summon',
    'invite',
    'delete',
    'mirror',
  ]),
  member: row(['read', 'session', 'comment', 'export', 'annotate', 'edit', 'trash', 'summon']),
  viewer: row(['read', 'session', 'request', 'comment', 'export']),
  observer: row(['read', 'session', 'request']),
});

/** Unknown roles get NOTHING. A typo must not be an escalation (R1). */
const NONE: Row = row([]);

const isProjectRole = (role: unknown): role is ProjectRole =>
  typeof role === 'string' && (ROLES as readonly string[]).includes(role);

/** The capability row for a role; an unknown role (or null) gets the all-false row. */
export function capabilitiesFor(role: string | null | undefined): Row {
  return isProjectRole(role) ? MATRIX[role] : NONE;
}

/** Whether a role holds a capability. Unknown role or unknown capability → false. */
export function can(role: string | null | undefined, cap: Capability): boolean {
  return capabilitiesFor(role)[cap] === true;
}

/**
 * Read-only, derived from the table in ONE place. Every session-minting path
 * calls this rather than testing `role === 'viewer'` — the day a role is added,
 * the places that tested the string are the places that get it wrong.
 */
export function isReadOnlyRole(role: string | null | undefined): boolean {
  return !can(role, 'edit');
}

/** 0 (observer) … 3 (owner); -1 for an unknown role or null. */
export function rankOf(role: string | null | undefined): number {
  return isProjectRole(role) ? ROLES.indexOf(role) : -1;
}

/** The higher of two roles; an unknown role is ignored; null when neither is known. */
export function maxRole(
  a: string | null | undefined,
  b: string | null | undefined
): ProjectRole | null {
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra < 0 && rb < 0) return null;
  return ROLES[Math.max(ra, rb)] ?? null;
}

/** The floor a credential without a role falls to (render tokens, any "missing role"). */
export const FLOOR_ROLE: ProjectRole = 'observer';

/** Capabilities a canvas grant never confers — they need a project role. */
export const PROJECT_ONLY: readonly Capability[] = Object.freeze([
  'invite',
  'delete',
  'mirror',
] as const);

/** The V2-1.2 `Role` level a project role renders as. */
export function levelOf(role: string | null | undefined): 'view' | 'comment' | 'edit' | null {
  if (!isProjectRole(role)) return null;
  if (can(role, 'edit')) return 'edit';
  if (can(role, 'comment')) return 'comment';
  return 'view';
}

/** The matrix as rows, STRONGEST first, for a docs table or an operator surface. */
export function matrixRows(): Array<{ role: ProjectRole } & Record<Capability, boolean>> {
  return [...ROLES].reverse().map((role) => ({ role, ...MATRIX[role] }));
}

// ---------------------------------------------------------------------------
// TWO VOCABULARIES, ONE BRIDGE — Cloud Phase 27.
//
// A self-hosted hub has ACCOUNT roles (`users.mjs`: 'admin' | 'member'); this
// file has PROJECT roles. They overlap on 'member', and that coincidence once
// made every admin's session read-only (`can('admin','edit')` → unknown →
// nothing). A string crossing a vocabulary boundary is TRANSLATED here.

/** Account roles a hub's user table can hold (mirrors `apps/hub/src/users.mjs`). */
export const ACCOUNT_ROLES = Object.freeze(['admin', 'member'] as const);

/**
 * The project role a role from EITHER vocabulary implies. A project role passes
 * through; `admin` → `owner`; anything else → null, which holds nothing.
 */
export function projectRoleForAccount(role: string | null | undefined): ProjectRole | null {
  if (isProjectRole(role)) return role;
  if (role === 'admin') return 'owner';
  return null;
}
