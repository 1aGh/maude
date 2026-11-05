// client/v2/ds/ds-refresh.js — 2.0.5 (#205): when the shell's design-system hosts read the server.
//
// Before, each host (make · truth · advanced · off-system) re-read on its own timer every 2.5–8 s while the
// window was looked at. On a cell that was ~50 requests a minute per open DS board, each one a closure walk
// and a system read, and the hub's studio child sat at 1.5 GB / 138 % CPU. Nothing those reads show changes
// on its own clock: it changes when someone writes, and every write the shell makes says so
// (DS_STATE_CHANGED, door-write.js), and a write the canvas sees redraws it (`dgn:'loaded'`).
//
// So a host reads:
//   - once when it starts (per system),
//   - when the window is looked at again (`visibilitychange` → visible),
//   - when the shell wrote the system (DS_STATE_CHANGED),
//   - when the open canvas has drawn again (`dgn:'loaded'` from its own frame, only with `frameFor`),
//   - after a failed read, again after 5 s, 10 s, 20 s … at most 5 min (one success resets it),
//   - and, only with `slowMs`, on ONE slow clock — visible window only, held while the canvas is loading or
//     broken. Only the "changed outside" card needs it (truth-host): a file edited outside Maude has no event.
//
// `load(fetchImpl)` reads through the fetch it is given; a read that throws, or any answer that is not ok, is a
// failure. The host keeps its own sequence guard; this only decides WHEN.

import { errorCardShown } from '../code/code-bus.js';
import { DS_STATE_CHANGED } from './door-write.js';

export const DS_BACKOFF_FIRST_MS = 5_000;
export const DS_BACKOFF_CAP_MS = 5 * 60_000;
/** The one slow clock (truth-host's "changed outside" card). */
export const DS_SLOW_POLL_MS = 60_000;

/** The canvas pane is still opening, or shows a broken-canvas card: the slow clock waits. */
export function canvasPaused(doc = globalThis.document) {
  if (errorCardShown()) return true;
  const state = doc
    ?.querySelector?.('main.viewport[data-canvas-state]')
    ?.getAttribute?.('data-canvas-state');
  return state === 'loading' || state === 'error';
}

/** The delay before the retry after `failures` failed reads in a row (1 → first). */
export function backoffMs(failures, first = DS_BACKOFF_FIRST_MS, cap = DS_BACKOFF_CAP_MS) {
  if (failures <= 0) return 0;
  return Math.min(cap, first * 2 ** (failures - 1));
}

/**
 * @param {(fetchImpl: typeof fetch) => Promise<unknown>} load
 * @param {{
 *   fetchImpl?: () => typeof fetch,
 *   slowMs?: number,
 *   paused?: () => boolean,
 *   frameFor?: () => ({ contentWindow?: unknown } | null),
 *   firstMs?: number,
 *   backoffFirstMs?: number,
 *   backoffCapMs?: number,
 *   win?: Window,
 *   doc?: Document,
 *   timers?: { set: typeof setTimeout, clear: typeof clearTimeout },
 * }} [opts]
 * @returns {{ now(): Promise<void>, stop(): void }}
 */
export function dsRefresh(load, opts = {}) {
  const win = opts.win ?? globalThis.window;
  const doc = opts.doc ?? globalThis.document;
  const set = opts.timers?.set ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = opts.timers?.clear ?? ((t) => clearTimeout(t));
  const paused = opts.paused ?? (() => canvasPaused(doc));
  const getFetch = opts.fetchImpl ?? (() => globalThis.fetch);
  const slowMs = opts.slowMs ?? 0;
  const hidden = () => doc?.visibilityState === 'hidden';

  let dead = false;
  let failures = 0;
  let timer = null;

  const schedule = (ms, fn) => {
    if (timer !== null) clear(timer);
    timer = ms > 0 ? set(fn, ms) : null;
  };
  const next = () => {
    if (dead) return;
    if (failures > 0)
      return schedule(backoffMs(failures, opts.backoffFirstMs, opts.backoffCapMs), retry);
    if (slowMs > 0) return schedule(slowMs, tick);
    schedule(0);
  };

  const now = async () => {
    if (dead || hidden()) return;
    let failed = false;
    const base = getFetch();
    const tracked = async (...args) => {
      try {
        const res = await base(...args);
        if (!res?.ok) failed = true;
        return res;
      } catch (err) {
        failed = true;
        throw err;
      }
    };
    try {
      await load(tracked);
    } catch {
      failed = true;
    }
    if (dead) return;
    failures = failed ? failures + 1 : 0;
    next();
  };

  // a retry waits for a looked-at window: `visibilitychange` reads at once when it is looked at again
  function retry() {
    timer = null;
    if (!hidden()) void now();
  }
  function tick() {
    timer = null;
    if (hidden() || paused()) return next();
    void now();
  }

  const onVisible = () => {
    if (doc?.visibilityState === 'visible') void now();
  };
  const onChanged = () => void now();
  const onMessage = (e) => {
    const frame = opts.frameFor?.() ?? null;
    if (!frame || e?.source !== frame.contentWindow) return;
    if (e.data && typeof e.data === 'object' && e.data.dgn === 'loaded') void now();
  };

  doc?.addEventListener?.('visibilitychange', onVisible);
  win?.addEventListener?.(DS_STATE_CHANGED, onChanged);
  if (opts.frameFor) win?.addEventListener?.('message', onMessage);

  let first = null;
  if (opts.firstMs && opts.firstMs > 0) first = set(() => void now(), opts.firstMs);
  else void now();

  return {
    now,
    stop() {
      dead = true;
      if (first !== null) clear(first);
      if (timer !== null) clear(timer);
      timer = null;
      doc?.removeEventListener?.('visibilitychange', onVisible);
      win?.removeEventListener?.(DS_STATE_CHANGED, onChanged);
      if (opts.frameFor) win?.removeEventListener?.('message', onMessage);
    },
  };
}
