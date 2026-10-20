// client/v2/assets/assets-bus.js — how the registry reaches the mounted Assets tab (S8.12).
//
// `assets.place` (↵) and `assets.details` (⌘I) are shell actions whose state lives in the panel: which tile is picked,
// where the selected artboard is. The shell's one key listener and the menu runner call `runAssetsAction(id)`; the
// panel binds itself here while it is mounted and runs the SAME functions its tile menu runs, so a key, the menu and the
// right-click row are one code path.
//
// `assetTileSelected()` is the registry fact (actions/types.ts › Fact) that makes ↵ and ⌘I mean "this tile": a tile
// is picked AND keyboard focus is inside the tab. A tile still picked while focus moved to the canvas or a toolbar
// button must leave ↵ to whatever has focus.

/** @type {{ place: () => void, details: () => void, trash: () => void, tileSelected: () => boolean } | null} */
let bound = null;

/** The panel binds itself on mount. @returns the unbind. */
export function bindAssetsPanel(api) {
  bound = api;
  return () => {
    if (bound === api) bound = null;
  };
}

/** The registry fact `assetTileSelected`. */
export function assetTileSelected() {
  try {
    return !!bound?.tileSelected();
  } catch {
    return false;
  }
}

/** Run `assets.place` / `assets.details` / `assets.trash` on the picked tile. @returns whether a mounted panel took it. */
export function runAssetsAction(id) {
  const fn =
    id === 'assets.place'
      ? bound?.place
      : id === 'assets.details'
        ? bound?.details
        : id === 'assets.trash'
          ? bound?.trash
          : null;
  if (!fn) return false;
  fn();
  return true;
}
