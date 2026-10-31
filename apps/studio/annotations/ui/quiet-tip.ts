/**
 * @file       annotations/ui/quiet-tip.ts — which quiet annotation a press in Edit landed on (r1, Michal rc.1 item 14)
 * @scope      apps/studio/annotations/ui/quiet-tip.ts
 * @purpose    In Edit the annotation layer is quiet by design (S4.9): faded, and every click reaches the design under
 *             it. A picture dropped from Finder on bare canvas lands on that layer, so in Edit it sat at 45 % and a
 *             click or a drag on it did nothing, with no word why. The layer asks this pure helper on each press and,
 *             when it names a stroke, shows `QUIET_MOVE_TIP` at the pointer (annotations/ui/locked.tsx). A press on an
 *             artboard is the design's: no tip. Pure: no React.
 */

import { type Stroke, strokeHitTest } from '../../annotations-model.ts';

/** The top-most stroke under a WORLD point, for a press whose target is bare canvas; else null. */
export function quietStrokeAt(
  strokes: readonly Stroke[],
  wx: number,
  wy: number,
  tol: number,
  target: Element | null
): Stroke | null {
  // a press on an artboard (or anything in it) selects the design, as Edit promises
  if (!target || target.closest?.('[data-dc-screen]')) return null;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i] as Stroke;
    if (strokeHitTest(s, wx, wy, tol)) return s;
  }
  return null;
}
