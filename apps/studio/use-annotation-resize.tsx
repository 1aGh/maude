/**
 * @file       use-annotation-resize.tsx — Task 23 (Wave 2, G4)
 * @scope      apps/studio/use-annotation-resize.tsx
 * @purpose    Screen-space corner / endpoint handles for the selected
 *             annotation. Per-tool resize math with FigJam resize modifiers:
 *             Shift = lock aspect ratio (45° angle snap for arrows), Alt =
 *             scale from center, Shift+Alt = both. Modifiers update live on
 *             keydown/keyup mid-drag (re-applied at the last pointer position).
 *
 *             Handles are `position: fixed` DOM siblings of the canvas (the
 *             same pattern element selection uses) — they stay 8 × 8 CSS px
 *             at any zoom and never get caught in the SVG `vector-effect`
 *             gymnastics.
 *
 *             Mounts the overlay element exactly once via `AnnotationResizeOverlay`.
 *             The hook does the math + persistence; the overlay component
 *             owns the rAF loop that follows pan/zoom + pointer drags.
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { defOf } from './annotations/registry.ts';
import { useAnnotationPipeline } from './annotations/ui/pipeline-context.ts';
import { anchorPoint, BIND_THRESHOLD_PX, bindCandidate } from './annotations-bindings.ts';
import {
  type ArrowStroke,
  canRotate,
  type ElementStroke,
  type EllipseStroke,
  HALO_PAD_PX,
  type ImageStroke,
  type LinkStroke,
  normalizeRotation,
  type PenStroke,
  type PolygonStroke,
  type RectStroke,
  rotatePoint,
  type SectionStroke,
  type StickyStroke,
  type Stroke,
  type StrokesStoreValue,
  strokeBBox,
  strokeCenter,
  strokeRotation,
} from './annotations-layer.tsx';
import { getLiveViewport, useViewportControllerContext } from './canvas-lib.tsx';
import { useAnnotationSelection } from './use-annotation-selection.tsx';

const RESIZE_CSS = `
/* DS selection specimen .sel-handle recipe — accent square, 1px accent-fg
 * border, --radius-xs corners. (8px box kept: the JS centers handles on the
 * half-size offset; the specimen's 7px differs by a hairline only.) Comment
 * must stay backtick-free — it lives inside the RESIZE_CSS template literal. */
.dc-annot-resize-handle {
  position: fixed;
  width: 8px;
  height: 8px;
  background: var(--maude-hud-accent, oklch(0.680 0.180 268));
  border: 1px solid var(--maude-hud-accent-fg, oklch(0.180 0.030 268));
  border-radius: 3px;
  z-index: 6;
  pointer-events: auto;
  touch-action: none;
}
/* Phase 24 — '!important' so the scale/move affordance beats use-tool-mode's
   blanket '* { cursor: <tool> !important }' (move mode). Without it the move
   glyph clobbered the resize cursors and the user saw no scale affordance over
   a handle. Specificity already wins ('.class[attr]' > '*'); the '!important'
   is what lets it through against the other '!important' rule. See DDR-067.
   NOTE: keep this comment backtick-free — it lives inside the RESIZE_CSS
   template literal and a stray backtick closes it (bun parse fail, §6). */
.dc-annot-resize-handle[data-corner="nw"], .dc-annot-resize-handle[data-corner="se"] { cursor: nwse-resize !important; }
.dc-annot-resize-handle[data-corner="ne"], .dc-annot-resize-handle[data-corner="sw"] { cursor: nesw-resize !important; }
.dc-annot-resize-handle[data-corner="ep1"], .dc-annot-resize-handle[data-corner="ep2"] { cursor: move !important; }
/* FigJam v3 — mid-edge handles: single-axis resize. Slightly smaller pills so
   the corner squares stay the primary affordance. */
.dc-annot-resize-handle[data-corner="n"], .dc-annot-resize-handle[data-corner="s"] { cursor: ns-resize !important; width: 14px; height: 6px; }
.dc-annot-resize-handle[data-corner="e"], .dc-annot-resize-handle[data-corner="w"] { cursor: ew-resize !important; width: 6px; height: 14px; }
/* Wave G — rotation lives in INVISIBLE hover zones just outside each corner
   (FigJam): the cursor flips to a rotate glyph there and dragging turns the
   stroke. No knob — the old below-the-bbox knob read as clutter and collided
   with the connector dots. z-index below the handles so a corner square wins
   where they overlap. */
.dc-annot-rotate-zone {
  position: fixed;
  width: 18px;
  height: 18px;
  background: transparent;
  z-index: 5;
  pointer-events: auto;
  touch-action: none;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath stroke='white' stroke-width='4' d='M4.8 13 A6 6 0 1 1 15.2 13 M2.2 10.8 L4.8 13 L7.4 10.9 M12.6 10.9 L15.2 13 L17.8 10.8'/%3E%3Cpath stroke='black' stroke-width='1.8' d='M4.8 13 A6 6 0 1 1 15.2 13 M2.2 10.8 L4.8 13 L7.4 10.9 M12.6 10.9 L15.2 13 L17.8 10.8'/%3E%3C/g%3E%3C/svg%3E") 10 10, alias !important;
}
`.trim();

function ensureResizeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-annot-resize-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-annot-resize-css';
  s.textContent = RESIZE_CSS;
  document.head.appendChild(s);
}

export type Corner =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 'e'
  | 's'
  | 'w'
  | 'rot-nw'
  | 'rot-ne'
  | 'rot-sw'
  | 'rot-se'
  | 'ep1'
  | 'ep2';

/** FigJam v3 — mid-edge handles resize a single axis. */
function isEdgeCorner(c: Corner): boolean {
  return c === 'n' || c === 'e' || c === 's' || c === 'w';
}

/** Wave G — the four invisible rotate zones outside the corners. */
function isRotCorner(c: Corner): boolean {
  return c === 'rot-nw' || c === 'rot-ne' || c === 'rot-sw' || c === 'rot-se';
}

/**
 * Wave G/H — handles float a step OFF the stroke (matching the halo's pad —
 * `HALO_PAD_PX` lives in annotations-model as the single source) instead of
 * sitting glued to the bbox. The pad is SCREEN-constant (`HALO_PAD_PX / zoom`
 * world units) so the breathing room reads the same at every zoom.
 * `padDX/padDY` shift a dragged handle's cursor back ONTO the true bbox
 * corner/edge so the shape doesn't grow by the pad on first move.
 */
export const padDX = (c: Corner): number =>
  c === 'nw' || c === 'sw' || c === 'w' ? 1 : c === 'ne' || c === 'se' || c === 'e' ? -1 : 0;
export const padDY = (c: Corner): number =>
  c === 'nw' || c === 'ne' || c === 'n' ? 1 : c === 'sw' || c === 'se' || c === 's' ? -1 : 0;

/** Stroke types that expose resize handles. Text inherits its anchor bbox. */
function isResizable(
  s: Stroke
): s is
  | ElementStroke
  | RectStroke
  | EllipseStroke
  | PolygonStroke
  | ArrowStroke
  | PenStroke
  | StickyStroke
  | ImageStroke
  | LinkStroke
  | SectionStroke {
  if (s.tool === 'element') {
    const caps = defOf(s.el.type)?.caps;
    return !!caps?.box && caps.resizable;
  }
  return (
    s.tool === 'rect' ||
    s.tool === 'ellipse' ||
    s.tool === 'polygon' ||
    s.tool === 'arrow' ||
    s.tool === 'pen' ||
    s.tool === 'sticky' ||
    s.tool === 'image' ||
    s.tool === 'link' ||
    s.tool === 'mediaref' ||
    s.tool === 'section'
  );
}

/**
 * Resize modifiers (FigJam-parity). Held during a handle drag:
 *   • `shift` — lock to the start aspect ratio (45° angle snap for arrows;
 *               always-1:1 stickies ignore it — they're square regardless).
 *   • `alt`   — scale symmetrically around the stroke's center / midpoint.
 * Both together combine (ratio-locked AND center-anchored). With neither held
 * the result is byte-identical to the pre-modifier behaviour.
 */
export interface ResizeMods {
  shift: boolean;
  alt: boolean;
}

const NO_MODS: ResizeMods = { shift: false, alt: false };

const isWestCorner = (c: Corner): boolean => c === 'nw' || c === 'sw';
const isNorthCorner = (c: Corner): boolean => c === 'nw' || c === 'ne';

/**
 * Wave H — resizing a ROTATED stroke must keep the anchored corner/edge fixed
 * in WORLD space. The axis-aligned math anchors it in the LOCAL frame, but the
 * rotation pivot is the bbox CENTER — when w/h change, the center moves, so
 * the whole rotated image drifts on screen. The anchor's local point is
 * preserved by `bboxResize` (non-Alt), so its world drift is exactly the
 * difference of rotating that same local point around the OLD vs NEW center.
 * Returns the [dx, dy] world shift to add to the new box's x/y (translation
 * commutes with center-rotation: rotate(p+t, c+t, θ) = rotate(p, c, θ) + t).
 * Alt-resizes keep the center fixed, so there is nothing to compensate.
 */
function rotatedAnchorShift(
  b0: { x: number; y: number; w: number; h: number },
  b1: { x: number; y: number; w: number; h: number },
  corner: Corner,
  rot: number
): [number, number] {
  // Anchor identity: the opposite corner (corner drags) / the opposite edge
  // midpoint (edge drags), as a point of the START box in local coords.
  let ux: number;
  let uy: number;
  if (isEdgeCorner(corner)) {
    ux = corner === 'e' ? 0 : corner === 'w' ? 1 : 0.5;
    uy = corner === 's' ? 0 : corner === 'n' ? 1 : 0.5;
  } else {
    ux = isWestCorner(corner) ? 1 : 0;
    uy = isNorthCorner(corner) ? 1 : 0;
  }
  const px = b0.x + ux * b0.w;
  const py = b0.y + uy * b0.h;
  const [w0x, w0y] = rotatePoint(px, py, b0.x + b0.w / 2, b0.y + b0.h / 2, rot);
  const [w1x, w1y] = rotatePoint(px, py, b1.x + b1.w / 2, b1.y + b1.h / 2, rot);
  return [w0x - w1x, w0y - w1y];
}

/**
 * Shared bbox resize for rect / polygon / sticky / ellipse. Returns the new
 * axis-aligned box for the dragged `corner` moving to world (wx, wy):
 *   • normal  — the diagonally-opposite corner is the fixed anchor.
 *   • Alt     — the box's center is the fixed anchor (symmetric scale).
 *   • Shift   — keep the start aspect ratio (the dominant axis drives scale).
 *   • square  — force 1:1 regardless of Shift (sticky notes).
 * The no-modifier branch is algebraically identical to the previous
 * min/max corner math (verified against the resize round-trip tests).
 */
export function bboxResize(
  bbox: { x: number; y: number; w: number; h: number },
  corner: Corner,
  wx: number,
  wy: number,
  mods: ResizeMods,
  square: boolean
): { x: number; y: number; w: number; h: number } {
  const { x, y, w, h } = bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  // FigJam v3 — mid-edge handles move ONE axis: the opposite edge anchors
  // (Alt = symmetric around the center). Always-square strokes (sticky) let
  // the dragged axis drive the side, re-centered on the cross axis.
  if (isEdgeCorner(corner)) {
    const horizontal = corner === 'e' || corner === 'w';
    let nx = x;
    let ny = y;
    let nw = w;
    let nh = h;
    if (horizontal) {
      const anchorX = corner === 'w' ? x + w : x;
      nw = Math.max(1, mods.alt ? 2 * Math.abs(wx - cx) : Math.abs(wx - anchorX));
      nx = mods.alt ? cx - nw / 2 : wx < anchorX ? anchorX - nw : anchorX;
    } else {
      const anchorY = corner === 'n' ? y + h : y;
      nh = Math.max(1, mods.alt ? 2 * Math.abs(wy - cy) : Math.abs(wy - anchorY));
      ny = mods.alt ? cy - nh / 2 : wy < anchorY ? anchorY - nh : anchorY;
    }
    if (square) {
      const side = horizontal ? nw : nh;
      if (horizontal) {
        nh = side;
        ny = cy - side / 2;
      } else {
        nw = side;
        nx = cx - side / 2;
      }
    }
    return { x: nx, y: ny, w: nw, h: nh };
  }
  const isW = isWestCorner(corner);
  const isN = isNorthCorner(corner);
  const anchorX = isW ? x + w : x;
  const anchorY = isN ? y + h : y;

  // Raw extents from the dragged corner — center-relative under Alt.
  let nw = mods.alt ? 2 * Math.abs(wx - cx) : Math.abs(wx - anchorX);
  let nh = mods.alt ? 2 * Math.abs(wy - cy) : Math.abs(wy - anchorY);

  if (square) {
    const side = Math.max(nw, nh, 1);
    nw = side;
    nh = side;
  } else if (mods.shift && w > 0 && h > 0) {
    const s = Math.max(nw / w, nh / h);
    nw = w * s;
    nh = h * s;
  }
  nw = Math.max(1, nw);
  nh = Math.max(1, nh);

  let nx: number;
  let ny: number;
  if (mods.alt) {
    nx = cx - nw / 2;
    ny = cy - nh / 2;
  } else {
    // Grow away from the anchor toward the cursor's side (handles flips).
    nx = wx < anchorX ? anchorX - nw : anchorX;
    ny = wy < anchorY ? anchorY - nh : anchorY;
  }
  return { x: nx, y: ny, w: nw, h: nh };
}

/**
 * Wave H — `bboxResize` plus the rotated-anchor compensation in one step. The
 * box-shaped tools (rect family / image / ellipse) all need the same pair:
 * run the axis-aligned math, then shift the result so the anchored corner /
 * edge stays fixed in WORLD space (Alt keeps the center — nothing to fix).
 */
function bboxResizeRotAware(
  start: Stroke,
  b0: { x: number; y: number; w: number; h: number },
  corner: Corner,
  wx: number,
  wy: number,
  mods: ResizeMods,
  square: boolean
): { x: number; y: number; w: number; h: number } {
  const box = bboxResize(b0, corner, wx, wy, mods, square);
  const rot = strokeRotation(start);
  if (rot !== 0 && !mods.alt) {
    const [dx, dy] = rotatedAnchorShift(b0, box, corner, rot);
    box.x += dx;
    box.y += dy;
  }
  return box;
}

/**
 * Per-tool resize math. Given a stroke + the moved corner + the new world
 * coords for that corner, returns a patched stroke. `start` is the stroke at
 * the moment the drag began (used as the source-of-truth for scaling math —
 * avoids drift from rounding successive deltas). `mods` carries the live
 * FigJam resize modifiers (Shift aspect-lock, Alt scale-from-center).
 */
export function resizeStroke(
  start: Stroke,
  corner: Corner,
  wx: number,
  wy: number,
  mods: ResizeMods = NO_MODS,
  /**
   * Wave G — rotation reference for the corner rotate zones: the pointer
   * angle (deg, around the stroke center) at drag start + the stroke's
   * rotation at drag start. Rotation is RELATIVE — the grab point is the
   * zero reference, so the shape follows the hand with no jump (FigJam).
   * Without it, the raw pointer angle is used as-is.
   */
  rotRef?: { angle0: number; rot0: number }
): Partial<Stroke> | null {
  if (isRotCorner(corner)) {
    if (!canRotate(start)) return null;
    const c = strokeCenter(start);
    if (!c) return null;
    const cur = (Math.atan2(wy - c[1], wx - c[0]) * 180) / Math.PI;
    let deg = normalizeRotation(rotRef ? rotRef.rot0 + (cur - rotRef.angle0) : cur);
    if (mods.shift) {
      deg = normalizeRotation(Math.round(deg / 15) * 15);
    } else {
      // Magnetic cardinals (FigJam): drifting within 2° of 0/±90/180 locks on,
      // so "straighten it back out" doesn't need pixel-perfect aim.
      for (const cand of [0, 90, 180, -90, -180]) {
        if (Math.abs(deg - cand) <= 2) {
          deg = cand;
          break;
        }
      }
    }
    const norm = normalizeRotation(deg);
    return { rotation: norm === 0 ? undefined : norm } as Partial<Stroke>;
  }
  if (
    start.tool === 'rect' ||
    start.tool === 'sticky' ||
    start.tool === 'polygon' ||
    start.tool === 'link' ||
    start.tool === 'mediaref' ||
    start.tool === 'section'
  ) {
    // Rect / polygon / sticky / link / mediaref all resize via their shared
    // x / y / w / h bbox. Sticky stays 1:1; the link + media-ref cards
    // free-resize (Shift still locks their current ratio) so the user can size
    // the inline player up (DDR-150 dogfood — "video annotation nejde zvětšit").
    const b0 = { x: start.x, y: start.y, w: start.w, h: start.h };
    const box = bboxResizeRotAware(start, b0, corner, wx, wy, mods, start.tool === 'sticky');
    return box as Partial<RectStroke | StickyStroke | PolygonStroke | LinkStroke>;
  }
  if (start.tool === 'element') {
    // A registry type: fit its box, the fields come from its definition.
    const def = defOf(start.el.type);
    const b0 = strokeBBox(start);
    if (!def || !b0) return null;
    const box = bboxResize(b0, corner, wx, wy, mods, !!def.caps.aspectLock);
    const ctx = { origin: { x: 0, y: 0 }, resolve: () => null };
    return { el: { ...start.el, ...def.resize(start.el, box, ctx) } } as Partial<Stroke>;
  }
  if (start.tool === 'image') {
    // Phase 23 — images aspect-LOCK by default and free-resize with Shift held
    // (the inverse of the shape tools — Figma/FigJam image behaviour). Invert
    // the Shift flag into bboxResize, which keeps the START ratio when shift is
    // set; the start ratio IS the image's intrinsic aspect.
    const b0 = { x: start.x, y: start.y, w: start.w, h: start.h };
    const box = bboxResizeRotAware(
      start,
      b0,
      corner,
      wx,
      wy,
      { shift: !mods.shift, alt: mods.alt },
      false
    );
    return box as Partial<ImageStroke>;
  }
  if (start.tool === 'ellipse') {
    // Treat the four corners as the bbox of the ellipse, then derive cx/cy/rx/ry.
    const b0 = { x: start.cx - start.rx, y: start.cy - start.ry, w: start.rx * 2, h: start.ry * 2 };
    const box = bboxResizeRotAware(start, b0, corner, wx, wy, mods, false);
    return {
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      rx: Math.max(1, box.w / 2),
      ry: Math.max(1, box.h / 2),
    } as Partial<EllipseStroke>;
  }
  if (start.tool === 'arrow') {
    if (corner !== 'ep1' && corner !== 'ep2') return null;
    const otherX = corner === 'ep1' ? start.x2 : start.x1;
    const otherY = corner === 'ep1' ? start.y2 : start.y1;
    const midX = (start.x1 + start.x2) / 2;
    const midY = (start.y1 + start.y2) / 2;
    // Alt pins the midpoint (both ends mirror); otherwise the far end is fixed.
    const refX = mods.alt ? midX : otherX;
    const refY = mods.alt ? midY : otherY;
    let dragX = wx;
    let dragY = wy;
    if (mods.shift) {
      // Snap the shaft angle (relative to the reference) to 45° increments.
      const dx = wx - refX;
      const dy = wy - refY;
      const dist = Math.hypot(dx, dy);
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      dragX = refX + Math.cos(ang) * dist;
      dragY = refY + Math.sin(ang) * dist;
    }
    if (mods.alt) {
      const mirrorX = 2 * midX - dragX;
      const mirrorY = 2 * midY - dragY;
      return corner === 'ep1'
        ? ({ x1: dragX, y1: dragY, x2: mirrorX, y2: mirrorY } as Partial<ArrowStroke>)
        : ({ x2: dragX, y2: dragY, x1: mirrorX, y1: mirrorY } as Partial<ArrowStroke>);
    }
    return corner === 'ep1'
      ? ({ x1: dragX, y1: dragY } as Partial<ArrowStroke>)
      : ({ x2: dragX, y2: dragY } as Partial<ArrowStroke>);
  }
  if (start.tool === 'pen') {
    // Scale all points around an anchor — the opposite corner (normal) or the
    // bbox center (Alt). Shift forces a uniform scale (dominant axis wins).
    // A 0-extent axis (single-point pen stroke) keeps scale 1 (no div-by-zero).
    // Edge handles aren't offered for ink (corner scale only).
    if (isEdgeCorner(corner)) return null;
    const bb = strokeBBox(start);
    if (!bb) return null;
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    const isW = isWestCorner(corner);
    const isN = isNorthCorner(corner);
    let anchorX: number;
    let anchorY: number;
    let sx: number;
    let sy: number;
    if (mods.alt) {
      anchorX = cx;
      anchorY = cy;
      sx = bb.w === 0 ? 1 : (wx - cx) / (isW ? -bb.w / 2 : bb.w / 2);
      sy = bb.h === 0 ? 1 : (wy - cy) / (isN ? -bb.h / 2 : bb.h / 2);
    } else {
      anchorX = isW ? bb.x + bb.w : bb.x;
      anchorY = isN ? bb.y + bb.h : bb.y;
      const newLeft = isW ? wx : bb.x;
      const newTop = isN ? wy : bb.y;
      const newRight = isW ? bb.x + bb.w : wx;
      const newBottom = isN ? bb.y + bb.h : wy;
      sx = bb.w === 0 ? 1 : (newRight - newLeft) / bb.w;
      sy = bb.h === 0 ? 1 : (newBottom - newTop) / bb.h;
    }
    if (mods.shift) {
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = (sx < 0 ? -1 : 1) * s;
      sy = (sy < 0 ? -1 : 1) * s;
    }
    const scaled = start.points.map(
      ([px, py]) =>
        [anchorX + (px - anchorX) * sx, anchorY + (py - anchorY) * sy] as [number, number]
    );
    return { points: scaled } as Partial<PenStroke>;
  }
  return null;
}

/**
 * Returns the four corners (or two endpoints, for arrow) of the selected
 * stroke in world coordinates. Used by the overlay component to position
 * the screen-space handle divs each rAF tick. `pad` is the halo offset in
 * WORLD units (callers pass `HALO_PAD_PX / zoom` for a screen-constant gap).
 */
function handlePositions(s: Stroke, pad: number): Array<{ corner: Corner; x: number; y: number }> {
  if (s.tool === 'arrow') {
    return [
      { corner: 'ep1', x: s.x1, y: s.y1 },
      { corner: 'ep2', x: s.x2, y: s.y2 },
    ];
  }
  const bb0 = strokeBBox(s);
  if (!bb0) return [];
  // Wave G — handles sit on the HALO (bbox + pad), not glued to the stroke
  // itself; applyResize shifts the cursor back by the same pad.
  const bb = {
    x: bb0.x - pad,
    y: bb0.y - pad,
    w: bb0.w + pad * 2,
    h: bb0.h + pad * 2,
  };
  const corners: Array<{ corner: Corner; x: number; y: number }> = [
    { corner: 'nw', x: bb.x, y: bb.y },
    { corner: 'ne', x: bb.x + bb.w, y: bb.y },
    { corner: 'sw', x: bb.x, y: bb.y + bb.h },
    { corner: 'se', x: bb.x + bb.w, y: bb.y + bb.h },
  ];
  // FigJam v3 — mid-edge handles (single-axis resize) for the box-shaped
  // strokes; ink (pen) keeps corner-scale only.
  if (s.tool !== 'pen') {
    corners.push(
      { corner: 'n', x: bb.x + bb.w / 2, y: bb.y },
      { corner: 'e', x: bb.x + bb.w, y: bb.y + bb.h / 2 },
      { corner: 's', x: bb.x + bb.w / 2, y: bb.y + bb.h },
      { corner: 'w', x: bb.x, y: bb.y + bb.h / 2 }
    );
  }
  // Wave G — invisible rotate zones AT the padded corners; the rAF tick adds
  // a screen-constant outward offset (along center→corner) so they hover just
  // beyond the corner squares at every zoom + rotation.
  if (canRotate(s)) {
    corners.push(
      { corner: 'rot-nw', x: bb.x, y: bb.y },
      { corner: 'rot-ne', x: bb.x + bb.w, y: bb.y },
      { corner: 'rot-sw', x: bb.x, y: bb.y + bb.h },
      { corner: 'rot-se', x: bb.x + bb.w, y: bb.y + bb.h }
    );
  }
  // FigJam v3 — a rotated stroke carries its handles with it: every handle
  // point turns around the bbox center, so they sit on the visible outline.
  const rot = strokeRotation(s);
  if (rot !== 0) {
    const cx = bb.x + bb.w / 2;
    const cy = bb.y + bb.h / 2;
    return corners.map((c) => {
      const [rx, ry] = rotatePoint(c.x, c.y, cx, cy, rot);
      return { corner: c.corner, x: rx, y: ry };
    });
  }
  return corners;
}

export function AnnotationResizeOverlay({ store }: { store: StrokesStoreValue | null }): ReactNode {
  ensureResizeStyles();
  const annotSel = useAnnotationSelection();
  const controller = useViewportControllerContext();
  const vp = controller?.viewport ?? null;
  const pipeline = useAnnotationPipeline();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startStroke: Stroke;
    /** Wave H — full strokes snapshot at drag start (the undo `before`). */
    startStrokes: Stroke[];
    corner: Corner;
    /** FigJam v3 — neighbour bbox dims for the dimension-match snap. */
    dims: Array<{ id: string; w: number; h: number }>;
    /** Wave G — rotation drag reference (corner rotate zones only). */
    rotRef?: { angle0: number; rot0: number };
  } | null>(null);
  // Last pointer position (client coords) during a drag — lets a mid-drag
  // Shift/Alt keydown re-apply the resize without waiting for a pointermove.
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const selectedId = annotSel.selectedIds.length === 1 ? (annotSel.selectedIds[0] ?? null) : null;
  const selectedStroke: Stroke | null = useMemo(() => {
    if (!selectedId || !store) return null;
    return store.strokes.find((s) => s.id === selectedId) ?? null;
  }, [selectedId, store]);

  // Live for the same reason the rAF loop is: a trackpad pinch mid-drag moves
  // the camera without republishing, and unprojecting the pointer through a
  // stale viewport would resize the stroke to the wrong world size.
  const screenToWorld = useCallback(
    (cx: number, cy: number): [number, number] => {
      const v = getLiveViewport() ?? vp ?? { x: 0, y: 0, zoom: 1 };
      const z = v.zoom || 1;
      return [(cx - v.x) / z, (cy - v.y) / z];
    },
    [vp]
  );

  // rAF loop — repositions handles on every frame while a single resizable
  // stroke is selected. Cheaper than wiring pan/zoom observers because the
  // halo overlays already follow the same pattern.
  //
  // It MUST read `getLiveViewport()` per tick, not the `vp` captured in this
  // effect's closure: the published viewport is settle-cadence (SETTLE_MS), so
  // through a pan/zoom the closure holds one frozen value and the loop spends
  // the whole gesture recomputing the SAME stale screen positions. The handles
  // sat where the selection used to be and only snapped onto it ~half a second
  // after the gesture ended. `liveViewport` is written on every applyViewport
  // with no publish lag, and equals `vp` once settled.
  useEffect(() => {
    if (!selectedStroke || !isResizable(selectedStroke)) {
      const c = containerRef.current;
      if (c) {
        for (const child of Array.from(c.children)) {
          (child as HTMLElement).style.display = 'none';
        }
      }
      return;
    }
    const tick = () => {
      rafRef.current = null;
      const c = containerRef.current;
      if (!c) return;
      const v = getLiveViewport() ?? vp ?? { x: 0, y: 0, zoom: 1 };
      const z = v.zoom || 1;
      // Wave H — screen-constant halo offset (HALO_PAD_PX at any zoom).
      const positions = handlePositions(selectedStroke, HALO_PAD_PX / z);
      // Ensure enough handle children exist (each corner = one absolutely-
      // positioned div); the per-kind class is assigned below.
      while (c.children.length < positions.length) {
        c.appendChild(document.createElement('div'));
      }
      while (c.children.length > positions.length) {
        c.lastChild && c.removeChild(c.lastChild);
      }
      // Wave G — rotate zones push a screen-constant step OUTWARD from the
      // stroke center so they hover diagonally beyond the corner squares.
      const wc = strokeCenter(selectedStroke);
      const csx = wc ? wc[0] * z + v.x : 0;
      const csy = wc ? wc[1] * z + v.y : 0;
      for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const handle = c.children[i] as HTMLElement | undefined;
        if (!pos || !handle) continue;
        let sx = pos.x * z + v.x;
        let sy = pos.y * z + v.y;
        const isRot = isRotCorner(pos.corner);
        if (isRot && wc) {
          const dx = sx - csx;
          const dy = sy - csy;
          const len = Math.hypot(dx, dy) || 1;
          const reach = 13;
          sx += (dx / len) * reach;
          sy += (dy / len) * reach;
        }
        // Edge pills are 14×6 / 6×14, rotate zones 18×18 (corners 8×8) —
        // center each on its point.
        const ns = pos.corner === 'n' || pos.corner === 's';
        const ew = pos.corner === 'e' || pos.corner === 'w';
        const halfW = isRot ? 9 : ns ? 7 : ew ? 3 : 4;
        const halfH = isRot ? 9 : ns ? 3 : ew ? 7 : 4;
        handle.className = isRot ? 'dc-annot-rotate-zone' : 'dc-annot-resize-handle';
        handle.style.display = 'block';
        handle.style.left = `${Math.round(sx - halfW)}px`;
        handle.style.top = `${Math.round(sy - halfH)}px`;
        handle.dataset.corner = pos.corner;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [selectedStroke, vp]);

  // Pointer handling — pointerdown on a handle starts a drag; pointermove
  // patches the stroke via `store.updateStroke`; pointerup commits.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        !t?.classList.contains('dc-annot-resize-handle') &&
        !t?.classList.contains('dc-annot-rotate-zone')
      )
        return;
      if (!t || !selectedStroke || !store) return;
      const corner = t.dataset.corner as Corner | undefined;
      if (!corner) return;
      e.preventDefault();
      e.stopPropagation();
      // Wave G — corner rotation is relative to the grab angle (no jump).
      let rotRef: { angle0: number; rot0: number } | undefined;
      if (isRotCorner(corner)) {
        const cw = strokeCenter(selectedStroke);
        if (cw) {
          const [wx, wy] = screenToWorld(e.clientX, e.clientY);
          rotRef = {
            angle0: (Math.atan2(wy - cw[1], wx - cw[0]) * 180) / Math.PI,
            rot0: strokeRotation(selectedStroke),
          };
        }
      }
      // FigJam v3 — dimension-match candidates, captured once per gesture: the
      // bbox dims of every OTHER box-shaped stroke. While resizing, a width /
      // height within the threshold of a neighbour's snaps to it exactly and
      // the neighbour gets a match halo (the "make it the same size" quota).
      const dims: Array<{ id: string; w: number; h: number }> = [];
      for (const s of store.strokes) {
        if (s.id === selectedStroke.id) continue;
        if (s.tool === 'pen' || s.tool === 'arrow' || s.tool === 'text') continue;
        const bb = strokeBBox(s);
        if (bb && bb.w > 1 && bb.h > 1) dims.push({ id: s.id, w: bb.w, h: bb.h });
      }
      dragRef.current = {
        pointerId: e.pointerId,
        startStroke: selectedStroke,
        startStrokes: store.strokes,
        corner,
        dims,
        rotRef,
      };
      try {
        t.setPointerCapture(e.pointerId);
      } catch {
        /* some browsers reject capture on synthetic events */
      }
      // The layer's pointer pipeline owns the moves and the release (Task 21);
      // mounted without a layer (tests), the overlay listens itself.
      if (pipeline) {
        const pointerId = e.pointerId;
        pipeline.begin(pointerId, {
          kind: isRotCorner(corner) ? 'rotating' : 'resizing',
          move: onMove,
          up: onUp,
          cancel: (ev) => onUp(ev ?? ({ pointerId } as PointerEvent)),
        });
      }
    };
    const applyResize = (
      clientX: number,
      clientY: number,
      mods: ResizeMods,
      suppressBind: boolean
    ) => {
      const d = dragRef.current;
      if (!d || !store) return;
      const [wx, wy] = screenToWorld(clientX, clientY);
      // FigJam v3 — a rotated stroke resizes in its LOCAL frame: inverse-
      // rotate the cursor around the start pivot, run the axis-aligned math,
      // keep the rotation. (The rotation knob itself wants the RAW cursor.)
      let lwx = wx;
      let lwy = wy;
      const startRot = strokeRotation(d.startStroke);
      if (startRot !== 0 && !isRotCorner(d.corner)) {
        const c = strokeCenter(d.startStroke);
        if (c) {
          const [ux, uy] = rotatePoint(wx, wy, c[0], c[1], -startRot);
          lwx = ux;
          lwy = uy;
        }
      }
      // Wave G/H — handles render padded OFF the bbox (screen-constant); shift
      // the cursor back onto the true corner/edge so the first move doesn't
      // grow the shape.
      const padWorld = HALO_PAD_PX / (vp?.zoom || 1);
      lwx += padDX(d.corner) * padWorld;
      lwy += padDY(d.corner) * padWorld;
      let patch = resizeStroke(d.startStroke, d.corner, lwx, lwy, mods, d.rotRef);
      if (!patch) return;
      // FigJam v3 — dimension match + live size label for box resizes. ⌘
      // suppresses matching (same convention as drag snapping).
      if (
        d.startStroke.tool !== 'arrow' &&
        d.startStroke.tool !== 'pen' &&
        'w' in patch &&
        'h' in patch &&
        typeof patch.w === 'number' &&
        typeof patch.h === 'number' &&
        typeof patch.x === 'number' &&
        typeof patch.y === 'number'
      ) {
        const zoom = vp?.zoom || 1;
        const thr = 6 / zoom;
        const matchIds: string[] = [];
        if (!suppressBind && d.dims.length) {
          // Only the axes this handle actually drags participate — an east-
          // edge drag must never quietly re-snap the HEIGHT to a neighbour.
          const edge = isEdgeCorner(d.corner);
          const affectsW = !edge || d.corner === 'e' || d.corner === 'w';
          const affectsH = !edge || d.corner === 'n' || d.corner === 's';
          let bestW: { id: string; w: number } | null = null;
          let bestH: { id: string; h: number } | null = null;
          for (const cand of d.dims) {
            if (
              affectsW &&
              Math.abs(cand.w - patch.w) <= thr &&
              (!bestW || Math.abs(cand.w - patch.w) < Math.abs(bestW.w - patch.w))
            ) {
              bestW = { id: cand.id, w: cand.w };
            }
            if (
              affectsH &&
              Math.abs(cand.h - patch.h) <= thr &&
              (!bestH || Math.abs(cand.h - patch.h) < Math.abs(bestH.h - patch.h))
            ) {
              bestH = { id: cand.id, h: cand.h };
            }
          }
          // Snap the box to the matched dim, keeping the anchored edge fixed
          // (the cursor-side edge moves; x/y only shift when the west/north
          // edge was the dragged one).
          if (bestW) {
            if (wx < patch.x + patch.w / 2) patch.x = patch.x + patch.w - bestW.w;
            patch.w = bestW.w;
            matchIds.push(bestW.id);
          }
          if (bestH) {
            if (wy < patch.y + patch.h / 2) patch.y = patch.y + patch.h - bestH.h;
            patch.h = bestH.h;
            matchIds.push(bestH.id);
          }
        }
        store.setResizeInfo?.({
          box: { x: patch.x, y: patch.y, w: patch.w, h: patch.h },
          matchIds,
        });
      }
      // FigJam v3 — dragging an arrow ENDPOINT re-anchors its bind: within the
      // magnet threshold of a bindable host the endpoint snaps + binds; free
      // space (or ⌘ held — Figma "suppress snap") clears the bind. The layer
      // paints the candidate halo (store.setBindHint).
      if (d.startStroke.tool === 'arrow' && (d.corner === 'ep1' || d.corner === 'ep2')) {
        const zoom = vp?.zoom || 1;
        const cand = suppressBind
          ? null
          : bindCandidate(
              wx,
              wy,
              store.strokes,
              BIND_THRESHOLD_PX / zoom,
              new Set([d.startStroke.id])
            );
        if (cand) {
          const host = store.strokes.find((s) => s.id === cand.hostId);
          const pt = host ? anchorPoint(host, cand.nx, cand.ny) : null;
          if (pt) {
            // An explicit endpoint re-anchor PINS the magnet — auto-routing
            // must not override a side the user chose by hand.
            const pinned = { ...cand, pinned: true };
            patch =
              d.corner === 'ep1'
                ? ({ ...patch, startBind: pinned, x1: pt[0], y1: pt[1] } as Partial<Stroke>)
                : ({ ...patch, endBind: pinned, x2: pt[0], y2: pt[1] } as Partial<Stroke>);
          }
        } else {
          patch = {
            ...patch,
            [d.corner === 'ep1' ? 'startBind' : 'endBind']: undefined,
          } as Partial<Stroke>;
        }
        store.setBindHint?.(cand?.hostId ?? null);
      }
      // Wave H — transient preview tick: no undo record, no PUT. The gesture
      // commits ONCE on pointerup (undo used to walk every resize pixel).
      store.previewStroke(d.startStroke.id, patch);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      applyResize(
        e.clientX,
        e.clientY,
        { shift: e.shiftKey, alt: e.altKey },
        e.metaKey || e.ctrlKey
      );
    };
    // Holding/releasing Shift / Alt / ⌘ mid-drag re-runs the resize at the
    // last known pointer position so the constraint flips live, FigJam-style.
    const onKey = (e: KeyboardEvent) => {
      if (!dragRef.current) return;
      if (e.key !== 'Shift' && e.key !== 'Alt' && e.key !== 'Meta' && e.key !== 'Control') return;
      const p = lastPointRef.current;
      if (!p) return;
      e.preventDefault();
      applyResize(p.x, p.y, { shift: e.shiftKey, alt: e.altKey }, e.metaKey || e.ctrlKey);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      lastPointRef.current = null;
      // Wave H — close the preview gesture as ONE undo record (no-op when
      // the drag ended exactly where it started).
      store?.commitGesture(
        d.startStrokes,
        isRotCorner(d.corner)
          ? 'rotate'
          : d.corner === 'ep1' || d.corner === 'ep2'
            ? 'move endpoint'
            : 'resize'
      );
      // Clear the bind-hint halo + size label regardless of what was dragged
      // (no-ops when nothing was hinted).
      store?.setBindHint?.(null);
      store?.setResizeInfo?.(null);
    };
    c.addEventListener('pointerdown', onDown);
    if (!pipeline) {
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    return () => {
      c.removeEventListener('pointerdown', onDown);
      if (!pipeline) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
      }
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKey, true);
    };
  }, [selectedStroke, store, screenToWorld, vp, pipeline]);

  // Only render when there's exactly one resizable stroke selected. Multi
  // resize is undefined for v1 (no canonical UX); text inherits anchor bbox.
  if (!selectedStroke || !isResizable(selectedStroke)) return null;
  return <div ref={containerRef} aria-hidden="true" />;
}
