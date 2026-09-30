/**
 * @file       annotations/elements/_shared.ts — helpers shared by element definitions
 * @scope      apps/studio/annotations/elements/_shared.ts
 * @purpose    Box fields, text-style fields and the rotation-aware box
 *             hit-test most element types reuse. A new element type composes
 *             these; it never re-implements them.
 */

import { bool, type FieldSpecMap, fieldValue, num, oneOf } from '../fields.ts';
import type { AnnotationElement, Box } from '../types.ts';

export const ALIGNS = ['left', 'center', 'right'] as const;
export const LISTS = ['bullet', 'number'] as const;

/** Geometry of every box-shaped element. `w`/`h` are always normalized (≥ 0). */
export const BOX_FIELDS: FieldSpecMap = {
  x: num({ required: true }),
  y: num({ required: true }),
  w: num({ min: 0, required: true }),
  h: num({ min: 0, required: true }),
};

export const ROT_FIELD: FieldSpecMap = { rot: num({ min: -180, max: 180, dp: 1, def: 0 }) };

/** Whole-element text formatting (DDR-091: list markers are render-only). */
export function textStyleFields(defAlign: (typeof ALIGNS)[number]): FieldSpecMap {
  return {
    bold: bool(),
    italic: bool(),
    strike: bool(),
    underline: bool(),
    list: oneOf(LISTS),
    align: oneOf(ALIGNS, defAlign),
  };
}

export function n(el: AnnotationElement, key: string): number {
  const v = el[key];
  return typeof v === 'number' ? v : 0;
}

export function boxOf(el: AnnotationElement): Box {
  return { x: n(el, 'x'), y: n(el, 'y'), w: n(el, 'w'), h: n(el, 'h') };
}

export function rotOf(el: AnnotationElement): number {
  return n(el, 'rot');
}

/** Rotate (px, py) around (cx, cy) by `deg` clockwise. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): [number, number] {
  if (deg === 0) return [px, py];
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Inverse-rotate a probe into the element's local (unrotated) frame. */
export function toLocal(el: AnnotationElement, box: Box, px: number, py: number): [number, number] {
  const rot = rotOf(el);
  if (rot === 0) return [px, py];
  return rotatePoint(px, py, box.x + box.w / 2, box.y + box.h / 2, -rot);
}

export function inBox(b: Box, px: number, py: number, tol: number): boolean {
  return px >= b.x - tol && px <= b.x + b.w + tol && py >= b.y - tol && py <= b.y + b.h + tol;
}

export function pointSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Minimum grab tolerance of solid cards (v1 parity: cards have no stroke width, so 2). */
export const CARD_MIN_TOL = 2;

/** Solid card: the whole (rotated) box is hittable, with at least `minTol` slack. */
export function solidBoxHit(
  el: AnnotationElement,
  px: number,
  py: number,
  tol: number,
  minTol = CARD_MIN_TOL
): boolean {
  const b = boxOf(el);
  const [lx, ly] = toLocal(el, b, px, py);
  return inBox(b, lx, ly, Math.max(tol, minTol));
}

export function translateBox(
  el: AnnotationElement,
  dx: number,
  dy: number
): Record<string, unknown> {
  return { x: n(el, 'x') + dx, y: n(el, 'y') + dy };
}

export function resizeBox(_el: AnnotationElement, box: Box): Record<string, unknown> {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

/** Read a field with its spec default applied. */
export function get<T>(spec: FieldSpecMap, el: AnnotationElement, key: string): T {
  return fieldValue(spec, el, key) as T;
}
