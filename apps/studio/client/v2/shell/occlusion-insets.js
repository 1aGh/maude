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

import { insetsFromIslands, topBandFromIslands, ZERO_INSETS } from '../../../bridge/occlusion.ts';

const EDGES = new Set(['top', 'right', 'bottom', 'left']);

const boxOf = (el) => {
  const r = el?.getBoundingClientRect?.();
  if (!r) return null;
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  // #170 R29 — an island that comes back grows out of its icon (scale 0.12 → 1, floating-panels.css), and
  // getBoundingClientRect reads the scaled box: measured mid-grow it covered a tenth of itself. Read the layout box
  // instead — the transform's fixed point (its origin) and the untransformed size. A scale is the only transform an
  // island runs; with no layout size (display: contents, a fake) the drawn box stands.
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!(w > 0 && h > 0) || (Math.abs(r.width - w) < 0.5 && Math.abs(r.height - h) < 0.5))
    return box;
  const origin = el.ownerDocument?.defaultView?.getComputedStyle?.(el)?.transformOrigin ?? '';
  const [ox, oy] = origin.split(' ').map((v) => Number.parseFloat(v));
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return box;
  const sx = r.width / w;
  const sy = r.height / h;
  const left = r.left - ox * (1 - sx);
  const top = r.top - oy * (1 - sy);
  return { left, top, right: left + w, bottom: top + h };
};

/**
 * Insets of the frame covered by the islands under `root`.
 * @param frameEl the canvas viewport (the iframe's host); null ⇒ zeros
 * @param root anything with `querySelectorAll`; islands are `[data-occludes]`
 * @param opts.presenting Present mode hides all chrome and the canvas uses 0 there — send zeros
 */
export function measureShellInsets(frameEl, root, { presenting = false } = {}) {
  const m = frameAndIslands(frameEl, root, presenting);
  return m ? insetsFromIslands(m.frame, m.islands) : { ...ZERO_INSETS };
}

/**
 * #217 — the free top band between the top islands (project pill on the left, the Share cluster on the right),
 * in frame px; the canvas centres its top-centre pill there. Null in Present, with no frame, or with no room.
 */
export function measureShellTopBand(frameEl, root, { presenting = false } = {}) {
  const m = frameAndIslands(frameEl, root, presenting);
  return m ? topBandFromIslands(m.frame, m.islands) : null;
}

function frameAndIslands(frameEl, root, presenting) {
  if (presenting || !frameEl || !root) return null;
  const frame = boxOf(frameEl);
  if (!frame || !(frame.right > frame.left && frame.bottom > frame.top)) return null;
  const islands = [];
  for (const el of root.querySelectorAll('[data-occludes]')) {
    const edge = el.getAttribute('data-occludes');
    if (!EDGES.has(edge)) continue;
    const rect = boxOf(el);
    if (rect) islands.push({ rect, edge });
  }
  return { frame, islands };
}

/**
 * `dgn:'loaded'` fires from the canvas document's inline script, BEFORE its runtime module has
 * evaluated and installed the insets listener — a single seed on `loaded` is usually dropped (measured
 * in V2-4.1: the first Fit of a freshly opened canvas ignored the left panel). The same ladder
 * `ui-open.js` / the halo restore use covers the gap: each rung is a fresh seed (newer seq, same value),
 * stopped as soon as the window is gone. Returns a cancel function. `onDone` runs once, after the last rung or on
 * cancel — 2.0.4: the caller must let go of the cancel then, since it holds the canvas window (a kept cancel kept
 * every canvas ever opened alive, ~14 MB each).
 */
export const SEED_LADDER_MS = [0, 50, 450, 1200];
export function seedOnLadder(pump, to, { alive = () => true, setTimer, clearTimer, onDone } = {}) {
  const set = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer ?? ((h) => clearTimeout(h));
  let left = SEED_LADDER_MS.length;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };
  const handles = SEED_LADDER_MS.map((ms) =>
    set(() => {
      if (alive()) pump.seed(to);
      left -= 1;
      if (left === 0) finish();
    }, ms)
  );
  return () => {
    for (const h of handles) clear(h);
    finish();
  };
}

const same = (a, b) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
const sameBand = (a, b) => (a && b ? a.left === b.left && a.right === b.right : a === b);

/**
 * @param measure () => Insets      the current insets
 * @param measureBand () => TopBand | null   #217 — the free top band (optional; absent ⇒ never sent)
 * @param send (seq, insets, to?, topBand?) => void    `to` is undefined for "every canvas", a target for a
 *   seed; `topBand` is the band, or null when there is none to send
 * @param schedule (fn) => handle   requestAnimationFrame in the browser
 * @param cancel (handle) => void
 */
export function createInsetsPump({
  measure,
  measureBand = () => null,
  send,
  schedule,
  cancel = () => {},
}) {
  let seq = 0;
  let last = { ...ZERO_INSETS }; // what the canvases hold: the canvas default is all zero (seq -1)
  let lastBand = null; // …and no band
  let handle = null;
  let disposed = false;
  const flush = () => {
    handle = null;
    if (disposed) return;
    const next = measure();
    const band = measureBand();
    if (same(next, last) && sameBand(band, lastBand)) return;
    last = next;
    lastBand = band;
    seq += 1;
    send(seq, next, undefined, band);
  };
  return {
    /** Ask for a re-measure; any number of calls in one frame make one send. */
    request() {
      if (disposed || handle !== null) return;
      handle = schedule(flush) ?? true;
    },
    /** V2-4.3b — measure and send NOW (dropping a pending frame): the mode lane calls this right
     *  after a fold committed, so the target insets precede its `set-mode` (§5.6). */
    flushNow() {
      if (disposed) return;
      if (handle !== null && handle !== true) cancel(handle);
      handle = null;
      flush();
    },
    /** Send the current insets to ONE canvas (a freshly loaded iframe) whether or not they changed.
     *  Newer seq than anything sent so far, so the canvas never drops it and older frames never win. */
    seed(to) {
      if (disposed) return;
      const next = measure();
      const band = measureBand();
      last = next;
      lastBand = band;
      seq += 1;
      send(seq, next, to, band);
    },
    dispose() {
      disposed = true;
      if (handle !== null && handle !== true) cancel(handle);
      handle = null;
    },
  };
}
