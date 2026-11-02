// edit-ops/tidy.ts — S2.9 `artboard.tidy`: several artboards into one row with even gaps (Plane A: meta positions).
//
// An artboard's place is `meta.layout.artboards[]` in the `.meta.json` (never its JSX, never the per-user camera,
// DDR-115), so Tidy is not a source edit-op: this module is the maths, the canvas commits the result through
// `DragStateBus.commitPositions` (annotations ride along; one write, one ⌘Z) and an agent applies the same rule by
// hand (`canvas-tsx.md` § "Tidy artboards").
//
//   · order    left to right as they sit now (ties keep the order given);
//   · line     every board's top goes to the LOWEST board's top (the largest y) — nothing climbs;
//   · start    the first board keeps its left edge;
//   · gap      one gap between every neighbour: the mean of today's gaps, or 80 when two boards overlap;
//   · sizes    untouched — Tidy never resizes.
//
// Registry action: `artboard.tidy` (shared registry). The align bar's "Tidy up" button and ⌘K run it.

export interface TidyRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TidyMove {
  id: string;
  x: number;
  y: number;
}

/** The gap when there is no gap to keep (boards overlap or stack): the "80" of the arrange canvas. */
export const DEFAULT_TIDY_GAP = 80;

/** "tidy up 4 artboards" — the undo line. */
export const TIDY_LABEL = (n: number): string => `tidy up ${n} artboard${n === 1 ? '' : 's'}`;

function ordered(rects: readonly TidyRect[]): TidyRect[] {
  return rects
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.x - b.r.x || a.i - b.i)
    .map((e) => e.r);
}

/** The one gap Tidy uses between neighbours. */
export function tidyGap(rects: readonly TidyRect[]): number {
  const row = ordered(rects);
  if (row.length < 2) return DEFAULT_TIDY_GAP;
  let sum = 0;
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1] as TidyRect;
    const cur = row[i] as TidyRect;
    const gap = cur.x - (prev.x + prev.w);
    if (gap < 0) return DEFAULT_TIDY_GAP; // overlapping or stacked: there is no row to take a gap from
    sum += gap;
  }
  return Math.round(sum / (row.length - 1));
}

/** Where each artboard goes — only the ones that move. Whole pixels (the layout lane stores integers). */
export function tidyArtboards(rects: readonly TidyRect[]): TidyMove[] {
  if (rects.length < 2) return [];
  const row = ordered(rects);
  const gap = tidyGap(rects);
  const line = Math.round(Math.max(...rects.map((r) => r.y)));
  const moves: TidyMove[] = [];
  let cursor = Math.round((row[0] as TidyRect).x);
  for (const r of row) {
    const x = cursor;
    if (x !== Math.round(r.x) || line !== Math.round(r.y)) moves.push({ id: r.id, x, y: line });
    cursor = x + Math.round(r.w) + gap;
  }
  return moves;
}
