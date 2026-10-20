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

/** @type {{ place: () => void, details: () => void, trash: () => void, generate?: () => void, describe?: () => void, describeStop?: () => void, tileSelected: () => boolean } | null} */
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

/** S8.16 — `assets.generate` asked while no Assets tab was mounted: the tab opens the ask when it mounts. */
let wantsGenerate = false;

/** The panel, on mount: was Generate asked for before it was there? (read once) */
export function takeGenerateRequest() {
  const w = wantsGenerate;
  wantsGenerate = false;
  return w;
}

/** S8.20 — `assets.describe` (⌘K "Search in pictures") asked while no Assets tab was mounted: the sheet opens on mount. */
let wantsDescribe = false;

/** The panel, on mount: was the describe sheet asked for before it was there? (read once) */
export function takeDescribeRequest() {
  const w = wantsDescribe;
  wantsDescribe = false;
  return w;
}

/**
 * Run `assets.place` / `assets.details` / `assets.trash` on the picked tile, or `assets.generate` (the ask).
 * @returns whether a mounted panel took it. `assets.generate` with no panel mounted is held for the next mount.
 */
export function runAssetsAction(id) {
  if (id === 'assets.generate') {
    if (bound?.generate) {
      bound.generate();
      return true;
    }
    wantsGenerate = true;
    return false;
  }
  if (id === 'assets.describe') {
    if (bound?.describe) {
      bound.describe();
      return true;
    }
    wantsDescribe = true;
    return false;
  }
  if (id === 'assets.describe-stop') {
    if (!bound?.describeStop) return false;
    bound.describeStop();
    return true;
  }
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
