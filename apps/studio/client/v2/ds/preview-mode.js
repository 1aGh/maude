// client/v2/ds/preview-mode.js — S10.14: look at the project in another design system before deciding (13 · ds-many-switch).
//
//   ↑ ↓   step through the project's systems; every open canvas re-renders in the one stepped to
//   ↵     open the switch review for that system (ds-multi-switch)
//   esc   step back — every canvas renders in its own system again
//
// SESSION-ONLY by construction: the preview is a module variable and nothing else. It is never written to
// localStorage, sessionStorage, IndexedDB, a cookie, a file or the server — closing the window ends it, and no
// peer ever sees it. The only thing that leaves this module is the system's NAME, which the canvas URL carries as
// `?dsPreview=<ds>` (canvas-url.js, S10.4); the server answers that URL from the files already on disk.
// test/ds-preview-session-only.test.ts pins the absence of every storage and network call.

import { useSyncExternalStore } from 'react';

/** @type {{ from: string, names: string[], index: number } | null} */
let session = null;
const listeners = new Set();
const emit = () => {
  for (const fn of [...listeners]) fn();
};

/**
 * Start previewing. `systems` are the project's system names; the first one after `from` is where the
 * preview starts (the row's own system is one step too, so ↑ can come back to it). Fewer than two systems:
 * there is nothing to look at.
 * @param {{ from: string, systems: string[] }} p
 */
export function beginDsPreview({ from, systems }) {
  const names = [...new Set((systems ?? []).filter((n) => typeof n === 'string' && n))];
  if (names.length < 2) return null;
  const at = Math.max(0, names.indexOf(from));
  session = { from: names.includes(from) ? from : names[0], names, index: (at + 1) % names.length };
  emit();
  return getDsPreview();
}

/** Step to the next (+1) or previous (-1) system, wrapping. */
export function stepDsPreview(delta) {
  if (!session) return null;
  const n = session.names.length;
  session = { ...session, index: (((session.index + delta) % n) + n) % n };
  emit();
  return getDsPreview();
}

/** Jump to a named system (a click on a row of the preview menu). */
export function pickDsPreview(name) {
  if (!session) return null;
  const i = session.names.indexOf(name);
  if (i < 0) return getDsPreview();
  session = { ...session, index: i };
  emit();
  return getDsPreview();
}

export function stopDsPreview() {
  if (!session) return false;
  session = null;
  emit();
  return true;
}

/** @returns {{ from: string, names: string[], index: number, target: string } | null} */
export function getDsPreview() {
  return session ? { ...session, target: session.names[session.index] } : null;
}

export function subscribeDsPreview(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const targetSnapshot = () => (session ? session.names[session.index] : null);
const sessionSnapshot = () => session;
/** The whole session (`{ from, names, index, target }`) for the bar that draws it, or null. */
export function useDsPreview() {
  const s = useSyncExternalStore(subscribeDsPreview, sessionSnapshot, () => null);
  return s ? { ...s, target: s.names[s.index] } : null;
}

/** The system being previewed, or null — for the shell's frames, which rebuild their URL when it changes. */
export function useDsPreviewTarget() {
  return useSyncExternalStore(subscribeDsPreview, targetSnapshot, () => null);
}

/** The options a canvas URL is built with while previewing: the same options plus `dsPreview`. */
export function withDsPreview(opts, target) {
  if (!target) return opts;
  return { ...(opts ?? {}), dsPreview: target };
}

export const PREVIEW_WORDS = Object.freeze({
  banner: (from, to) => `Previewing ${from} in ${to}.`,
  shown: (n) =>
    n > 0 ? `${n} canvas${n === 1 ? '' : 'es'} shown in it · esc to stop` : 'esc to stop',
  action: 'Switch…',
  stop: 'Stop previewing',
  menuHead: 'Design systems',
  hint: '↑↓ to look · ↵ to switch · esc to stop',
  none: 'There is no other design system to preview.',
});

/** Test seam. */
export function resetDsPreview() {
  session = null;
  listeners.clear();
}
