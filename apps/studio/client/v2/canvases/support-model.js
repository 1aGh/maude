// client/v2/canvases/support-model.js — 06 ad-left (round 10): Canvases › Advanced › Show hidden files, as
// data for the ONE canvas tree.
//
// The board (06 · ad-left, "both ON") draws the same tree as ever with the files that are usually out of the
// way dimmed in place: a canvas's sidecars (`X.meta.json`, `X.css`) under its row, a folder's loose notes and
// styles after its canvases, and the project's runtime entries (`_history/`, `_canvas-state/`) at the root.
// Before this, the toggle swapped the whole list for the v1 file view (section headers, flat rows, no file
// names under the canvases). The rows come from the same `/_index-data` groups the tree is built from:
//
//   byCanvas  canvas path  → its sidecars          (same-base files, `groupBySidecar`'s rule)
//   byDir     folder path  → loose supporting files (README.md, tokens.css…; pictures/fonts/audio/video are
//                            the Assets panel's, never sidecar noise)
//   runtime   the Runtime group's entries, a name with no extension drawn as a folder (`_history/`)
//
// Pure data → rows: `visibleRows(tree, { support })` (tree-model.js) places them.

import { groupBySidecar, previewKind } from '../../shell/util.js';
import { canvasGroups } from './tree-model.js';

const MEDIA = new Set(['image', 'video', 'audio', 'font']);

const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const dirOfPath = (p) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

/** `{ byCanvas, byDir, runtime }` for the groups `/_index-data` sent (empty maps when nothing is hidden). */
export function supportIndex(groups) {
  const byCanvas = new Map();
  const byDir = new Map();
  for (const g of canvasGroups(groups)) {
    const perDir = new Map();
    for (const p of g.paths || []) {
      const dir = dirOfPath(p);
      const list = perDir.get(dir) ?? [];
      list.push({ name: baseOf(p), path: p });
      perDir.set(dir, list);
    }
    for (const [dir, files] of perDir) {
      const { canvases, orphans } = groupBySidecar(files);
      for (const c of canvases) {
        if (c.sidecars.length)
          byCanvas.set(
            c.primary.path,
            c.sidecars.map((f) => ({ name: f.name, path: f.path }))
          );
      }
      const loose = orphans
        .map((o) => o.primary)
        .filter((f) => !MEDIA.has(previewKind(f.name)))
        .map((f) => ({ name: f.name, path: f.path }));
      if (loose.length) byDir.set(dir, loose);
    }
  }
  const rt = (groups || []).find((g) => g.kind === 'runtime');
  const runtime = (rt?.paths || [])
    .map((p) => {
      const name = baseOf(p);
      return { name, path: p, dir: !/\.[^./]+$/.test(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { byCanvas, byDir, runtime };
}

/** The glyph a supporting row wears: the runtime folders the board names, else a plain file. */
export function supportIcon(name) {
  if (/^_history/.test(name)) return 'history';
  if (/^_canvas-state/.test(name)) return 'laptop';
  return 'file';
}
