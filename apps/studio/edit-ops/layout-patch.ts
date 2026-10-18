// edit-ops/layout-patch.ts — S2.10: merge an op's `LayoutPatch` into the layout lane's artboards[].
//
// Pure. The route reads `meta.layout.artboards`, calls `mergeLayout`, and writes the result through the layout
// lane's own writer (`api.patchCanvasMeta`), so the cell announce / `onMetaChanged` hook run as for a drag.

import type { LayoutPatch } from './types.ts';

export type LayoutEntry = { id: string; x: number; y: number };

/** The widest an artboard coordinate may be (`api.ts` MAX_LAYOUT_COORD) and the most entries one layout holds. */
export const MAX_LAYOUT_COORD = 1_000_000;
export const MAX_LAYOUT_ENTRIES = 2_000;

export const isCoord = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_LAYOUT_COORD;

/** `set` replaces or appends; `pin` appends only what has no entry. Existing order is kept. */
export function mergeLayout(existing: readonly LayoutEntry[], patch: LayoutPatch): LayoutEntry[] {
  const out = existing.map((e) => ({ id: e.id, x: e.x, y: e.y }));
  const at = new Map(out.map((e, i) => [e.id, i]));
  for (const e of patch.pin ?? []) {
    if (at.has(e.id)) continue;
    at.set(e.id, out.length);
    out.push({ id: e.id, x: e.x, y: e.y });
  }
  for (const e of patch.set ?? []) {
    const i = at.get(e.id);
    if (i === undefined) {
      at.set(e.id, out.length);
      out.push({ id: e.id, x: e.x, y: e.y });
    } else out[i] = { id: e.id, x: e.x, y: e.y };
  }
  return out;
}
