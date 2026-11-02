// edit-ops/place-freely.ts — `object.place-freely` (S2.11, ed-lay-free: "Place freely").
//
// An object that sits in an auto layout is placed by its frame. Place freely makes X and Y its own:
// it keeps the box it has now and stops being arranged — `position: absolute` with `left`, `top`,
// `width` and `height` in its inline style. Plain CSS, never `data-cd-*` (V2-1.4); the frame's other
// children close the gap, which is what leaving a layout means.
//
// params: `x` `y` `w` `h` — the object's box inside its frame in world px, which the canvas measures
// (the margin already taken off x / y, since `left` is where the margin edge goes). When the frame
// is not itself placed (`position: static`) the canvas sends `relativeParent: true` and the frame as
// the SECOND target; it gets `position: relative` so the numbers mean what they say.
//
// An object already placed freely writes nothing. A position the file computes is refused.

import { finiteParam, inlinePosition, PLACED_FREELY, writeStyle } from './constraints.ts';
import type { EditOp } from './types.ts';

const px = (n: number) => `${Math.round(n)}px`;

export const objectPlaceFreely: EditOp = {
  id: 'object.place-freely',
  apply(source, req) {
    const child = req.targets[0];
    if (!child) return { source };
    const x = finiteParam(req, 'x');
    const y = finiteParam(req, 'y');
    const w = finiteParam(req, 'w');
    const h = finiteParam(req, 'h');
    const position = inlinePosition(source, req, child);
    if (position && PLACED_FREELY.test(position)) return { source };
    let out = writeStyle(source, req, child, {
      position: 'absolute',
      left: px(x),
      top: px(y),
      width: px(w),
      height: px(h),
    });
    const frame =
      (req.params as Record<string, unknown>).relativeParent === true ? req.targets[1] : null;
    if (frame) {
      const framePos = inlinePosition(out, req, frame);
      if (!framePos || framePos === 'static')
        out = writeStyle(out, req, frame, { position: 'relative' });
    }
    return { source: out };
  },
};
