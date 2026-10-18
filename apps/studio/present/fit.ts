// apps/studio/present/fit.ts — S3.2a: how an artboard sits on the Present stage (D6).
//
// PURE. One rule per kind, no settings (md-edge-mixed):
//   web              fills the width, starts at the top; what does not fit is reached by scrolling inside
//   print            the TRIM fills the stage as a digital artboard would; the bleed stays off screen
//   digital / video  contain on the dark stage — a 9:16 pillarboxed, a banner letterboxed, a 1:1 fitting
//                    the height — and never cropped
//
// Everything is in two spaces: ARTBOARD px (the artboard's own box) and STAGE px (the host's box, 0,0 at
// its top-left). `place` is where the artboard's top-left lands in the stage; `window` is the part of the
// artboard the audience sees (artboard px), which the stage mask cuts the dark around. The caller turns a
// fit into a camera with `cameraFor`.

export type FitKind = 'digital' | 'print' | 'web' | 'video';

export interface FitInput {
  kind: FitKind;
  /** The artboard's box, px. */
  art: { w: number; h: number };
  /** The stage (the canvas host), px. */
  stage: { w: number; h: number };
  /** Print only: the bleed on every side, px. The artboard IS the bleed box (print/units.ts). */
  bleedPx?: number;
  /** The camera's zoom range — canvas-lib's ZOOM_MIN / ZOOM_MAX, so a fit is always reachable. */
  minScale?: number;
  maxScale?: number;
}

export interface Fit {
  scale: number;
  /** Where the artboard's top-left lands, in stage px. */
  place: { x: number; y: number };
  /** The visible part of the artboard, in artboard px. */
  window: { x: number; y: number; w: number; h: number };
  /** What the dark stage does around it. `inset` = both axes short (a tiny artboard held at the zoom cap). */
  fill: 'none' | 'pillarbox' | 'letterbox' | 'inset';
  /** Web: how far the page can scroll, in artboard px. 0 for every other kind. */
  maxScroll: number;
}

const DEFAULT_MIN = 0.02;
const DEFAULT_MAX = 4;
const EPS = 1e-6;

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** A fit that is finite and harmless, for a stage or artboard with no usable size. */
function fallback(input: FitInput): Fit {
  const w = pos(input.art?.w) ? input.art.w : 0;
  const h = pos(input.art?.h) ? input.art.h : 0;
  return {
    scale: 1,
    place: { x: 0, y: 0 },
    window: { x: 0, y: 0, w, h },
    fill: 'none',
    maxScroll: 0,
  };
}

function containFill(shownW: number, shownH: number, stage: { w: number; h: number }): Fit['fill'] {
  const fullW = shownW >= stage.w - EPS;
  const fullH = shownH >= stage.h - EPS;
  if (fullW && fullH) return 'none';
  if (fullH) return 'pillarbox';
  if (fullW) return 'letterbox';
  return 'inset';
}

export function fitForKind(input: FitInput): Fit {
  const { kind, art, stage } = input;
  if (!pos(art?.w) || !pos(art?.h) || !pos(stage?.w) || !pos(stage?.h)) return fallback(input);
  const minScale = pos(input.minScale) ? input.minScale : DEFAULT_MIN;
  const maxScale = pos(input.maxScale) ? input.maxScale : DEFAULT_MAX;
  const clamp = (s: number) => Math.min(maxScale, Math.max(minScale, s));

  if (kind === 'web') {
    const scale = clamp(stage.w / art.w);
    const visibleH = stage.h / scale;
    return {
      scale,
      place: { x: (stage.w - art.w * scale) / 2, y: 0 },
      window: { x: 0, y: 0, w: art.w, h: Math.min(art.h, visibleH) },
      fill: 'none',
      maxScroll: Math.max(0, art.h - visibleH),
    };
  }

  // print shows the trim; everything else shows the whole artboard.
  let win = { x: 0, y: 0, w: art.w, h: art.h };
  if (kind === 'print') {
    const raw =
      typeof input.bleedPx === 'number' && Number.isFinite(input.bleedPx) ? input.bleedPx : 0;
    // A bleed that would eat the artboard cannot invert the trim: leave at least 1 px of it.
    const bleed = Math.min(Math.max(0, raw), (Math.min(art.w, art.h) - 1) / 2);
    win = { x: bleed, y: bleed, w: art.w - 2 * bleed, h: art.h - 2 * bleed };
  }
  const scale = clamp(Math.min(stage.w / win.w, stage.h / win.h));
  const shownW = win.w * scale;
  const shownH = win.h * scale;
  const left = (stage.w - shownW) / 2;
  const top = (stage.h - shownH) / 2;
  return {
    scale,
    place: { x: left - win.x * scale, y: top - win.y * scale },
    window: win,
    fill: containFill(shownW, shownH, stage),
    maxScroll: 0,
  };
}

/**
 * S3.3 — a web page scrolled by `scroll` artboard px (md-edge-mixed: "starts at the top and scrolls with the
 * trackpad"). The page moves up by `scroll` and the visible window moves down with it, so the stage mask
 * follows. Clamped to 0..maxScroll; only a web artboard has anything to scroll, every other fit comes back
 * as it is.
 */
export function scrolled(fit: Fit, scroll: number): Fit {
  if (!(fit.maxScroll > 0) || !Number.isFinite(scroll)) return fit;
  const s = Math.min(fit.maxScroll, Math.max(0, scroll));
  if (s === 0) return fit;
  return {
    ...fit,
    place: { x: fit.place.x, y: fit.place.y - s * fit.scale },
    window: { ...fit.window, y: fit.window.y + s },
  };
}

/** The canvas camera that puts `fit` on screen when the artboard's top-left is at `origin` (world px). */
export function cameraFor(
  fit: Fit,
  origin: { x: number; y: number }
): { x: number; y: number; zoom: number } {
  return {
    x: fit.place.x - origin.x * fit.scale,
    y: fit.place.y - origin.y * fit.scale,
    zoom: fit.scale,
  };
}
