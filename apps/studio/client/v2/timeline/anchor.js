// client/v2/timeline/anchor.js — S7.7: where the timeline island sits (07 · `under()` in _video.tsx).
//
// Compact: 900 wide, centred under the selected video artboard, clamped 16 px inside the window; the notch
// points at the artboard's centre and stays on the island's straight edge (never in a rounded corner), even
// when the artboard has been panned half off screen. Full: edge to edge, 16 px in, no notch.
// Pure — the shell measures the window, this decides the numbers.

/** The compact island's width (07 · BODY_W 1440 → 900). */
export const ISLAND_W = 900;
/** The island never gets closer than this to the window's edge (CONTRACT §2: 16 px). */
export const EDGE_GAP = 16;
/** The notch keeps this far from the island's ends, so it is never drawn into a rounded corner. */
export const NOTCH_INSET = 24;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

/**
 * @param {{ cx: number, viewportW: number, width?: number, gap?: number }} p
 *   `cx` is the artboard's centre in window px
 * @returns {{ left: number, width: number, notch: number }} `notch` is measured from the island's left edge
 */
export function placeCompact({ cx, viewportW, width = ISLAND_W, gap = EDGE_GAP }) {
  const w = Math.max(0, Math.min(width, viewportW - 2 * gap));
  const left = clamp(Math.round(cx - w / 2), gap, viewportW - gap - w);
  const notch = clamp(Math.round(cx - left), NOTCH_INSET, w - NOTCH_INSET);
  return { left, width: w, notch };
}

/** The full island: the whole window width less the gap on both sides. No notch (it belongs to the compact one). */
export function placeFull({ viewportW, gap = EDGE_GAP }) {
  return { left: gap, width: Math.max(0, viewportW - 2 * gap), notch: null };
}

/**
 * The artboard's centre in window px: the canvas frame's own offset plus the rect the canvas reported
 * (iframe viewport px, `artboard-anchor`).
 * @param {{ left: number }} frameBox
 * @param {{ x: number, w: number }} rect
 */
export function anchorCentre(frameBox, rect) {
  return frameBox.left + rect.x + rect.w / 2;
}
