// client/v2/shell/f6-cycle.js — F6 moves the keyboard between the panels and the canvas (S2.21; 14 Editing
// `ed-edge-keys`, registry `ui.cycle-region`). ⇧F6 goes back. The regions are what a person sees as places:
// the canvases list, the panels on the right, the canvas itself — taken in reading order (left to right, then top
// to bottom), so F6 never jumps over the window.
//
// The canvas is an iframe of another origin; the shell cannot reach into it, but it can focus the frame and its
// window, and the document inside then gets the keys (tab walks objects there, editing/tab-order.tsx). The way
// OUT is the canvas's own F6: the editing layer forwards the chord to the shell (`dgn:'key'`, a `fromCanvas`
// action), which lands in the same handler — one key crosses the boundary both ways.
//
// A region is `[data-f6-region]` (opt-in, wins), a `nav` / `aside` with an accessible name, or the active canvas
// frame. Hidden ones (a closed panel, `display: none`) are not regions. The DOM-reading parts take their
// measurements as arguments, so test/v2-f6-cycle.test.ts runs the order and the wrap without a layout engine.

/** What counts as a place to land. */
export const REGION_SELECTOR =
  '[data-f6-region], nav[aria-label], aside[aria-label], iframe.active[data-path]';

/** Where inside a region the keyboard lands: an explicit entry, else the first thing that takes a key. */
const ENTRY_SELECTOR = '[data-f6-entry]';
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Reading order: left to right, then top to bottom, with a little slack so a 1 px offset is not a column. */
export function readingOrder(items, slack = 8) {
  return [...items].sort((a, b) => {
    const dx = a.rect.left - b.rect.left;
    if (Math.abs(dx) > slack) return dx;
    return a.rect.top - b.rect.top;
  });
}

/** The index F6 goes to. `current` is -1 when the keyboard is in none of the regions. Wraps. */
export function nextIndex(count, current, dir) {
  if (count <= 0) return -1;
  if (current < 0) return dir < 0 ? count - 1 : 0;
  return (current + (dir < 0 ? -1 : 1) + count) % count;
}

/** The index of the region that holds `active` (the frame itself, or anything inside a panel), else -1. */
export function regionOf(regions, active) {
  if (!active) return -1;
  return regions.findIndex((r) => r === active || r.contains(active));
}

const defaultShown = (el) =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const defaultRect = (el) => el.getBoundingClientRect();

/**
 * The regions on screen, in reading order. A region inside another is not a second stop (a labelled `aside`
 * inside a `nav`'s panel is part of it).
 */
export function regionsIn(doc, { shown = defaultShown, rectOf = defaultRect } = {}) {
  const all = [...doc.querySelectorAll(REGION_SELECTOR)].filter((el) => shown(el));
  const top = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
  return readingOrder(
    top.map((el) => ({ el, rect: rectOf(el) })),
    8
  ).map((x) => x.el);
}

/** Where the keyboard lands in a region. */
export function entryOf(region, shown = defaultShown) {
  if (region.tagName === 'IFRAME') return region;
  const explicit = region.querySelector(ENTRY_SELECTOR);
  if (explicit && shown(explicit)) return explicit;
  const first = [...region.querySelectorAll(TABBABLE)].find((el) => shown(el));
  if (first) return first;
  // a region with nothing to press still takes the keyboard, so the next F6 starts from it
  if (!region.hasAttribute('tabindex')) region.setAttribute('tabindex', '-1');
  return region;
}

/** Put the keyboard on `el`; an iframe takes its window too, so the document inside gets the keys. */
export function landOn(el) {
  el.focus?.({ preventScroll: true });
  if (el.tagName === 'IFRAME') {
    try {
      el.contentWindow?.focus();
    } catch {
      /* detached frame */
    }
  }
}

/**
 * F6 (`dir` 1) or ⇧F6 (-1). Returns true when the keyboard moved (the caller then stops the browser's own F6).
 * `opts` carries the measurements for tests.
 */
export function cycleRegion(doc, dir, opts = {}) {
  const regions = regionsIn(doc, opts);
  if (regions.length === 0) return false;
  const at = regionOf(regions, doc.activeElement);
  const to = regions[nextIndex(regions.length, at, dir)];
  if (!to) return false;
  landOn(entryOf(to, opts.shown));
  return true;
}
