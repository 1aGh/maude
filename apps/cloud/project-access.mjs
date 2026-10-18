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

import { ROLES as MATRIX_ROLES, can as matrixCan } from '../studio/access/roles.ts';

/**
 * The roles the control plane STORES, weakest first: the matrix's roles. D1
 * v17 (migrate.mjs, V2-1.7 §5.8) rebuilt `project_members` to admit `observer`
 * (Can view), so S9.1's V1_ROLES stand-in is gone.
 */
export const ROLES = MATRIX_ROLES;

/**
 * Decide access from facts, not from a query.
 *
 * @param {object} args
 * @param {string|null} args.accountId       who is asking (null = signed out)
 * @param {object|null} args.project         the project row, or null if absent
 * @param {{account_id: string, role: string}[]} [args.members]
 * @param {number} [args.now]
 * @returns {{ok: true, role: string, paused?: true} | {ok: false, reason: string}}
 *
 * `paused` (A3, Maude v2 S9.15): the trial ended with no subscription. Everyone
 * who could open the project still can — reads and exports keep working; the
 * cell refuses writes and sync with 402 `plan` (`planRefusal`). The key is
 * present ONLY when true, so every unpaused answer is byte-identical to v1's.
 */
export function decideAccess({ accountId, project, members = [], now = Date.now() }) {
  // Identical answer for "no such project" and "not yours". Distinguishing
  // them turns this into an oracle for which project ids exist, and project
  // ids are guessable — they are named after the work.
  if (!accountId) return { ok: false, reason: 'not-signed-in' };
  if (!project) return { ok: false, reason: 'no-access' };

  // A purged project is gone. Saying "no access" would suggest asking someone
  // for access, which is the one thing that cannot help.
  if (project.state === 'purged') return { ok: false, reason: 'purged' };

  const paused = planState(project, { now }) === 'paused' ? { paused: true } : {};

  if (project.account_id === accountId) return { ok: true, role: 'owner', ...paused };

  const member = members.find((m) => m.account_id === accountId);
  if (!member) return { ok: false, reason: 'no-access' };
  if (!ROLES.includes(member.role)) return { ok: false, reason: 'no-access' };

  // A suspended project is readable by its owner (who has to be able to
  // export and pay) but not by everyone else — a lapsed subscription should
  // not quietly keep a whole team working.
  if (project.state === 'suspended') return { ok: false, reason: 'suspended' };

  return { ok: true, role: member.role, ...paused };
}

/**
 * Where a project stands on its plan (A3). Pure.
 *
 *  - `paid`   — a subscription is on the row (Checkout, or Choose a plan);
 *  - `trial`  — provisioned under the account's trial, still inside it;
 *  - `paused` — that trial is over and no plan was chosen;
 *  - `none`   — not a trial project and no subscription: a pending checkout,
 *    a hand-provisioned pilot, a legacy row. NEVER paused by this — the trial
 *    clock is not a way to stop a project that was never on it.
 *
 * The contract's "decideAccess marks every project the account owns paused"
 * reads as this: with one trial workspace per address, every unpaid project an
 * account owns past its trial is its trial project.
 */
export function planState(project, { now = Date.now() } = {}) {
  if (!project) return 'none';
  if (project.subscription_id) return 'paid';
  const endsAt = project.trial_ends_at ?? null;
  if (endsAt === null) return 'none';
  return now >= endsAt ? 'paused' : 'trial';
}

/**
 * The cell's answer to a write on a paused project (S9-slices Q11). 402, not
 * 403: a v2 client shows the plan callout on it and never renews credentials.
 * Only the owner — the one who can choose a plan — is told to; everyone else
 * hears that editing is paused, and nothing about billing.
 */
export function planRefusal(role) {
  return {
    status: 402,
    body: {
      reason: 'plan',
      error: role === 'owner' ? ACCESS_MESSAGES.plan : ACCESS_MESSAGES.paused,
    },
  };
}

/** What the person is told. One sentence, and never our vocabulary. */
export const ACCESS_MESSAGES = {
  'not-signed-in': 'Sign in to open this project.',
  'no-access': 'This project is not available to your account.',
  purged: 'This project was deleted. If you exported it, that copy is still yours.',
  suspended: 'This project is paused. Its owner can restart it from the dashboard.',
  // A3 (S9.15) — the owner's sentence is the contract's; the hub's
  // access-gate.mjs carries the same two strings (a test pins each side).
  plan: 'Choose a plan to keep editing.',
  paused: 'Editing is paused for this project. Its owner can turn it back on.',
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
