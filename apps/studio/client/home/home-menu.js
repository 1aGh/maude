// client/home/home-menu.js — the Home pill's menu (CONTRACT §1 "the one menu", P8-C8 / 02 ob-edge-whats-new).
//
// Home wears the SAME pill as a project ("Home ⌄", ProjectPill) and the same registry rows — labels, keys
// and visibility are the registry's, never typed here. What differs is the tree: Home has no canvas, so
// only the rows Home can run are offered (a row that opens a dialog Home does not have would be a dead
// end). Menu › Help › What's new is the one that was unreachable here: the pill was a bare <span>.
//
// PURE (no DOM, no React).

import { menuCtx } from '../v2/shell/project-menu-model.js';

/** The tree, as `PROJECT_MENU`'s own node shape (actions/menu.ts). */
export const HOME_MENU = Object.freeze([
  {
    submenu: 'File',
    items: [{ id: 'canvas.new' }, { id: 'project.new' }, { id: 'project.open' }],
  },
  {
    submenu: 'Help',
    items: [{ id: 'help.whats-new' }],
  },
]);

/** The ids Home's runner must answer — one entry per row of HOME_MENU. */
export const HOME_MENU_IDS = Object.freeze([
  'canvas.new',
  'project.new',
  'project.open',
  'help.whats-new',
]);

/** KeyCtx for Home: the desktop shell with no canvas open (`shell: 'home'` is a registry shell, but the
 *  rows' predicates are the desktop's — ⌘N / ⇧⌘N / ⌘O are desktop keys). */
export function homeMenuCtx({ native = false, online = true } = {}) {
  return menuCtx({ native, online });
}

/** The state the rows show: What's new carries the unseen count as its status word, as in a project. */
export function homeMenuState({ unseen = 0 } = {}) {
  return unseen > 0
    ? { status: { 'help.whats-new': { word: `${unseen} new`, tone: 'neutral' } } }
    : {};
}
