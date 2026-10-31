// client/v2/shell/format-update.js — p8-v1-drop (Michal, decision maude/v2-michal-drop-v1-auto-convert): a
// format-1 project, or a linked one that still saves the old way, CONVERTS BY ITSELF when it opens — no
// opt-in dialog. Pure: what the shell says and whether it may convert now, from `/_config` and the
// migrator's DRY RUN (`POST /_api/project/migrate` without `apply` — read only; its refusal `code` names
// why this Mac cannot convert the project now, and `autoConvert` says whether the server lets it run
// unasked). Who converts: a local / git / Syncthing project always; a linked one when this Mac is the
// owner, signed in, online and the team server is ≥ 1.9.0 (`format-v2`). Anyone else gets ONE line with
// its action, and the conversion runs by itself once the reason clears. A Maude Cloud project never
// converts by itself during the rc (`autoConvert.allowed === false`): the owner may still convert it by
// hand, after a warning. The words are the contract's (CONTRACT §3–§4) and match `format.ts`
// FORMAT_COPY (test/format-update-model.test.ts).

/** CONTRACT §4 / V2-1.12 §5.8 — mirrors format.ts FORMAT_COPY (older-project half). */
export const OLDER_COPY = {
  olderStatus: 'View only — this project still uses Maude 1.',
  olderStatusAction: 'Update project',
  olderUpdating: 'Updating this project for Maude 2…',
  olderNonOwner:
    'View only — this project moves to Maude 2 once its owner opens it. Ask the owner.',
  /** rc.1 finding 1 (Michal A) — the role floor came from a hub record with no role (a 1.x `link --token`):
   *  the record does not say who this Mac is, so Sign in — never Ask the owner (r1-roleless-signin). */
  olderRoleless: (hub) =>
    `View only — this Mac's link to ${hub || 'the team server'} doesn't say who you are. Sign in, and if you own the project, it moves to Maude 2 by itself.`,
  /** gate-b-sec4 — the committed link was never made on this Mac (parked): Connect (r1-format-ds). */
  olderLinkUnconfirmed:
    "View only — this project says it syncs with a team server that isn't connected on this Mac. Connect it, and the project moves to Maude 2 by itself.",
  connectAction: 'Connect',
  olderHubTooOld:
    'View only — the team server needs an update before this project can move to Maude 2.',
  olderOwnerOffline:
    'View only — waiting for the connection to the team server. The project moves to Maude 2 by itself once it is back.',
  olderServerSetup:
    "View only — the team server isn't set up to save accepted revisions yet. Once it is, the project moves to Maude 2 by itself.",
  toastUpdated:
    'Updated for Maude 2. It now saves with accepted revisions. A copy of the old files is in Version history, on this Mac only.',
  cloudStatus:
    'View only — this Maude Cloud project still uses Maude 1. It moves to Maude 2 by itself once Maude Cloud runs Maude 2.',
  cloudDialogTitle: (projectName) => `Update "${projectName}" for Maude 2 now?`,
  cloudDialogBody:
    "Maude Cloud doesn't run Maude 2 yet. Until it does, the project's cloud tab is view only for everyone. Nothing in the project is lost.",
  teamServerAction: 'How to update',
  teamServerTitle: 'Update the team server',
  teamServerBody:
    'Whoever runs your team server updates it; the projects on it stay as they are. On the server, run the command below again — it keeps the settings and secrets and starts the new version on the same data. Maude Cloud team servers are already up to date. Once the server is updated, the project moves to Maude 2 by itself.',
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

/** A hub address as the callout names it: its host (`design.example`); '' when it does not parse. */
const hostOf = (url) => {
  try {
    return url ? new URL(url).host : '';
  } catch {
    return '';
  }
};

/** A hub role that may update (the hub's own bar: an owner of the whole project; `admin` is owner). */
const ownsProject = (role) => role === 'owner' || role === 'admin';

/** Is this an OLDER project this build opens view only (the v2 side of the gate)? */
export function isOlderGate(cfg) {
  const g = cfg?.formatGate;
  return !!g && g.projectFormat < g.supported;
}

/** The save-mode blockers the team server names (engine.ts SaveModeBlocker): its own setup, not this Mac. */
const SERVER_SETUP = new Set([
  'store-not-durable',
  'browser-not-paired',
  'mode-forbidden',
  'mode-unavailable',
]);

/** The dry run says this is a Maude Cloud project the server will not convert unasked (the rc). */
const cloudHeld = (plan) => plan?.autoConvert?.allowed === false;

/**
 * The refusal line for a dry run that names why this Mac cannot convert now; undefined when none does.
 * Shared by both triggers; `save` picks the words of the format-2 one (a project that still saves the
 * old way — view only since p8-v1-drop, so a non-owner is told too).
 */
function refusalState(plan, { save = false } = {}) {
  const codes = refusalCodes(plan);
  const owner = ownsProject(plan.project?.linked?.role);
  const hub = plan.project?.linked?.hub ?? '';
  const nonOwner = {
    kind: 'non-owner',
    line: save ? SAVE_COPY.nonOwner : OLDER_COPY.olderNonOwner,
    action: null,
  };
  // p8-update-fails-loud: a sign-in the team server turns down is said, with the way out. With no
  // sign-in at all the role is unknown ('unknown'): Sign in.
  if (codes.includes('token-rejected')) {
    if (!owner) return nonOwner;
    return save
      ? {
          kind: 'save-mode-sign-in',
          line: FAIL_COPY.saveModeTokenRejected,
          action: 'sign-in-again',
          hub,
        }
      : {
          kind: 'token-rejected',
          line: FAIL_COPY.olderTokenRejected,
          action: 'sign-in-again',
          hub,
        };
  }
  // gate-b-sec4: this Mac never made the committed link (parked) — the studio runs solo; the way out is
  // Connect, whatever this Mac holds for that hub (r1-format-ds).
  if (codes.includes('link-unconfirmed'))
    return {
      kind: 'link-unconfirmed',
      line: OLDER_COPY.olderLinkUnconfirmed,
      action: 'connect',
      hub,
    };
  if (codes.includes('no-sign-in') && (plan.project?.linked?.role ?? 'unknown') === 'unknown') {
    return { kind: 'no-sign-in', line: FAIL_COPY.olderNotSignedIn, action: 'sign-in', hub };
  }
  if (codes.includes('not-owner') || codes.includes('no-sign-in')) return nonOwner;
  if (codes.includes('hub-too-old'))
    return owner
      ? { kind: 'hub-too-old', line: OLDER_COPY.olderHubTooOld, action: 'team-server' }
      : nonOwner;
  if (codes.includes('offline'))
    return owner
      ? {
          kind: 'offline',
          line: save ? SAVE_COPY.offline : OLDER_COPY.olderOwnerOffline,
          action: null,
        }
      : nonOwner;
  const blocker = plan.project?.linked?.modeBlocker;
  if (codes.some((c) => SERVER_SETUP.has(c)) || SERVER_SETUP.has(blocker))
    return owner
      ? {
          kind: 'server-setup',
          line: save ? SAVE_COPY.serverSetup : OLDER_COPY.olderServerSetup,
          action: null,
        }
      : nonOwner;
  if (codes.length || (plan.refusals ?? []).length) {
    // another refusal (a file that does not load …): say what stopped it; a later probe checks again
    return { kind: 'refused', line: applyFailureLine(plan), action: null };
  }
  return undefined;
}
/**
 * The callout for an older project, or null when there is none.
 *   plan: undefined — not probed yet; { error } — the probe failed; else the dry-run report.
 * Returns { kind, line, action[, hub] }. kind 'ready' = this Mac may convert it now, unasked
 * (`autoStep`); 'cloud' = a Maude Cloud project during the rc — the owner may convert it by hand
 * (action 'update-cloud', after a warning).
 */
export function olderGateState({ cfg, plan }) {
  if (!isOlderGate(cfg)) return null;
  // A viewer stays a viewer after an update: the role names the reason, and the owner is who updates.
  if (cfg?.readOnlyReason === 'role') {
    // rc.1 finding 1 (Michal A): a hub record with no role keeps the floor, but it does not say who
    // this Mac is — the step is the team server's sign-in, which stores the role; an owner then
    // converts by itself (`/_config` stops saying 'role'). A role the hub vouched: Ask the owner.
    if (cfg.roleSource === 'missing') {
      const hub = cfg.linkedHub?.url ?? '';
      return {
        kind: 'roleless',
        line: OLDER_COPY.olderRoleless(hostOf(hub)),
        action: 'sign-in',
        hub,
      };
    }
    return { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (plan === undefined) return { kind: 'checking', line: OLDER_COPY.olderStatus, action: null };
  // A cloud cell's door refuses a non-owner's dry run (403 read-only): only the owner updates there.
  if (plan?.reason === 'read-only') {
    return { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  if (!plan || plan.error) return { kind: 'failed', line: FAIL_COPY.unexpected, action: 'retry' };
  // already converted, and `/_config` has not caught up yet: nothing to run
  if (plan.exitCode === AT_TARGET)
    return { kind: 'checking', line: OLDER_COPY.olderStatus, action: null };
  const refused = refusalState(plan);
  if (refused !== undefined) return refused;
  // A Maude Cloud project — the server says so, or this IS the cloud tab: never unasked during the rc.
  if (cloudHeld(plan) || cfg?.cloud) {
    const owner = cfg?.cloud ? ownsProject(cfg.cloud.role) : true;
    return owner
      ? { kind: 'cloud', line: OLDER_COPY.cloudStatus, action: 'update-cloud' }
      : { kind: 'non-owner', line: OLDER_COPY.olderNonOwner, action: null };
  }
  // Local or unlinked, or the owner of a linked project on a v2 hub: it converts now.
  return { kind: 'ready', line: OLDER_COPY.olderUpdating, action: null };
}

/** The timed re-check of a blocked project waits 1 min, then 2, 4, 8, and never more than 10 (p8-sec2-lows
 *  B2-3): every re-check is a dry run on the owner's own team server, so a reason that does not clear
 *  (browser not paired, server not set up) must not cost one a minute for as long as the tab is open. */
export const RECHECK_FIRST_MS = 60_000;
export const RECHECK_MAX_MS = 10 * 60_000;
export const recheckDelay = (misses) =>
  Math.min(RECHECK_FIRST_MS * 2 ** Math.max(0, Math.min(misses | 0, 10)), RECHECK_MAX_MS);

/** States the callout re-checks on its own (online / focus / a timer): the reason may clear. */
export const RECHECK_KINDS = new Set([
  'link-unconfirmed',
  'hub-too-old',
  'offline',
  'server-setup',
  'no-sign-in',
  'non-owner',
  'refused',
  'failed',
]);

// ── The second trigger (p8-update-to-accepted, Michal: decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`; automatic since p8-v1-drop). A LINKED
// format-2 project that still saves the old way (DDR-241 legacy shared documents) switches to accepted
// revisions by itself, owner only. Editing the old way is gone (p8-v1-drop): until the switch the
// project is VIEW ONLY (`/_config.formatGate.source === 'save-mode'`), so anyone else is told why. A
// cloud tab cannot run the switch from the studio (the cell has no owner credential for its own hub
// here): the owner is pointed to the dashboard's Saving page instead. CONTRACT §3–§4 voice: no "we"/"I",
// what happened · what is safe · one verb.

export const SAVE_COPY = {
  status: 'View only — this project still saves the old way.',
  updating: 'Switching this project to accepted revisions…',
  nonOwner:
    'View only — this project still saves the old way. It switches once its owner opens it. Ask the owner.',
  offline:
    'View only — this project still saves the old way. Waiting for the connection to the team server; it switches by itself once it is back.',
  serverSetup:
    "View only — this project still saves the old way, and the team server isn't set up to save accepted revisions yet. Once it is, the project switches by itself.",
  toastBoth: OLDER_COPY.toastUpdated,
  toastSwitched:
    'Updated. The project now saves with accepted revisions. A copy of the old files is in Version history, on this Mac only.',
  toastImporting:
    'Updated for Maude 2. It now saves with accepted revisions — the team server is still bringing changes in, and nothing is lost. A copy of the old files is in Version history, on this Mac only.',
  toastFormatOnly:
    'Updated for Maude 2, but it still saves the old way. Nothing is lost. A copy of the old files is in Version history, on this Mac only.',
  switchFailed: 'The project still saves the old way. Nothing in it changed.',
  cloudStatus:
    'View only — this project still saves the old way. Switch it in the dashboard, under Saving.',
  // p8-cell-copy: the OWNER of a project in a cloud tab whose server has no dashboard address (a
  // self-hosted workspace). Never "Ask the owner" — they are the owner; the switch runs when the owner
  // opens the project in the Maude app on a Mac (saveModeState, desktop branch).
  ownerElsewhere:
    'View only — this project still saves the old way. Open it in the Maude app on your Mac, and it switches by itself.',
  cloudAction: 'Open dashboard',
};

/** Is this a linked, format-2 project that still saves the old way (the second trigger)? */
export function isSaveModeOffer(cfg) {
  if (!cfg || isOlderGate(cfg)) return false;
  if (cfg.readOnlyReason === 'role') return false;
  // p8-v1-drop: the server gates such a project view only ('save-mode'); an older server still sends
  // the bare `saveMode` with no gate
  if (cfg.formatGate) return cfg.formatGate.source === 'save-mode';
  return cfg.saveMode === 'legacy';
}

/**
 * The callout for a format-2 project that still saves the old way, or null.
 *   cloud tab → the owner gets the dashboard pointer (no probe); anyone else the view-only line.
 *   desktop  → 'ready' (switch now, unasked) once the dry run says the switch is due, owner only;
 *              anyone else, or a reason it cannot run now, the line that says so.
 */
export function saveModeState({ cfg, plan }) {
  if (!isSaveModeOffer(cfg)) return null;
  const nonOwner = { kind: 'non-owner', line: SAVE_COPY.nonOwner, action: null };
  if (cfg.cloud) {
    // p8-fix-a F19 — the project's own Saving page when the cell knows its id; else the dashboard root
    const href = cfg.cloud.projectUrl
      ? `${String(cfg.cloud.projectUrl).replace(/\/+$/, '')}/saving`
      : cfg.cloud.dashboardUrl;
    if (!ownsProject(cfg.cloud.role)) return nonOwner;
    if (!href) return { kind: 'save-mode-owner', line: SAVE_COPY.ownerElsewhere, action: null };
    return { kind: 'save-mode-cloud', line: SAVE_COPY.cloudStatus, action: 'dashboard', href };
  }
  if (plan === undefined) return { kind: 'checking', line: SAVE_COPY.status, action: null };
  if (!plan || plan.error) return { kind: 'failed', line: FAIL_COPY.unexpected, action: 'retry' };
  if (plan.exitCode === AT_TARGET)
    return { kind: 'checking', line: SAVE_COPY.status, action: null };
  const refused = refusalState(plan, { save: true });
  if (refused !== undefined) return refused;
  const linked = plan.project?.linked;
  if (!ownsProject(linked?.role)) return nonOwner;
  if (!linked?.modeDue) return { kind: 'checking', line: SAVE_COPY.status, action: null };
  // the switch alone, on a Maude Cloud hub during the rc: nothing automatic, the dashboard owns it
  if (cloudHeld(plan)) return { kind: 'checking', line: SAVE_COPY.status, action: null };
  return { kind: 'ready', line: SAVE_COPY.updating, action: null };
}

// ── No retry loop (p8-v1-drop). A conversion this Mac tried and that did not go through is tried again
// only once the conditions CHANGE (a probe that comes back not-ready in between: offline → online, a
// sign-in, an updated team server) — never on the same answer — and at most AUTO_MAX times per app
// session. The guard lives in sessionStorage per project, so a reload of the window does not loop either.

export const AUTO_MAX = 3;

/** The guard's starting value. */
export const AUTO_FRESH = Object.freeze({ blocked: false, attempts: 0 });

/**
 * One step of the guard: given the guard, the state the latest probe gave and which trigger it is
 * ('format' — a format-1 project; 'save' — a format-2 one that still saves the old way), should the
 * shell convert now? Returns { apply, guard } — the guard to keep. A run that went through leaves the
 * guard blocked too: until `/_config` catches up the dry run may still read 'ready', and that is no
 * reason to run again. A different trigger (the format moved, the switch is still due) starts afresh.
 */
export function autoStep(guard, state, trigger = 'format') {
  let g = guard && typeof guard === 'object' ? guard : AUTO_FRESH;
  if (g.trigger && g.trigger !== trigger && state?.kind === 'ready') g = AUTO_FRESH;
  if (state?.kind !== 'ready') {
    // a probe in flight says nothing new; any other answer is a change of conditions
    if (!state || state.kind === 'checking') return { apply: false, guard: g };
    return { apply: false, guard: { ...g, blocked: false } };
  }
  if (g.blocked || g.attempts >= AUTO_MAX) return { apply: false, guard: g };
  return { apply: true, guard: { blocked: true, attempts: g.attempts + 1, trigger } };
}

/** The engine's exit code for "already there" (engine.ts EXIT.atTarget): `/_config` has not caught up. */
const AT_TARGET = 10;

/** After an apply: { done, toast } — or { done: false, error }. Honest about a switch that did not happen
 *  after the format moved (the engine reports it; the save-mode trigger then switches it by itself). */
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
    "The project was not updated — this needs Maude 2's server, and this window is still connected to an older one. Nothing in it changed. Restart Maude, and it updates by itself.",
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
  if (action === 'update-cloud') return OLDER_COPY.olderStatusAction;
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
