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

/** @type {{ from: string, names: string[], index: number, menuOpen: boolean } | null} */
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
  session = {
    from: names.includes(from) ? from : names[0],
    names,
    index: (at + 1) % names.length,
    menuOpen: true,
  };
  emit();
  return getDsPreview();
}

/**
 * The systems menu goes away (a click outside it, a click into the canvas iframe) but the preview stays: the
 * banner is still up with "Switch…" and "esc to stop". Only esc, or a switch, ends the preview itself.
 */
export function hideDsPreviewMenu() {
  if (!session || session.menuOpen === false) return false;
  session = { ...session, menuOpen: false };
  emit();
  return true;
}

export function showDsPreviewMenu() {
  if (session?.menuOpen !== false) return false;
  session = { ...session, menuOpen: true };
  emit();
  return true;
}

/**
 * "Preview in …" asked for from a system's row. The same row asking again is a toggle (13 · ds-many-switch):
 * menu open → stop; menu hidden → bring it back; another row, or no preview yet → start from that row.
 * @param {{ from: string, systems: string[] }} p
 * @returns {'started' | 'stopped' | 'shown' | 'none'}
 */
export function requestPreviewMenu({ from, systems }) {
  if (session && session.from === from) {
    if (session.menuOpen !== false) {
      stopDsPreview();
      return 'stopped';
    }
    showDsPreviewMenu();
    return 'shown';
  }
  return beginDsPreview({ from, systems }) ? 'started' : 'none';
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

/** @returns {{ from: string, names: string[], index: number, menuOpen: boolean, target: string } | null} */
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
  menuHead: 'Design systems',
  // what the menu says beside a system. The panel's "2 in use" counts systems that ANY canvas uses; the menu is
  // about the open canvas, so it says that, and names the default the way the panel's "Default" means it.
  usedByCanvas: 'used by this canvas',
  defaultForNew: 'default for new canvases',
  previewing: 'previewing',
  // the menu's foot (13 · ds-many-switch): the way out to the Design system, and to making / linking another
  doors: Object.freeze([
    Object.freeze({ id: 'open', label: 'Open the Design system', key: '↵' }),
    Object.freeze({ id: 'make', label: 'Make a design system…', key: '' }),
    Object.freeze({ id: 'link', label: 'Link a team library…', key: '' }),
  ]),
  // why a door is greyed (never a dead row): the person's role, or no runner for the action in this window
  doorViewOnly: 'You can view this project. Ask a project owner for edit access.',
  doorUnavailable: 'Not available here.',
  hint: '↑↓ to look · ↵ to switch · esc to stop',
  none: 'There is no other design system to preview.',
});

/** Test seam. */
export function resetDsPreview() {
  session = null;
  listeners.clear();
}
