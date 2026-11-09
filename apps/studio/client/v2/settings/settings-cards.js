// client/v2/settings/settings-cards.js — 2.1.1 T6: Settings as one column of expandable cards (canvas 17,
// artboards 08 · 10 · 11). PURE (no DOM, no React).
//
// Every tab is one column of cards — today's Connections row made expandable: icon · title · one line ·
// a status line that says what is set, an action that fixes it in one click, a chevron that opens it.
// One card is open per tab; which one is remembered per tab for this session (sessionStorage — a
// window you reopen tomorrow starts on the defaults again). The cards a tab carries, their default,
// and the one-line summaries live here so the sheet, ⌘K and the tests read one table.

import { PANEL_SIDE_DEFAULTS, LAYERS_MODE_DEFAULT } from './settings-model.js';

/** The cards per tab, in the order the column draws them (08 · 10 · 11). */
export const CARDS = Object.freeze({
  general: Object.freeze([
    'this-project',
    'look',
    'canvas',
    'terminal',
    'keyboard',
    'layout',
    // a cloud tab has no This project card: the account the hub signed it in as is its own card
    'account',
  ]),
  connections: Object.freeze(['claude', 'figma', 'github', 'ai']),
  advanced: Object.freeze([
    'spend',
    'this-mac',
    'claude-code',
    'decision-memory',
    'engines',
    'privacy',
    'experimental',
    'reset',
  ]),
});

/** The card a tab opens on before the person picked one (08 This project · 10 Claude · 11 This Mac). */
export const DEFAULT_OPEN = Object.freeze({
  general: 'this-project',
  connections: 'claude',
  advanced: 'this-mac',
});

export const CARD_STORE = 'maude-settings-card-v1';

function storage(store) {
  if (store !== undefined) return store;
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** The open card per tab this session: `{ general: 'look', advanced: null, … }` (null = all closed). */
export function readOpenCards(store) {
  const s = storage(store);
  try {
    const v = JSON.parse(s?.getItem(CARD_STORE) ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Which card of `tab` is open: the remembered one (or none, when the person closed it), else the default. */
export function openCardOf(tab, remembered = {}) {
  const ids = CARDS[tab] ?? [];
  if (Object.hasOwn(remembered, tab)) {
    const v = remembered[tab];
    return v === null || ids.includes(v) ? v : (DEFAULT_OPEN[tab] ?? null);
  }
  return DEFAULT_OPEN[tab] ?? null;
}

/** A click on a card's header: open it (closing the tab's other one), or close it when it was open. */
export function toggleCard(current, id) {
  return current === id ? null : id;
}

export function writeOpenCard(tab, id, store) {
  const s = storage(store);
  try {
    s?.setItem(CARD_STORE, JSON.stringify({ ...readOpenCards(s), [tab]: id }));
  } catch {
    /* private mode — the choice just isn't remembered */
  }
}

/**
 * ⌘K's Settings result → what the sheet opens on: `"general#look"` (the tab, then the card that holds the
 * row). A plain `"advanced"` (the menu's own Settings…, an older caller) opens the tab alone.
 */
export function settingsTarget(section, row) {
  return row?.card ? `${section}#${row.card}` : section;
}
export function parseSettingsTarget(target) {
  if (typeof target !== 'string' || !target) return { tab: undefined, card: null };
  const [tab, card] = target.split('#');
  return { tab: tab || undefined, card: card && (CARDS[tab] ?? []).includes(card) ? card : null };
}

// ── the closed card says what is set (08 · 11) ─────────────────────────────────────────────────

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function andList(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

/** Look: "Dark" · "Light" · "Auto — matches your computer". */
export function lookSummary(theme, auto = false) {
  if (auto) return 'Auto — matches your computer';
  return theme === 'light' ? 'Light' : 'Dark';
}

/** Canvas and view: "Zoom controls and annotations on · minimap off". */
export function canvasSummary({ minimap, zoom, annotations, autoInspector } = {}) {
  const flags = [
    ['minimap', minimap],
    ['zoom controls', zoom],
    ['annotations', annotations],
    ['auto-open Inspector', autoInspector],
  ];
  const on = flags.filter(([, v]) => v === true).map(([k]) => k);
  const off = flags.filter(([, v]) => v === false).map(([k]) => k);
  const parts = [];
  if (on.length) parts.push(`${andList(on)} on`);
  if (off.length) parts.push(`${andList(off)} off`);
  return parts.length ? cap(parts.join(' · ')) : '—';
}

/** Terminal (#206): what the terminal does with a project. */
export function terminalSummary(opens) {
  return opens === false ? 'Uses its own hidden server' : 'Opens projects in Maude';
}

/** Keyboard: the one switch. */
export function keyboardSummary(singleKeys) {
  return singleKeys === false ? 'Single-key shortcuts off' : 'Single-key shortcuts on';
}

/** Layout: "Panels in their usual places", or what moved. */
export function layoutSummary(panelSide = {}, layersMode = LAYERS_MODE_DEFAULT) {
  const moved = Object.entries(PANEL_SIDE_DEFAULTS).filter(
    ([id, side]) => (panelSide?.[id] ?? side) !== side
  ).length;
  const parts = [];
  if (moved) parts.push(`${moved} ${moved === 1 ? 'panel' : 'panels'} moved`);
  if (layersMode && layersMode !== LAYERS_MODE_DEFAULT) parts.push('Layers inside the Inspector');
  return parts.length ? parts.join(' · ') : 'Panels in their usual places';
}

const money = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2).replace(/0$/, '')}`;
};

/** Generation spend: "Stops at $5 a session and $20 a day · asks before a job over $2". */
export function spendSummary({ perRun, perDay, confirmOver } = {}) {
  const ask =
    Number(confirmOver) === 0 ? 'asks before every job' : `asks before a job over ${money(confirmOver)}`;
  return `Stops at ${money(perRun)} a session and ${money(perDay)} a day · ${ask}`;
}

/** This Mac: "Maude 2.1.1 · port 4402 · keys in the macOS Keychain" (an update ready says so first). */
export function thisMacSummary({ version, port, update } = {}) {
  const parts = [];
  if (update) parts.push(update.version ? `${update.version} is ready` : 'An update is ready');
  parts.push(`Maude ${version}`);
  if (port) parts.push(`port ${port}`);
  parts.push('keys in the macOS Keychain');
  return parts.join(' · ');
}

/** Claude Code: "design 2.1.1 · flow 2.1.1 · installs by itself". */
export function claudeCodeSummary({ plugins, ownCopy = false, autoSetup = true } = {}) {
  const which = ownCopy ? 'your own plugin copy' : (plugins ?? 'from your own install');
  return `${which} · ${autoSetup === false ? 'shows the install command' : 'installs by itself'}`;
}

/** Engines: what subtitles and keyframes run on (the saved engine names, Auto when none is saved). */
const SUBTITLE_WORDS = {
  auto: 'Auto',
  whisper: 'on this Mac',
  elevenlabs: 'by ElevenLabs',
  groq: 'by Groq',
};
const KEYFRAME_WORDS = {
  auto: 'Auto',
  gemma: 'on this Mac',
  ffmpeg: 'by ffmpeg',
  blind: 'evenly spaced',
};
export function enginesSummary(prefs) {
  if (!prefs || typeof prefs !== 'object') return 'Auto picks for you';
  const sub = SUBTITLE_WORDS[prefs.transcriptionProvider] ?? 'Auto';
  const key = KEYFRAME_WORDS[prefs.keyframeEngine] ?? 'Auto';
  if (sub === 'Auto' && key === 'Auto') return 'Auto picks for you';
  return `Subtitles ${sub === 'Auto' ? 'Auto' : sub} · keyframes ${key === 'Auto' ? 'Auto' : key}`;
}

/** Privacy: "No usage data · asks before adding logs to a bug report". */
export function privacySummary(policy) {
  const logs =
    policy === 'always'
      ? 'adds logs to bug reports'
      : policy === 'never'
        ? 'never adds logs to a bug report'
        : 'asks before adding logs to a bug report';
  return `No usage data · ${logs}`;
}

/** Experimental: "1 preview, off". */
export function experimentalSummary(teamsOn) {
  return `1 preview, ${teamsOn ? 'on' : 'off'}`;
}
