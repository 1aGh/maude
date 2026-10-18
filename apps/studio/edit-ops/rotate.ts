// edit-ops/rotate.ts — `object.rotate` (S2.7: the rotate handle, the Rotation row's sibling).
//
// Rotation is `rotate(<n>deg)` inside the element's inline `transform`; everything else in the
// transform is kept (`words-css.ts` `withRotation`, the same function the Rotation row uses, so the
// handle and the row always agree). Each object turns about its own centre.
//
// params: `degrees` sets the angle (every target gets it); `by` adds to the angle each target has
// now. The result is kept in −180…180 and rounded to 0.01°; 0° takes the rotate out, and the whole
// `transform` when nothing else is left in it. A transform the file computes is refused.

import { applyEdit, applyRemove, CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import type { EditOp } from './types.ts';
import { rotationOf, withRotation } from './words-css.ts';

/** −180 < n ≤ 180, 2 decimals. */
export function normalizeDegrees(n: number): number {
  const r = Math.round((((((n + 180) % 360) + 360) % 360) - 180) * 100) / 100;
  return r === -180 ? 180 : r;
}

const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 100_000;

export const objectRotate: EditOp = {
  id: 'object.rotate',
  apply(source, req) {
    const { degrees, by } = req.params;
    const refuse = (message: string, id = req.targets[0]?.element ?? ''): never => {
      throw new CanvasEditError(message, { canvas: req.file, id });
    };
    if (!finite(degrees) && !finite(by)) refuse('Say how far to rotate.');

    let out = source;
    for (const t of req.targets) {
      const state = readAttributeState(req.file, out, t.element, 'style.transform', t.occurrence);
      if (state.kind === 'expression')
        refuse(`${t.element} turns by a computed value; change it in the code.`, t.element);
      const transform = state.kind === 'literal' ? state.value : undefined;
      const next = normalizeDegrees(
        finite(degrees) ? degrees : rotationOf(transform) + (by as number)
      );
      const value = withRotation(transform, next);
      if (value === (transform ?? null)) continue;
      out =
        value === null
          ? applyRemove(req.file, out, t.element, 'style.transform', t.occurrence).source
          : applyEdit(
              req.file,
              out,
              t.element,
              'style.transform',
              JSON.stringify(value),
              t.occurrence
            ).source;
    }
    return { source: out };
  },
};
