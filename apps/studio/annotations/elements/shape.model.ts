/**
 * Closed shape (DDR-242) — rect / ellipse / diamond / triangle / triangle-down
 * in ONE type with a `kind` field, so converting a shape is a field change that
 * keeps its id, binds and label. The label is an embedded record (Excalidraw
 * "bound text"): exactly one per shape, by construction.
 */

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_INK,
  SHAPE_KINDS,
  SHAPE_MIN_SIZE,
  type ShapeKind,
} from '../constants.ts';
import { bool, color, fill, num, oneOf, record, text } from '../fields.ts';
import type { AnnotationElement, Box, ElementDef } from '../types.ts';
import {
  BOX_FIELDS,
  boxOf,
  get,
  inBox,
  pointSegmentDist,
  ROT_FIELD,
  resizeBox,
  textStyleFields,
  toLocal,
  translateBox,
} from './_shared.ts';

export const LABEL_FIELDS = {
  text: text(),
  fontSize: num({ min: 4, max: 400, dp: 1, def: DEFAULT_FONT_SIZE }),
  color: color(DEFAULT_INK),
  ...textStyleFields('center'),
};

const FIELDS = {
  kind: oneOf(SHAPE_KINDS, 'rect'),
  ...BOX_FIELDS,
  ...ROT_FIELD,
  color: color(DEFAULT_INK),
  width: num({ min: 0.5, max: 64, dp: 1, def: 2 }),
  fill: fill(),
  radius: num({ min: 0, max: 1000, dp: 1, def: 0 }),
  dashed: bool(),
  label: record(LABEL_FIELDS, { def: {} }),
};

/** Outline vertices of the polygon kinds, spanning the full box. */
export function polygonVertices(kind: ShapeKind, b: Box): Array<[number, number]> {
  const { x, y, w, h } = b;
  if (kind === 'diamond') {
    return [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
  }
  if (kind === 'triangle') {
    return [
      [x + w / 2, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  return [
    [x, y],
    [x + w, y],
    [x + w / 2, y + h],
  ];
}

function pointInPolygon(px: number, py: number, pts: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as [number, number];
    const b = pts[j] as [number, number];
    if (a[1] > py !== b[1] > py && px < ((b[0] - a[0]) * (py - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function shapeHit(el: AnnotationElement, px: number, py: number, tol: number): boolean {
  const b = boxOf(el);
  const [lx, ly] = toLocal(el, b, px, py);
  const kind = get<ShapeKind>(FIELDS, el, 'kind');
  const filled = get<string | null>(FIELDS, el, 'fill') != null;
  const t = Math.max(tol, get<number>(FIELDS, el, 'width'));
  if (kind === 'ellipse') {
    const rx = b.w / 2;
    const ry = b.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const nx = (lx - (b.x + rx)) / rx;
    const ny = (ly - (b.y + ry)) / ry;
    const d = nx * nx + ny * ny;
    if (filled) return d <= 1 + t / Math.max(rx, ry);
    return Math.abs(Math.sqrt(d) - 1) <= t / Math.max(rx, ry);
  }
  if (kind === 'rect') {
    if (filled) return inBox(b, lx, ly, t);
    if (!inBox(b, lx, ly, t)) return false;
    return (
      Math.abs(lx - b.x) <= t ||
      Math.abs(lx - (b.x + b.w)) <= t ||
      Math.abs(ly - b.y) <= t ||
      Math.abs(ly - (b.y + b.h)) <= t
    );
  }
  const pts = polygonVertices(kind, b);
  if (filled && pointInPolygon(lx, ly, pts)) return true;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as [number, number];
    const c = pts[(i + 1) % pts.length] as [number, number];
    if (pointSegmentDist(lx, ly, a[0], a[1], c[0], c[1]) <= t) return true;
  }
  return false;
}

export const shape: ElementDef = {
  type: 'shape',
  fields: FIELDS,
  caps: {
    box: true,
    rotatable: true,
    resizable: true,
    bindable: true,
    container: false,
    textSlot: 'label',
  },
  bounds: (el) => boxOf(el),
  hitTest: (el, px, py, tol) => shapeHit(el, px, py, tol),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => {
    const b = boxOf(el);
    return b.w >= SHAPE_MIN_SIZE && b.h >= SHAPE_MIN_SIZE;
  },
};
