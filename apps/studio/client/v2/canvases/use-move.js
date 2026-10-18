// client/v2/canvases/use-move.js — S1.2: the panel's row-level state for moving, renaming and the row menu.
//
// One menu is open at a time (`menu`), one name is being edited at a time (`renaming`). The menu's rows turn
// into the shell's own functions — move (`moveCanvasReq`, the one drag and the keyboard both end in), rename
// (`/_api/fs-move` with a new name), duplicate, trash — so nothing here talks to the server.

import { useCallback, useState } from 'react';

/**
 * @returns {{
 *   menu: null | {row, anchor, anchorEl, view},
 *   openMenu(e, row): void, closeMenu(restoreFocus?: boolean): void, setView(view): void,
 *   renaming: string | null, startRename(path): void, stopRename(): void,
 * }}
 */
export function useRowOps() {
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const openMenu = useCallback((e, row) => {
    e.preventDefault();
    e.stopPropagation();
    const anchorEl = e.currentTarget;
    const r = anchorEl.getBoundingClientRect();
    const byPointer = e.type === 'contextmenu';
    setMenu({
      row,
      anchorEl,
      anchor: byPointer
        ? { top: e.clientY, bottom: e.clientY, left: e.clientX }
        : { top: r.top, bottom: r.bottom, left: r.left },
      view: 'root',
    });
  }, []);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenu((m) => {
      if (m && restoreFocus) m.anchorEl?.focus?.();
      return null;
    });
  }, []);

  const setView = useCallback((view) => setMenu((m) => (m ? { ...m, view } : m)), []);
  const startRename = useCallback((path) => setRenaming(path), []);
  const stopRename = useCallback(() => setRenaming(null), []);

  return { menu, openMenu, closeMenu, setView, renaming, startRename, stopRename };
}

/** The folders above `path` that are under the group root, nearest last — the ones to open to show the row. */
export function ancestorDirs(tree, path) {
  const out = [];
  let dir = path.slice(0, Math.max(0, path.lastIndexOf('/')));
  while (dir && tree.byPath.has(dir)) {
    out.unshift(dir);
    const i = dir.lastIndexOf('/');
    if (i < 0) break;
    dir = dir.slice(0, i);
  }
  return out;
}
