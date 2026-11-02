// client/v2/canvases/last-canvas.js — V2-8.5 c7 (01 cf-big-tree): a project opens on the canvas it was last on.
//
// "Last" is this Mac's own `_canvas-state/_recent.json` (when each canvas was last opened here, per person,
// never versioned or synced — DDR-115), read through `/_api/pins` -> `opened`. Nothing new is stored: the
// same stamp that orders "Recently opened" and Home's recents names the canvas.
//
// Pure: opened + the tree's groups -> the path a tab opens, or null (nothing opened here yet: the project
// keeps its empty state and its first-run card).

import { normalizeOpenPath } from '../../share-link.js';

const CANVAS_EXT = /\.(tsx|html?)$/i;
const SYSTEM_PATH = /(^|\/)system\//;

/**
 * @param opened `{ <designRoot-relative path>: ms }`
 * @param groups the tree's `/_index-data` groups (`{ paths: [...] }`)
 * @param designRel the design root's name (".design")
 * @returns the tab path (as the groups list it) of the canvas opened most recently that still exists, or null
 */
export function lastOpenedPath(opened, groups, designRel = '.design') {
  if (!opened || typeof opened !== 'object') return null;
  let best = null;
  let bestAt = -Infinity;
  for (const g of groups || []) {
    for (const p of g?.paths || []) {
      if (!CANVAS_EXT.test(p) || SYSTEM_PATH.test(p)) continue;
      const at = opened[normalizeOpenPath(p, designRel) ?? ''];
      if (Number.isFinite(at) && at > bestAt) {
        best = p;
        bestAt = at;
      }
    }
  }
  return best;
}
