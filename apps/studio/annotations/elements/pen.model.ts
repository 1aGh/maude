/**
 * Freehand pen / highlighter (DDR-242, DDR-090: the highlighter is a pen flag).
 * Points are a flat `[x0, y0, x1, y1, …]` list in parent space.
 */

import { DEFAULT_INK, MAX_PEN_POINTS } from '../constants.ts';
import { bool, color, num, points } from '../fields.ts';
import type { AnnotationElement, Box, ElementDef } from '../types.ts';
import { get, pointSegmentDist } from './_shared.ts';

const FIELDS = {
  points: points(MAX_PEN_POINTS),
  color: color(DEFAULT_INK),
  width: num({ min: 0.5, max: 128, dp: 1, def: 2 }),
  highlighter: bool(),
};

function pts(el: AnnotationElement): number[] {
  return Array.isArray(el.points) ? (el.points as number[]) : [];
}

export function penBounds(p: readonly number[]): Box | null {
  if (p.length < 2) return null;
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i] as number;
    const y = p[i + 1] as number;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

export const pen: ElementDef = {
  type: 'pen',
  fields: FIELDS,
  caps: {
    box: false,
    rotatable: false,
    resizable: true,
    bindable: false,
    container: false,
    textSlot: null,
  },
  bounds: (el) => penBounds(pts(el)),
  hitTest(el, px, py, tol) {
    const p = pts(el);
    const t = Math.max(tol, get<number>(FIELDS, el, 'width'));
    if (p.length === 2) return Math.hypot(px - (p[0] as number), py - (p[1] as number)) <= t;
    for (let i = 2; i + 1 < p.length; i += 2) {
      const d = pointSegmentDist(
        px,
        py,
        p[i - 2] as number,
        p[i - 1] as number,
        p[i] as number,
        p[i + 1] as number
      );
      if (d <= t) return true;
    }
    return false;
  },
  translate(el, dx, dy) {
    return { points: pts(el).map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
  },
  resize(el, box) {
    const p = pts(el);
    const cur = penBounds(p);
    if (!cur) return {};
    const sx = cur.w > 0 ? box.w / cur.w : 1;
    const sy = cur.h > 0 ? box.h / cur.h : 1;
    return {
      points: p.map((v, i) => (i % 2 === 0 ? box.x + (v - cur.x) * sx : box.y + (v - cur.y) * sy)),
    };
  },
  meaningful: (el) => pts(el).length >= 4,
};
