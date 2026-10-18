// Clear-out reaches this machine's own `_trash/` — S1.7b (S1-trash.md §3 "Retention").
//
// When the project owner clears items out of the shared Trash, the per-Mac
// copies of THOSE canvases go too (S1 Q4, Michal's default): the copy
// `DELETE /_api/canvas` parked here (`_trash/<stamp>__<slug>/` + its
// `_trash-manifest.json`) and the copy a teammate's delete parked here
// (`_trash/<slug>-deleted-<ts>/`, sync/tombstone-apply.ts). On a hub's own
// checkout (a cell's studio) the second shape IS the hub quarantine.
//
// Permanently deleting is the product's own clear-out the OWNER confirmed —
// so it is scoped to exactly the cleared canvases, and proven per copy:
//   - the directory's SHAPE names the cleared canvas (the bundle's manifest
//     says `canvas: <its path>`; a tombstone dir is named for its slug);
//   - the parked `.tsx` holds BYTE FOR BYTE the canvas as it stood when it was
//     trashed (the store's html lane before the delete). A copy with work the
//     project never saw is not the cleared item — it stays;
//   - a copy that is also byte-identical to an item STILL in the Trash at the
//     same path stays (it is that item's copy as much as the cleared one's).
// Nothing else under `_trash/` is read for deletion: moves (`__moved-`),
// conflict losers, file-plane quarantines, migrations, artboards, anything of
// unknown shape. A symlinked `_trash/` or entry is never followed.

import { lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { canvasSlugFromRel } from '../canvas-slug.ts';

/** A canvas item as the store held it when it was trashed. */
export interface ParkedCanvas {
  /** Design-root-relative path the canvas was trashed from. */
  path: string;
  /** Its html lane (the `.tsx` bytes) at the trash revision. */
  body: string;
}

const BUNDLE_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z__(.+)$/;
const TOMBSTONE_RE = /^(.+)-deleted-(\d{10,})$/;

const isRealDir = (abs: string): boolean => {
  try {
    const st = lstatSync(abs);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

function readRealFile(abs: string): string | null {
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.isSymbolicLink()) return null;
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

/** Does `_trash/<name>` park `canvas` (by its shape, not yet by its bytes)? */
function namesCanvas(trashAbs: string, name: string, canvas: string, slug: string): boolean {
  const bundle = BUNDLE_RE.exec(name);
  if (bundle && bundle[1] === slug) {
    const raw = readRealFile(path.join(trashAbs, name, '_trash-manifest.json'));
    if (raw === null) return false;
    try {
      const m = JSON.parse(raw) as { canvas?: unknown; kind?: unknown };
      return m?.kind !== 'artboard' && m?.canvas === canvas;
    } catch {
      return false;
    }
  }
  const stone = TOMBSTONE_RE.exec(name);
  return !!stone && stone[1] === slug;
}

/**
 * Remove this machine's parked copies of exactly the `cleared` canvases.
 * Returns the design-root-relative dirs removed (`_trash/…`). Never throws.
 */
export function removeClearedCopies(o: {
  designRoot: string;
  designRel: string;
  cleared: readonly ParkedCanvas[];
  /** Canvas items still in the Trash — a copy identical to one of these stays. */
  remaining?: readonly ParkedCanvas[];
  log?: (line: string) => void;
}): string[] {
  const trashAbs = path.join(o.designRoot, '_trash');
  if (!o.cleared.length || !isRealDir(trashAbs)) return [];
  let names: string[];
  try {
    names = readdirSync(trashAbs);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const item of o.cleared) {
    if (!item.path || !item.body || !/\.tsx$/i.test(item.path)) continue;
    const slug = canvasSlugFromRel(item.path, o.designRel);
    const base = path.posix.basename(item.path);
    const kept = new Set(
      (o.remaining ?? []).filter((r) => r.path === item.path).map((r) => r.body)
    );
    for (const name of names) {
      if (removed.includes(`_trash/${name}`)) continue;
      if (!namesCanvas(trashAbs, name, item.path, slug)) continue;
      const dir = path.join(trashAbs, name);
      if (!isRealDir(dir)) continue;
      const parked = readRealFile(path.join(dir, base));
      if (parked === null || parked !== item.body || kept.has(parked)) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
        removed.push(`_trash/${name}`);
      } catch (err) {
        o.log?.(`[trash] could not remove ${name}: ${(err as Error).message}`);
      }
    }
  }
  if (removed.length) o.log?.(`[trash] cleared out — removed ${removed.join(', ')}`);
  return removed;
}
