// client/v2/ds/reach-model.js — S10.9: the arithmetic and the words of the reach view (13 · ds-edit-reach,
// "Used in 5 canvases · Show"). Pure: no React, no fetch, no DOM.
//
// The usage index (S10.5, `GET /_api/ds/usage?ds=&css=`) says, per canvas, how many places use a token, how many
// of those sit in each artboard, and WHICH elements (`data-cd-id`, with the artboard they are in — Q11). This file
// turns that into what the view draws: one frame per artboard that has places, the element ids to ring in each,
// and the words of the tags ("4 patterns · 21 places", "14 places"). Positions never come from here — only a live
// render knows them (the canvas answers `ds-rects`), and `ringsFor` turns that answer into rings.
//
// A frame is an artboard ("Homepage · Desktop"). A "pattern" is such an artboard: a screen the colour lands on.
// The view shows at most FRAMES_SHOWN frames; the rest are named in a line ("… are in the review too"), because
// the review list (review-sheet / the island beside the frames) is the whole list and the view is a preview of it.
// Ring ids are capped at RING_CAP in all (the dgn table caps one request at the same number).

export const RING_CAP = 500;
export const FRAMES_SHOWN = 4;

const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const placesWords = (n) => plural(n, 'place', 'places');
export const patternsWords = (n) => plural(n, 'pattern', 'patterns');
/** "4 patterns · 21 places" — the tag on the whole view. */
export const reachTag = (patterns, places) => `${patternsWords(patterns)} · ${placesWords(places)}`;

const nameOf = (rel) =>
  String(rel)
    .replace(/^.*\//, '')
    .replace(/\.tsx$/i, '');

/** "ab-hero-desktop" → "Hero desktop" (a label when the canvas has not told us the artboard's own). */
export function artboardWords(id) {
  const words = String(id)
    .replace(/^ab[-_]/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Artboard';
}

const intOr0 = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/**
 * @param {{ canvases?: Array<{ rel: string, places?: number, artboards?: Record<string, number>,
 *           elements?: Array<{ artboard: string | null, id: string }> }> } | null | undefined} usage
 * @param {{ frames?: number, cap?: number }} [opts]
 * @returns {{
 *   places: number, patterns: number, tag: string, capped: boolean, ringed: number,
 *   frames: Array<{ key: string, rel: string, canvas: string, artboard: string, label: string, places: number, ids: string[] }>,
 *   more: Array<{ rel: string, canvas: string, artboard: string, places: number }>,
 *   canvases: number,
 * }}
 */
export function reachModel(usage, opts = {}) {
  const shown = Number.isInteger(opts.frames) && opts.frames >= 0 ? opts.frames : FRAMES_SHOWN;
  const cap = Number.isInteger(opts.cap) && opts.cap >= 0 ? opts.cap : RING_CAP;
  const list = Array.isArray(usage?.canvases) ? usage.canvases : [];

  /** one entry per (canvas, artboard) that has a place */
  const all = [];
  let places = 0;
  let canvases = 0;
  for (const c of list) {
    if (!c || typeof c.rel !== 'string') continue;
    const total = intOr0(c.places);
    if (total === 0) continue;
    canvases += 1;
    places += total;
    const byBoard = new Map();
    for (const [id, n] of Object.entries(c.artboards ?? {})) {
      if (typeof id === 'string' && id && intOr0(n) > 0)
        byBoard.set(id, { places: intOr0(n), ids: [] });
    }
    for (const e of Array.isArray(c.elements) ? c.elements : []) {
      if (!e || typeof e.id !== 'string' || !ID.test(e.id)) continue;
      if (typeof e.artboard !== 'string' || !e.artboard) continue; // outside every artboard: nothing to frame
      const slot = byBoard.get(e.artboard) ?? { places: 0, ids: [] };
      if (!slot.ids.includes(e.id)) slot.ids.push(e.id);
      byBoard.set(e.artboard, slot);
    }
    for (const [artboard, slot] of byBoard) {
      all.push({
        key: `${c.rel}#${artboard}`,
        rel: c.rel,
        canvas: nameOf(c.rel),
        artboard,
        label: `${nameOf(c.rel)} · ${artboardWords(artboard)}`,
        places: Math.max(slot.places, slot.ids.length),
        ids: slot.ids,
      });
    }
  }
  // the busiest artboard first; ties keep the index order (stable)
  all.sort((a, b) => b.places - a.places);

  // The ring budget goes to the frames in order; the frames past the budget lose their rings, not their place.
  let budget = cap;
  let ringed = 0;
  let capped = false;
  for (const f of all) {
    if (f.ids.length > budget) {
      f.ids = f.ids.slice(0, budget);
      capped = true;
    }
    budget -= f.ids.length;
    ringed += f.ids.length;
  }
  const frames = all.slice(0, shown);
  const more = all.slice(shown).map((f) => ({
    rel: f.rel,
    canvas: f.canvas,
    artboard: f.artboard,
    places: f.places,
  }));
  return {
    places,
    patterns: all.length,
    tag: reachTag(all.length, places),
    capped,
    ringed,
    frames,
    more,
    canvases,
  };
}

/** "Onboarding, Mobile — detail and Landing page are in the review too" (the canvases past the frames). */
export function moreWords(more) {
  const names = [];
  for (const m of more) if (!names.includes(m.canvas)) names.push(m.canvas);
  if (names.length === 0) return '';
  const head = names.slice(0, 3);
  const rest = names.length - head.length;
  const joined =
    head.length === 1 ? head[0] : `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`;
  return `${joined}${rest > 0 ? ` and ${rest} more` : ''} ${names.length === 1 && rest === 0 ? 'is' : 'are'} in the review too`;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The rings of one frame: the canvas's answer to `ds-rects` (rects in the frame's own pixels) → the rects to
 * draw, only for ids we asked about, only inside the frame, capped.
 * @param {{ rects?: Array<{ id: string, x: number, y: number, w: number, h: number }> } | null} reply
 * @param {string[]} wanted
 * @param {{ w: number, h: number }} view  the frame's size in its own pixels
 */
export function ringsFor(reply, wanted, view, cap = RING_CAP) {
  const want = new Set(wanted);
  const out = [];
  const W = num(view?.w);
  const H = num(view?.h);
  if (W === null || H === null || W <= 0 || H <= 0) return out;
  for (const r of Array.isArray(reply?.rects) ? reply.rects : []) {
    if (out.length >= cap) break;
    if (!r || typeof r.id !== 'string' || !want.has(r.id)) continue;
    const x = num(r.x);
    const y = num(r.y);
    const w = num(r.w);
    const h = num(r.h);
    if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) continue;
    // wholly outside the frame: not seen, not ringed
    if (x >= W || y >= H || x + w <= 0 || y + h <= 0) continue;
    out.push({ id: r.id, x, y, w, h });
  }
  return out;
}
