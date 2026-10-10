// actions/legacy.ts — today's (v1) layouts of the three key-showing surfaces, as registry data
// (V2-1.3 contract §5.10 `V1_SHEET`, §8 step 4). The ⌘K palette, the menubar dropdowns and the "?"
// sheet render from these during V2-2.4 so they stay byte-identical; every row names the registry
// action(s) it shows, and `actions-legacy.test.ts` proves each displayed key is a real binding of
// that action (or a known v1 defect). Deleted in V2-8.0 with the `legacy` field.
//
// The display strings stay verbatim because v1 spelled one chord three ways (defect 8:
// palette '⌘⇧M', menus '⌘ ⇧ M' / '⇧⌘M', sheet '⌘ ⇧ M'); Phase 4 renders `formatChord()`.

import type { ActionId } from './types.ts';

// ── "?" — the keyboard-shortcuts sheet (was dialogs/shortcuts-overlay.jsx SHORTCUT_GROUPS) ──
export interface V1SheetRow {
  label: string;
  kbd: string;
  alt?: string;
  /** The actions the row describes (a row can stand for several: "Move · Hand · Comment"). */
  ids: ActionId[];
}
export interface V1SheetGroup {
  id: string;
  label: string;
  items: V1SheetRow[];
}

export const V1_SHEET: readonly V1SheetGroup[] = [
  {
    id: 'canvas',
    label: 'Canvas',
    items: [
      { label: 'Command palette', kbd: '⌘ K', ids: ['search.open'] },
      { label: 'New brief board', kbd: 'N', ids: ['canvas.new'] },
      { label: 'Export…', kbd: '⇧ ⌘ E', ids: ['export.open'] },
      { label: 'Handoff to production', kbd: '⇧ ⌘ H', ids: ['handoff.open'] },
      { label: 'Reload canvas', kbd: '⌘ R', ids: ['canvas.reload'] },
      { label: 'Search files', kbd: '/', alt: '⌘ F', ids: ['canvases.search', 'canvases.find'] },
    ],
  },
  {
    id: 'tools',
    label: 'Tools · canvas focus',
    items: [
      {
        label: 'Move · Hand · Comment',
        kbd: 'V',
        alt: 'H / C',
        ids: ['tool.select', 'tool.hand', 'tool.comment'],
      },
      {
        label: 'Pen · Highlighter · Eraser',
        kbd: 'B',
        alt: 'I / E',
        ids: ['tool.pen', 'tool.highlighter', 'tool.eraser'],
      },
      { label: 'Shape · Arrow', kbd: 'R', alt: 'A', ids: ['tool.shape', 'tool.arrow'] },
      {
        label: 'Sticky · Text · Section',
        kbd: 'N',
        alt: 'T / ⇧S',
        ids: ['tool.sticky', 'tool.text', 'tool.section'],
      },
      { label: 'Undo / redo', kbd: '⌘ Z', alt: '⇧ ⌘ Z', ids: ['edit.undo', 'edit.redo'] },
    ],
  },
  {
    id: 'selection',
    label: 'Selection & zoom',
    items: [
      // Pointer gestures, not chords — listed as literal rows (§5.4).
      { label: 'Select element', kbd: '⌘ click', ids: [] },
      { label: 'Add to selection', kbd: '⌘ ⇧ click', ids: [] },
      { label: 'Preview deepest', kbd: '⌘ hover', ids: [] },
      { label: 'Deselect · close menu', kbd: 'Esc', ids: ['ui.step-back'] },
      { label: 'Zoom in / out', kbd: '⌘ +', alt: '⌘ −', ids: ['view.zoom-in', 'view.zoom-out'] },
      {
        label: 'Fit · actual size',
        kbd: '⌘ 0',
        alt: '⌘ 1',
        ids: ['view.zoom-fit', 'view.zoom-actual'],
      },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { label: 'Project tree', kbd: 'T', ids: ['view.panels'] },
      { label: 'Design system view', kbd: 'S', ids: ['view.design-system'] },
      { label: 'Inspector', kbd: '⌘ ⇧ I', ids: ['view.inspector'] },
      { label: 'Comments sidebar', kbd: '⌘ ⇧ M', ids: ['view.comments'] },
      { label: 'Annotations', kbd: '⇧ P', ids: ['view.annotations'] },
      { label: 'Hidden files', kbd: 'H', ids: ['view.hidden-files'] },
      {
        label: 'This cheat sheet · help',
        kbd: '?',
        alt: 'F1',
        ids: ['help.shortcuts', 'help.guides'],
      },
    ],
  },
];

// ── ⌘K — the command palette (was hooks/use-palette-and-panels.jsx paletteActions) ──
export interface V1PaletteRow {
  id: ActionId;
  group: 'Canvas' | 'View' | 'Tools' | 'Help';
  /** v1 icon name (shell/icons.jsx). */
  icon: string;
  /** v1 display key, verbatim. */
  kbd?: string;
}

export const V1_PALETTE: readonly V1PaletteRow[] = [
  { id: 'canvas.new', group: 'Canvas', icon: 'plus', kbd: 'N' },
  { id: 'canvas.new-video', group: 'Canvas', icon: 'plus' },
  { id: 'export.open', group: 'Canvas', icon: 'download', kbd: '⇧⌘E' },
  { id: 'share.copy-link', group: 'Canvas', icon: 'link' },
  { id: 'handoff.open', group: 'Canvas', icon: 'external', kbd: '⇧⌘H' },
  { id: 'ai.generate', group: 'Canvas', icon: 'sparkle' },
  { id: 'settings.open', group: 'Canvas', icon: 'sliders', kbd: '⌘,' },
  { id: 'view.design-system', group: 'View', icon: 'sliders', kbd: 'S' },
  { id: 'view.comments', group: 'View', icon: 'resolve', kbd: '⌘⇧M' },
  { id: 'view.inspector', group: 'View', icon: 'sliders', kbd: '⌘⇧I' },
  { id: 'canvas.reload', group: 'View', icon: 'reload', kbd: '⌘R' },
  { id: 'ai.draw-mark', group: 'Tools', icon: 'pen' },
  { id: 'settings.theme', group: 'Tools', icon: 'sun' },
  { id: 'help.whats-new', group: 'Help', icon: 'sparkle' },
  { id: 'help.shortcuts', group: 'Help', icon: 'help', kbd: '?' },
  { id: 'help.guides', group: 'Help', icon: 'help', kbd: 'F1' },
  { id: 'help.report-bug', group: 'Help', icon: 'help' },
];

// ── the menubar dropdowns (was menus/menubar.jsx) ──
export interface V1MenuItem {
  id: ActionId;
  /** v1 display key, verbatim ('' renders no key chip). */
  kbd?: string;
  /** Overrides the action's `legacy.menu` label. */
  label?: string;
  /** v1 hid the row from a viewer (per-menu `readOnly` — rule 12 unifies it in Phase 4). */
  viewer?: false;
  /** Desktop app only (v1 `isNativeApp()`). */
  native?: true;
  /** Only with a canvas open (Edit › New artboard). */
  canvas?: true;
  /** Greyed (v1 `disabled`) without an open canvas / a share path. */
  needs?: 'canvas' | 'share-path';
  /** The v1 tool id the Tools menu posts as `tool-set`. */
  tool?: string;
  /** The displayed key is another action's binding (Deselect all shows esc = `ui.step-back`). */
  keyOf?: ActionId;
  /** The key is displayed but no v1 binding implements it (V2-1.3 §2 defect id). */
  dead?: string;
}
export interface V1MenuSep {
  sep: true;
  viewer?: false;
  canvas?: true;
}
export type V1MenuRow = V1MenuItem | V1MenuSep;
export type V1MenuName = 'file' | 'edit' | 'view' | 'zoom' | 'selection' | 'tools' | 'help';

export const V1_MENUBAR: Readonly<Record<V1MenuName, readonly V1MenuRow[]>> = {
  file: [
    // Bare N — the browser reserves ⌘N (New Window) and never delivers it.
    { id: 'canvas.new', kbd: 'N', viewer: false },
    { id: 'video.assemble', needs: 'canvas', viewer: false },
    { id: 'export.open', kbd: '⇧⌘E' },
    { id: 'share.open', needs: 'share-path' },
    { id: 'handoff.open', kbd: '⇧⌘H' },
    { sep: true },
    { id: 'ai.generate', viewer: false },
    { id: 'settings.open', kbd: '⌘,', viewer: false },
    { sep: true, viewer: false },
    { id: 'canvas.reload', kbd: '⌘R', needs: 'canvas' },
    { id: 'canvas.close', needs: 'canvas' },
  ],
  edit: [
    { id: 'edit.undo', kbd: '⌘Z', viewer: false },
    { id: 'edit.redo', kbd: '⇧⌘Z', viewer: false },
    { sep: true, viewer: false },
    { id: 'select.none', kbd: 'Esc', keyOf: 'ui.step-back' },
    { id: 'select.all-annotations', kbd: '⇧⌘A', viewer: false, dead: 'defect-1' },
    { sep: true, viewer: false, canvas: true },
    { id: 'artboard.new-desktop', viewer: false, canvas: true },
    { id: 'artboard.new-laptop', viewer: false, canvas: true },
    { id: 'artboard.new-tablet', viewer: false, canvas: true },
    { id: 'artboard.new-mobile', viewer: false, canvas: true },
    { id: 'artboard.new-a4', viewer: false, canvas: true },
    { id: 'artboard.new-letter', viewer: false, canvas: true },
  ],
  // The View menu's "Panels" rows; menubar.jsx adds each row's live state (checked, the Changes
  // count, the cloud Assistant notice) and v1's viewer filter.
  view: [
    { id: 'view.panels', kbd: 'T' },
    { id: 'history.open', kbd: '⌘ ⇧ G' },
    { id: 'view.comments', kbd: '⌘ ⇧ M' },
    { id: 'view.hidden-files', kbd: 'H' },
    { id: 'view.layers', kbd: '' },
    { id: 'view.inspector', kbd: '⌘ ⇧ I' },
    { id: 'view.inspector-on-select', kbd: '' },
    { id: 'view.timeline-keep-open', kbd: '⌘ ⇧ T' },
    { id: 'ai.chat', kbd: '⌘ ⇧ A' },
    { id: 'view.annotations', kbd: '⇧ P' },
    { id: 'view.minimap', kbd: '' },
    { id: 'view.zoom-controls', kbd: '' },
    { id: 'present.canvas', kbd: '' },
    { id: 'view.print-guides', kbd: '' },
  ],
  zoom: [
    { id: 'view.zoom-in', kbd: '⌘ +' },
    { id: 'view.zoom-out', kbd: '⌘ −' },
    { id: 'view.zoom-fit', kbd: '⌘ 0' },
    { id: 'view.zoom-actual', kbd: '⌘ 1' },
  ],
  selection: [
    { id: 'select.none', kbd: 'Esc', keyOf: 'ui.step-back' },
    { id: 'select.all-annotations', kbd: '⌘ ⇧ A', viewer: false, dead: 'defect-1' },
  ],
  // Mirrors DEFAULT_TOOLS in use-tool-mode.tsx (Rect / Ellipse are dead — defect 5: `setTool`
  // knows only `shape`); a viewer keeps only the navigate / inspect tools.
  tools: [
    { id: 'tool.browse', kbd: '', tool: 'browse' },
    { id: 'tool.select', kbd: 'V', tool: 'move' },
    { id: 'tool.hand', kbd: 'H', tool: 'hand' },
    { id: 'tool.comment', kbd: 'C', tool: 'comment', viewer: false },
    { id: 'tool.pen', kbd: 'B', tool: 'pen', viewer: false },
    { id: 'tool.rect', kbd: 'R', tool: 'rect', viewer: false, dead: 'defect-5' },
    { id: 'tool.ellipse', kbd: 'O', tool: 'ellipse', viewer: false, dead: 'defect-5' },
    { id: 'tool.sticky', kbd: 'N', tool: 'sticky', viewer: false },
    { id: 'tool.arrow', kbd: 'A', tool: 'arrow', viewer: false },
    { id: 'tool.text', kbd: 'T', tool: 'text', viewer: false },
    { id: 'tool.eraser', kbd: 'E', tool: 'eraser', viewer: false },
  ],
  help: [
    { id: 'help.shortcuts', kbd: '?' },
    { id: 'help.guides', kbd: 'F1' },
    { id: 'help.report-bug' },
    { sep: true },
    { id: 'help.tour' },
    { id: 'help.intro' },
    // DDR-119 / DDR-166 — the collab course, the quick-setup journey and the readiness check are
    // native, no-terminal concerns.
    { id: 'help.sharing', native: true },
    { id: 'help.setup', native: true },
    { id: 'help.ai-readiness', native: true },
    { id: 'help.whats-new' },
  ],
};
