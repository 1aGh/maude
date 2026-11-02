// edit-ops/align.ts — `align.left` · `align.hcentre` · `align.right` · `align.top` · `align.vmiddle`
// · `align.bottom` (S2.7: the align bar over a multi-selection, ed-obj-multi).
//
// The reference is the selection's own bounds (the box around everything selected), as in every
// design tool: Left puts every object's left edge on the leftmost one, Centre on the middle of the
// box, and so on. Only the axis the verb names is written. Needs two or more objects. See
// arrange.ts for the request shape (`params.items`) and what is written.

import { computeAlign } from '../equal-spacing-detector.ts';
import { applyMoves, keyedRects, parseItems } from './arrange.ts';
import type { EditOp } from './types.ts';

const MODES = {
  'align.left': { mode: 'left', axis: 'x' },
  'align.hcentre': { mode: 'center-x', axis: 'x' },
  'align.right': { mode: 'right', axis: 'x' },
  'align.top': { mode: 'top', axis: 'y' },
  'align.vmiddle': { mode: 'center-y', axis: 'y' },
  'align.bottom': { mode: 'bottom', axis: 'y' },
} as const;

export type AlignOpId = keyof typeof MODES;
export const ALIGN_OP_IDS = Object.keys(MODES) as AlignOpId[];

function alignOp(id: AlignOpId): EditOp {
  const { mode, axis } = MODES[id];
  return {
    id,
    apply(source, req) {
      const items = parseItems(req, 2, 'two or more objects to align');
      const moves = computeAlign(keyedRects(items), mode).map((m) => ({
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

export const alignOps: readonly EditOp[] = ALIGN_OP_IDS.map(alignOp);
