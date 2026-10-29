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

// ── The second trigger (p8-update-to-accepted, Michal: decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`). The same Update also switches a LINKED
// project that still saves the old way (DDR-241 legacy shared documents) to accepted revisions — one extra
// step of the same banner, dialog and route, owner only. A format-2 project that is still legacy is not
// view only, so its offer is quieter: no auto-ask, a plain button. A cloud tab cannot run the switch from
// the studio (the cell has no owner credential for its own hub here): the owner is pointed to the
// dashboard's Saving page instead. CONTRACT §3–§4 voice: no "we"/"I", what happened · what is safe · one verb.

export const SAVE_COPY = {
  status: 'This project still saves the old way.',
  statusAction: 'Update project',
  dialogTitle: (projectName) => `Update how "${projectName}" saves?`,
  dialogBody:
    "Each change counts as saved once the team server confirms it, and Undo takes back only your own. Anyone with the project open switches over by themselves, and nothing in it is lost. People on Maude 1 older than 1.3 can look at it but can't save changes.",
  /** the second paragraph of the format-1 dialog when the switch comes with it */
  combinedBody:
    'It also starts saving with accepted revisions: each change counts as saved once the team server confirms it. Anyone with the project open switches over by themselves.',
  toastBoth:
    'Updated for Maude 2 and saving with accepted revisions. People on Maude 1 can look but not edit.',
  toastSwitched: 'Updated. The project now saves with accepted revisions.',
  toastImporting: 'Updated. The team server is still bringing changes in — nothing is lost.',
  toastFormatOnly:
    'Updated for Maude 2, but it still saves the old way. Nothing is lost — Update project again to finish.',
  switchFailed:
    'The project still saves the old way. Nothing in it changed — Update project again to switch.',
  cloudStatus: 'This project still saves the old way. Switch it in the dashboard, under Saving.',
  cloudAction: 'Open dashboard',
};

/** Is this a linked, editable, format-2 project that still saves the old way (the second trigger)? */
export function isSaveModeOffer(cfg) {
  if (!cfg || isOlderGate(cfg) || cfg.formatGate) return false;
  if (cfg.readOnlyReason === 'role') return false;
  return cfg.saveMode === 'legacy';
}

/**
 * The quiet callout for a format-2 project that still saves the old way, or null.
 *   cloud tab → the owner gets the dashboard pointer (no probe); anyone else nothing.
 *   desktop  → only once the dry run says the switch is due, and only for the owner.
 */
export function saveModeState({ cfg, plan }) {
  if (!isSaveModeOffer(cfg)) return null;
  if (cfg.cloud) {
    const href = cfg.cloud.dashboardUrl;
    if (!href || !ownsProject(cfg.cloud.role)) return null;
    return { kind: 'save-mode-cloud', line: SAVE_COPY.cloudStatus, action: 'dashboard', href };
  }
  if (!plan || plan.error || (plan.refusals ?? []).length) return null;
  const linked = plan.project?.linked;
  if (!linked?.modeDue || !ownsProject(linked.role)) return null;
  return { kind: 'save-mode', line: SAVE_COPY.status, action: 'update' };
}

/** The Update dialog's words: the format body, plus the switch when it comes along; or the switch alone. */
export function updateDialogCopy({ older, plan, name }) {
  const modeDue = plan?.project?.linked?.modeDue === true;
  if (older) {
    return {
      title: OLDER_COPY.dialogTitle(name),
      body: modeDue ? [OLDER_COPY.dialogBody, SAVE_COPY.combinedBody] : [OLDER_COPY.dialogBody],
      action: OLDER_COPY.dialogAction,
    };
  }
  return {
    title: SAVE_COPY.dialogTitle(name),
    body: [SAVE_COPY.dialogBody],
    action: SAVE_COPY.statusAction,
  };
}

/** After an apply: { done, toast } — or { done: false, error } for the dialog. Honest about a switch
 *  that did not happen after the format moved (the engine reports it; the next Update finishes it). */
export function applyOutcome(report) {
  if (report?.dryRun !== false || report.exitCode !== 0) {
    return { done: false, error: applyFailureLine(report) };
  }
  const linked = report.project?.linked ?? null;
  const formatMoved = (report.project?.formatBefore ?? 2) < 2;
  const due = linked?.modeDue === true;
  if (!due) return { done: true, toast: OLDER_COPY.toastUpdated };
  if (!linked.modeSwitched) {
    return formatMoved
      ? { done: true, toast: SAVE_COPY.toastFormatOnly }
      : { done: false, error: SAVE_COPY.switchFailed };
  }
  if (linked.modeImporting) return { done: true, toast: SAVE_COPY.toastImporting };
  return { done: true, toast: formatMoved ? SAVE_COPY.toastBoth : SAVE_COPY.toastSwitched };
}

/** The dialog's line when an apply did not go through (what happened · what is safe). */
export function applyFailureLine(report) {
  const first = [
    ...(report?.refusals ?? []),
    ...(report?.steps ?? []).flatMap((s) => s?.refusals ?? []),
  ][0];
  const why = first?.reason ? ` — ${first.reason}` : '';
  return `The project was not updated${why}. Nothing in it changed.`;
}
