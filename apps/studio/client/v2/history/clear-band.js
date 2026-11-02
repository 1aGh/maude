// client/v2/history/clear-band.js — S1.23: the history surfaces that sit in the canvas area keep clear of the
// shell's floating islands (V2-4.1 `data-occludes`), the way the canvas itself does for Fit.
//
//   viewBarPlacement   PURE: where the Viewing bar (11 · pn-history `pn-viewbar`) goes in the band between the
//                      top islands (project pill on the left, the Share cluster on the right) — centred when it
//                      fits there, else pulled to the band, and capped to the band's width so its "back to now"
//                      is never under an island.
//   useViewBarPlacement(ref)   measures and applies it (left / max-width on the bar), re-measuring when the
//                      window, the host or an island changes.
//   useIslandInsets(ref)       the insets the islands leave on `ref`'s box (the compare stage uses them so the
//                      A / B frames and the change list are not cut off by the left panel).

import { useLayoutEffect, useState } from 'react';
import { measureShellInsets } from '../shell/occlusion-insets.js';

const EDGE_MARGIN = 8;
const ISLAND_GAP = 8;

/**
 * @param host     `{ left, right }` the bar is positioned in (its containing block)
 * @param islands  `[{ left, right }]` the islands sharing the bar's band (any that do not overlap it
 *                 vertically are the caller's to leave out)
 * @param width    the bar's natural width
 * @returns `{ center, maxWidth }` — `center` in px from the host's left edge, `maxWidth` the band's width
 */
export function viewBarPlacement({ host, islands, width }) {
  const mid = (host.left + host.right) / 2;
  let lo = host.left + EDGE_MARGIN;
  let hi = host.right - EDGE_MARGIN;
  for (const i of islands) {
    if (!(i.right > i.left)) continue;
    if ((i.left + i.right) / 2 <= mid) lo = Math.max(lo, i.right + ISLAND_GAP);
    else hi = Math.min(hi, i.left - ISLAND_GAP);
  }
  // islands that leave no room at all: ignore them rather than draw a sliver
  if (hi - lo < 120) {
    lo = host.left + EDGE_MARGIN;
    hi = host.right - EDGE_MARGIN;
  }
  const avail = hi - lo;
  const w = Math.min(width, avail);
  const center = Math.min(Math.max(mid, lo + w / 2), hi - w / 2);
  return { center: Math.round(center - host.left), maxWidth: Math.floor(avail) };
}

const rectOf = (el) => el.getBoundingClientRect();

/** Re-run `fn` when the window, `host` or an island resizes, or islands come and go. Returns a cleanup. */
function watch(host, fn) {
  let raf = 0;
  const run = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      fn();
    });
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(run) : null;
  const seen = new Set();
  const sync = () => {
    if (!ro) return;
    const now = new Set([host, ...document.querySelectorAll('[data-occludes]')]);
    for (const el of seen)
      if (!now.has(el)) {
        ro.unobserve(el);
        seen.delete(el);
      }
    for (const el of now)
      if (!seen.has(el)) {
        ro.observe(el);
        seen.add(el);
      }
  };
  const mo =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          sync();
          run();
        })
      : null;
  mo?.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['hidden', 'data-occludes', 'class'],
  });
  sync();
  window.addEventListener('resize', run);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    mo?.disconnect();
    ro?.disconnect();
    window.removeEventListener('resize', run);
  };
}

/** Place the Viewing bar (`ref`, an absolutely positioned, `translate: -50% 0` island) in the clear band. */
export function useViewBarPlacement(ref, active = true) {
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!active || !bar) return undefined;
    const host = bar.offsetParent || bar.parentElement;
    if (!host) return undefined;
    const place = () => {
      // natural width first: the bar unconstrained
      bar.style.maxWidth = 'none';
      const own = rectOf(bar);
      const h = rectOf(host);
      const islands = [...document.querySelectorAll('[data-occludes="top"]')]
        .filter((el) => !bar.contains(el))
        .map(rectOf)
        .filter((r) => r.right > r.left && r.bottom > own.top && r.top < own.bottom);
      const { center, maxWidth } = viewBarPlacement({
        host: { left: h.left, right: h.right },
        islands,
        width: own.width,
      });
      bar.style.left = `${center}px`;
      bar.style.maxWidth = `${maxWidth}px`;
    };
    place();
    return watch(host, place);
  }, [ref, active]);
}

const ZERO = { top: 0, right: 0, bottom: 0, left: 0 };
const same = (a, b) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

/** The insets the shell's islands leave on `ref`'s box (V2-4.1 `measureShellInsets`), kept current. */
export function useIslandInsets(ref) {
  const [insets, setInsets] = useState(ZERO);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const next = measureShellInsets(el, document.body);
      setInsets((cur) => (same(cur, next) ? cur : next));
    };
    measure();
    return watch(el.parentElement || el, measure);
  }, [ref]);
  return insets;
}
