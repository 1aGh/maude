// edit-ops/distribute.ts — `distribute.h` · `distribute.v` (S2.7).
//
// Equal gaps on one axis: the objects are ordered by where they sit on the canvas (not by the order
// they were picked), the first and the last stay, and the ones between take equal gaps. Needs three
// or more objects (with two there is nothing between). Only the axis the verb names is written.

import { computeDistribute } from '../equal-spacing-detector.ts';
import { applyMoves, keyedRects, parseItems } from './arrange.ts';
import type { EditOp } from './types.ts';

function distributeOp(id: 'distribute.h' | 'distribute.v', axis: 'x' | 'y'): EditOp {
  return {
    id,
    apply(source, req) {
      const items = parseItems(req, 3, 'three or more objects to space evenly');
      const moves = computeDistribute(keyedRects(items), axis).map((m) => ({
        i: Number(m.key),
        x: m.x,
        y: m.y,
      }));
      return {
        source: applyMoves(source, req, items, moves, { x: axis === 'x', y: axis === 'y' }),
      };
    },
  };
}

export const distributeOps: readonly EditOp[] = [
  distributeOp('distribute.h', 'x'),
  distributeOp('distribute.v', 'y'),
];
