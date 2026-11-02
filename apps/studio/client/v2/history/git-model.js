// client/v2/history/git-model.js — S11.10: the model behind Version history › Advanced (06 · ad-history).
//
// Pure, no React, no fetch: what the fold SAYS and WHEN. The panel above it is versions only — no commit ids,
// no branch. Everything git lives one fold down, in plain words (CONTRACT §3–§4; the Advanced bodies are the
// one place the words lint lets "branch" and "git" through). This file retires `panels/GitPanel.jsx` (the
// Changes / History panel) and the branch half of `panels/RepoBranchSwitcher.jsx`: the capability stays, the
// words move here, and `GIT_ACTIONS` names the registry action and the route behind each button.
//
//   gitSurface(…)            what the fold shows for this role and posture ('full' · 'read-only' · … · 'hidden')
//   branchModel(…)           the Branch select: the shared line first, drafts newest-first, a teammate's marked
//   resumeDraft(…)           "Drafts › Continue": the draft you were last working on, offered from main
//   unsavedUnits(…)          "Not in a version yet": a canvas and its sidecars travel as one row (DDR-112)
//   changedLine / lineDiff   "Changed in this version": +14 −6 and the lines (client-side, from two versions)
//   commitFor(…)             the git id of the version being looked at (nearest commit at or after it)
//   outcomeBanner(…)         the result banner for Save / Publish / Get latest, port of the v1 panel's `run`
//   chatGuardCopy(…)         the words of the "a chat is working" confirm before a branch moves

import { baseName, buildUnits, supportLabel } from '../../panels/git-grouping.js';

export { baseName, supportLabel };

// ── words ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The fold's hint (06 · ad-history). */
export const GIT_HINT = 'Branch, git, changed files';

export const GIT_WORDS = {
  branch: 'Branch',
  drafts: 'Drafts',
  continueDraft: 'Continue',
  dismiss: 'Dismiss',
  remote: 'Remote',
  copy: 'Copy',
  copied: 'Copied',
  changedIn: 'Changed in this version',
  changedNone: 'Nothing changed in this version.',
  changedFirst: 'The first version — everything in it is new.',
  changedUnavailable: 'The changes in this version are not available here.',
  notYet: 'Not in a version yet',
  notYetNone: 'Everything is in a version.',
  discard: 'Discard',
  compareFile: 'Compare before and after',
  save: 'Save a version with a note…',
  newBranch: 'New branch…',
  fetch: 'Fetch',
  fetching: 'Fetching…',
  pullCopy: 'Pull a copy to this Mac…',
  getLatest: 'Get latest',
  gettingLatest: 'Getting the latest…',
  everyVersion: 'Every version, with its id',
  noVersions: 'No saved versions yet.',
  noVersionsCloud: 'The cloud is saving this project. Versions appear here as you work.',
  cloudVersions: 'Cloud versions',
  cloudSaving: 'Cloud is saving — changes sync automatically. Disconnect to commit locally.',
  readOnly: 'Saving and publishing are in your terminal here — this view is read-only.',
  notVersioned: 'Not versioned yet. Once it has versions, your changes show up here.',
  historyUnreachable: 'Couldn’t reach the cloud history.',
  historyUnreachableSub: 'Your work is still being saved — this is only the list of versions.',
  retry: 'Retry',
  loading: 'Loading…',
  preview: 'Preview',
  restore: 'Restore',
  restoring: 'Restoring…',
  undo: 'Undo',
  undoing: 'Undoing…',
  restored: 'Restored — a new version was added.',
  restoreFailed: 'The project did not accept the restore.',
  undone: 'Undone.',
  undoFailed: 'Someone changed this since — nothing was undone.',
  published: 'Published — your team can Get latest.',
  publishWaits: 'Publish waits until you are back online.',
  upToDate: 'Up to date with everyone.',
  saved: 'Version saved.',
  signIn: 'Sign in with GitHub to publish.',
  nobodyHere: 'No other drafts.',
  fromTeam: 'from your team, not downloaded yet',
  // dialogs — the title's verb is the primary button's (CONTRACT §4)
  saveTitle: 'Save a version',
  saveField: 'Describe what changed in this version',
  savePlaceholder: 'Describe what changed in this version…',
  saveAll: 'Save all',
  saveHint: 'Type a note and pick at least one file to save a version.',
  selectAll: 'Select all changed files',
  cancel: 'Cancel',
  newBranchTitle: 'Create a branch',
  newBranchField: 'Name your branch',
  newBranchPlaceholder: 'nav-redesign',
  newBranchCreate: 'Create branch',
  newBranchCreating: 'Creating…',
  newBranchHint: (shared) =>
    `A branch is your own line of work off what you’re looking at now. Add it to ${shared} when you’re happy, or throw it away — nothing else changes.`,
  addTitle: (shared) => `Add to ${shared}`,
  adding: 'Adding…',
  addBody: (name, shared) =>
    `Propose everything in “${name}” to ${shared} — the branch everyone shares.`,
  addMeta:
    'On a shared GitHub project this opens a pull request for review; a local project adds it directly. Nothing is lost — your work is kept in the versions.',
  prOpened: (n) => `Pull request opened${n ? ` #${n}` : ''}`,
  prBody: (name, shared, repo) =>
    `Your branch “${name}” is up as a pull request into ${shared}${repo ? ` of ${repo}` : ''}. Review and merge it on GitHub — that keeps your team’s review rules.`,
  prReview: 'Review on GitHub',
  prCopied: 'Link copied — paste in your browser',
  prClose: 'Close',
  prPublishedTitle: 'Branch published',
  prGotIt: 'Got it',
  prUnavailable: 'Branch published, but the pull request could not be opened.',
  switching: (name) => `Opening ${name}…`,
  downloading: (name) => `Downloading ${name}…`,
  merging: (name, shared) => `Adding ${name} → ${shared}…`,
  errSwitch: 'Could not switch.',
  errCreate: 'Could not create the branch.',
  errFetch: 'Could not fetch the remote branches.',
  errFetchTimeout: 'Couldn’t reach the remote — your branches are still listed.',
  errFetchAuth: 'Sign in with GitHub to fetch remote branches.',
  errAdd: 'Could not add the branch.',
  errGeneric: 'Something went wrong.',
};

/** Publish N versions — the number is what the git status counts ahead of the remote. */
export function publishLabel(unpushed) {
  const n = Number(unpushed) || 0;
  return n > 0 ? `Publish ${n} version${n === 1 ? '' : 's'}` : 'Publish';
}

/** "Add to main · opens a pull request" — a GitHub remote opens one; a local project adds it directly. */
export function addToSharedLabel({ shared = 'main', remote = '' } = {}) {
  const r = String(remote || '');
  if (!r) return `Add to ${shared}…`;
  return /github\.com/i.test(r) ? `Add to ${shared} · opens a pull request` : `Add to ${shared}`;
}

/** The remote as a person reads it: no scheme, no `.git`, no credentials. */
export function remoteLabel(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(s);
  const raw = scp ? `${scp[1]}/${scp[2]}` : s.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]*@/, '');
  return raw.replace(/\.git$/i, '').replace(/\/+$/, '');
}

// ── what the fold shows ────────────────────────────────────────────────────────────────────────────────────

const WRITES = new Set(['edit', 'owner']);

/**
 * @param p.role         'view' | 'comment' | 'edit' | 'owner'
 * @param p.native       the desktop app (a browser tab is the repo's companion: awareness only, DDR-119)
 * @param p.cellManaged  a cloud tab: the hub commits every edit as it lands (`cfg.cloud`)
 * @param p.cloudManaged a desktop repo linked + credentialed to Maude Cloud (DDR-218)
 * @param p.repo         `/_api/git/status` → `repo` (false = not versioned)
 * @param p.online       the network is up (default true). Offline, saving a version still works and
 *                       Publish waits for the internet (S11.15, 06 · ad-edge-where): `publishWaits`.
 * @returns { mode, canWrite, history, note, publishWaits }
 *   mode  'hidden'        Can comment / Can view — and the server refuses the writes whatever is drawn
 *         'cloud'         a cloud tab: "Cloud versions" only
 *         'cloud-saving'  a linked desktop repo: the note and the list, no buttons
 *         'not-versioned' no git here
 *         'read-only'     a browser tab: the changed files and the list, no buttons
 *         'full'          the whole fold
 */
export function gitSurface({
  role = 'view',
  native = false,
  cellManaged,
  cloudManaged,
  repo,
  online = true,
} = {}) {
  if (!WRITES.has(role)) return { mode: 'hidden', canWrite: false, history: false, note: null };
  if (cellManaged) return { mode: 'cloud', canWrite: false, history: true, note: null };
  if (cloudManaged)
    return { mode: 'cloud-saving', canWrite: false, history: true, note: GIT_WORDS.cloudSaving };
  if (repo === false)
    return { mode: 'not-versioned', canWrite: false, history: false, note: GIT_WORDS.notVersioned };
  if (!native)
    return { mode: 'read-only', canWrite: false, history: true, note: GIT_WORDS.readOnly };
  return { mode: 'full', canWrite: true, history: true, note: null, publishWaits: !online };
}

// ── branches ───────────────────────────────────────────────────────────────────────────────────────────────

export const SHARED = new Set(['main', 'master']);
export const isShared = (name) => SHARED.has(name);

/** A branch name from what was typed — the v1 rule, so an existing name round-trips. */
export function slugifyBranch(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A stable testid slug for a branch (`branch-row-<slug>`), as it always was. */
export function tid(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const byRecent = (a, b) =>
  (b.updatedAt || 0) - (a.updatedAt || 0) || String(a.name).localeCompare(String(b.name));

/**
 * @param p.branches   `/_api/git/branches` → `branches`: `{ name, current, updatedAt, where }`
 * @param p.branch     the branch HEAD is on (the live one from the git-status broadcast, else the status)
 * @returns { branch, shared, onShared, options, drafts }
 *   options  the Branch select: the shared line first, then drafts newest-first
 *   drafts   the local drafts other than the current branch
 */
export function branchModel({ branches = [], branch = 'main' } = {}) {
  const shared =
    branches.find((b) => isShared(b.name))?.name || (isShared(branch) ? branch : 'main');
  const others = branches.filter((b) => !isShared(b.name)).sort(byRecent);
  const rows = [
    { name: shared, where: 'both', shared: true },
    ...others.map((b) => ({ name: b.name, where: b.where || 'local', shared: false })),
  ];
  // The current branch is always in the list, even before the list has loaded.
  if (!rows.some((r) => r.name === branch))
    rows.push({ name: branch, where: 'local', shared: false });
  const options = rows.map((r) => ({
    ...r,
    current: r.name === branch,
    remoteOnly: r.where === 'remote',
    label: r.where === 'remote' ? `${r.name} (${GIT_WORDS.fromTeam})` : r.name,
  }));
  return {
    branch,
    shared,
    onShared: isShared(branch),
    options,
    drafts: others.filter((b) => b.name !== branch),
  };
}

/**
 * "Drafts › Continue": on the shared line with a draft you worked on, offer to go back to the newest local one.
 * Maude shows whatever HEAD is, so after an add or a Get latest you land on main — this saves the switch back.
 */
export function resumeDraft({ branches = [], onShared, dismissed, busy } = {}) {
  if (!onShared || dismissed || busy) return null;
  return (
    [...branches]
      .filter((b) => !isShared(b.name) && b.where !== 'remote')
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] ?? null
  );
}

/** "as of 3 min ago" for the last Fetch (`at` in unix seconds). */
export function relativeTime(at, nowMs = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.floor(nowMs / 1000) - at);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/**
 * The confirm before a branch moves under a running chat (D10). The wording is deliberately "is editing files
 * on this branch", NOT "this will stop it": the bridge outlives the reload now, so the turn keeps going into a
 * worktree that has moved — saying "will stop it" would be false in the reassuring direction.
 */
export function chatGuardCopy({ count, branch, verb }) {
  return {
    title: count > 1 ? `${count} chats are working right now` : 'A chat is working right now',
    body: `Claude is editing files on ${branch}. If you ${verb} now, those edits can land on the wrong branch — and Maude's History can't undo a cross-branch mix-up.`,
    meta: 'Safest is to wait for the chat to finish, or stop it yourself first.',
    confirm: 'Do it anyway',
    cancel: 'Wait',
  };
}

// ── "Not in a version yet" ─────────────────────────────────────────────────────────────────────────────────

export const KIND_OF = { modified: 'M', added: 'A', deleted: 'D', untracked: 'U' };
export const KIND_TITLE = { M: 'Modified', A: 'Added', D: 'Deleted', U: 'Untracked' };

/**
 * `/_api/git/status` files → rows. A canvas and its sidecars (layout, annotations) save and discard as ONE
 * unit (DDR-112); the row names the canvas and counts what travels with it.
 */
export function unsavedUnits(files = [], designRel = '.design') {
  const { canvasUnits, otherUnits } = buildUnits(files, designRel);
  return [...canvasUnits, ...otherUnits].map((u) => ({
    key: u.key,
    kind: u.kind,
    path: u.primary.path,
    name: baseName(u.primary.path),
    badge: KIND_OF[u.primary.status] ?? 'M',
    badgeTitle: KIND_TITLE[KIND_OF[u.primary.status] ?? 'M'],
    paths: [u.primary, ...u.supporting].map((m) => m.path),
    supporting: u.supporting.map((s) => ({
      path: s.path,
      label: supportLabel(s.path),
      badge: KIND_OF[s.status] ?? 'M',
    })),
    comparable: u.kind === 'canvas',
  }));
}

/** Which of the checked paths a Save would take, and whether it can go (a note and one file at least). */
export function saveState({ message = '', units = [], unchecked = new Set(), busy = null } = {}) {
  const paths = units.flatMap((u) => u.paths).filter((p) => !unchecked.has(p));
  return {
    paths,
    canSave: String(message).trim().length > 0 && paths.length > 0 && !busy,
    canSaveAll: String(message).trim().length > 0 && !busy,
  };
}

/** A unit's check state across its members. */
export function unitCheck(unit, unchecked) {
  const on = unit.paths.filter((p) => !unchecked.has(p)).length;
  return on === 0 ? 'none' : on === unit.paths.length ? 'all' : 'some';
}

/** The words of the discard confirm. */
export function discardConfirm(unit) {
  return unit.supporting.length
    ? `Discard your changes to “${unit.name}” and its supporting files? This can't be undone.`
    : `Discard your changes to “${unit.name}”? This can't be undone.`;
}

// ── "Changed in this version" ──────────────────────────────────────────────────────────────────────────────

export const shortSha = (sha) => String(sha || '').slice(0, 7);

/**
 * The git id of the version being looked at: the oldest commit made at or after it (a version is saved to git
 * a moment after it lands). `entries` are `/_api/git/log` rows, newest first. null when none can be named.
 */
export function commitFor(row, entries, slackMs = 2000) {
  const at = Number(row?.madeAt);
  if (!Number.isFinite(at) || !Array.isArray(entries)) return null;
  let best = null;
  let bestT = Infinity;
  for (const e of entries) {
    const t = Date.parse(e?.date);
    if (!Number.isFinite(t) || t < at - slackMs) continue;
    if (t < bestT) {
      best = e;
      bestT = t;
    }
  }
  return best;
}

const MAX_DIFF_LINES = 1200;

/**
 * Lines added and removed between two texts, and the changed lines (`+` / `−`, one line of context between
 * hunks left out). The common head and tail are trimmed first, so a one-line change in a long canvas is cheap;
 * a rewrite past the cap reports its sizes as approximate.
 * @returns { add, del, lines: { k: '+' | '-' | ' ', t: string }[], approx: boolean }
 */
export function lineDiff(before, after, { maxLines = 12 } = {}) {
  const a = before == null ? [] : String(before).split('\n');
  const b = after == null ? [] : String(after).split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  if (x.length > MAX_DIFF_LINES || y.length > MAX_DIFF_LINES)
    return { add: y.length, del: x.length, lines: [], approx: true };
  // LCS table over the changed middle only
  const n = x.length;
  const m = y.length;
  const w = m + 1;
  const t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i * w + j] =
        x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  let add = 0;
  let del = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      out.push({ k: ' ', t: x[i] });
      i++;
      j++;
    } else if (i < n && (j === m || t[(i + 1) * w + j] >= t[i * w + j + 1])) {
      out.push({ k: '-', t: x[i++] });
      del++;
    } else {
      out.push({ k: '+', t: y[j++] });
      add++;
    }
  }
  const changed = out.filter((l) => l.k !== ' ');
  return {
    add,
    del,
    lines: changed.slice(0, maxLines),
    approx: false,
    more: Math.max(0, changed.length - maxLines),
  };
}

/**
 * "Changed in this version" for the canvas: one file line (M, or A when this is its first version) with the
 * counts, and the changed lines. `before` is the version before it (null = none).
 */
export function changedLine({ path, before, after }) {
  const d = lineDiff(before, after);
  return {
    path,
    badge: before == null ? 'A' : 'M',
    add: d.add,
    del: d.del,
    approx: d.approx,
    lines: d.lines,
    more: d.more ?? 0,
  };
}

// ── history list ───────────────────────────────────────────────────────────────────────────────────────────

/** "5m ago" · "yesterday" · a date — the list's clock. */
export function timeAgo(iso, nowMs = Date.now()) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * `loadLog` entries → "Every version, with its id": a git commit reads "author · 7-char id", an accepted
 * revision "author · version 12" with Preview / Restore / Undo.
 */
export function versionRows(entries, nowMs = Date.now()) {
  return (entries ?? []).map((c) => {
    const accepted = c.accepted
      ? {
          revision: c.accepted.revision,
          actionId: c.accepted.actionId,
          mine: !!c.accepted.mine,
          undone: !!c.accepted.undo,
        }
      : null;
    return {
      key: c.sha,
      sha: c.sha,
      accepted,
      title: c.message || (accepted ? '(no description)' : '(no message)'),
      meta: accepted
        ? `${c.author} · version ${accepted.revision}`
        : `${c.author} · ${shortSha(c.sha)}`,
      when: timeAgo(c.date, nowMs),
    };
  });
}

// ── outcomes ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The banner for a finished Save / Publish / Get latest. `res` is what the server answered
 * (`{ ok, error?, authRequired?, conflict? }`); null = nothing to say (ok without a message).
 * A conflict while publishing asks for Get latest; a content conflict while getting it points at the window
 * that just opened; a protected branch points at the pull-request way in (DDR-162).
 */
export function outcomeBanner(kind, res, ok) {
  if (res?.ok) return ok ?? null;
  if (res?.authRequired) return { variant: 'info', text: res.error || GIT_WORDS.signIn };
  if (res?.conflict)
    return kind === 'getLatest'
      ? {
          variant: 'info',
          title: 'You both changed this',
          text: 'Pick what to keep in the window that just opened.',
        }
      : {
          variant: 'warn',
          title: "Publish didn't go through",
          text: 'The shared project moved on while you were working. Get the latest, then publish yours on top.',
          getLatest: true,
        };
  if (kind === 'publish' && /protected branch|GH006/i.test(res?.error || ''))
    return {
      variant: 'warn',
      title: 'This branch is protected',
      text: 'It needs a pull request. Switch to a branch, then use “Add to main” to open one.',
    };
  return { variant: 'error', text: res?.error || GIT_WORDS.errGeneric };
}

// ── actions ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The registry action behind each button and the route it calls — `/_api/git/*` is unchanged. `write` ones are
 * refused for Can comment / Can view by the server (access-role-matrix pins each), whatever the fold draws.
 */
export const GIT_ACTIONS = {
  'history.branch-switch': { method: 'POST', route: '/_api/git/checkout', write: true },
  'history.new-branch': { method: 'POST', route: '/_api/git/branch', write: true },
  // a fetch moves remote refs only — the matrix allows it for a viewer, so the fold hides it by role, not the server
  'history.fetch': { method: 'POST', route: '/_api/git/fetch', write: false },
  'history.publish': { method: 'POST', route: '/_api/git/push', write: true },
  'history.save-with-note': { method: 'POST', route: '/_api/git/commit', write: true },
  'history.open-pr': { method: 'POST', route: '/_api/git/fold', write: true },
  'history.discard-file': { method: 'POST', route: '/_api/git/discard', write: true },
  // "Continue" is a branch switch to the draft you were on: the same route, its own button
  'history.continue-draft': { method: 'POST', route: '/_api/git/checkout', write: true },
  'history.undo-action': { method: 'POST', route: '/_api/project/undo', write: true },
};
