// editing/duplicate-rhythm.ts — S2.10: where ⌘D puts the copy (14 Editing: ed-ab-menu, pane 2).
//
// "The copy lands to the right at the gap the row already uses, selected — press again to keep the
// rhythm." Pure maths over the committed layout (world px): no DOM, no React. The canvas feeds it
// `dragBus.layoutRects()` and sends the answer to `artboard.duplicate` as `items[].at`.
//
//   rowGap       the gap the source's row already uses: to its left neighbour when it has one (so the
//                second ⌘D repeats the first one's gap), else to its right neighbour, else the default grid's
//                gutter
//   copyPlace    right of the source at that gap, same top edge; if another board is in the way, past it
//   pinsFor      the boards that carry no layout entry yet — splicing a copy into the JSX shifts every later
//                default-grid slot, so they are pinned where they are drawn, in the same request
//   dropPlaces   an ⌥-drag: each dragged board's copy lands exactly where the drop put it

/** canvas-lib's ⌥-drag drop asks the editing layer to copy instead of move (cancelled = taken). */
export const DUPLICATE_ON_DROP_EVENT = 'maude:duplicate-artboards-on-drop';

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The default grid's gutter (canvas-lib `VP_GRID.gutter`): the gap of a row of one. */
export const DEFAULT_GAP = 80;
/** Two boards share a row when their vertical spans overlap by at least this share of the shorter one. */
export const ROW_OVERLAP = 0.5;

const right = (b: Box) => b.x + b.w;
const bottom = (b: Box) => b.y + b.h;

function sameRow(a: Box, b: Box): boolean {
  const overlap = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return overlap >= Math.min(a.h, b.h) * ROW_OVERLAP && overlap > 0;
}

/** The gap the source's row uses (world px, never negative). */
export function rowGap(source: Box, all: readonly Box[]): number {
  const row = all.filter((b) => b.id !== source.id && sameRow(source, b));
  const left = row.filter((b) => right(b) <= source.x).sort((a, b) => right(b) - right(a))[0];
  if (left) return Math.max(0, Math.round(source.x - right(left)));
  const next = row.filter((b) => b.x >= right(source)).sort((a, b) => a.x - b.x)[0];
  if (next) return Math.max(0, Math.round(next.x - right(source)));
  return DEFAULT_GAP;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

/**
 * Where the copy of `source` lands: right of it at the row's gap, on its top edge. A board already
 * standing there pushes the copy past it (at the same gap), until the place is free.
 */
export function copyPlace(
  source: Box,
  all: readonly Box[],
  copy: { w: number; h?: number } = { w: source.w }
): { x: number; y: number } {
  const gap = rowGap(source, all);
  const h = copy.h ?? source.h;
  let x = right(source) + gap;
  for (let guard = 0; guard < 500; guard++) {
    const probe: Box = { id: '', x, y: source.y, w: copy.w, h };
    const blocker = all.filter((b) => overlaps(probe, b)).sort((a, b) => right(b) - right(a))[0];
    if (!blocker) break;
    x = right(blocker) + gap;
  }
  return { x: Math.round(x), y: Math.round(source.y) };
}

/** One entry per board to copy: the copy's place, each one counted among the boards the next sees. */
export function copyPlaces(
  sources: readonly Box[],
  all: readonly Box[],
  widthOf: (b: Box) => number = (b) => b.w
): Array<{ artboard: string; at: { x: number; y: number } }> {
  const occupied: Box[] = [...all];
  const out: Array<{ artboard: string; at: { x: number; y: number } }> = [];
  for (const s of sources) {
    const w = widthOf(s);
    const at = copyPlace(s, occupied, { w });
    occupied.push({ id: `copy-of-${s.id}`, x: at.x, y: at.y, w, h: s.h });
    out.push({ artboard: s.id, at });
  }
  return out;
}

/** The boards without a layout entry, at their drawn position (`layout` = the ids the meta lane holds). */
export function pinsFor(
  all: readonly Box[],
  layout: ReadonlySet<string>
): Array<{ id: string; x: number; y: number }> {
  return all
    .filter((b) => !layout.has(b.id))
    .map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y) }));
}

/** An ⌥-drag drop: each dragged board's copy lands at the position the drop gave it. */
export function dropPlaces(
  moved: ReadonlyArray<{ id: string; x: number; y: number }>
): Array<{ artboard: string; at: { x: number; y: number } }> {
  return moved.map((m) => ({ artboard: m.id, at: { x: Math.round(m.x), y: Math.round(m.y) } }));
}

/**
 * An artboard drag was dropped. A plain drop moves the boards (`commit`, riders ride along); an ⌥ drop asks the
 * editing layer to copy instead — the originals stay — and falls back to the move only when nothing answered
 * (an embed, a specimen: the v1 behaviour). Returns what happened.
 */
export function routeDrop(
  alt: boolean,
  moved: Array<{ id: string; x: number; y: number }>,
  win: Pick<EventTarget, 'dispatchEvent'>,
  commit: (moved: Array<{ id: string; x: number; y: number }>, opts?: { riders: false }) => void
): 'moved' | 'duplicated' {
  if (alt) {
    const taken = !win.dispatchEvent(
      new CustomEvent(DUPLICATE_ON_DROP_EVENT, { detail: { moved }, cancelable: true })
    );
    if (taken) return 'duplicated';
    commit(moved, { riders: false });
    return 'moved';
  }
  commit(moved);
  return 'moved';
}
