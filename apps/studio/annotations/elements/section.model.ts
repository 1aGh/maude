/**
 * Section (DDR-242) — a labelled container. Children name it as `parent` and
 * are positioned RELATIVE to its origin, so moving a section is one write and
 * nudge / align / duplicate / delete act on it as a subtree. Its interior is
 * click-through: only the border band and the title chip are hittable.
 */

import {
  DEFAULT_SECTION_COLOR,
  SECTION_LABEL_FONT,
  SECTION_LABEL_H,
  SECTION_MIN_SIZE,
} from '../constants.ts';
import { color, str } from '../fields.ts';
import type { AnnotationElement, Box, ElementDef } from '../types.ts';
import { BOX_FIELDS, boxOf, resizeBox, translateBox } from './_shared.ts';

const FIELDS = {
  ...BOX_FIELDS,
  label: str({ max: 200, plain: true, def: 'Section', allowEmpty: true }),
  color: color(DEFAULT_SECTION_COLOR),
};

/**
 * The title chip's box in WORLD units, given the current zoom. The chip is
 * drawn at a constant SCREEN size, so its world size is screen size / zoom —
 * the ONE definition every hit-test, eraser and connector uses (v1 had three
 * drifting copies, see the plan's Problem §5).
 */
export function sectionChipBox(el: AnnotationElement, zoom = 1): Box {
  const b = boxOf(el);
  const label = typeof el.label === 'string' ? el.label : 'Section';
  const z = zoom > 0 ? zoom : 1;
  const w = Math.max(56, label.length * SECTION_LABEL_FONT * 0.62 + 18) / z;
  const h = (SECTION_LABEL_H + 6) / z;
  return { x: b.x, y: b.y - h, w, h };
}

export const section: ElementDef = {
  type: 'section',
  fields: FIELDS,
  caps: {
    box: true,
    rotatable: false,
    resizable: true,
    bindable: true,
    container: true,
    textSlot: 'title',
  },
  bounds: (el) => boxOf(el),
  hitTest(el, px, py, tol) {
    const b = boxOf(el);
    const chip = sectionChipBox(el);
    if (px >= chip.x && px <= chip.x + chip.w && py >= chip.y && py <= b.y) return true;
    const t = Math.max(tol, 8);
    if (px < b.x - t || px > b.x + b.w + t || py < b.y - t || py > b.y + b.h + t) return false;
    return (
      Math.abs(px - b.x) <= t ||
      Math.abs(px - (b.x + b.w)) <= t ||
      Math.abs(py - b.y) <= t ||
      Math.abs(py - (b.y + b.h)) <= t
    );
  },
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => {
    const b = boxOf(el);
    return b.w >= SECTION_MIN_SIZE && b.h >= SECTION_MIN_SIZE;
  },
};
