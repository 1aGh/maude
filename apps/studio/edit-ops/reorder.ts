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

import {
  applyDuplicateElement,
  applyMove,
  CanvasEditError,
  type MovePosition,
} from '../canvas-edit.ts';
import type { EditOp } from './types.ts';
import { objectBringForward, objectSendBackward } from './z-order.ts';

const POSITIONS: readonly string[] = ['before', 'after', 'inside-start', 'inside-end'];

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
    if (moved.element === ref.element && (moved.occurrence ?? 0) === (ref.occurrence ?? 0))
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
