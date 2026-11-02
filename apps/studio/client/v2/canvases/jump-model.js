// client/v2/canvases/jump-model.js — S1.3: the jump list as data (11 · pn-jump, 01 · cf-open-big).
//
// PURE. A canvas row opens into its artboards; a click glides the canvas there. This file holds what the
// list says (counts per kind, the foot, what a dynamic canvas admits) and what a click DOES — as the exact
// messages for the canvas iframe, so the one place that posts them is a plain loop and the choice between
// the glide and today's jump is a tested function.

// (tree-model imports this file, so `plural` is written here again rather than imported back.)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Kinds in the order a person reads them; "social" is the old name of the digital slot. */
export const KIND_ORDER = Object.freeze(['web', 'digital', 'print', 'video']);
const KIND_ALIAS = { social: 'digital' };
export const normaliseKind = (k) => KIND_ALIAS[k] || k || '';

/** Plain words for the kind glyph's tooltip / accessible name. */
export const KIND_LABEL = Object.freeze({
  web: 'Web',
  digital: 'Digital',
  print: 'Print',
  video: 'Video',
});

/** `[{ kind, count }]` for `boards`, in KIND_ORDER (kinds the index added later follow, by name). */
export function kindCounts(boards) {
  const n = new Map();
  for (const b of boards || []) {
    const k = normaliseKind(b?.kind) || 'web';
    n.set(k, (n.get(k) || 0) + 1);
  }
  const known = KIND_ORDER.filter((k) => n.has(k));
  const rest = [...n.keys()].filter((k) => !KIND_ORDER.includes(k)).sort();
  return [...known, ...rest].map((kind) => ({ kind, count: n.get(kind) }));
}

/**
 * The words under the list while canvases are open: "21 artboards · 19 digital, 2 print".
 * A dynamic canvas makes some of its artboards only when it runs — the foot says "so far" rather than
 * claiming a total it cannot know (CONTRACT §4: say what is true).
 */
export function jumpFoot(boards, { dynamic = false } = {}) {
  const total = (boards || []).length;
  if (!total) return dynamic ? 'Artboards appear once the canvas runs' : 'No artboards yet';
  const head = plural(total, 'artboard', 'artboards') + (dynamic ? ' so far' : '');
  const by = kindCounts(boards)
    .map((k) => `${k.count} ${k.kind}`)
    .join(', ');
  return `${head} · ${by}`;
}

/** The line under a dynamic canvas's artboards (or in place of them). */
export const DYNAMIC_NOTE = 'Its artboards are made when it runs.';

/** Does this canvas have a jump list to open? Artboards written out, or a dynamic canvas that says so. */
export const hasJumpList = (c) => !!c && ((c.boards?.length ?? 0) > 0 || !!c.dynamic);

/**
 * Is the jump list of `c` open? `state` is the person's choices: a Map path → boolean. Not touched: closed — also in
 * a search where the canvas answered through an artboard: 01 cf-panel-search draws a FLAT list (one row per canvas,
 * the artboard that matched quoted under its name: print · “Náborový leták A6 · FLAG” and 3 more); the twisty opens
 * the artboards when the person wants them. (`viaBoards` stays in the signature: the caller still says it.)
 */
export function jumpIsOpen(state, c, { viaBoards: _viaBoards = false } = {}) {
  const v = state?.get?.(c.path);
  return typeof v === 'boolean' ? v : false;
}

/**
 * Whether the canvas's camera glide exists yet. The bridge message `reveal-artboard` and the canvas-lib
 * handler land in separate commits (lead, then L1); until both are in, a jump is the one the tree has
 * always made (select the artboard, frame it). The lead flips this when both exist.
 */
export const REVEAL_ARTBOARD_LIVE = false;

/**
 * What a click on an artboard row does.
 *   activePath  the canvas open in the tab right now
 *   path        the canvas the row belongs to
 * @returns {{ open: boolean, messages: object[] }} `open`: the canvas is not on screen yet — open its tab
 *   first and post on a retry ladder (the frame mounts late). `messages`: for the canvas iframe, in order.
 *   Reduced motion jumps: `glide` is false and the canvas-lib handler cuts straight there.
 */
export function planJump({
  activePath,
  path,
  artboardId,
  reducedMotion = false,
  live = REVEAL_ARTBOARD_LIVE,
}) {
  if (!path || !artboardId) return { open: false, messages: [] };
  const messages = live
    ? [{ dgn: 'reveal-artboard', artboardId, glide: !reducedMotion, flash: true }]
    : [
        { dgn: 'select-by-id', artboardId },
        { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: artboardId } },
      ];
  return { open: activePath !== path, messages };
}

/** Delays (ms) a post is repeated at: right away for a canvas already on screen, a ladder for a fresh one. */
export const JUMP_NOW_MS = Object.freeze([0]);
export const JUMP_LADDER_MS = Object.freeze([400, 1200, 2800]);
