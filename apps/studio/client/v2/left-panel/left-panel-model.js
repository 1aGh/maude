// client/v2/left-panel/left-panel-model.js — V2-4.4a: the words and shapes of the left panel
// (Canvases · Layers · Assets), kept out of the components so they can be pinned without a DOM.
//
// CONTRACT §1 (Trash, C10), §2 (keys that moved), §3 (words), §7 (Assets is the third tab, the
// Design system canvas is pinned above every canvas).

import { DOCK_PANELS, PANEL_SIDES_DEFAULTS } from '../../shell/dock.jsx';

/** The tabs the left slot offers, in order. Layers is a left tab only while it is "a panel" (View ›
 *  Advanced › Layers as a panel — the default); otherwise it lives in the Inspector and the strip is
 *  Canvases · Assets. Ids are the dock's (`dock-tab-tree` stays the e2e hook). */
export function leftTabs({ layersMode = 'separate', sides = null } = {}) {
  return DOCK_PANELS.filter((p) => {
    const side = sides?.[p.id] || PANEL_SIDES_DEFAULTS[p.id];
    if (side !== 'left') return false;
    if (p.id === 'layers') return layersMode === 'separate';
    return p.id === 'tree' || p.id === 'layers' || p.id === 'assets';
  }).map((p) => ({ id: p.id, label: p.label }));
}

/** The pinned Design system rows: one per system the project holds (the DESIGN SYSTEM group's
 *  `dsFolders`). One system reads "Design system"; several are each named after their system
 *  (CONTRACT §7, A12). No system → nothing is pinned. */
export function dsPinnedRows(groups) {
  const g = (groups || []).find((x) => x.label === 'Design system');
  const folders = g?.dsFolders || [];
  return folders.map((f) => ({
    dsName: f.name,
    label: folders.length === 1 ? 'Design system' : f.name,
  }));
}

/** What the Trash row shows after its name: the count, or nothing while empty / not loaded. */
export function trashRowCount(trash) {
  return trash && trash.total > 0 ? String(trash.total) : '';
}

/** The line over the Trash list. "Kept", never "deleted" (CONTRACT §3). */
export function trashSummary(trash) {
  const n = trash?.total ?? 0;
  if (n === 0) return 'Nothing in the trash.';
  return `${n} ${n === 1 ? 'thing' : 'things'} kept until you clear it out.`;
}

/** TrashEntry.reason → plain words (the same words the Sync panel's trash list uses). */
export const TRASH_REASON_WORD = {
  conflict: 'older copy from a conflict',
  removed: 'removed by sync',
  moved: 'replaced by a move',
  deleted: 'moved to the trash',
  migration: 'kept by a migration',
  unknown: 'kept',
};

/** Where every capability of ledger rows G0-D/D4 (keys) and G0-D/D5 (the Files panel) lives now.
 *  `file` is the source that produces the control, `testid` / `actionId` / `label` what a test can
 *  find there. The table test (test/v2-left-panel-model.test.ts) checks each against the source, so a
 *  capability cannot be dropped silently. */
export const CAPABILITY_HOMES = [
  // ── D4: keys that moved ──
  {
    row: 'G0-D/D4',
    feature: 'Refresh tree',
    home: 'Canvases › Advanced (Refresh) + ⌘K "Refresh tree" + ⇧⌘R',
    file: 'client/v2/left-panel/canvases-advanced.jsx',
    testid: 'canvases-refresh',
    actionId: 'canvases.refresh',
  },
  {
    row: 'G0-D/D4',
    feature: 'Toggle the tree',
    home: '⌘\\ (Hide panels) and the panel icon in the corner',
    file: 'client/v2/shell/corner-icons.jsx',
    testid: 'panel-icon-<which>',
    actionId: 'view.panels',
  },
  {
    row: 'G0-D/D4',
    feature: 'Hidden files',
    home: 'Canvases › Advanced switch (no key) + Menu › View › Advanced',
    file: 'client/v2/left-panel/canvases-advanced.jsx',
    testid: 'canvases-hidden-files',
    actionId: 'view.hidden-files',
  },
  {
    row: 'G0-D/D4',
    feature: 'Design system view',
    home: 'the pinned Design system row',
    file: 'client/v2/left-panel/canvases-pinned.jsx',
    testid: 'canvases-ds-row',
    actionId: 'view.design-system',
  },
  {
    row: 'G0-D/D4',
    feature: 'New canvas',
    home: '⌘N, Menu › File › New canvas, the + at the head of Canvases',
    file: 'client/tree/tree.jsx',
    label: 'New blank brief board',
    actionId: 'canvas.new',
  },
  // ── D5: the Files panel ──
  {
    row: 'G0-D/D5',
    feature: 'New folder',
    home: 'Canvases head (folder +)',
    file: 'client/tree/tree.jsx',
    testid: 'tree-new-folder',
  },
  {
    row: 'G0-D/D5',
    feature: 'Inline composer',
    home: 'Canvases head — opens under the + / folder +',
    file: 'client/tree/tree.jsx',
    label: 'st-newboard',
  },
  {
    row: 'G0-D/D5',
    feature: 'Folder menu',
    home: 'a folder row — its ⋯ button and right-click',
    file: 'client/tree/tree.jsx',
    testid: 'tree-row-menu-<slug>',
  },
  {
    row: 'G0-D/D5',
    feature: 'Drag and drop',
    home: 'canvas and folder rows (drop on a folder, or the group root)',
    file: 'client/tree/tree.jsx',
    label: 'dropProps',
  },
  {
    row: 'G0-D/D5',
    feature: 'Keyboard tree navigation',
    home: 'the Canvases list (role=tree)',
    file: 'client/tree/tree.jsx',
    testid: 'canvas-list',
  },
  {
    row: 'G0-D/D5',
    feature: 'Open-comment count',
    home: 'a canvas row — its count badge',
    file: 'client/tree/tree.jsx',
    label: 'openCount',
  },
  {
    row: 'G0-D/D5',
    feature: 'Figma and experimental badges',
    home: 'a canvas row — the badge after its name',
    file: 'client/tree/tree.jsx',
    label: 'imported-figma',
  },
  {
    row: 'G0-D/D5',
    feature: 'Non-canvas file preview',
    home: 'Canvases › Advanced › Hidden files — supporting files open a preview',
    file: 'client/tree/tree.jsx',
    label: 'previewKind',
  },
  {
    row: 'G0-D/D5',
    feature: 'Search',
    home: 'the search field at the head of Canvases (/ and ⌘F focus it)',
    file: 'client/tree/tree.jsx',
    testid: 'canvas-search',
  },
  {
    row: 'G0-D/D5',
    feature: 'Trash',
    home: 'the Canvases panel’s last row + Canvases › Advanced + ⌘K "Trash"',
    file: 'client/v2/left-panel/canvases-pinned.jsx',
    testid: 'canvases-trash-row',
    actionId: 'view.trash',
  },
];
