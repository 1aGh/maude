// apps/studio/present/order.ts — S3.2a: the order Present · Artboards walks (D5, Gate 0 C31).
//
// PURE. The default is the canvas order: rows banded at half the smallest artboard height, left to right
// inside a row. It is computed from the LIVE artboard world rects, so a canvas with no stored positions
// (an auto-grid) orders the same as one with. `meta.present.order` overrides it, `meta.present.skip[]`
// drops artboards from the run and so from the counter. Both are read from `.meta.json`, which a peer
// (a v1 build, another person, an AI) may have written, so every member is checked and a stale or
// malformed one is dropped, never thrown on.

import { linkGroups } from '../video/link-groups.ts';

export interface OrderRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What `.meta.json` carries under `present` (V2-1.12 R6). Anything else in the key is ignored. */
export interface PresentMeta {
  order?: unknown;
  skip?: unknown;
}

export interface PresentRun {
  /** Every artboard in canvas order (skipped ones included) — the reference order for "what follows". */
  all: string[];
  /** The artboards Present shows, in the order it shows them. */
  run: string[];
  /** The ones left out, in canvas order. */
  skipped: string[];
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function usable(r: OrderRect | null | undefined): r is OrderRect {
  return (
    !!r &&
    typeof r.id === 'string' &&
    r.id !== '' &&
    finite(r.x) &&
    finite(r.y) &&
    finite(r.w) &&
    finite(r.h)
  );
}

/** Row by row, left to right. Rects with broken numbers are left out. */
export function canvasOrder(rects: readonly OrderRect[]): string[] {
  const rs = rects.filter(usable);
  if (rs.length === 0) return [];
  // A row is every artboard whose top is within half the smallest height of the row's first (top-most)
  // one. Comparing to the row's FIRST rect, not the previous one, stops a staircase from chaining
  // into a single row.
  let smallest = Number.POSITIVE_INFINITY;
  for (const r of rs) if (r.h > 0 && r.h < smallest) smallest = r.h;
  const band = Number.isFinite(smallest) ? smallest / 2 : 0;
  const byY = [...rs].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const rows: OrderRect[][] = [];
  let top = Number.NaN;
  for (const r of byY) {
    if (rows.length === 0 || !(r.y - top < band)) {
      rows.push([r]);
      top = r.y;
    } else {
      rows[rows.length - 1].push(r);
    }
  }
  const out: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
    for (const r of row) out.push(r.id);
  }
  return out;
}

/** The ids of an unknown value that are strings in `known`, once each, in the value's order. */
function knownIds(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string' || !known.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** The run: explicit order (when set) over the canvas order, minus `skip`. */
export function presentRun(
  rects: readonly OrderRect[],
  meta: PresentMeta | null | undefined
): PresentRun {
  const all = canvasOrder(rects);
  const known = new Set(all);
  const m = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
  const named = knownIds(m.order, known);
  const namedSet = new Set(named);
  // Artboards the order does not name follow in canvas order: a new artboard added after "Order and
  // notes…" still gets presented (it is not hidden just because nobody placed it).
  const ordered = [...named, ...all.filter((id) => !namedSet.has(id))];
  const skip = new Set(knownIds(m.skip, known));
  return {
    all,
    run: ordered.filter((id) => !skip.has(id)),
    skipped: all.filter((id) => skip.has(id)),
  };
}

/**
 * Where Present starts (`PresentSpec.from`): an artboard id, or `'start'`. A skipped artboard starts at
 * the next presentable one that follows it in canvas order (nothing after it: the start); an id the
 * canvas no longer has starts at the first.
 */
export function startIndex(run: PresentRun, from: string | null | undefined): number {
  if (!from || from === 'start' || run.run.length === 0) return 0;
  const direct = run.run.indexOf(from);
  if (direct >= 0) return direct;
  const at = run.all.indexOf(from);
  if (at < 0) return 0;
  for (let i = at + 1; i < run.all.length; i++) {
    const j = run.run.indexOf(run.all[i]);
    if (j >= 0) return j;
  }
  return 0;
}

/**
 * S7.19 (S7-slices Q11) — the artboards that share `id`'s cut: the video artboards whose `<VideoComp>` mount one
 * component (`video/link-groups.ts`, the rule the link lines and the Formats list use). An artboard that shares
 * its cut with none is its own deck of one; an id with no video on it names nothing (null).
 */
export function formatIdsOf<K>(
  items: ReadonlyArray<{ id: string; comp: K | null | undefined }>,
  id: string
): string[] | null {
  if (!items.some((it) => it.id === id)) return null;
  return linkGroups(items).find((g) => g.ids.includes(id))?.ids ?? [id];
}

/**
 * The run with only `ids` in it, in the run's own order (`only: 'formats'`). Nothing to keep (the ids are not in
 * the run, or none are given) leaves the run as it is, so Present never opens on an empty deck.
 */
export function onlyIds(run: PresentRun, ids: readonly string[] | null | undefined): PresentRun {
  if (!ids || ids.length === 0) return run;
  const keep = new Set(ids);
  const kept = run.run.filter((id) => keep.has(id));
  if (kept.length === 0) return run;
  return { all: run.all, run: kept, skipped: run.skipped };
}
