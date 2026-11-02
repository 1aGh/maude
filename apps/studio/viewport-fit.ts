/**
 * @file       viewport-fit.ts — V2-8.5 c7 (01 cf-open-big, "Zoom to fit · 10 %").
 * @scope      apps/studio/viewport-fit.ts
 * @purpose    Is the camera where the last "Zoom to fit" (⌘0, the View menu, the readout) put it? The shell
 *             cannot tell a fitted camera from a hand-zoomed one at the same percent, so the canvas keeps the
 *             fit target it computed and reports `fit` with `viewport-zoom` while the camera still sits on it.
 *             Any pan or zoom moves off the target and the flag drops by itself; there is no "was fitted"
 *             state to forget to clear. Pure: no DOM, no React.
 */

export interface FitViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Whole pixels of pan and a thousandth of zoom: the ease ends exactly on the target, a wheel tick does not. */
const PAN_TOL = 1.5;
const ZOOM_TOL = 0.001;

export function viewportAtFit(vp: FitViewport | null, mark: FitViewport | null): boolean {
  if (!vp || !mark) return false;
  return (
    Math.abs(vp.zoom - mark.zoom) <= ZOOM_TOL &&
    Math.abs(vp.x - mark.x) <= PAN_TOL &&
    Math.abs(vp.y - mark.y) <= PAN_TOL
  );
}
