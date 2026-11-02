// editing/world-menu.ts — the right-click menu of the empty canvas (P5, UX audit F17, decision v2-p5-world-menu).
//
//   Add comment C
//   Paste ⌘V                      (when the clipboard is wired — the artboard menu's own paste)
//   Zoom to fit ⌘0 · Actual size ⇧0   (the View menu's words and keys, view.zoom-fit / view.zoom-actual)
//   Export… ⇧⌘E                   (the ONE Export sheet, scope from the canvas — never a second export route)
//
// v1 carried "Fit to view 1", "Reset view ⌘0" (two names for ⌘0) and "Export canvas as separate…" / "Export project
// (ZIP)…", which skipped the sheet. Pure over the item structure — testable without a DOM.

import type { ContextTarget, MenuItem, MenuSection } from '../context-menu.tsx';

export interface WorldMenuDeps {
  addComment(target: ContextTarget): void;
  fit(): void;
  actualSize(): void;
  /** absent: no Paste row */
  paste?(target: ContextTarget): void;
  /** opens the shell's one Export sheet (nothing selected: the current canvas) */
  openExport(): void;
}

export function worldMenuSections(deps: WorldMenuDeps): MenuSection[] {
  const clip: MenuItem[] = deps.paste
    ? [{ id: 'paste-world', label: 'Paste', shortcut: '⌘V', onSelect: deps.paste }]
    : [];
  return [
    [{ id: 'add-comment', label: 'Add comment', shortcut: 'C', onSelect: deps.addComment }],
    ...(clip.length ? [clip] : []),
    [
      { id: 'fit-view', label: 'Zoom to fit', shortcut: '⌘0', onSelect: () => deps.fit() },
      { id: 'reset-view', label: 'Actual size', shortcut: '⇧0', onSelect: () => deps.actualSize() },
    ],
    [{ id: 'export-canvas', label: 'Export…', shortcut: '⇧⌘E', onSelect: () => deps.openExport() }],
  ];
}
