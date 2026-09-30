/** Sticky note — a paper card with a wrapped text body (DDR-242). */

import {
  DEFAULT_FONT_SIZE,
  DEFAULT_STICKY_FILL,
  STICKY_MIN_SIZE,
  STICKY_RADIUS,
} from '../constants.ts';
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

export const sticky: ElementDef = {
  type: 'sticky',
  fields: {
    ...BOX_FIELDS,
    ...ROT_FIELD,
    fill: color(DEFAULT_STICKY_FILL),
    text: text(),
    fontSize: num({ min: 4, max: 400, dp: 1, def: DEFAULT_FONT_SIZE }),
    radius: num({ min: 0, max: 200, dp: 1, def: STICKY_RADIUS }),
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
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => {
    const b = boxOf(el);
    return b.w >= STICKY_MIN_SIZE && b.h >= STICKY_MIN_SIZE;
  },
};
