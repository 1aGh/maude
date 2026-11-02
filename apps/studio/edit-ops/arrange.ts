// edit-ops/arrange.ts — what align, distribute and rotate share (S2.7, ed-obj-multi).
//
// Where an object sits on the page is a fact of the RENDERED canvas (a flow layout, a class, a
// transform), so the canvas measures and the writer decides: every request carries `params.items`,
// one entry per target in the same order, in world pixels —
//
//   x y w h     the object's visual box (rotation included), the reference the maths works on;
//   left top    the object's own `left` / `top` as it renders now.
//
// The writer computes where each object should go and moves it by the difference, writing
// `style.left` / `style.top` (inline, px). It never converts a layout to free placement: an object
// that is not placed freely is refused by the canvas before it asks, and a style the file computes
// is refused here ("the same result by hand" is an edit of `left` / `top`).

import { applyEdit, CanvasEditError } from '../canvas-edit.ts';
import type { KeyedRect } from '../equal-spacing-detector.ts';
import type { ResolvedEditOp } from './types.ts';

export interface ArrangeItem {
  x: number;
  y: number;
  w: number;
  h: number;
  left: number;
  top: number;
}

const LIMIT = 1_000_000;
const UNKNOWN = 'The canvas did not say where the objects are; try again.';

function fail(req: ResolvedEditOp, message: string): never {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
}

/** `params.items`, checked: one finite entry per target. Throws a refusal a person can read. */
export function parseItems(req: ResolvedEditOp, min: number, what: string): ArrangeItem[] {
  const raw = req.params.items;
  if (req.targets.length < min) fail(req, `Select ${what} first.`);
  if (!Array.isArray(raw) || raw.length !== req.targets.length) fail(req, UNKNOWN);
  const out: ArrangeItem[] = [];
  for (const it of raw as unknown[]) {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    const n = (k: string): number => {
      const v = o[k];
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMIT) fail(req, UNKNOWN);
      return v as number;
    };
    out.push({ x: n('x'), y: n('y'), w: n('w'), h: n('h'), left: n('left'), top: n('top') });
  }
  return out;
}

export const keyedRects = (items: readonly ArrangeItem[]): KeyedRect[] =>
  items.map((it, i) => ({ key: String(i), x: it.x, y: it.y, w: it.w, h: it.h }));

export interface Move {
  /** index into targets */
  i: number;
  /** the new visual position (world px) */
  x: number;
  y: number;
}

/**
 * Move each target to its new box by writing `left` / `top`. `axes` limits what is written
 * (distribute on x never touches `top`). Returns the source unchanged when nothing moves.
 */
export function applyMoves(
  source: string,
  req: ResolvedEditOp,
  items: readonly ArrangeItem[],
  moves: readonly Move[],
  axes: { x: boolean; y: boolean } = { x: true, y: true }
): string {
  let out = source;
  for (const m of moves) {
    const it = items[m.i] as ArrangeItem;
    const t = req.targets[m.i] as ResolvedEditOp['targets'][number];
    const set = (prop: 'left' | 'top', value: number) => {
      out = applyEdit(
        req.file,
        out,
        t.element,
        `style.${prop}`,
        JSON.stringify(`${Math.round(value)}px`),
        t.occurrence
      ).source;
    };
    if (axes.x && Math.round(m.x) !== Math.round(it.x)) set('left', it.left + (m.x - it.x));
    if (axes.y && Math.round(m.y) !== Math.round(it.y)) set('top', it.top + (m.y - it.y));
  }
  return out;
}
