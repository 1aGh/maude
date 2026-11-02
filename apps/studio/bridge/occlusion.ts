// apps/studio/bridge/occlusion.ts — occluded insets (V2-1.2 §5.6). Leaf module: no React, no DOM.
//
// The shell's floating islands (project pill, panels, timeline, ZoomUndo) cover parts of the canvas
// iframe. It tells the canvas how much of each edge is covered (`occluded-insets`), and the camera
// consumers (Fit, reveal, zoom anchors, active artboard, minimap) work in the VISIBLE rect instead
// of the whole host. Never consumers: hit-testing, export/capture, `__maudeCanvasRects` (world
// coords) and the persisted camera (view.json stays raw).
//
// Invariants (§5.6): (I1) an inset change alone never moves the camera; (I3) with all-zero insets
// every consumer is byte-identical to today; (I4) an older `seq` is dropped; (I5) ≤ 200 bytes.

/** CSS px of the iframe viewport, integers ≥ 0. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: Readonly<Insets> = Object.freeze({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

/** An axis whose visible span would drop below this ignores both of its insets. */
export const MIN_VISIBLE_PX = 240;
const MAX_INSET_PX = 8192;

export const isZeroInsets = (ins: Insets | null | undefined): boolean =>
  !ins || (ins.top === 0 && ins.right === 0 && ins.bottom === 0 && ins.left === 0);

/** Visible rect of a w×h host. An axis whose visible span would drop below MIN_VISIBLE_PX ignores
 *  both its insets (a degenerate host keeps the whole axis rather than a sliver). */
export function visibleRect(
  w: number,
  h: number,
  ins: Insets
): { x: number; y: number; w: number; h: number } {
  const vw = w - ins.left - ins.right;
  const vh = h - ins.top - ins.bottom;
  const xOk = vw >= MIN_VISIBLE_PX;
  const yOk = vh >= MIN_VISIBLE_PX;
  return {
    x: xOk ? ins.left : 0,
    y: yOk ? ins.top : 0,
    w: xOk ? vw : w,
    h: yOk ? vh : h,
  };
}

/** Validate an untrusted insets payload: every edge finite, 0…8192, rounded; else null. */
export function clampInsets(raw: unknown): Insets | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const k of ['top', 'right', 'bottom', 'left'] as const) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_INSET_PX) return null;
    out[k] = Math.round(v);
  }
  return out;
}

type Box = { left: number; top: number; right: number; bottom: number };
export type IslandEdge = 'top' | 'right' | 'bottom' | 'left';

/** Shell side: per edge, the deepest overlap of any visible island declaring that edge, plus `gap`,
 *  rounded up. An island that doesn't overlap the frame (a pinned panel beside it), or a hidden /
 *  zero-size one, contributes nothing. */
export function insetsFromIslands(
  frame: Box,
  islands: ReadonlyArray<{ rect: Box; edge: IslandEdge }>,
  gap = 8
): Insets {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const { rect: r, edge } of islands) {
    if (!(r.right > r.left && r.bottom > r.top)) continue; // hidden / zero-size
    const ix = Math.min(r.right, frame.right) - Math.max(r.left, frame.left);
    const iy = Math.min(r.bottom, frame.bottom) - Math.max(r.top, frame.top);
    if (ix <= 0 || iy <= 0) continue; // no overlap with the iframe
    const depth =
      edge === 'top'
        ? r.bottom - frame.top
        : edge === 'bottom'
          ? frame.bottom - r.top
          : edge === 'left'
            ? r.right - frame.left
            : frame.right - r.left;
    if (depth <= 0) continue;
    out[edge] = Math.max(out[edge], Math.ceil(depth + gap));
  }
  return out;
}

/** The screen box a reveal must bring an element into: the host box minus the occluded insets
 *  (per-axis fallback as `visibleRect`). Zero insets return the host box unchanged. */
export function revealViewBox(host: Box, ins: Insets | null | undefined): Box {
  if (isZeroInsets(ins)) return host;
  const v = visibleRect(host.right - host.left, host.bottom - host.top, ins as Insets);
  return {
    left: host.left + v.x,
    top: host.top + v.y,
    right: host.left + v.x + v.w,
    bottom: host.top + v.y + v.h,
  };
}
