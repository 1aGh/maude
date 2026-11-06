// Row flow for a generated artboard grid (r3-ds-rows). Pure and React-free, so canvas-lib and the
// tests share one function.
//
// Michal (2026-11-01, on the Design system canvas): "design system je hrozne rozlezly ... radek
// artboards by mel mit vzdy jen takovou vysku jako je jeho nejdelsi artboard". A converted system
// places its specimen pages in section rows at a FIXED pitch (`OWN_ARTBOARD.h + rowGap`), written
// into the meta before anything is measured. The pages hug their content (1 500–4 750 px), so a
// row with only short pages left thousands of empty pixels under it and one tall page ran into the
// row below. The pitch can't be right at write time; it can at run time, once the pages report
// their height. So the board is re-pitched from the measured heights: every row is exactly as tall
// as its tallest artboard, and the gap between rows is one constant.

/** The slice of an artboard rect the flow reads and writes. */
export interface RowRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The one gap between two rows (design px). 80 is the canvas's own gutter (`VP_GRID.gutter`) and
 * already the gap between the Design system canvas's seven sections, so those do not move when the
 * rows below them are tightened. It is also room for an artboard's name (11 screen px + margin)
 * above its frame at 100 %; the column gap there is 48.
 */
export const ROW_GAP = 80;

/**
 * The most artboards one generated row holds (2.0.7 fix #6). A converted system put every page of a
 * section in ONE row — StudyFi's 29 component pages made a row 43 000 px wide, and the canvas fitted
 * at 2 %. Six 1 440 px pages (8 880 px) keep a row about as wide as a few rows are tall, so the
 * canvas reads as a grid. The generator wraps at this count (`ds/board/template.ts`), and the open
 * canvas wraps an older generated grid the same way at run time (`wrapRows`).
 */
export const MAX_ROW_COLUMNS = 6;

/** The column gap of a generated row when it has only one artboard to measure it from (`OWN_ARTBOARD.gap`). */
const DEFAULT_COLUMN_GAP = 48;

/** A column gap wider than this is not a packed row — somebody placed the artboard there. */
const MAX_COLUMN_GAP = 96;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * The Design system canvas, by what it draws: the seven sections (`ds-brand` …), the kept specimen
 * pages (`ds-own-*`) and the AI directions (`ds-dir-*`) — and nothing else. An artboard a person adds
 * to it (any other id) turns the flow off: that canvas is theirs to arrange.
 */
export function isDsCanvasIds(ids: readonly string[]): boolean {
  return ids.length > 0 && ids.includes('ds-brand') && ids.every((id) => id.startsWith('ds-'));
}

/** Artboards grouped by their `y`, top row first, each row left to right. */
export function rowsOf<T extends RowRect>(rects: readonly T[]): T[][] {
  const byY = new Map<number, T[]>();
  for (const r of rects) {
    const row = byY.get(r.y);
    if (row) row.push(r);
    else byY.set(r.y, [r]);
  }
  return [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row.slice().sort((a, b) => a.x - b.x));
}

/** The sizes an artboard was DRAWN at (its `width`/`height` props), by id — what the generator packed with. */
export type DeclaredSizes = ReadonlyMap<string, { w: number; h: number }>;

const overlap = (a: RowRect, b: RowRect) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

/**
 * True while the layout is still the one the generator wrote: rows of artboards that share a `y`,
 * every row starting at the left edge and packed with one (small) gap between neighbours, and no two
 * artboards on top of each other at the size they were DRAWN at (`declared`; the measured height of a
 * hugging page is no evidence — a tall page legitimately spills into the next row until it is flowed).
 * Dragging an artboard anywhere breaks one of the three: it lands off the left edge, off the packed
 * `x` of a row, or on another artboard. A layout a person has arranged is therefore never re-pitched.
 */
export function isUntouchedRowGrid(rects: readonly RowRect[], declared?: DeclaredSizes): boolean {
  if (rects.length === 0) return false;
  for (const r of rects)
    if (!finite(r.x) || !finite(r.y) || !finite(r.w) || !finite(r.h)) return false;
  const left = Math.min(...rects.map((r) => r.x));
  for (const row of rowsOf(rects)) {
    const first = row[0] as RowRect;
    if (Math.abs(first.x - left) > 0.5) return false;
    let gap: number | null = null;
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1] as RowRect;
      const cur = row[i] as RowRect;
      const g = cur.x - (prev.x + prev.w);
      if (g < -0.5 || g > MAX_COLUMN_GAP) return false;
      if (gap !== null && Math.abs(g - gap) > 0.5) return false;
      gap = g;
    }
  }
  const drawn = rects.map((r) => ({ ...r, ...(declared?.get(r.id) ?? {}) }));
  for (let i = 0; i < drawn.length; i++)
    for (let j = i + 1; j < drawn.length; j++)
      if (overlap(drawn[i] as RowRect, drawn[j] as RowRect)) return false;
  return true;
}

/**
 * Wrap every row of an untouched row grid that holds more than `maxCols` artboards onto rows below
 * it, packed from the left edge at the row's own column gap, in the order they stood. Everything
 * under a wrapped row moves down by the room the new rows take (`gap` between rows, each row as tall
 * as its tallest artboard); rows above the first wrapped one keep their place. The row flow
 * (`flowRows`) re-pitches the result from the measured heights as before. Run time only, like the
 * flow: an older converted canvas reads as a grid without its versioned meta being rewritten on
 * open. Returns the SAME array when no row is too long or the layout is not an untouched grid (a
 * person's arrangement is never wrapped), so a caller can compare by identity.
 */
export function wrapRows<T extends RowRect>(
  rects: T[],
  opts: { gap?: number; maxCols?: number; declared?: DeclaredSizes } = {}
): T[] {
  const gap = opts.gap ?? ROW_GAP;
  const maxCols = Math.max(1, opts.maxCols ?? MAX_ROW_COLUMNS);
  if (!isUntouchedRowGrid(rects, opts.declared)) return rects;
  const rows = rowsOf(rects);
  if (rows.every((row) => row.length <= maxCols)) return rects;
  const left = Math.min(...rects.map((r) => r.x));
  const tallest = (row: readonly T[]) => Math.max(...row.map((r) => r.h));
  const next = new Map<string, { x: number; y: number }>();
  let shift = 0;
  for (const row of rows) {
    const y = (row[0] as T).y + shift;
    if (row.length <= maxCols) {
      for (const r of row) next.set(r.id, { x: r.x, y });
      continue;
    }
    const colGap =
      row.length > 1 ? (row[1] as T).x - ((row[0] as T).x + (row[0] as T).w) : DEFAULT_COLUMN_GAP;
    let cy = y;
    for (let i = 0; i < row.length; i += maxCols) {
      const chunk = row.slice(i, i + maxCols);
      let cx = left;
      for (const r of chunk) {
        next.set(r.id, { x: cx, y: cy });
        cx += r.w + colGap;
      }
      if (i + maxCols < row.length) cy += tallest(chunk) + gap;
    }
    const last = row.slice(Math.floor((row.length - 1) / maxCols) * maxCols);
    shift += cy - y + tallest(last) - tallest(row);
  }
  return rects.map((r) => {
    const p = next.get(r.id) as { x: number; y: number };
    return p.x === r.x && p.y === r.y ? r : { ...r, x: p.x, y: p.y };
  });
}

/**
 * Re-pitch the rows of an untouched row grid from the artboards' heights: the first row keeps its
 * `y`, every row below starts `gap` under the TALLEST artboard of the row above. Columns (`x`) are
 * never touched. Returns the SAME array when there is nothing to change or the layout is not an
 * untouched grid, so a caller can compare by identity and never loops.
 */
export function flowRows<T extends RowRect>(
  rects: T[],
  opts: { gap?: number; declared?: DeclaredSizes } = {}
): T[] {
  const gap = opts.gap ?? ROW_GAP;
  if (!isUntouchedRowGrid(rects, opts.declared)) return rects;
  const next = new Map<string, number>();
  let y = (rowsOf(rects)[0] as T[])[0]?.y ?? 0;
  for (const row of rowsOf(rects)) {
    for (const r of row) next.set(r.id, y);
    y += Math.max(...row.map((r) => r.h)) + gap;
  }
  if (rects.every((r) => next.get(r.id) === r.y)) return rects;
  return rects.map((r) => (next.get(r.id) === r.y ? r : { ...r, y: next.get(r.id) as number }));
}
