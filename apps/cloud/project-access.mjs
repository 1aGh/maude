// Who may open which project — Cloud Phase 22 Task 2 (DDR-204).
//
// The control plane is the identity provider, so this is where "may this
// person open this project" is answered. A cell never decides it; a cell
// verifies a token that says the question was already answered here.
//
// PURE, and that is load-bearing rather than tidy. This is the check that
// separates one customer's work from another's, and it has to be reviewable
// over every combination without a database, a session, or a running cell
// (DDR-196 §1).
//
// The token shape is IMPORTED from the hub side rather than re-declared, so
// the two ends agree by construction. Two carefully-written copies of a claim
// format is how a signature check starts passing on the wrong thing.
//
// The same goes for what a role MEANS: this module used to carry its own role
// list and capability table (with no `export` row) beside the cell's. Since
// S9.1 both come from THE matrix, `apps/studio/access/roles.ts` (V2-1.7 §5.2).

import { can as matrixCan, V1_ROLES } from '../studio/access/roles.ts';

/**
 * The roles the control plane STORES, weakest first: the matrix's pre-v2 roles.
 * D1 pins them (`project_members.role CHECK (role IN ('viewer','member','owner'))`,
 * migrate.mjs v4/v5), so `observer` (Can view) is offered and accepted here only
 * once the V2-1.7 §5.8 migration rebuilds those tables.
 */
export const ROLES = V1_ROLES;

/**
 * Decide access from facts, not from a query.
 *
 * @param {object} args
 * @param {string|null} args.accountId       who is asking (null = signed out)
 * @param {object|null} args.project         the project row, or null if absent
 * @param {{account_id: string, role: string}[]} [args.members]
 * @returns {{ok: true, role: string} | {ok: false, reason: string}}
 */
export function decideAccess({ accountId, project, members = [] }) {
  // Identical answer for "no such project" and "not yours". Distinguishing
  // them turns this into an oracle for which project ids exist, and project
  // ids are guessable — they are named after the work.
  if (!accountId) return { ok: false, reason: 'not-signed-in' };
  if (!project) return { ok: false, reason: 'no-access' };

  // A purged project is gone. Saying "no access" would suggest asking someone
  // for access, which is the one thing that cannot help.
  if (project.state === 'purged') return { ok: false, reason: 'purged' };

  if (project.account_id === accountId) return { ok: true, role: 'owner' };

  const member = members.find((m) => m.account_id === accountId);
  if (!member) return { ok: false, reason: 'no-access' };
  if (!ROLES.includes(member.role)) return { ok: false, reason: 'no-access' };

  // A suspended project is readable by its owner (who has to be able to
  // export and pay) but not by everyone else — a lapsed subscription should
  // not quietly keep a whole team working.
  if (project.state === 'suspended') return { ok: false, reason: 'suspended' };

  return { ok: true, role: member.role };
}

/** What the person is told. One sentence, and never our vocabulary. */
export const ACCESS_MESSAGES = {
  'not-signed-in': 'Sign in to open this project.',
  'no-access': 'This project is not available to your account.',
  purged: 'This project was deleted. If you exported it, that copy is still yours.',
  suspended: 'This project is paused. Its owner can restart it from the dashboard.',
};

/**
 * The control plane's words, translated at ONE boundary (decision
 * d_39bd12253f8ee17739312974) into the matrix capability that decides each.
 * `share` is inviting (links, people); `billing` sits with `delete` — the one
 * who pays for a project is the one who may delete it, its owner. Both are
 * project-only: a canvas grant never confers them (PROJECT_ONLY).
 */
const WORDS = Object.freeze({
  view: 'read',
  edit: 'edit',
  comment: 'comment',
  invite: 'invite',
  billing: 'delete',
  mirror: 'mirror',
  share: 'invite',
  delete: 'delete',
});

/**
 * Whether a role may do a thing — answered by the matrix, never a local table.
 * The interesting question is "what can a viewer NOT do"; `CAPABILITIES` is the
 * same answer as rows (word → stored roles holding it), derived, for a page.
 */
export function can(role, capability) {
  if (!Object.hasOwn(WORDS, capability) || !ROLES.includes(role)) return false;
  return matrixCan(role, WORDS[capability]);
}

export const CAPABILITIES = Object.freeze(
  Object.fromEntries(
    Object.keys(WORDS).map((word) => [word, Object.freeze(ROLES.filter((r) => can(r, word)))])
  )
);
