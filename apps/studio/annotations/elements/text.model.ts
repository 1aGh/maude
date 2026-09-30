/**
 * Standalone text (DDR-242). Unlike v1, its box is STORED (measured by the
 * editor at commit) instead of estimated from a character count, so hit-test,
 * marquee, snapping and headless readers agree with what is drawn. A shape's
 * label is NOT a text element — it lives on the shape (`shape.label`).
 */

import { DEFAULT_FONT_SIZE, DEFAULT_INK } from '../constants.ts';
import { color, num, text } from '../fields.ts';
import type { ElementDef } from '../types.ts';
import {
  BOX_FIELDS,
  boxOf,
  ROT_FIELD,
  resizeBox,
  solidBoxHit,
  textStyleFields,
  translateBox,
} from './_shared.ts';

/** Text blocks larger than this don't take arrow binds (a paragraph is not a node). */
export const MAX_TEXT_BIND_W = 1200;
export const MAX_TEXT_BIND_H = 480;

export const textEl: ElementDef = {
  type: 'text',
  fields: {
    ...BOX_FIELDS,
    ...ROT_FIELD,
    text: text(),
    fontSize: num({ min: 4, max: 400, dp: 1, def: DEFAULT_FONT_SIZE }),
    color: color(DEFAULT_INK),
    ...textStyleFields('left'),
  },
  caps: {
    box: true,
    rotatable: true,
    resizable: true,
    bindable: true,
    container: false,
    textSlot: 'text',
  },
  bounds: (el) => boxOf(el),
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol, 0),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => typeof el.text === 'string' && el.text.trim().length > 0,
};

export function textBindable(w: number, h: number): boolean {
  return w > 0 && h > 0 && w <= MAX_TEXT_BIND_W && h <= MAX_TEXT_BIND_H;
}
