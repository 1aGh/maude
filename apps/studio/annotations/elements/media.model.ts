/**
 * The three media cards (DDR-242): `image` (a dropped raster), `link` (a URL
 * preview chip — no server fetch, DDR-054/060) and `mediaref` (a pointer to an
 * `assets/` video/audio clip, DDR-150 P4). All are solid rect cards whose only
 * external references are validated relative `assets/` paths or http(s) URLs.
 */

import {
  ASSET_IMAGE_HREF_RE,
  ASSET_MEDIA_SRC_RE,
  IMAGE_MIN_SIZE,
  LINK_URL_RE,
} from '../constants.ts';
import { oneOf, str } from '../fields.ts';
import type { ElementDef } from '../types.ts';
import { BOX_FIELDS, boxOf, ROT_FIELD, resizeBox, solidBoxHit, translateBox } from './_shared.ts';

const CARD_CAPS = {
  box: true,
  rotatable: true,
  resizable: true,
  bindable: false,
  container: false,
  textSlot: null,
} as const;

function card(
  type: string,
  fields: ElementDef['fields'],
  meaningful: ElementDef['meaningful']
): ElementDef {
  return {
    type,
    fields: { ...BOX_FIELDS, ...ROT_FIELD, ...fields },
    caps: CARD_CAPS,
    bounds: (el) => boxOf(el),
    hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
    translate: translateBox,
    resize: resizeBox,
    meaningful,
  };
}

export const image: ElementDef = {
  ...card(
    'image',
    {
      // A stripped/invalid href degrades to '' — an inert frame that fetches nothing.
      href: str({ max: 256, re: ASSET_IMAGE_HREF_RE, def: '', allowEmpty: true }),
      alt: str({ max: 500, plain: true, def: '', allowEmpty: true }),
    },
    (el) => {
      const b = boxOf(el);
      return b.w >= IMAGE_MIN_SIZE && b.h >= IMAGE_MIN_SIZE;
    }
  ),
  // Images take arrow binds (v1 parity: isBindable included image).
  caps: { ...CARD_CAPS, bindable: true },
};

export const link: ElementDef = card(
  'link',
  {
    url: str({ max: 2048, re: LINK_URL_RE, required: true }),
    title: str({ max: 300, plain: true, def: '', allowEmpty: true }),
    domain: str({ max: 253, plain: true, def: '', allowEmpty: true }),
  },
  (el) => typeof el.url === 'string' && el.url.length > 0
);

export const mediaref: ElementDef = card(
  'mediaref',
  {
    src: str({ max: 256, re: ASSET_MEDIA_SRC_RE, def: '', allowEmpty: true }),
    media: oneOf(['video', 'audio'] as const, 'video'),
    title: str({ max: 300, plain: true, def: '', allowEmpty: true }),
  },
  (el) => typeof el.src === 'string' && el.src.length > 0
);
