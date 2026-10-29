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
  // p8-update-fails-loud: a sign-in the team server turns down is said, with the way out — never an
  // Update button that can only fail. With no sign-in at all the role is unknown ('unknown'): Sign in.
  const hub = plan.project?.linked?.hub ?? '';
  if (codes.includes('token-rejected')) {
    return owner
      ? { kind: 'token-rejected', line: FAIL_COPY.olderTokenRejected, action: 'sign-in-again', hub }
      : { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (codes.includes('no-sign-in') && (plan.project?.linked?.role ?? 'unknown') === 'unknown') {
    return { kind: 'no-sign-in', line: FAIL_COPY.olderNotSignedIn, action: 'sign-in', hub };
  }
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
  // p8-update-fails-loud: the switch cannot run because the team server turned this Mac's sign-in
  // down — the owner is told so (the project keeps saving the old way and stays editable).
  if (
    plan &&
    !plan.error &&
    refusalCodes(plan).includes('token-rejected') &&
    ownsProject(plan.project?.linked?.role)
  ) {
    return {
      kind: 'save-mode-sign-in',
      line: FAIL_COPY.saveModeTokenRejected,
      action: 'sign-in-again',
      hub: plan.project?.linked?.hub ?? '',
    };
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

// ── p8-update-fails-loud (the alligators report, 2026-10-29: "Update project did nothing"). Every way
// the Update can fail ends in a worded state with the ONE action that helps — never a silent no-op and
// never the bare "was not updated". CONTRACT §4: what happened · what is safe · one verb; a retry is
// "Retry <name>", pressed by hand. The sign-in words are the Sync details card's ("Sign in again").

export const FAIL_COPY = {
  offline: "The project was not updated — the team server can't be reached. Nothing in it changed.",
  notSignedIn:
    "The project was not updated — this Mac isn't signed in to the team server. Nothing in it changed.",
  tokenRejected:
    "The project was not updated — the team server turned down this Mac's sign-in. Nothing in it changed.",
  hubTooOld:
    'The project was not updated — the team server needs an update first. Nothing in it changed.',
  oldServer:
    "The project was not updated — this needs Maude 2's server, and this window is still connected to an older one. Nothing in it changed. Restart Maude, then Update project.",
  unexpected: 'Something stopped the update. Nothing in the project changed.',
  switchTokenRejected:
    "The project still saves the old way — the team server turned down this Mac's sign-in. Nothing in it changed.",
  toastFormatOnlySignIn:
    "Updated for Maude 2, but it still saves the old way — the team server turned down this Mac's sign-in. Nothing is lost.",
  olderTokenRejected:
    "View only — the team server turned down this Mac's sign-in, so the project can't be updated yet.",
  olderNotSignedIn: "View only — this Mac isn't signed in to the team server for this project.",
  saveModeTokenRejected:
    "This project still saves the old way. The team server turned down this Mac's sign-in.",
  retry: 'Retry update',
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  close: 'Close',
};

/** The label of a failure's one action (null: none — the dialog offers only Close). */
export function failureActionLabel(action) {
  if (action === 'retry') return FAIL_COPY.retry;
  if (action === 'sign-in') return FAIL_COPY.signIn;
  if (action === 'sign-in-again') return FAIL_COPY.signInAgain;
  if (action === 'team-server') return OLDER_COPY.teamServerAction;
  return null;
}

const isReport = (r) => !!r && typeof r === 'object' && r.format === 'maude.migrate-report';
const hubOf = (report) => {
  const h = report?.project?.linked?.hub;
  return typeof h === 'string' && h ? h : '';
};
const refusalCodes = (report) => (report?.refusals ?? []).map((r) => r?.code).filter(Boolean);

/**
 * The dialog's state when an apply did not go through: { kind, line, action[, hub] }.
 *   { thrown: true }             — the request never got an answer
 *   { status, report }           — the route's status and its JSON (null when it was not JSON)
 * A 404 / 405, or a 200 that is no migrate report, is a server without the route: an older Maude
 * server behind a newer window (the auto-updater swapped the bundle under a running shell).
 */
export function applyFailureState({ status, report, thrown } = {}) {
  const unexpected = { kind: 'unexpected', line: FAIL_COPY.unexpected, action: 'retry' };
  if (thrown) return unexpected;
  if (status === 404 || status === 405 || (status === 200 && !isReport(report)))
    return { kind: 'old-server', line: FAIL_COPY.oldServer, action: null };
  if (status !== 409 || !isReport(report)) return unexpected;
  const codes = refusalCodes(report);
  const hub = hubOf(report);
  if (codes.includes('token-rejected'))
    return { kind: 'token-rejected', line: FAIL_COPY.tokenRejected, action: 'sign-in-again', hub };
  if (codes.includes('no-sign-in'))
    return { kind: 'no-sign-in', line: FAIL_COPY.notSignedIn, action: 'sign-in', hub };
  if (codes.includes('offline'))
    return { kind: 'offline', line: FAIL_COPY.offline, action: 'retry' };
  if (codes.includes('hub-too-old'))
    return { kind: 'hub-too-old', line: FAIL_COPY.hubTooOld, action: 'team-server' };
  if (codes.includes('not-owner'))
    return { kind: 'not-owner', line: applyFailureLine(report), action: null };
  if (!(report.refusals?.length || report.steps?.some((s) => s?.refusals?.length)))
    return unexpected;
  return { kind: 'refused', line: applyFailureLine(report), action: 'retry' };
}

/**
 * The whole answer of an apply: { done: true, toast[, action, hub] } or { done: false, kind, line,
 * action[, hub] }. A 200 is read by applyOutcome (the existing toasts); a switch the hub turned down
 * for the sign-in after the format moved keeps the format-only toast, with Sign in again.
 */
export function applyResult({ status, report, thrown } = {}) {
  if (thrown || status !== 200 || !isReport(report))
    return { done: false, ...applyFailureState({ status, report, thrown }) };
  const out = applyOutcome(report);
  const linked = report.project?.linked ?? null;
  const signInLost = linked?.modeError === 'token-rejected';
  if (out.done) {
    if (signInLost && out.toast === SAVE_COPY.toastFormatOnly)
      return {
        done: true,
        toast: FAIL_COPY.toastFormatOnlySignIn,
        action: 'sign-in-again',
        hub: hubOf(report),
      };
    return out;
  }
  if (out.error === SAVE_COPY.switchFailed) {
    return signInLost
      ? {
          done: false,
          kind: 'switch-token-rejected',
          line: FAIL_COPY.switchTokenRejected,
          action: 'sign-in-again',
          hub: hubOf(report),
        }
      : { done: false, kind: 'switch-failed', line: SAVE_COPY.switchFailed, action: 'retry' };
  }
  return { done: false, ...applyFailureState({ status: 409, report }) };
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
