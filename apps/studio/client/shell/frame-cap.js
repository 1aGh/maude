// shell/frame-cap.js — Maude 2.0.4 (task O): how many canvas frames the viewport keeps mounted.
//
// Every mounted canvas frame is a whole page: its own React, its own canvas runtime and the canvas bundle (~2 MB
// of script per canvas), plus every picture on it decoded. The viewport mounts one frame per entry in `tabs`, and
// some roads append to `tabs` without dropping the frame before (a comment jump into another canvas), so a session
// could keep any number of canvases alive. The cap: the active canvas + the one shown just before it. A frame past
// the cap unmounts; opening its canvas again loads it afresh — its camera comes back from `_canvas-state` like any
// open.

/** Frames kept mounted at most: the active canvas + 1 most recent. */
export const FRAME_CAP = 2;

/** How many recent canvases are remembered (only the first FRAME_CAP - 1 others are ever mounted). */
const RECENT_KEEP = 8;

/**
 * The recency list with `path` moved to the front (most recent first). Returns the SAME array when `path` is
 * already at the front, so a render that changes nothing allocates nothing.
 * @param {string[]} recent
 * @param {string | null | undefined} path
 * @returns {string[]}
 */
export function noteShown(recent, path) {
  if (!path || recent[0] === path) return recent;
  return [path, ...recent.filter((p) => p !== path)].slice(0, RECENT_KEEP);
}

/**
 * Which tabs get a mounted frame: the active path, then the most recently shown other open tabs, up to `cap`.
 * Paths in `skip` (views that are not canvas frames, like the Design system tab) are never counted.
 * @param {{ path: string }[]} tabs
 * @param {string | null | undefined} activePath
 * @param {string[]} recent most recent first
 * @param {{ cap?: number, skip?: (path: string) => boolean }} [opts]
 * @returns {Set<string>}
 */
export function framesToMount(tabs, activePath, recent, opts = {}) {
  const cap = opts.cap ?? FRAME_CAP;
  const skip = opts.skip ?? (() => false);
  const open = new Set(tabs.map((t) => t.path).filter((p) => !skip(p)));
  const keep = new Set();
  if (activePath && open.has(activePath)) keep.add(activePath);
  for (const p of recent) {
    if (keep.size >= cap) break;
    if (open.has(p)) keep.add(p);
  }
  return keep;
}
