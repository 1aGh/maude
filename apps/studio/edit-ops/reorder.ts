// edit-ops/reorder.ts — `object.reorder-earlier` · `object.reorder-later` · `object.reorder-to`
// (S2.11, ed-lay-reorder).
//
// In an auto layout the order of the children in the code IS the order on the canvas (and the
// Layers panel), so reordering is one move of source text and nothing else:
//   · earlier / later — one step among its siblings (← → in an auto layout). Same permutation as
//     z-order's [ ] (stacking is source order too); the ids are separate because the words differ
//     and a frame's arrow keys must not read as "send backward".
//   · reorder-to — the drop of a drag: the object goes before / after / inside a neighbour (the
//     SECOND target, so the dispatcher stamps it too). `copy: true` is ⌥-drag: the original stays
//     and a copy lands in the slot, ids and locks not inherited (applyDuplicateElement's rule).
// One request = one write = one action, whatever the move was.
//
// params (reorder-to): `position` — before · after · inside-start · inside-end; `copy` — boolean.
//   r1 #15 — an ⌥-drag of a PLACED object (`position: absolute`) has no slot to land in: it names the object itself as
//   the neighbour (`after`), `copy: true` and `at: {left, top}` (the drop, in the frame's px); the copy goes right
//   after the original in the code and takes those two numbers. Still one write, one action, one ⌘Z.

import {
  applyDuplicateElement,
  applyMove,
  CanvasEditError,
  type MovePosition,
} from '../canvas-edit.ts';
import { writeStyle } from './constraints.ts';
import type { EditOp } from './types.ts';
import { objectBringForward, objectSendBackward } from './z-order.ts';

const POSITIONS: readonly string[] = ['before', 'after', 'inside-start', 'inside-end'];

const px = (n: number) => `${Math.round(n)}px`;

/** `at: {left, top}` — finite numbers inside the canvas's range, or null. */
function placedAt(v: unknown): { left: number; top: number } | null {
  if (!v || typeof v !== 'object') return null;
  const { left, top } = v as Record<string, unknown>;
  const ok = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100_000;
  return ok(left) && ok(top) ? { left, top } : null;
}

export const objectReorderEarlier: EditOp = {
  id: 'object.reorder-earlier',
  apply: objectSendBackward.apply,
};
export const objectReorderLater: EditOp = {
  id: 'object.reorder-later',
  apply: objectBringForward.apply,
};

export const objectReorderTo: EditOp = {
  id: 'object.reorder-to',
  apply(source, req) {
    const moved = req.targets[0];
    const ref = req.targets[1];
    const fail = (message: string): never => {
      throw new CanvasEditError(message, { canvas: req.file, id: moved?.element ?? '' });
    };
    if (!moved || !ref) return fail('Say where it goes: drop it next to another object.');
    const params = req.params as Record<string, unknown>;
    const position = params.position;
    if (typeof position !== 'string' || !POSITIONS.includes(position))
      return fail('Say where it goes: before, after or inside.');
    const self = moved.element === ref.element && (moved.occurrence ?? 0) === (ref.occurrence ?? 0);
    const at = placedAt(params.at);
    if (self && !(params.copy === true && position === 'after' && at))
      return fail('It cannot go next to itself.');
    let from = moved.element;
    let fromIndex = moved.occurrence;
    let out = source;
    if (params.copy === true) {
      const dup = applyDuplicateElement(req.file, out, moved.element, moved.occurrence);
      out = dup.source;
      // the copy is what moves; when its id cannot be resolved it stays beside the original
      if (!dup.newId) return { source: out };
      from = dup.newId;
      fromIndex = undefined;
      // a placed object's copy: it already sits right after the original; it takes the drop's left / top
      if (self && at) {
        const copy = { ...moved, element: dup.newId, occurrence: undefined };
        out = writeStyle(out, req, copy, { left: px(at.left), top: px(at.top) });
        return { source: out, created: [{ artboard: moved.artboard, element: dup.newId }] };
      }
    } else if (params.at !== undefined) {
      return fail('Only a copy takes a place of its own.');
    }
    out = applyMove(
      req.file,
      out,
      from,
      ref.element,
      position as MovePosition,
      fromIndex,
      ref.occurrence
    ).source;
    return { source: out };
  },
};

export const reorderOps: readonly EditOp[] = [
  objectReorderEarlier,
  objectReorderLater,
  objectReorderTo,
];
