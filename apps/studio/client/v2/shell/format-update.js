// client/v2/shell/format-update.js — Michal 2A (2026-10-28): a format-1 project in v2 is view only and
// OFFERS "Update project" — one button, never on its own (decision maude/v2-michal-1a-2a-format-gate-one-
// button-migrate). Pure: what the view-only callout says and offers, from `/_config` and the migrator's
// DRY RUN (`POST /_api/project/migrate` without `apply` — read only; its refusal `code` names why this Mac
// cannot update the project now). The words are the contract's (CONTRACT §4, V2-1.12 §5.8) and match
// `format.ts` FORMAT_COPY (test/format-update-model.test.ts).

/** CONTRACT §4 / V2-1.12 §5.8 — mirrors format.ts FORMAT_COPY (older-project half). */
export const OLDER_COPY = {
  olderStatus: 'View only — this project still uses Maude 1.',
  olderStatusAction: 'Update project',
  olderNonOwner: "View only — the owner hasn't updated this project for Maude 2 yet.",
  olderHubTooOld:
    'View only — the team server needs an update before this project can move to Maude 2.',
  olderOwnerOffline:
    'View only — updating the project needs the team server, and this Mac is offline.',
  dialogTitle: (projectName) => `Update "${projectName}" for Maude 2?`,
  dialogBody:
    "People still on Maude 1 can look at it but can't change it until they update. Nothing in the project is lost.",
  dialogAction: 'Update project',
  toastUpdated: 'Updated for Maude 2. People on Maude 1 can look but not edit.',
  teamServerAction: 'How to update',
  teamServerTitle: 'Update the team server',
  teamServerBody:
    'Whoever runs your team server updates it; the projects on it stay as they are. On the server, run the command below again — it keeps the settings and secrets and starts the new version on the same data. Maude Cloud team servers are already up to date. Once the server is updated, Update project appears here.',
  teamServerCopy: 'Copy command',
  teamServerClose: 'Close',
};

/** The one command a self-hosted team server is updated with (`maude hub workspace-up`: re-running is
 *  the upgrade path — it reuses `.env`'s secrets and the data volume). Pinned to this app's release. */
export function teamServerCommand(version) {
  const v =
    typeof version === 'string' && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)
      ? version
      : 'latest';
  return `maude hub workspace-up --image-tag ${v}`;
}

/** A hub role that may update (the hub's own bar: an owner of the whole project; `admin` is owner). */
const ownsProject = (role) => role === 'owner' || role === 'admin';

/** Is this an OLDER project this build opens view only (the v2 side of the gate)? */
export function isOlderGate(cfg) {
  const g = cfg?.formatGate;
  return !!g && g.projectFormat < g.supported;
}

/**
 * The callout for an older project, or null when there is none.
 *   plan: undefined — not probed yet; { error } — the probe failed; else the dry-run report.
 * Returns { kind, line, action } with action 'update' | 'team-server' | null.
 */
export function olderGateState({ cfg, plan }) {
  if (!isOlderGate(cfg)) return null;
  // A viewer stays a viewer after an update: the role names the reason, and the owner is who updates.
  if (cfg?.readOnlyReason === 'role') {
    return { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (plan === undefined) return { kind: 'checking', line: OLDER_COPY.olderStatus, action: null };
  // A cloud cell's door refuses a non-owner's dry run (403 read-only): only the owner updates there.
  if (plan?.reason === 'read-only') {
    return { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (!plan || plan.error) return { kind: 'owner', line: OLDER_COPY.olderStatus, action: 'update' };
  const codes = (plan.refusals ?? []).map((r) => r?.code).filter(Boolean);
  const owner = ownsProject(plan.project?.linked?.role);
  if (codes.includes('not-owner') || codes.includes('no-sign-in')) {
    return { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (codes.includes('hub-too-old')) {
    return owner
      ? { kind: 'hub-too-old', line: OLDER_COPY.olderHubTooOld, action: 'team-server' }
      : { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (codes.includes('offline')) {
    return owner
      ? { kind: 'offline', line: OLDER_COPY.olderOwnerOffline, action: null }
      : { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  // Local or unlinked, or the owner of a linked project on a v2 hub (another refusal — a file that does
  // not load — still offers the button; the dialog then says what stopped it).
  return { kind: 'owner', line: OLDER_COPY.olderStatus, action: 'update' };
}

/** States the callout re-checks on its own (online / focus / a timer): the hub may come back or update. */
export const RECHECK_KINDS = new Set(['hub-too-old', 'offline']);

/** The dialog's line when an apply did not go through (what happened · what is safe). */
export function applyFailureLine(report) {
  const first = [
    ...(report?.refusals ?? []),
    ...(report?.steps ?? []).flatMap((s) => s?.refusals ?? []),
  ][0];
  const why = first?.reason ? ` — ${first.reason}` : '';
  return `The project was not updated${why}. Nothing in it changed.`;
}
