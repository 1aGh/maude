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

/** `set` replaces or appends; `pin` appends only what has no entry; `remove` takes entries out. Order is kept. */
export function mergeLayout(existing: readonly LayoutEntry[], patch: LayoutPatch): LayoutEntry[] {
  const gone = new Set(patch.remove ?? []);
  const out = existing.filter((e) => !gone.has(e.id)).map((e) => ({ id: e.id, x: e.x, y: e.y }));
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

/** The entries of `meta.layout.artboards` that read as positions (anything else is dropped, as before). */
export function layoutEntriesOf(layout: unknown): LayoutEntry[] {
  const rec = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
  const list = (rec as { artboards?: unknown }).artboards;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is LayoutEntry =>
      !!e &&
      typeof (e as LayoutEntry).id === 'string' &&
      Number.isFinite((e as LayoutEntry).x) &&
      Number.isFinite((e as LayoutEntry).y)
  );
}

/**
 * S2.10b — the versioned `.meta.json` text after an op's patch, as the layout lane's writer
 * (`api.patchCanvasMeta`) writes it: other keys kept, no inline `viewport`, `last_modified` stamped,
 * two-space JSON + newline. `current` is the file's text (null = no file yet). Null when the file is
 * not a JSON object (it is then left alone).
 */
export function nextMetaText(current: string | null, patch: LayoutPatch, now: Date): string | null {
  let meta: Record<string, unknown> = {};
  if (current?.trim()) {
    try {
      const parsed = JSON.parse(current) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      meta = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const layout = meta.layout;
  const rec = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
  const next: Record<string, unknown> = {
    ...meta,
    layout: { ...rec, artboards: mergeLayout(layoutEntriesOf(layout), patch) },
  };
  next.viewport = undefined;
  next.last_modified = now.toISOString();
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** A patch with anything to write. */
export const hasLayoutChange = (p: LayoutPatch | undefined): p is LayoutPatch =>
  !!p && !!(p.set?.length || p.pin?.length || p.remove?.length);
