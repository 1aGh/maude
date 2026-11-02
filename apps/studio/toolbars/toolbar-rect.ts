// apps/studio/toolbars/toolbar-rect.ts — the toolbar island reports where it is (V2-1.2 §5.5): the
// shell anchors its tool panels (Stickers, Templates, Component picker, Assets) to this rect.
//
// One `toolbar-rect {mode, rect}` per animation frame at most (M5-adjacent: the payload follows the
// layout, never a timer), and nothing at all when the value did not change. `rect` is the island's
// box in the iframe viewport, whole CSS px; `null` while no toolbar is shown (Present, Can view).
//
// Pure (the clock and the post are injected) so the throttle is a unit test, not a timing test.

import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';

export interface ToolbarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ToolbarRectPayload {
  dgn: 'toolbar-rect';
  mode: CanvasModeV2;
  rect: ToolbarRect | null;
}

export interface RectPosterDeps {
  /** The island's current box, or null while it is not rendered. */
  measure: () => ToolbarRect | null;
  mode: () => CanvasModeV2;
  post: (m: ToolbarRectPayload) => void;
  raf?: (fn: () => void) => number;
  caf?: (id: number) => void;
}

export interface RectPoster {
  /** Ask for a measurement on the next frame; any number of calls inside a frame cost one post. */
  request(): void;
  cancel(): void;
}

/** Whole CSS px, never negative, never NaN — what the shell's `rect` validator and the anchor maths want. */
export function wholeRect(r: {
  left: number;
  top: number;
  width: number;
  height: number;
}): ToolbarRect {
  const n = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height) };
}

export function createRectPoster(deps: RectPosterDeps): RectPoster {
  const raf =
    deps.raf ??
    ((fn: () => void) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(fn)
        : (setTimeout(fn, 16) as unknown as number));
  const caf =
    deps.caf ??
    ((id: number) =>
      typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
  let pending: number | null = null;
  let last = '';
  return {
    request() {
      if (pending !== null) return;
      pending = raf(() => {
        pending = null;
        const mode = deps.mode();
        const rect = deps.measure();
        const key = `${mode}|${rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : 'null'}`;
        if (key === last) return;
        last = key;
        deps.post({ dgn: 'toolbar-rect', mode, rect });
      });
    },
    cancel() {
      if (pending !== null) caf(pending);
      pending = null;
    },
  };
}
