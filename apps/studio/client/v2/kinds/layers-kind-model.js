// client/v2/kinds/layers-kind-model.js — S7.24b: the Layers half of the kind filter (08 · ak-mixed-fit,
// 05 · es-filter). PURE — no React, no DOM, no store.
//
// Canvases counts CANVASES under each kind (kind-filter-model.js); Layers counts the ARTBOARDS of the open canvas:
// Combine-kampan is 21 artboards, 19 fixed size + 2 print. The filter does not hide an artboard — it dims the ones
// outside the kind on the canvas (`dim-artboards`) and says how many ("19 other artboards are dimmed. Show all").
// `boards` is the index's `[{ id, label, kind }]` (indexMeta → boards).

import { normaliseKind } from '../canvases/jump-model.js';
import { FILTER_KINDS, isFilterKind, KIND_WORD } from './kind-filter-model.js';

/** The most artboard ids one `dim-artboards` carries (the bridge row refuses a longer list whole). */
export const DIM_IDS_MAX = 500;

const kindOf = (b) => normaliseKind(b?.kind) || 'web';

/** `{ all, digital, web, print, video }` — how many ARTBOARDS of the open canvas are of each kind. */
export function artboardCounts(boards) {
  const out = { all: 0, digital: 0, web: 0, print: 0, video: 0 };
  for (const b of boards || []) {
    out.all++;
    const k = kindOf(b);
    if (k in out && k !== 'all') out[k]++;
  }
  return out;
}

/**
 * The artboard ids to dim while the filter is on `kind`: every artboard that is not of it. `null` = dim nothing
 * (no filter, a kind that is not one, or no artboards known). Capped at DIM_IDS_MAX.
 */
export function dimIds(boards, kind) {
  if (!isFilterKind(kind) || !Array.isArray(boards) || boards.length === 0) return null;
  const ids = [];
  for (const b of boards) {
    if (typeof b?.id === 'string' && kindOf(b) !== kind) ids.push(b.id);
    if (ids.length >= DIM_IDS_MAX) break;
  }
  return ids;
}

/** How many artboards sit outside the filter. */
export function otherCount(boards, kind) {
  if (!isFilterKind(kind)) return 0;
  return (boards || []).filter((b) => kindOf(b) !== kind).length;
}

/** The sentence under the Layers list while the filter dims something: "19 other artboards are dimmed." */
export function layersFoot({ boards, kind }) {
  const n = otherCount(boards, kind);
  if (!n) return '';
  return n === 1 ? '1 other artboard is dimmed.' : `${n} other artboards are dimmed.`;
}

/** The label on the foot's way out. */
export const SHOW_ALL = 'Show all';

/** Mid-sentence word for a kind ("fixed size", "web page"). */
const LOWER = Object.freeze({
  digital: 'fixed size',
  web: 'web page',
  print: 'print',
  video: 'video',
});

/** The same words after "is" — with their article ("The one artboard here is a web page."). */
const A_KIND = Object.freeze({
  digital: 'a fixed size artboard',
  web: 'a web page',
  print: 'a print artboard',
  video: 'a video',
});

const orJoin = (xs) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`;

/**
 * A filter that matches no artboard of the open canvas (05 · es-filter, the Layers side): it says WHICH filter is
 * on, what the canvas has instead, and how to undo it. The artboards stay on the canvas, only dimmed.
 */
export function noArtboardsOfKind({ kind, canvas, boards }) {
  const total = (boards || []).length;
  const have = FILTER_KINDS.filter((k) => (boards || []).some((b) => kindOf(b) === k));
  const what = orJoin(have.map((k) => LOWER[k]));
  return {
    title: `No ${LOWER[kind] || ''} artboards${canvas ? ` in ${canvas}` : ''}.`,
    next:
      total === 1
        ? `The ${KIND_WORD[kind] || ''} filter is on. The one artboard here is ${A_KIND[have[0]] ?? what}.`
        : `The ${KIND_WORD[kind] || ''} filter is on. All ${total} artboards here are ${what}.`,
    action: 'Clear filter',
  };
}
