// client/v2/kinds/kind-filter-model.js — S7.24: the kind filter as data (08 · ak-mixed-fit, ak-mixed-filter,
// 05 · es-filter). PURE — no React, no DOM, no store.
//
// The chips are All · Fixed size · Web page · Print · Video. The counts come from the project index's artboard
// kinds (`indexMeta` → a canvas's `boards`): a canvas counts ONCE under each kind it has, and under All once
// whatever it holds ("A canvas counts once under each kind it has", 08). A canvas with no artboards is only
// in All. `social` is the old name of `digital` (`normaliseKind`).

import { normaliseKind } from '../canvases/jump-model.js';

/** The chips, left to right (08 · KindChips order). */
export const KIND_CHIPS = Object.freeze(['all', 'digital', 'web', 'print', 'video']);

/** The kinds a filter can name. */
export const FILTER_KINDS = Object.freeze(['digital', 'web', 'print', 'video']);

/** The words on a chip (08 · KIND_WORD) — the same words as the artboard inspector's Kind row. */
export const KIND_WORD = Object.freeze({
  all: 'All',
  digital: 'Fixed size',
  web: 'Web page',
  print: 'Print',
  video: 'Video',
});

/** What a canvas HAS of a kind, in a sentence: "12 of 93 canvases have video". */
const HAVE = Object.freeze({
  digital: 'fixed size artboards',
  web: 'web pages',
  print: 'print',
  video: 'video',
});

/** Mid-sentence word for a kind: "No print canvases in …". */
const LOWER = Object.freeze({
  digital: 'fixed size',
  web: 'web page',
  print: 'print',
  video: 'video',
});

/** Is `k` a kind a filter can be on? ('all' is the absence of a filter.) */
export const isFilterKind = (k) => FILTER_KINDS.includes(k);

/** A canvas's artboards as `Map<kind, n>` — `boards` is `[{ kind }]` (indexMeta's shape). */
export function boardKinds(boards) {
  const n = new Map();
  for (const b of boards || []) {
    const k = normaliseKind(b?.kind) || 'web';
    n.set(k, (n.get(k) || 0) + 1);
  }
  return n;
}

/** How many of `canvas`'s artboards are of `kind` (0 when it has none, or when `kind` is 'all'/unknown). */
export function kindBoards(canvas, kind) {
  if (!isFilterKind(kind)) return 0;
  return boardKinds(canvas?.boards).get(kind) || 0;
}

/** Does `canvas` have at least one artboard of `kind`? */
export const hasKind = (canvas, kind) => kindBoards(canvas, kind) > 0;

/**
 * `{ all, digital, web, print, video }` for a list of canvas nodes: how many canvases have each kind, one count
 * per canvas per kind (a canvas of 6 artboards, one of them video, is 1 under Video).
 */
export function countByKind(canvases) {
  const out = { all: 0, digital: 0, web: 0, print: 0, video: 0 };
  for (const c of canvases || []) {
    out.all++;
    for (const k of boardKinds(c?.boards).keys()) if (k in out && k !== 'all') out[k]++;
  }
  return out;
}

/** "2 of 3" — how many of a canvas's artboards match the filter (the hit's meta, 08 · CanvasHit). */
export function hitCount(canvas, kind) {
  const total = (canvas?.boards || []).length;
  return `${kindBoards(canvas, kind)} of ${total}`;
}

/** The chip's accessible name: "Print, 2" (08 · KindChips aria-label). */
export const chipName = (kind, count) => `${KIND_WORD[kind] || KIND_WORD.all}, ${count}`;

/**
 * The words under the list while a kind filter is on (08 · ak-mixed-filter):
 * "12 of 93 canvases have video. A canvas counts once under each kind it has."
 */
export function kindFilterFoot({ kind, matching, total }) {
  if (!isFilterKind(kind)) return '';
  return `${matching} of ${total} canvases have ${HAVE[kind]}. A canvas counts once under each kind it has.`;
}

/**
 * A filter that hides every canvas says WHICH filter and how to undo it (05 · es-filter, the Canvases side):
 * the kit's block takes these words directly.
 */
export function noCanvasesOfKind({ kind, project, total }) {
  const word = KIND_WORD[kind] || '';
  return {
    title: `No ${LOWER[kind] || ''} canvases${project ? ` in ${project}` : ''}.`,
    next: `The ${word} filter is on. Clear it to see all ${total} canvases.`,
    action: 'Clear filter',
  };
}
