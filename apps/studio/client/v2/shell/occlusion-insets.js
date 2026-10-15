// client/v2/shell/occlusion-insets.js — V2-4.1: the SHELL side of occluded insets (V2-1.2 §5.6).
//
// The floating islands (panels, folded corner icons) cover parts of the canvas iframe. Each island root
// carries `data-occludes="top|right|bottom|left"`; this module measures them against the iframe's rect
// (`insetsFromIslands`, bridge/occlusion.ts) and pumps the result to the canvas iframe(s) as
// `{dgn:'occluded-insets', seq, insets}` — only on change, at most once per animation frame, with a
// strictly increasing seq, and seeded to a canvas that has just reported `loaded`. The canvas side
// (bridge/canvas-mode-store.ts, canvas-lib `computeFit`) is V2-2.10d; the mode-transition part (target
// insets before `set-mode`) is V2-4.3's.
//
// Pure and DOM-free on purpose (the hook in use-occluded-insets.js owns the observers): `measure`,
// `send` and `schedule` are injected, so the pump is exercised headlessly.

import { insetsFromIslands, ZERO_INSETS } from '../../../bridge/occlusion.ts';

const EDGES = new Set(['top', 'right', 'bottom', 'left']);

const boxOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
};

/**
 * Insets of the frame covered by the islands under `root`.
 * @param frameEl the canvas viewport (the iframe's host); null ⇒ zeros
 * @param root anything with `querySelectorAll`; islands are `[data-occludes]`
 * @param opts.presenting Present mode hides all chrome and the canvas uses 0 there — send zeros
 */
export function measureShellInsets(frameEl, root, { presenting = false } = {}) {
  if (presenting || !frameEl || !root) return { ...ZERO_INSETS };
  const frame = boxOf(frameEl);
  if (!frame || !(frame.right > frame.left && frame.bottom > frame.top)) return { ...ZERO_INSETS };
  const islands = [];
  for (const el of root.querySelectorAll('[data-occludes]')) {
    const edge = el.getAttribute('data-occludes');
    if (!EDGES.has(edge)) continue;
    const rect = boxOf(el);
    if (rect) islands.push({ rect, edge });
  }
  return insetsFromIslands(frame, islands);
}

/**
 * `dgn:'loaded'` fires from the canvas document's inline script, BEFORE its runtime module has
 * evaluated and installed the insets listener — a single seed on `loaded` is usually dropped (measured
 * in V2-4.1: the first Fit of a freshly opened canvas ignored the left panel). The same ladder
 * `ui-open.js` / the halo restore use covers the gap: each rung is a fresh seed (newer seq, same value),
 * stopped as soon as the window is gone. Returns a cancel function.
 */
export const SEED_LADDER_MS = [0, 50, 450, 1200];
export function seedOnLadder(pump, to, { alive = () => true, setTimer, clearTimer } = {}) {
  const set = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer ?? ((h) => clearTimeout(h));
  const handles = SEED_LADDER_MS.map((ms) =>
    set(() => {
      if (alive()) pump.seed(to);
    }, ms)
  );
  return () => {
    for (const h of handles) clear(h);
  };
}

const same = (a, b) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/**
 * @param measure () => Insets      the current insets
 * @param send (seq, insets, to?) => void    `to` is undefined for "every canvas", a target for a seed
 * @param schedule (fn) => handle   requestAnimationFrame in the browser
 * @param cancel (handle) => void
 */
export function createInsetsPump({ measure, send, schedule, cancel = () => {} }) {
  let seq = 0;
  let last = { ...ZERO_INSETS }; // what the canvases hold: the canvas default is all zero (seq -1)
  let handle = null;
  let disposed = false;
  const flush = () => {
    handle = null;
    if (disposed) return;
    const next = measure();
    if (same(next, last)) return;
    last = next;
    seq += 1;
    send(seq, next);
  };
  return {
    /** Ask for a re-measure; any number of calls in one frame make one send. */
    request() {
      if (disposed || handle !== null) return;
      handle = schedule(flush) ?? true;
    },
    /** Send the current insets to ONE canvas (a freshly loaded iframe) whether or not they changed.
     *  Newer seq than anything sent so far, so the canvas never drops it and older frames never win. */
    seed(to) {
      if (disposed) return;
      const next = measure();
      last = next;
      seq += 1;
      send(seq, next, to);
    },
    dispose() {
      disposed = true;
      if (handle !== null && handle !== true) cancel(handle);
      handle = null;
    },
  };
}
