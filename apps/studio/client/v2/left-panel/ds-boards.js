// client/v2/left-panel/ds-boards.js — 2.0.7 (B3): a pinned Design system row opens into the artboards of its
// Design system canvas, the way a canvas row opens into its own (11 · pn-jump). PURE: which canvas a system's
// row lists, and its artboards in the canvas's own order, read from the index snapshot the Canvases panel
// already holds (no second read of the index).

import { indexMeta } from '../canvases/tree-model.js';

/** The repo path of a system's Design system canvas: `<designRel>/<system path>/design-system.tsx`. */
export function dsCanvasPath(systemPath, designRel) {
  if (typeof systemPath !== 'string' || !systemPath.trim()) return null;
  const rel = `${systemPath.replace(/^\/+|\/+$/g, '')}/design-system.tsx`;
  return designRel ? `${designRel}/${rel}` : rel;
}

/**
 * Each pinned row's Design system canvas and its artboards: Map dsName → { path, boards: [{ id, label, kind }] }.
 * A system that has no Design system canvas yet (not converted), or whose canvas lists no artboards, is left
 * out — its row has nothing to open.
 *   systems  [{ name, path }] — the shell config's designSystems; a row the config does not list falls back
 *            to the group's `dsFolders` (a folder that brings its own design-system.tsx, 2.0.7 #1)
 */
export function dsBoardLists(rows, { snapshot, designRel = '', systems = [], groups = [] } = {}) {
  const out = new Map();
  if (!snapshot || !Array.isArray(rows) || !rows.length) return out;
  const root = (snapshot?.project?.designRel || designRel || '').replace(/^\/+|\/+$/g, '');
  const meta = indexMeta(snapshot, root);
  const folders = (groups || []).flatMap((g) => g?.dsFolders || []);
  for (const r of rows) {
    const name = r?.dsName;
    if (!name) continue;
    const sys =
      (systems || []).find((d) => d?.name === name) || folders.find((f) => f?.name === name);
    const path = dsCanvasPath(sys?.path, root);
    const m = path ? meta.get(path) : null;
    if (!m || !m.boards?.length) continue;
    out.set(name, { path, boards: m.boards });
  }
  return out;
}
