/**
 * @file       use-element-resize.tsx — feature-element-editing-robustness Stage D
 * @scope      apps/studio/use-element-resize.tsx
 * @purpose    On-canvas drag-resize for the single selected CANVAS ELEMENT
 *             (an `[data-cd-id]` node in an artboard), the DOM counterpart of
 *             `use-annotation-resize.tsx` (which targets the SVG annotation
 *             model). Renders 8 screen-space handles (4 corner + 4 edge) that
 *             stay a constant 8 px at any zoom, with FigJam modifier grammar:
 *             Shift = lock aspect ratio, Alt = resize from center. On release it
 *             commits `width`/`height` (+ `left`/`top` for a top/left-edge drag
 *             on an out-of-flow element) through the SAME `reposition-request`-
 *             style lane the coordinate drag uses (untrusted canvas REQUESTS,
 *             main-origin shell WRITES via `/_api/edit-css` — DDR-054).
 *
 *             Composition with ReorderDrag: the handles are `position:fixed`
 *             overlay divs OUTSIDE the artboard, so ReorderDrag's `el.contains
 *             (target)` gate (canvas-shell) never fires for a handle pointerdown
 *             — a body drag still moves via reorder/reposition, a handle drag
 *             resizes.
 *
 *             In-flow elements resize by writing explicit `width`/`height` only
 *             (a resize NEVER implicitly converts to absolute; the explicit
 *             context-menu "Convert children to absolute" — feature-4 T8,
 *             DDR-188 — is the opt-in flatten path); an out-of-flow
 *             (absolute/fixed) element additionally moves `left`/`top` when the
 *             top/left edge is dragged, so the resize feels origin-correct.
 */

import { type ReactNode, useCallback, useEffect, useRef } from 'react';
import { globalCdOccurrence, resolveSelectionEl } from './dom-selection.ts';
import { isElementDragActive } from './drag-state.ts';
import { useSelectionSet } from './use-selection-set.tsx';
import { useToolMode } from './use-tool-mode.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Handle CSS — mirrors the `.dc-annot-resize-handle` recipe (DS `.sel-handle`:
// accent square, accent-fg hairline border, radius-xs). Kept as its own class so
// it doesn't depend on the annotation overlay being mounted. Comment must stay
// backtick-free — it lives inside the template literal.

const EL_RESIZE_CSS = `
.dc-el-resize-handle {
  position: fixed;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  /* P8 C5 (14 R2, board .ed-h): a bg-2 square with a 1.5 px inset accent, no radius — the same 8 x 8 on edges */
  background: var(--maude-chrome-bg-2, #ffffff);
  border: 0;
  box-shadow: inset 0 0 0 1.5px var(--maude-hud-accent, oklch(0.53 0.175 238));
  border-radius: 0;
  z-index: 6;
  pointer-events: auto;
  touch-action: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
.dc-el-resize-handle[data-corner="nw"], .dc-el-resize-handle[data-corner="se"] { cursor: nwse-resize !important; }
.dc-el-resize-handle[data-corner="ne"], .dc-el-resize-handle[data-corner="sw"] { cursor: nesw-resize !important; }
.dc-el-resize-handle[data-corner="n"], .dc-el-resize-handle[data-corner="s"] { cursor: ns-resize !important; }
.dc-el-resize-handle[data-corner="e"], .dc-el-resize-handle[data-corner="w"] { cursor: ew-resize !important; }
/* Rotation lives in INVISIBLE zones just outside each CORNER (FigJam / mirrors
   the annotation .dc-annot-rotate-zone) — the cursor flips to a rotate glyph and
   dragging turns the element. z-index BELOW the corner squares so the resize
   square wins on the inner overlap; the surrounding ring rotates. */
.dc-el-resize-handle[data-corner^="rot-"] {
  width: 20px; height: 20px;
  background: transparent !important;
  border: none !important;
  border-radius: 0 !important;
  z-index: 5;
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'%3E%3Cg fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath stroke='white' stroke-width='4' d='M4.8 13 A6 6 0 1 1 15.2 13 M2.2 10.8 L4.8 13 L7.4 10.9 M12.6 10.9 L15.2 13 L17.8 10.8'/%3E%3Cpath stroke='black' stroke-width='1.8' d='M4.8 13 A6 6 0 1 1 15.2 13 M2.2 10.8 L4.8 13 L7.4 10.9 M12.6 10.9 L15.2 13 L17.8 10.8'/%3E%3C/g%3E%3C/svg%3E") 10 10, alias !important;
}
/* Task L7 — live W×H (+ X,Y for an out-of-flow edge drag) readout pill, shown
   only WHILE a resize is in flight (see the tick() gate below). */
.dc-el-resize-readout {
  position: fixed;
  transform: translate(-50%, 12px);
  font-family: var(--maude-chrome-font-body, system-ui, -apple-system, sans-serif);
  font-size: 11px;
  padding: 3px 7px;
  background: var(--maude-hud-accent, oklch(0.680 0.180 268));
  color: var(--maude-hud-accent-fg, oklch(0.180 0.030 268));
  border-radius: 4px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  z-index: 6;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms cubic-bezier(0.4, 0, 0.2, 1);
}
/* INV-2 — reveal/settle collapses to 1ms, same idiom as every other overlay
   stylesheet in this codebase (equal-spacing-handles.tsx, etc). This overlay
   is mounted inside the canvas iframe's OWN document, which never loads the
   shell's 1-tokens-shell.css — the prefers-reduced-motion guard has to be
   re-declared per injected stylesheet, it doesn't cascade in from the shell.
   Comment stays backtick-free — it lives inside the template literal. */
@media (prefers-reduced-motion: reduce) {
  .dc-el-resize-handle, .dc-el-resize-readout { transition-duration: 1ms; }
}
`.trim();

function ensureElementResizeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-el-resize-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-el-resize-css';
  s.textContent = EL_RESIZE_CSS;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure resize math — unit-tested without a DOM.

export type ElResizeCorner = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** The 8 handles in a stable render order. */
export const EL_RESIZE_CORNERS: ElResizeCorner[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export interface ElResizeStart {
  /** World-px border-box dimensions at drag start. */
  w: number;
  h: number;
  /** Authored inline `left`/`top` (world px), or NaN when not present. */
  left: number;
  top: number;
}

export interface ElResizeMods {
  aspect: boolean; // Shift → lock start ratio
  center: boolean; // Alt → resize from center
}

export interface ElResizeFlags {
  /** True only for an out-of-flow element with an inline `left` — so a west-edge
   *  drag may move the origin. In-flow elements resize from their layout origin
   *  (width/height only), never moving left/top. */
  canMoveLeft: boolean;
  canMoveTop: boolean;
}

export interface ElResizeResult {
  width: number;
  height: number;
  left?: number;
  top?: number;
}

function edgeFlags(corner: ElResizeCorner) {
  return {
    movesLeft: corner === 'nw' || corner === 'w' || corner === 'sw',
    movesRight: corner === 'ne' || corner === 'e' || corner === 'se',
    movesTop: corner === 'nw' || corner === 'n' || corner === 'ne',
    movesBottom: corner === 'sw' || corner === 's' || corner === 'se',
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const MIN_SIZE = 1;

/**
 * Compute the target box for a resize drag. `dxW`/`dyW` are the cursor deltas in
 * WORLD units (screen delta ÷ the element's own render zoom). The result carries
 * `left`/`top` ONLY when the corresponding edge moved AND the flag permits it
 * (out-of-flow with an inline value) — so an in-flow element never gets a left/
 * top write. Left/top are derived by holding the OPPOSITE edge fixed (Figma
 * grammar), which is exact for both plain and aspect-locked resizes.
 */
export function computeElementResize(
  corner: ElResizeCorner,
  start: ElResizeStart,
  dxW: number,
  dyW: number,
  mods: ElResizeMods,
  flags: ElResizeFlags
): ElResizeResult {
  const { movesLeft, movesRight, movesTop, movesBottom } = edgeFlags(corner);
  const center = mods.center;

  let width = start.w;
  let height = start.h;
  if (movesRight) width = start.w + (center ? 2 * dxW : dxW);
  else if (movesLeft) width = start.w - (center ? 2 * dxW : dxW);
  if (movesBottom) height = start.h + (center ? 2 * dyW : dyW);
  else if (movesTop) height = start.h - (center ? 2 * dyW : dyW);

  // Aspect lock (Shift): keep the start ratio. Corner → drive by the axis with
  // the larger relative change; single edge → scale the other dimension.
  if (mods.aspect && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    const isCorner = (movesLeft || movesRight) && (movesTop || movesBottom);
    if (isCorner) {
      const relW = Math.abs(width - start.w) / start.w;
      const relH = Math.abs(height - start.h) / start.h;
      if (relW >= relH) height = width / ratio;
      else width = height * ratio;
    } else if (movesLeft || movesRight) {
      height = width / ratio;
    } else if (movesTop || movesBottom) {
      width = height * ratio;
    }
  }

  if (width < MIN_SIZE) width = MIN_SIZE;
  if (height < MIN_SIZE) height = MIN_SIZE;

  const result: ElResizeResult = { width: round(width), height: round(height) };
  // Derive left/top from the FINAL size by holding the opposite edge fixed.
  if (center) {
    if (flags.canMoveLeft && (movesLeft || movesRight))
      result.left = round(start.left + (start.w - width) / 2);
    if (flags.canMoveTop && (movesTop || movesBottom))
      result.top = round(start.top + (start.h - height) / 2);
  } else {
    if (flags.canMoveLeft && movesLeft) result.left = round(start.left + start.w - width);
    if (flags.canMoveTop && movesTop) result.top = round(start.top + start.h - height);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotation math (Task L8) — free-hand rotate handle. All pure, unit-tested.

/** Rotation angle (deg) from a CSS `transform` matrix (`none`/`matrix(...)`). */
export function rotationDegFromMatrix(transform: string | null | undefined): number {
  if (!transform || transform === 'none') return 0;
  const m = /matrix\(([^)]+)\)/.exec(transform);
  if (!m) return 0;
  const parts = m[1].split(',').map(Number);
  const a = parts[0] ?? 1;
  const b = parts[1] ?? 0;
  return Math.round(Math.atan2(b, a) * (180 / Math.PI) * 100) / 100;
}

/** Uniform scale from a CSS `transform` matrix (the `.dc-world` zoom). 1 when none. */
export function scaleFromMatrix(transform: string | null | undefined): number {
  if (!transform || transform === 'none') return 1;
  const m = /matrix\(([^)]+)\)/.exec(transform);
  if (!m) return 1;
  const parts = m[1].split(',').map(Number);
  const a = parts[0] ?? 1;
  const b = parts[1] ?? 0;
  const s = Math.hypot(a, b);
  return s > 0 ? s : 1;
}

/**
 * The `.dc-world` camera's effective render zoom for an element. Dogfood fix
 * (print-artboards round): the camera writes DIFFERENT properties per engine
 * (writeTransform's IS_WEBKIT split in canvas-lib) — WebKit gets
 * `transform: scale(z)`, Chromium gets the CSS `zoom` PROPERTY (whose
 * computed `transform` is a bare translate). Reading only the matrix
 * therefore returned 1 in every non-WebKit browser and the handle/spacing
 * overlays drew at world size instead of screen size, visibly scaling with
 * the camera (the desktop app is WKWebView, which is why dogfooding never
 * caught it). Multiplying both reads is exact on each engine: the unused
 * property computes to identity.
 */
export function worldZoomFor(el: Element): number {
  const world = el.closest('.dc-world') as HTMLElement | null;
  if (!world) return 1;
  const cs = getComputedStyle(world);
  const zoomProp = Number.parseFloat((cs as { zoom?: string }).zoom || '1') || 1;
  return scaleFromMatrix(cs.transform) * zoomProp;
}

/** Rotate a local offset (dx,dy) by `deg` — screen y is down, positive = CW. */
export function rotatePointDeg(dx: number, dy: number, deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** Screen angle (radians) from the element center to a point. */
export function pointerAngleRad(cx: number, cy: number, px: number, py: number): number {
  return Math.atan2(py - cy, px - cx);
}

/**
 * RELATIVE rotate (FigJam corner-zone model): the element's new angle after
 * dragging from `startPointerRad` to `curPointerRad`, starting from
 * `startElementDeg`. Grab any corner zone and turn — the delta is the change in
 * the center→pointer angle, so the corner tracks the cursor. Snaps to 15° while
 * Shift is held. Normalized to (-180, 180].
 */
export function rotateDeltaDeg(
  startElementDeg: number,
  startPointerRad: number,
  curPointerRad: number,
  snap: boolean
): number {
  let deg = startElementDeg + (curPointerRad - startPointerRad) * (180 / Math.PI);
  while (deg > 180) deg -= 360;
  while (deg <= -180) deg += 360;
  if (snap) deg = Math.round(deg / 15) * 15;
  return Math.round(deg * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay component — mounted once in CanvasShell alongside SelectionHalos.

type RotCorner = 'rot-nw' | 'rot-ne' | 'rot-sw' | 'rot-se';

interface ElResizeDrag {
  pointerId: number;
  corner: ElResizeCorner | RotCorner;
  el: HTMLElement;
  cdId: string;
  /** GLOBAL DOM-occurrence index of `el` among same-cd-id nodes (Stage H3). For a
   *  reused component the server maps it to the dragged instance's `<Component/>`
   *  usage so resizing one instance stays local; 0 for a normal element. */
  idIndex: number;
  /** Stage D4 — set when this drag targets a whole ARTBOARD frame (`[data-dc-
   *  screen]`, no data-cd-id) instead of a canvas element. Commits via
   *  `resize-artboard-request` (numeric width/height PROPS, DDR-027) instead of
   *  `resize-request`. Null for an ordinary element drag. */
  artboardId: string | null;
  startClientX: number;
  startClientY: number;
  elZoom: number; // rect.width / offsetWidth — the element's own render scale
  /** Element rotation (deg) at drag start — resize deltas are un-rotated by it,
   *  and it's the base angle a rotate drag turns FROM. */
  angle: number;
  /** Screen center of the element — the pivot for a rotate drag. */
  cx: number;
  cy: number;
  /** center→pointer angle (rad) at rotate-drag start (relative rotation base). */
  rotStartPointer: number;
  start: ElResizeStart;
  flags: ElResizeFlags;
  /** Inline style values BEFORE the drag — the undo `before` + failure restore. */
  before: {
    width: string | null;
    height: string | null;
    left: string | null;
    top: string | null;
    transform: string | null;
  };
  lastResult: ElResizeResult | null;
  /** Last previewed `transform` (rotate drag) — the commit value. */
  lastTransform: string | null;
}

/** Post the committed resize to the main-origin shell. Split out so the message
 *  shape stays in one place. `null` before = the prop was unset (reset on undo). */
function postResizeRequest(drag: ElResizeDrag, r: ElResizeResult): void {
  const patch: Record<string, string> = {
    width: `${r.width}px`,
    height: `${r.height}px`,
  };
  if (typeof r.left === 'number') patch.left = `${r.left}px`;
  if (typeof r.top === 'number') patch.top = `${r.top}px`;
  try {
    window.parent.postMessage(
      { dgn: 'resize-request', id: drag.cdId, patch, before: drag.before, idIndex: drag.idIndex },
      '*'
    );
  } catch {
    /* detached / cross-origin teardown */
  }
}

/** Stage D4 — post a committed ARTBOARD resize. `width`/`height` are plain
 *  NUMBERS (world px, not px strings) — the shell writes them as numeric JSX
 *  attrs via `/_api/resize-artboard` (DDR-027: artboard size is JSX-authoritative,
 *  not inline style). Never carries left/top — see the `artboardId` doc above. */
function postResizeArtboardRequest(drag: ElResizeDrag, r: ElResizeResult): void {
  if (!drag.artboardId) return;
  try {
    window.parent.postMessage(
      {
        dgn: 'resize-artboard-request',
        artboardId: drag.artboardId,
        width: r.width,
        height: r.height,
      },
      '*'
    );
  } catch {
    /* detached / cross-origin teardown */
  }
}

/** Post a committed rotate (Task L8) — a `transform` patch on the same lane. */
function postRotateRequest(drag: ElResizeDrag, transform: string): void {
  try {
    window.parent.postMessage(
      {
        dgn: 'resize-request',
        id: drag.cdId,
        patch: { transform },
        before: drag.before,
        idIndex: drag.idIndex,
      },
      '*'
    );
  } catch {
    /* detached / cross-origin teardown */
  }
}

export function ElementResizeOverlay(): ReactNode {
  ensureElementResizeStyles();
  const { selected } = useSelectionSet();
  const { tool } = useToolMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const dragRef = useRef<ElResizeDrag | null>(null);
  // Last committed { el, before } — restored if the shell reports the write
  // failed (dgn:'resize-failed'), so a rejected resize doesn't leave a phantom
  // inline box that the (suppressed / absent) HMR reload never corrects.
  const lastCommitRef = useRef<{ el: HTMLElement; before: ElResizeDrag['before'] } | null>(null);

  const one = selected.length === 1 ? selected[0] : null;
  const cdId = one && typeof one.id === 'string' ? one.id : null;
  // Stage D4 — a whole-ARTBOARD selection (chrome click: no data-cd-id, just the
  // `data-dc-screen` host) also gets handles, restricted to E/S/SE (growth-only —
  // see the `artboardId` doc on ElResizeDrag for why left/top never move).
  const artboardOnly = one && !cdId && typeof one.artboardId === 'string' ? one.artboardId : null;
  // A real ELEMENT selection with the move tool active gets handles. S2.8: a whole-ARTBOARD selection no longer does
  // — editing/artboard-handles.tsx draws the eight handles with the preset ruler there, one set not two.
  const active = tool === 'move' && !!cdId;

  // rAF loop — follow the selected element's screen box (pan/zoom + layout).
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    // INV-2 — opacity+pointer-events, not display:none, so a fresh selection's
    // handles/readout FADE in rather than pop (the `transition` on both
    // classes above). Interactivity (pointer-events) flips instantly — a
    // handle is grabbable the moment it's selected, even mid-fade.
    const hideAll = () => {
      for (const child of Array.from(c.children)) {
        const h = child as HTMLElement;
        h.style.opacity = '0';
        h.style.pointerEvents = 'none';
      }
    };
    if (!active || !one) {
      hideAll();
      return;
    }
    const tick = () => {
      rafRef.current = null;
      // Dogfood 2026-07-07 — a live ReorderDrag is the canvas's most DOM-churn-
      // heavy gesture (never true for OUR own resize drag — a handle grab
      // stopPropagation()s before ReorderDrag's own pointerdown listener sees
      // it); skip this overlay's per-frame work while one is in flight so it
      // doesn't compound the jank ("hrozně zavaší ten toolbar").
      if (isElementDragActive()) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      // Skip inline text runs where width/height are meaningless (no explicit box).
      if (!el) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) {
        hideAll();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Stage D4 — an artboard gets growth-only handles (E/S/SE) and NO rotate
      // zones (artboards don't rotate); an element gets the full 8 + 4 rotate set.
      const resizeCorners: ElResizeCorner[] = artboardOnly ? ['e', 's', 'se'] : EL_RESIZE_CORNERS;
      const rotateZones: RotCorner[] = artboardOnly ? [] : ['rot-nw', 'rot-ne', 'rot-sw', 'rot-se'];
      // +1 persistent slot (LAST child) for the Task L7 readout pill — always
      // present, hidden via opacity outside an active drag.
      const TOTAL = resizeCorners.length + rotateZones.length + 1;
      while (c.children.length < TOTAL) c.appendChild(document.createElement('div'));
      while (c.children.length > TOTAL) c.lastChild && c.removeChild(c.lastChild);

      // Rotation-aware placement (Task L8): the element's AABB center is its true
      // center (default transform-origin), so handles ride the ROTATED box. Read
      // the element's own rotation + the .dc-world zoom from computed style (DOM
      // reads — the overlay stays camera-agnostic, no viewport controller).
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const deg = rotationDegFromMatrix(getComputedStyle(el).transform);
      const zoom = worldZoomFor(el);
      const hw = (el.offsetWidth * zoom) / 2;
      const hh = (el.offsetHeight * zoom) / 2;
      // Rotate zones sit ON each corner (same offset), 20×20, z-index below the
      // 8×8 corner square — so the square wins the center + the ring rotates.
      const localOffset: Record<string, [number, number]> = {
        nw: [-hw, -hh],
        n: [0, -hh],
        ne: [hw, -hh],
        e: [hw, 0],
        se: [hw, hh],
        s: [0, hh],
        sw: [-hw, hh],
        w: [-hw, 0],
        'rot-nw': [-hw, -hh],
        'rot-ne': [hw, -hh],
        'rot-sw': [-hw, hh],
        'rot-se': [hw, hh],
      };
      // Rotate zones FIRST (lower in the DOM / z-index 5), corners LAST so the
      // 8×8 squares paint on top in the overlap.
      const handles = [...rotateZones, ...resizeCorners];
      for (let i = 0; i < handles.length; i++) {
        const corner = handles[i];
        const handle = c.children[i] as HTMLElement;
        const [ox, oy] = localOffset[corner] ?? [0, 0];
        const [rx, ry] = rotatePointDeg(ox, oy, deg);
        const ax = cx + rx;
        const ay = cy + ry;
        const isRot = corner.startsWith('rot-');
        const ns = corner === 'n' || corner === 's';
        const ew = corner === 'e' || corner === 'w';
        const halfW = isRot ? 10 : ns ? 7 : ew ? 3 : 4;
        const halfH = isRot ? 10 : ns ? 3 : ew ? 7 : 4;
        handle.className = 'dc-el-resize-handle';
        handle.dataset.corner = corner;
        handle.style.opacity = '1';
        handle.style.pointerEvents = 'auto';
        handle.style.left = `${Math.round(ax - halfW)}px`;
        handle.style.top = `${Math.round(ay - halfH)}px`;
        // Orient the edge pills with the element; rotate zones stay unrotated.
        handle.style.transform = isRot ? '' : `rotate(${deg}deg)`;
      }

      // Task L7 — live W×H (+X,Y when an edge drag moves the origin) readout,
      // shown only while THIS element's resize handle is actually being
      // dragged (dragRef is set by the pointerdown handler below). World
      // units — offsetWidth/Height + the drag's own left/top, unaffected by
      // the .dc-world zoom transform (same invariant Stage A's camera fix
      // relies on), so the number reads correctly at any zoom.
      const readout = c.children[handles.length] as HTMLElement;
      const drag = dragRef.current;
      if (drag && drag.el === el && !drag.corner.startsWith('rot-')) {
        const w = drag.lastResult?.width ?? el.offsetWidth;
        const h = drag.lastResult?.height ?? el.offsetHeight;
        let label = `${Math.round(w)} × ${Math.round(h)}`;
        const lx = drag.lastResult?.left;
        const ly = drag.lastResult?.top;
        if (typeof lx === 'number' || typeof ly === 'number') {
          label += `  ·  ${Math.round(lx ?? drag.start.left)}, ${Math.round(ly ?? drag.start.top)}`;
        }
        readout.className = 'dc-el-resize-readout';
        readout.textContent = label;
        readout.style.opacity = '1';
        readout.style.left = `${Math.round(cx)}px`;
        readout.style.top = `${Math.round(cy + hh)}px`;
      } else {
        readout.style.opacity = '0';
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, one, artboardOnly]);

  // Live-apply a resize result to the element's inline style (instant preview,
  // no source write). Commit on release.
  const applyPreview = useCallback((d: ElResizeDrag, r: ElResizeResult) => {
    d.el.style.width = `${r.width}px`;
    d.el.style.height = `${r.height}px`;
    if (typeof r.left === 'number') d.el.style.left = `${r.left}px`;
    if (typeof r.top === 'number') d.el.style.top = `${r.top}px`;
    d.lastResult = r;
  }, []);

  // Pointer handling — pointerdown on a handle starts the drag.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;

    const computeFromEvent = (d: ElResizeDrag, ev: PointerEvent): ElResizeResult => {
      // Un-rotate the screen delta into the element's LOCAL frame (so dragging a
      // handle resizes along the element's own axes on a rotated element), then
      // ÷ render zoom → world units.
      const [ldx, ldy] = rotatePointDeg(
        ev.clientX - d.startClientX,
        ev.clientY - d.startClientY,
        -d.angle
      );
      return computeElementResize(
        d.corner as ElResizeCorner,
        d.start,
        ldx / d.elZoom,
        ldy / d.elZoom,
        // Stage D4 — Alt/center is ignored for an artboard: without a left/top
        // write, "center" would just double the growth speed with no visual
        // recentering (confusing). Aspect-lock (Shift) still applies to both.
        { aspect: !!ev.shiftKey, center: !d.artboardId && !!ev.altKey },
        d.flags
      );
    };

    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.classList.contains('dc-el-resize-handle')) return;
      const corner = t.dataset.corner as ElResizeCorner | RotCorner | undefined;
      if (!corner || !one) return;
      const elCdId = typeof one.id === 'string' ? one.id : null;
      const elArtboardId = !elCdId && typeof one.artboardId === 'string' ? one.artboardId : null;
      if (!elCdId && !elArtboardId) return;
      const el = resolveSelectionEl(document, one) as HTMLElement | null;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const elZoom = el.offsetWidth ? rect.width / el.offsetWidth : 1;
      const cs = getComputedStyle(el);
      // Stage D4 — an artboard NEVER derives left/top from a resize drag (the
      // route only writes width/height PROPS; layout.artboards[] x/y stays
      // untouched — see the plan's Task D4 gotcha). Forcing outOfFlow=false here
      // (even though an artboard IS position:absolute in the DOM) is what makes
      // `flags.canMoveLeft/Top` false below; the growth-only E/S/SE handle set
      // rendered above is the visual half of the same guarantee.
      const outOfFlow = !elArtboardId && (cs.position === 'absolute' || cs.position === 'fixed');
      const startLeft = elArtboardId ? Number.NaN : Number.parseFloat(el.style.left);
      const startTop = elArtboardId ? Number.NaN : Number.parseFloat(el.style.top);
      const angle = elArtboardId ? 0 : rotationDegFromMatrix(cs.transform);
      const z = elZoom > 0 ? elZoom : 1;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const drag: ElResizeDrag = {
        pointerId: e.pointerId,
        corner,
        el,
        cdId: elCdId ?? '',
        artboardId: elArtboardId,
        // Stage H3 — which instance (global same-cd-id DOM occurrence) so a
        // reused-component resize routes to its own `<Component/>` usage (local).
        // N/A (0) for an artboard drag.
        idIndex: elCdId ? globalCdOccurrence(document, elCdId, el) : 0,
        startClientX: e.clientX,
        startClientY: e.clientY,
        elZoom: z,
        angle,
        cx,
        cy,
        rotStartPointer: pointerAngleRad(cx, cy, e.clientX, e.clientY),
        start: {
          // World-px border box. rect is the AABB; for a rotated element that
          // over-states w/h, so derive from offset dims when rotated.
          w: (angle ? el.offsetWidth : rect.width / z) || rect.width / z,
          h: (angle ? el.offsetHeight : rect.height / z) || rect.height / z,
          left: startLeft,
          top: startTop,
        },
        flags: {
          canMoveLeft: outOfFlow && Number.isFinite(startLeft),
          canMoveTop: outOfFlow && Number.isFinite(startTop),
        },
        before: {
          width: el.style.width || null,
          height: el.style.height || null,
          left: el.style.left || null,
          top: el.style.top || null,
          transform: el.style.transform || null,
        },
        lastResult: null,
        lastTransform: null,
      };
      dragRef.current = drag;
      try {
        t.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events may reject capture */
      }
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      if (d.corner.startsWith('rot-')) {
        // Rotate RELATIVE to the grabbed corner: turn by the change in the
        // center→pointer angle from where the drag started. Shift snaps to 15°.
        const deg = rotateDeltaDeg(
          d.angle,
          d.rotStartPointer,
          pointerAngleRad(d.cx, d.cy, e.clientX, e.clientY),
          !!e.shiftKey
        );
        const tf = `rotate(${deg}deg)`;
        d.el.style.transform = tf;
        d.lastTransform = tf;
        return;
      }
      applyPreview(d, computeFromEvent(d, e));
    };

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      if (d.corner.startsWith('rot-')) {
        const tf = d.lastTransform;
        if (!tf || tf === d.before.transform) return; // no-op
        lastCommitRef.current = { el: d.el, before: d.before };
        postRotateRequest(d, tf);
        return;
      }
      const r = d.lastResult ?? computeFromEvent(d, e);
      // No-op guard: nothing changed → don't churn a source write / undo entry.
      const changed =
        `${r.width}px` !== d.before.width ||
        `${r.height}px` !== d.before.height ||
        (typeof r.left === 'number' && `${r.left}px` !== d.before.left) ||
        (typeof r.top === 'number' && `${r.top}px` !== d.before.top);
      if (!changed) return;
      lastCommitRef.current = { el: d.el, before: d.before };
      if (d.artboardId) postResizeArtboardRequest(d, r);
      else postResizeRequest(d, r);
    };

    // Restore the pre-drag inline box if the shell reports the write failed.
    // `resize-artboard-failed` (Stage D4) shares the same restore shape — an
    // artboard drag's `before` never carries left/top (canMoveLeft/Top forced
    // false), so the width/height-only branch below is already correct for it.
    const onFail = (e: MessageEvent) => {
      const m = e.data as { dgn?: string } | null;
      if (m?.dgn !== 'resize-failed' && m?.dgn !== 'resize-artboard-failed') return;
      if (e.source !== window.parent) return; // only the parent shell (DDR-054)
      const last = lastCommitRef.current;
      if (!last) return;
      last.el.style.width = last.before.width ?? '';
      last.el.style.height = last.before.height ?? '';
      if (last.before.left !== null || last.el.style.left)
        last.el.style.left = last.before.left ?? '';
      if (last.before.top !== null || last.el.style.top) last.el.style.top = last.before.top ?? '';
      if (last.before.transform !== null || last.el.style.transform)
        last.el.style.transform = last.before.transform ?? '';
      lastCommitRef.current = null;
    };

    c.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('message', onFail);
    return () => {
      c.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('message', onFail);
    };
  }, [one, applyPreview]);

  return <div ref={containerRef} aria-hidden="true" />;
}
