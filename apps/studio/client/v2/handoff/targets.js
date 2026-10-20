// client/v2/handoff/targets.js — S8.10: the words and small pure helpers of Handoff to production
// (09 Export · ex-handoff, ex-handoff-ready, ex-handoff-edges). The targets themselves come from the
// server (`GET /_api/handoff/targets`, handoff/targets.ts), which reads the project's settings.

export const HANDOFF_VERB = 'Hand off';

/** "Hand off “Pricing” to production" — the title verb is the button's (CONTRACT §3). */
export const handoffTitle = (name) => `${HANDOFF_VERB} “${name || 'this canvas'}” to production`;

/** The sheet's line under the title: the design system, when there is one. */
export const handoffSub = (ds) => (ds ? `${ds} design system` : '');

export const USE_DS_LABEL = 'Use the design system';
export const dsTokensSub = (ds) => `colours, type and spacing come from ${ds}’s tokens`;

export const LAST_USED = 'Last used';
export const ADVANCED_HINT = 'Targets, the command, the registry file';

export const NO_BLOCKERS = 'Last review: no blockers. AI takes about a minute — keep working.';
export const NOT_REVIEWED = 'AI takes about a minute — keep working.';
export const BLOCKERS_NOTE =
  'They go to the developer as notes with the code. Fix them first, or hand off now.';
export const SHOW_ON_CANVAS = 'Show on canvas';

/** "The last review found 2 blockers: a; b." */
export function blockersLine(blockers) {
  const n = blockers.length;
  const list = blockers.map((b) => String(b.what).replace(/[.\s]+$/, '')).join('; ');
  return `The last review found ${n} ${n === 1 ? 'blocker' : 'blockers'}: ${list}.`;
}

export const CONNECT_FINE =
  'After connecting, the handoff you asked for runs — no need to start again.';
export const DRAFTING = (name) =>
  `AI is drafting “${name}” — keep working. It lands in Exports when it’s done.`;
export const QUEUED_CAP =
  'Queued, like an AI prompt sent offline. It lands in Exports when it’s done.';
export const FAILED = 'AI stopped before the code was written. Hand off again to retry.';

/** The ready card's heading per kind (ex-handoff-ready). */
export function readyTitle(kind, name) {
  switch (kind) {
    case 'web':
      return `${name} is ready for developers`;
    case 'rn':
      return `${name} is ready as an app component`;
    case 'lottie':
      return `${name} is ready as an animation`;
    default:
      return `${name}’s tokens are ready`;
  }
}

export function readyBody(kind, { anyMachine } = {}) {
  switch (kind) {
    case 'web':
      return anyMachine
        ? 'One command adds it to the site, on any machine. People in this project can run it as is.'
        : 'One command adds it to a project on this Mac.';
    case 'rn':
      return 'One component, styled from the design system’s tokens.';
    case 'lottie':
      return 'Plays the same on the web and in the app.';
    default:
      return 'Colours, type and spacing as CSS variables.';
  }
}

export const ADVANCED_COUNT = {
  web: 'registry · commands',
  rn: 'file · command',
  lottie: 'file · snippet · command',
  tokens: 'file',
};

// ── Last used (a per-viewer convenience: browser storage, never project state) ─────────────────
const KEY = 'maude-handoff-last-target';

export function readLastUsed() {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeLastUsed(id) {
  try {
    globalThis.localStorage?.setItem(KEY, id);
  } catch {
    /* private window: nothing remembered */
  }
}

/** The target the sheet opens on: the one asked for, else the last used, else the first that is on. */
export function initialTarget(targets, { asked = null, last = null } = {}) {
  const on = targets.filter((t) => !t.off);
  const by = (id) => on.find((t) => t.id === id || t.kind === id);
  return (asked && by(asked)) || (last && by(last)) || on[0] || null;
}
