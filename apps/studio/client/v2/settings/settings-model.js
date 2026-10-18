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

import {
  EXPERIMENTAL_TEAMS_PREF,
  OWN_PLUGIN_COPY_PREF,
  REPORT_LOGS_PREF,
} from './advanced-prefs.js';

export { EXPERIMENTAL_TEAMS_PREF, OWN_PLUGIN_COPY_PREF, REPORT_LOGS_PREF };

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
    // S11.13 (06 ad-settings › This Mac): "Bun 1.3.4 · built in" — the runtime that serves the project.
    nd: null,
    section: 'advanced',
    testid: 'settings-runtime',
    where: 'Settings › Advanced › This Mac › Runtime',
    local: true,
  },
  {
    // C34: display only. `location.port`; never an input (a port you edit is a port that fights the proxy).
    nd: null,
    section: 'advanced',
    testid: 'settings-server-port',
    where: 'Settings › Advanced › This Mac › Local server port',
    local: true,
  },
  {
    nd: null,
    section: 'advanced',
    testid: 'settings-plugins',
    where: 'Settings › Advanced › Claude Code › Plugins',
    local: true,
  },
  {
    // `MAUDE_NO_PLUGIN_BOOTSTRAP`, read at ACP spawn: prefs.json `ownPluginCopy`.
    nd: null,
    section: 'advanced',
    testid: 'settings-own-plugin-copy',
    action: 'settings.use-own-plugin-copy',
    where: 'Settings › Advanced › Claude Code › Use my own plugin copy',
    local: true,
  },
  {
    // C34: "N decisions · kgai" or "Not set up", from GET /_api/kg/summary.
    nd: null,
    section: 'advanced',
    testid: 'settings-decision-memory',
    where: 'Settings › Advanced › Decision memory',
    local: true,
  },
  {
    // D13: the policy the Report a bug dialog reads (prefs.json `reportLogs`).
    nd: null,
    section: 'advanced',
    testid: 'settings-report-logs',
    where: 'Settings › Advanced › Privacy › Logs in bug reports',
    local: true,
  },
  {
    // `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, set at ACP spawn: prefs.json `experimentalTeams`.
    nd: null,
    section: 'advanced',
    testid: 'settings-experimental-teams',
    action: 'settings.experimental-teams',
    where: 'Settings › Advanced › Experimental › AI reviews argue it out (teams)',
    local: true,
  },
  {
    nd: null,
    section: 'advanced',
    testid: 'settings-reset-panel-layout',
    action: 'settings.reset-panel-layout',
    where: 'Settings › Advanced › Reset › Reset panel layout',
    local: true,
  },
  {
    nd: null,
    section: 'advanced',
    testid: 'settings-reset-all',
    action: 'settings.reset-all',
    where: 'Settings › Advanced › Reset › Reset all settings…',
    local: true,
  },
  {
    // The per-fold switch list (ad-edge-remember): one switch per fold, `settings-fold-<id>`.
    nd: null,
    section: 'advanced',
    testid: 'settings-fold-<id>',
    where: 'Settings › Advanced › Reset › Open now, on this Mac',
    local: true,
  },
  {
    // V2-4.10 (06 ad-settings › Reset, ad-edge-remember): the Advanced folds are remembered per panel per
    // Mac; this folds them all again. Its ⌘K twin is "Close all Advanced sections" (view.advanced-close-all).
    nd: null,
    section: 'advanced',
    testid: 'settings-reset-folds',
    where: 'Settings › Advanced › Reset › Close all Advanced sections',
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

// ── S11.13 · Settings › Advanced (06 ad-settings, ad-edge-remember) ─────────────────────────────────

/**
 * C34 (decision `v2-S11-c34-unbuilt-rows-absent`): features Maude does not have get NO row — not a dead
 * switch, not a disabled one. 06 draws two of them; the gate test pins that neither is ever rendered.
 */
export const ABSENT_ROW_LABELS = Object.freeze([
  'Send anonymous usage data',
  'Faster canvas engine',
]);

/** "523 decisions · kgai" when the graph is active for the project, else "Not set up" (never a guess). */
export function decisionMemoryLine(summary) {
  if (!summary || summary.active !== true) return 'Not set up';
  const n = summary.decisions;
  if (!Number.isInteger(n) || n < 0) return 'Not set up';
  return `${n} ${n === 1 ? 'decision' : 'decisions'} · kgai`;
}

/** "Bun 1.3.4 · built in". An unanswered /_api/settings/about shows a dash, never a made-up version. */
export function runtimeLine(about) {
  const r = about && typeof about.runtime === 'string' ? about.runtime.trim() : '';
  return r ? `${r} · built in` : '—';
}

/** "design 2.0.0 · flow 2.0.0"; null when the bundle ships no plugin manifest (an npm layout). */
export function pluginsLine(about) {
  const list = Array.isArray(about?.plugins) ? about.plugins : [];
  const parts = list
    .filter((p) => p && typeof p.name === 'string' && typeof p.version === 'string')
    .map((p) => `${p.name} ${p.version}`);
  return parts.length ? parts.join(' · ') : null;
}

/** Privacy › Logs in bug reports. The Report a bug dialog reads `reportLogs`; absent = ask. */
export const REPORT_LOGS_CHOICES = Object.freeze([
  { id: 'ask', label: 'Ask each time' },
  { id: 'always', label: 'Always' },
  { id: 'never', label: 'Never' },
]);
export function reportLogsPolicy(prefs) {
  const v = prefs?.[REPORT_LOGS_PREF];
  return v === 'always' || v === 'never' ? v : 'ask';
}
/**
 * What Report a bug does with the policy (report-bug.jsx): `offer` = the log rows (server log
 * tail + memory, crash logs) are in the preview; `on` = they start ticked. Ask each time starts
 * them UNTICKED (the person opts in per report; decision v2-A6c-report-logs-never-hides), Always
 * starts them ticked (the person can still untick), Never offers no log row, so nothing of the
 * logs is sent.
 */
export function reportLogsConsent(policy) {
  if (policy === 'never') return { offer: false, on: false };
  return { offer: true, on: policy === 'always' };
}

/** What each fold is called in the per-fold switch list (06 ad-edge-remember "Open now, on this Mac"). */
export const FOLD_LABELS = Object.freeze({
  'left.canvases': 'Canvases › Advanced',
  'left.layers': 'Layers › Advanced',
  settings: 'Settings › Advanced',
  diagnostics: 'Menu › Diagnostics › Advanced',
  help: 'Keyboard shortcuts › Advanced',
  inspector: 'Inspector › Advanced',
  'ai.chat': 'AI chat list › Advanced',
  ai: 'AI chat panel › Advanced',
  history: 'Version history › Advanced',
  code: 'Code › Advanced',
  connections: 'Connections › Advanced',
  share: 'Share › Advanced',
  timeline: 'Timeline › Advanced',
  export: 'Export › Advanced',
  ds: 'Design system › Advanced',
});

/** The per-fold switch list: the panels that carry a fold, plus any id this Mac has remembered. */
export function foldRows(ids) {
  return [...new Set(ids)].map((id) => ({ id, label: FOLD_LABELS[id] ?? `${id} › Advanced` }));
}

/** Where a panel's moved to, and what Layers is, on a fresh Mac. */
export const PANEL_SIDE_DEFAULTS = Object.freeze({
  tree: 'left',
  layers: 'left',
  inspector: 'right',
  comments: 'right',
  changes: 'right',
  assistant: 'right',
});
export const LAYERS_MODE_DEFAULT = 'separate';

/**
 * Reset panel layout: panels back to their sides, Layers back to its own panel, floating (not pinned),
 * shown. Sizes stay: a width is the person's, not part of the layout. `calls` are the live handlers
 * (so the open window follows); `patch` is the same state on disk, in one write.
 */
export function resetPanelLayoutPlan({ panelSide = {}, layersMode } = {}) {
  const sideCalls = Object.entries(PANEL_SIDE_DEFAULTS).filter(
    ([id, side]) => (panelSide?.[id] ?? side) !== side
  );
  return {
    sideCalls,
    layersModeCall: layersMode && layersMode !== LAYERS_MODE_DEFAULT ? LAYERS_MODE_DEFAULT : null,
    patch: {
      panelSides: { ...PANEL_SIDE_DEFAULTS },
      layersMode: LAYERS_MODE_DEFAULT,
      pin: { on: false },
      panelsHidden: false,
    },
  };
}

/** The look a fresh Mac has (prefs.json 1.x defaults, mirrored from ui-prefs-migrate.ts V1_DEFAULTS). */
export const LOOK_DEFAULTS = Object.freeze({
  theme: 'dark',
  minimap: false,
  zoom: false,
  annotations: true,
  autoOpenInspector: true,
});

/**
 * Reset all settings: every preference of the person back to a fresh Mac's. NOT reset: keys and
 * sign-ins (Connections), this project's sync switches (they are the project's, not the person's),
 * and the "seen" markers (a reset does not replay the tour). `foldIds` are folded to their defaults.
 */
export function resetAllPlan(live = {}, foldIds = []) {
  const layout = resetPanelLayoutPlan({ panelSide: live.panelSide, layersMode: live.layersMode });
  const toggles = [];
  if (live.theme && live.theme !== LOOK_DEFAULTS.theme)
    toggles.push(['onSetTheme', LOOK_DEFAULTS.theme]);
  for (const [key, flag, handler] of [
    ['minimapVisible', 'minimap', 'onToggleMinimap'],
    ['zoomCtlVisible', 'zoom', 'onToggleZoomCtl'],
    ['annotationsVisible', 'annotations', 'onToggleAnnotations'],
    ['autoOpenInspector', 'autoOpenInspector', 'onToggleAutoOpenInspector'],
  ]) {
    if (typeof live[key] === 'boolean' && live[key] !== LOOK_DEFAULTS[flag])
      toggles.push([handler]);
  }
  return {
    ...layout,
    toggles,
    foldIds: [...new Set(foldIds)],
    patch: {
      ...layout.patch,
      theme: LOOK_DEFAULTS.theme,
      minimap: LOOK_DEFAULTS.minimap,
      zoom: LOOK_DEFAULTS.zoom,
      annotations: LOOK_DEFAULTS.annotations,
      autoOpenInspector: LOOK_DEFAULTS.autoOpenInspector,
      singleKeyShortcuts: true,
      canvases: { showHidden: false },
      [OWN_PLUGIN_COPY_PREF]: false,
      [EXPERIMENTAL_TEAMS_PREF]: false,
      [REPORT_LOGS_PREF]: 'ask',
    },
  };
}
