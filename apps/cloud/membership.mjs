// Who is on a project, and what happens when they are removed.
// Cloud Phase 22 Task 5 (DDR-204). Pure decision module.
//
// REMOVAL IS THE HARD HALF. Adding somebody is a row. Removing somebody has to
// answer "and what about the access they already have", and that question used
// to have no good answer: membership was implied by who held a password on a
// particular cell, so removing a person meant reaching into their cell, and
// a session they had already opened kept working regardless.
//
// Now membership is a control-plane fact, so removal can be complete. But
// completeness has a shape worth stating: a project access token is verified
// OFFLINE by the cell (DDR-204 — a control-plane outage must not lock anyone
// out of their own work). Offline verification means a token cannot be
// recalled. So removal is only as fast as the token is short, and this module
// is where that trade is written down rather than discovered.

import { rankOf, V1_ROLES } from '../studio/access/roles.ts';

/**
 * Roles a person can hold here, weakest first — THE matrix's stored roles
 * (`apps/studio/access/roles.ts`, S9.1), not a local list. `observer` joins once
 * the D1 tables accept it (V2-1.7 §5.8).
 */
export const ROLES = V1_ROLES;

/**
 * Decide a membership change.
 *
 * @param {object} args
 * @param {string} args.actorRole        the asker's role on this project
 * @param {string} args.targetAccountId  who it is about
 * @param {string|null} args.targetRole   their current role, null if not a member
 * @param {string|null} args.newRole      the role to set, null to remove
 * @param {string} args.ownerId          the project's owner account
 */
export function decideMembershipChange({
  actorRole,
  targetAccountId,
  targetRole,
  newRole,
  ownerId,
}) {
  if (actorRole !== 'owner') {
    return {
      ok: false,
      reason: 'not-allowed',
      message: 'Only the project’s owner can change who has access.',
    };
  }

  // The owner cannot be removed or demoted through this path. Not because it
  // is unthinkable — transferring a project is a real thing people need — but
  // because doing it here would leave a project with nobody who can pay for
  // it or delete it, and recovering from that requires us. Transfer is its own
  // deliberate action.
  if (targetAccountId === ownerId) {
    return {
      ok: false,
      reason: 'owner-immutable',
      message:
        'The owner cannot be removed here. Transfer the project first if you are handing it over.',
    };
  }

  if (newRole === null) {
    if (!targetRole)
      return { ok: false, reason: 'not-a-member', message: 'That person is not on this project.' };
    return { ok: true, action: 'remove', revokeSessions: true };
  }

  if (!ROLES.includes(newRole)) {
    return { ok: false, reason: 'unknown-role', message: 'That is not a role.' };
  }
  if (newRole === 'owner') {
    return {
      ok: false,
      reason: 'owner-immutable',
      message: 'Making someone else the owner is a transfer, not a role change.',
    };
  }

  // A DEMOTION revokes too. Going from member to viewer removes the ability to
  // edit, and a session opened as a member still carries it — offline
  // verification cannot be told otherwise. Treating a demotion as "just an
  // update" would leave the person editing until their token expired.
  const demoted = targetRole ? rankOf(newRole) < rankOf(targetRole) : false;
  return {
    ok: true,
    action: targetRole ? 'change-role' : 'add',
    revokeSessions: demoted,
  };
}

/**
 * How long removal actually takes.
 *
 * Stated as a function because it is a PROMISE with a limit, and the limit is
 * the thing people need to hear. A cell verifies a token offline so that a
 * control-plane outage cannot lock anyone out of their own work; the price is
 * that an already-issued token cannot be recalled.
 *
 * Told plainly rather than hidden: "they are removed" implies immediacy, and
 * an admin who believes that and is wrong makes a decision they would not
 * otherwise make.
 */
export function removalEffect({ tokenTtlMs }) {
  const hours = Math.round(tokenTtlMs / 3_600_000);
  return {
    immediate: ['They can no longer open the project from the dashboard.'],
    delayed:
      hours <= 1
        ? 'If they already had the project open, that stops working within the hour.'
        : `If they already had the project open, that keeps working for up to ${hours} hours.`,
    // The honest escape hatch, offered rather than buried, because somebody
    // removing a person urgently needs to know it exists.
    ifUrgent:
      'If this is urgent, pause the project — that stops everyone immediately, ' +
      'including them, and you can restart it once they are gone.',
  };
}

/**
 * What the person doing the removing sees before they confirm.
 *
 * Names the human, not an id. An admin confirming a destructive action against
 * an opaque identifier is an admin who occasionally removes the wrong person.
 */
export function removalConfirmation({ email, projectName, tokenTtlMs }) {
  const effect = removalEffect({ tokenTtlMs });
  return {
    title: `Remove ${email} from ${projectName}?`,
    points: [...effect.immediate, effect.delayed],
    footnote: effect.ifUrgent,
    confirmLabel: 'Remove them',
  };
}
