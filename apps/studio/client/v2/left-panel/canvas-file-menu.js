// client/v2/left-panel/canvas-file-menu.js — S11.9: the Advanced group of a canvas row's menu (06 · ad-left,
// `ad-edge-where`), as data and as the functions that run it.
//
//   Reveal in Finder · Open in editor · View code · Copy file path · ──── · Rename file…
//
// The group is added only while Canvases › Advanced is open (the row menu stays seven calm words
// otherwise). Who sees what, per the 06 "where" table:
//
//   Mac app            Reveal in Finder, Open in editor (Can edit and up)
//   In the browser     those two swap for ONE row, "Open in the Mac app" — the file lives on a Mac, not here
//   Can comment        no Reveal / Open (the project folder is not theirs), View code and Copy file path stay
//   Can view           none of the group (source is a download, which View is not offered — V2-1.7)
//
// Hidden is not refused: the server still enforces `export` on the source (`GET /_api/canvas-source`) and
// Rust confines the two native doors. This is only what the menu draws.
//
// Pure but for the callbacks it is handed; the doors, the clipboard, the toast and the bus are injected.

import { projectRel } from '../shell/native-doors.js';

/** The Canvases panel's fold key in prefs.json `fold` (shared with canvases-advanced.jsx). */
export const CANVASES_FOLD = 'left.canvases';

/** Copy `text` to the clipboard; false when the browser refuses (a blocked clipboard is not an error). */
export async function copyText(text) {
  try {
    await globalThis.navigator?.clipboard?.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

/** The role names the group cares about, weakest first. */
const RANK = { view: 0, comment: 1, edit: 2, owner: 3 };
const atLeast = (role, min) => (RANK[role] ?? 0) >= RANK[min];

/** The role a panel without an explicit one runs as: an editor can edit, a read-only panel is the weakest. */
export function panelRole({ role = null, edit = true } = {}) {
  if (role && role in RANK) return role;
  return edit ? 'edit' : 'view';
}

/**
 * The rows the Advanced group adds to a canvas row's menu.
 *   role    'view' | 'comment' | 'edit' | 'owner'
 *   native  whether the Mac app's native doors exist on this page (`nativeDoors().available`)
 * @returns {{ id: string, label: string, sepBefore?: boolean, native?: boolean }[]}
 */
export function fileMenuItems({ role = 'edit', native = false } = {}) {
  const items = [];
  if (atLeast(role, 'edit')) {
    if (native) {
      items.push({ id: 'reveal', label: 'Reveal in Finder', native: true });
      items.push({ id: 'open-editor', label: 'Open in editor', native: true });
    } else {
      items.push({ id: 'open-mac-app', label: 'Open in the Mac app' });
    }
  }
  if (atLeast(role, 'comment')) {
    items.push({ id: 'view-code', label: 'View code' });
    items.push({ id: 'copy-path', label: 'Copy file path' });
  }
  if (atLeast(role, 'edit'))
    items.push({ id: 'rename-file', label: 'Rename file…', sepBefore: true });
  return items;
}

/** The project-relative path of a row (`.design/ui/Pricing.tsx`) — what the doors and Copy file path take. */
export function rowProjectPath(designRel, row) {
  return projectRel(designRel, row?.rel ?? '');
}

export const FILE_MENU_WORDS = Object.freeze({
  copied: 'File path copied.',
  copyFailed: 'Couldn’t copy the file path.',
  macApp: 'Open this project in the Mac app to work with its files.',
});

/**
 * Run one row of the group. Every dependency is injected:
 *   designRel, doors ({ revealPath, openInEditor }), write(text) → boolean, toast(msg),
 *   requestViewCode({ canvas }), startRename(key)
 * @returns {Promise<boolean>} whether the row did its thing (a refused door says why in a toast)
 */
export async function runFileMenuItem(id, row, io) {
  const { designRel, doors, write, toast, requestViewCode, startRename } = io;
  const say = (m) => toast?.(m);
  const path = rowProjectPath(designRel, row);
  if (id === 'view-code') {
    requestViewCode?.({ canvas: row.path });
    return true;
  }
  if (id === 'rename-file') {
    startRename?.(row.key);
    return true;
  }
  if (id === 'copy-path') {
    const ok = await Promise.resolve(write?.(path)).catch(() => false);
    say(ok ? FILE_MENU_WORDS.copied : FILE_MENU_WORDS.copyFailed);
    return !!ok;
  }
  if (id === 'open-mac-app') {
    say(FILE_MENU_WORDS.macApp);
    return false;
  }
  if (id === 'reveal' || id === 'open-editor') {
    const res = await (id === 'reveal' ? doors?.revealPath(path) : doors?.openInEditor(path));
    if (res?.ok) return true;
    // Rust answers in words ("That file isn't in this project."); a browser tab has no door at all
    say(res?.error || FILE_MENU_WORDS.macApp);
    return false;
  }
  return false;
}
