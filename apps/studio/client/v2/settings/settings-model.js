// client/v2/settings/settings-model.js — V2-4.7a: Settings as a render model.
//
// PURE (no DOM, no React). Settings is one sheet with three sections — General · Connections ·
// Advanced (02 ob-settings, 06 ad-settings / ad-edge-hub) — and this file is the one table that says
// which row lives in which section, under which testid, and whether it exists in a browser tab.
// The rows test walks it against `nothing-deleted.json`, so a v1 setting cannot lose its home
// without a red test.
//
// A READ-ONLY session (a Can view / Can comment link or a cloud viewer, V2-4.9) gets Settings too, but only
// the part that is about the person: General's Look, Canvas and view, Layout (theme, Inspector words,
// panel positions — all kept in this browser). Connections and Advanced configure the Mac the project
// lives on, and the account row is about the Mac's owner, so a local read-only link has none of them.
//
// The shell flag (`cloud`) is tri-state and stays that way here: `undefined` = /_config has not
// answered, `null` = the desktop, an object = a cloud tab. Local-machine rows need `cloud === null`
// (never "not truthy"): a browser tab has no keychain, no ffmpeg and no whisper, and the routes behind
// them are refused in a cell by design (DDR-209 D1) — they are ABSENT there, not disabled.

export const SECTIONS = Object.freeze([
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'connections', label: 'Connections', icon: 'link', local: true },
  { id: 'advanced', label: 'Advanced', icon: 'more', local: true },
]);

export const SECTION_IDS = Object.freeze(SECTIONS.map((s) => s.id));
export const SETTINGS_TAB_STORE = 'mdcc-settings-tab-v2';

/**
 * Every row Settings carries that nothing-deleted.json knows by id (`nd`), plus the v1 settings that
 * have no ND row of their own (`nd: null`, kept reachable because "every today-setting has a row").
 * `testid` is the hook a person / scenario finds the control by; `where` is the path to follow.
 */
export const SETTINGS_ROWS = Object.freeze([
  // ── General ──────────────────────────────────────────────────────────────────────────────────
  {
    nd: 'A-light-dark-toggle',
    section: 'general',
    testid: 'settings-theme',
    action: 'settings.theme',
    where: 'Settings › General › Look › Theme (⌘K “Theme” toggles it)',
  },
  {
    nd: 'A-open-the-cloud-dashboard',
    section: 'general',
    testid: 'settings-open-dashboard',
    where: 'Settings › General › Account › Open the cloud dashboard',
    // The Mac's own account (a local project): a read-only link is somebody else's Mac, so it has none.
    // A cloud viewer keeps it — the hub told its tab where the dashboard is.
    account: true,
  },
  {
    nd: null,
    section: 'general',
    testid: 'settings-inspector-vocabulary',
    where: 'Settings › General › Look › Inspector words',
  },
  {
    nd: null,
    section: 'general',
    testid: 'settings-canvas-view',
    where: 'Settings › General › Canvas and view',
  },
  {
    // ND row A-panel-positions-left-right is V2-4.4's (home `view`); its text names “Settings › Layout”,
    // so the group keeps that name and the row keeps its own `where`.
    nd: null,
    section: 'general',
    testid: 'panel-side-<id>',
    where: 'Settings › General › Layout › Panel positions',
  },
  {
    // V2-4 gate (WCAG 2.1.4, a11y B8): one switch turns off every shortcut that is a single character key.
    nd: null,
    section: 'general',
    testid: 'settings-single-keys',
    where: 'Settings › General › Keyboard › Single-key shortcuts',
  },
  // ── Connections ──────────────────────────────────────────────────────────────────────────────
  {
    nd: 'A-cloud-account-email-and-sign-out',
    section: 'connections',
    testid: 'cloud-account',
    where: 'Settings › Connections › Maude Cloud (email, Sign out)',
    local: true,
  },
  {
    nd: 'A-sign-in-with-github',
    section: 'connections',
    testid: 'settings-github',
    where: 'Settings › Connections › GitHub › Sign in',
    local: true,
  },
  {
    nd: 'A-ai-provider-keys',
    section: 'connections',
    testid: 'settings-ai-keys',
    where: 'Settings › Connections › AI images, video and voice › Manage',
    local: true,
  },
  {
    nd: 'A-figma-token',
    section: 'connections',
    testid: 'figma-connect-card',
    where: 'Settings › Connections › Figma (token, Test connection, Remove)',
    local: true,
  },
  {
    nd: 'A-team-hub-address-and-access-token',
    section: 'connections',
    testid: 'settings-hub-address',
    where:
      'Settings › Connections › Maude Cloud › Advanced (address; the token stays in the keychain)',
    local: true,
  },
  {
    nd: 'A-your-team-s-own-server-email-password',
    section: 'connections',
    testid: 'settings-team-server-add',
    where: 'Settings › Connections › Your team’s own server › Add a team server…',
    local: true,
  },
  // ── Advanced ─────────────────────────────────────────────────────────────────────────────────
  {
    nd: 'A-app-version',
    section: 'advanced',
    testid: 'settings-app-version',
    where: 'Settings › Advanced › This Mac › Version',
    local: true,
  },
  {
    nd: 'A-update-banner-restart-now-later',
    section: 'advanced',
    testid: 'settings-update-restart',
    where:
      'Settings › Advanced › This Mac › Update (Restart now · Later) — the banner says the same',
    local: true,
  },
  {
    // G0-D D19: the native menu keeps Check for Updates…; the sheet carries the same check. Only in
    // the desktop app (`native`) — a browser tab on the desktop server has no updater.
    nd: 'D19',
    section: 'advanced',
    testid: 'settings-check-updates',
    where: 'Settings › Advanced › This Mac › Update › Check for updates',
    local: true,
    native: true,
  },
  {
    nd: 'A-server-build-name-maude-dev-srv',
    section: 'advanced',
    testid: 'settings-server-build',
    where: 'Settings › Advanced › This Mac › Server build',
    local: true,
  },
  {
    nd: 'A-where-keys-are-kept-keys-json',
    section: 'advanced',
    testid: 'settings-keys-store',
    where: 'Settings › Advanced › This Mac › Keys are kept in',
    local: true,
  },
  {
    nd: 'A-install-claude-code-automatically',
    section: 'advanced',
    testid: 'settings-claude-autosetup',
    where: 'Settings › Advanced › Claude Code › Install and sign in automatically',
    local: true,
  },
  {
    nd: 'A-draw-with-the-svg-agent-copies-design-draw',
    section: 'advanced',
    testid: 'settings-copy-draw',
    where: 'Settings › Advanced › Claude Code › Draw a mark with the SVG agent › Copy command',
    local: true,
  },
  {
    nd: 'A-brand-upload-copy-command',
    section: 'advanced',
    testid: 'settings-copy-brand',
    where: 'Settings › Advanced › Claude Code › Import a brand from the terminal › Copy command',
    local: true,
  },
  {
    nd: 'A-transcription-engine-and-whisper-model',
    section: 'advanced',
    testid: 'settings-transcription',
    where: 'Settings › Advanced › Engines › Subtitles (engine + whisper model)',
    local: true,
  },
  {
    nd: 'A-keyframe-engine-and-gemma-model',
    section: 'advanced',
    testid: 'settings-keyframes',
    where: 'Settings › Advanced › Engines › Video keyframes (engine + Gemma model)',
    local: true,
  },
  {
    nd: 'A-sync-project-files-propagate-deletions',
    section: 'advanced',
    testid: 'sync-setting-syncFiles',
    where: 'Settings › Advanced › This project › Sync project files · Propagate deletions',
    local: true,
  },
  {
    nd: 'A-sync-canvases-only-or-everything',
    section: 'advanced',
    testid: 'sync-setting-syncFiles',
    where: 'Settings › Advanced › This project › Sync project files (off = canvases only)',
    local: true,
  },
  {
    nd: 'A-first-link-conflicts-rule',
    section: 'advanced',
    testid: 'sync-setting-firstAnchor',
    where: 'Settings › Advanced › This project › When a folder first links',
    local: true,
  },
  {
    nd: 'A-hand-design-to-the-workspace',
    section: 'advanced',
    testid: 'sync-ownership-adopt',
    where: 'Settings › Advanced › This project › Who keeps .design/ › Hand over…',
    local: true,
  },
  {
    // V2-4.10 (06 ad-settings › Reset, ad-edge-remember): the Advanced folds are remembered per panel per
    // Mac; this folds them all again. Its ⌘K twin is "Close all Advanced sections" (view.advanced-close-all).
    nd: null,
    section: 'advanced',
    testid: 'settings-reset-folds',
    where: 'Settings › Advanced › Reset › Reset Advanced sections',
    local: true,
  },
]);

/** Which sections a shell offers. Local-machine sections need `cloud === null` and an owner's session
 *  (`!readOnly`, see the file head). */
export function sectionsFor(cloud, readOnly = false) {
  return SECTIONS.filter((s) => !s.local || (cloud === null && !readOnly));
}

/** Is a Settings row in this shell? The one rule the sheet, ⌘K and the parity table share. */
export function rowShown(row, { cloud = null, readOnly = false } = {}) {
  if (row.local && (cloud !== null || readOnly)) return false;
  if (row.account && cloud === null && readOnly) return false;
  return true;
}

/** The section to open on: an explicit one, else the remembered one — never one this shell lacks. */
export function resolveTab(cloud, initial, remembered, readOnly = false) {
  const ids = sectionsFor(cloud, readOnly).map((s) => s.id);
  if (initial && ids.includes(initial)) return initial;
  if (remembered && ids.includes(remembered)) return remembered;
  return 'general';
}

/** Roving focus over the section rail: arrows, Home, End. Returns the id to move to, or null. */
export function railTarget(ids, current, key) {
  if (ids.length === 0) return null;
  const i = Math.max(0, ids.indexOf(current));
  if (key === 'ArrowDown' || key === 'ArrowRight') return ids[(i + 1) % ids.length];
  if (key === 'ArrowUp' || key === 'ArrowLeft') return ids[(i - 1 + ids.length) % ids.length];
  if (key === 'Home') return ids[0];
  if (key === 'End') return ids[ids.length - 1];
  return null;
}

/** A hub URL → the host to say aloud; never a path or a query (it can carry an invite code). */
export function hostLabel(url) {
  try {
    return new URL(String(url)).host || String(url);
  } catch {
    return String(url ?? '');
  }
}
