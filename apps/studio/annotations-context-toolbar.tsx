/**
 * @file       annotations-context-toolbar.tsx — Phase 5.1 per-selection toolbar
 * @scope      apps/studio/annotations-context-toolbar.tsx
 * @purpose    FigJam-style floating chrome anchored above the currently
 *             selected annotation strokes. Reads `useAnnotationSelection` +
 *             `useStrokesStore`; mutations dispatch through the store so the
 *             debounced save kicks in automatically.
 *
 * Positioning:
 *   - Compute the union bbox in screen coords by calling
 *     `getBoundingClientRect` on each selected stroke's rendered SVG node
 *     (the SVG sits inside `.dc-world` so the rect already reflects the
 *     world's CSS zoom + translate).
 *   - Anchor 8 px above the bbox. Fall back to BELOW if there's no headroom.
 *
 * Field visibility — intersect across selection per the plan:
 *   - color, delete: always
 *   - fill: only when every stroke is rect or ellipse
 *   - thickness: only when every stroke is pen or arrow
 *   - font-size: only when at least one stroke is text (and the rest are its host)
 */

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAllLocked, lockedStrokeIds } from './annotations/lock.ts';
import {
  ARROW_HEAD_CHOICES,
  ARROW_INK_FRONT,
  ARROW_INK_MORE,
  ARROW_KINDS,
  headPatch,
  isTwoWay,
  kindPatch,
  twoWayPatch,
} from './annotations/ui/arrow-kinds.ts';
import { barTopFor } from './annotations/ui/bar-place.ts';
import { type FormatKey, formatCommands, formatState } from './annotations/ui/editor-channel.ts';
import { LOCKED_LINE } from './annotations/ui/locked.tsx';
import { SECTION_TONES } from './annotations/ui/section-fold.ts';
import { postToShell } from './annotations/ui/shell-asks.ts';
import { flipPatch, isGallerySticker } from './annotations/ui/sticker-drop.ts';
import { STICKY_FRONT, STICKY_MORE } from './annotations/ui/tool-prefs.ts';
import type { AlignEdge } from './annotations-align.ts';
import {
  type ArrowHead,
  type ArrowLineType,
  type ConvertibleShapeKind,
  convertShapeKind,
  DEFAULT_FONT_SIZE,
  FILL_PALETTE,
  type ListType,
  STROKE_PALETTE,
  type Stroke,
  shapeKindOf,
  type TextAlign,
  useStrokesStore,
} from './annotations-layer.tsx';
import { canvasInsets } from './bridge/canvas-mode-store.ts';
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconArrowheadCircle,
  IconArrowheadDiamond,
  IconArrowheadLine,
  IconArrowheadTriangle,
  IconArrowheadTriangleOutline,
  IconArrowNone,
  IconBold,
  IconChevronDown,
  IconComment,
  IconDash,
  IconDistributeH,
  IconDistributeV,
  IconDuplicate,
  IconFlip,
  IconGroup,
  IconItalic,
  IconLineCurved,
  IconLineElbow,
  IconLineStraight,
  IconLineThick,
  IconLineThin,
  IconLink,
  IconListBullet,
  IconListOrdered,
  IconLock,
  IconLockOpen,
  IconObjAlignBottom,
  IconObjAlignHCenter,
  IconObjAlignLeft,
  IconObjAlignRight,
  IconObjAlignTop,
  IconObjAlignVCenter,
  IconStampDisc,
  IconStrike,
  IconUnderline,
  IconUngroup,
  SHAPE_KIND_ICONS,
} from './canvas-icons.tsx';
import { IconMore } from './toolbars/toolbar-icons.tsx';
import { useAnnotationSelectionOptional } from './use-annotation-selection.tsx';
import { isHttpUrl, linkDomain } from './use-canvas-media-drop.tsx';

// Phase 24 — arrowhead + line-type option metadata (icon + label per value),
// driving the per-end head dropdowns + the line-type dropdown.
const HEAD_ICON: Record<ArrowHead, (p: { size?: number }) => ReactNode> = {
  none: IconArrowNone,
  line: IconArrowheadLine,
  triangle: IconArrowheadTriangle,
  'triangle-outline': IconArrowheadTriangleOutline,
  circle: IconArrowheadCircle,
  diamond: IconArrowheadDiamond,
};
const HEAD_OPTIONS: ReadonlyArray<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'line', label: 'Line' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'triangle-outline', label: 'Triangle outline' },
  { value: 'circle', label: 'Circle' },
  { value: 'diamond', label: 'Diamond' },
];
const LINETYPE_ICON: Record<ArrowLineType, (p: { size?: number }) => ReactNode> = {
  straight: IconLineStraight,
  curved: IconLineCurved,
  elbow: IconLineElbow,
};
const LINETYPE_OPTIONS: ReadonlyArray<{ value: ArrowLineType; label: string }> = [
  { value: 'straight', label: 'Straight' },
  { value: 'curved', label: 'Curved' },
  { value: 'elbow', label: 'Elbow' },
];
// Phase 24 — text alignment (text + sticky) + named font-size presets.
const ALIGN_ICON: Record<TextAlign, (p: { size?: number }) => ReactNode> = {
  left: IconAlignLeft,
  center: IconAlignCenter,
  right: IconAlignRight,
};
const ALIGN_OPTIONS: ReadonlyArray<{ value: TextAlign; label: string }> = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align center' },
  { value: 'right', label: 'Align right' },
];
// FigJam v3 — object align + distribute actions for the multi-select cluster.
type AlignAction = AlignEdge | 'dist-h' | 'dist-v';
const ALIGN_ACTION_OPTIONS: ReadonlyArray<{ value: AlignAction; label: string }> = [
  { value: 'left', label: 'Align left' },
  { value: 'h-center', label: 'Align horizontal centers' },
  { value: 'right', label: 'Align right' },
  { value: 'top', label: 'Align top' },
  { value: 'v-center', label: 'Align vertical centers' },
  { value: 'bottom', label: 'Align bottom' },
  { value: 'dist-h', label: 'Distribute horizontal spacing' },
  { value: 'dist-v', label: 'Distribute vertical spacing' },
];
const ALIGN_ACTION_ICON: Record<string, (p: { size?: number }) => ReactNode> = {
  left: IconObjAlignLeft,
  'h-center': IconObjAlignHCenter,
  right: IconObjAlignRight,
  top: IconObjAlignTop,
  'v-center': IconObjAlignVCenter,
  bottom: IconObjAlignBottom,
  'dist-h': IconDistributeH,
  'dist-v': IconDistributeV,
};
const FONT_SIZE_PRESETS: ReadonlyArray<{ px: number; label: string }> = [
  { px: 12, label: 'Small' },
  { px: 16, label: 'Medium' },
  { px: 24, label: 'Large' },
  { px: 36, label: 'Extra large' },
  { px: 64, label: 'Huge' },
];
/** S4.19 - a sticky's five front papers (canvas 15 `an-sticky`); the other five sit behind "+5". */
// Read at render time, never at module top level: annotations-layer and this file import each other.
// P8-C2 (15 R1b): ONE front five for the dock's colour row and this toolbar — yellow · coral · green · sky · lilac
// (tool-prefs STICKY_FRONT) — instead of the first five array slots (yellow · white · grey · salmon · peach).
const stickyPapersFront = (): readonly string[] => STICKY_FRONT.map((s) => s.hex);
const stickyPapersRest = (): readonly string[] => STICKY_MORE.map((s) => s.hex);
/** A sticky's Small..Huge: its Medium is the sticky's own default size, so a fresh sticky reads "Medium". */
const stickySizes = (): ReadonlyArray<{ px: number; label: string }> =>
  FONT_SIZE_PRESETS.map((p) => (p.label === 'Medium' ? { ...p, px: DEFAULT_FONT_SIZE } : p));
/** The size select's value: the preset's px, a custom px kept as itself, or `mixed`. */
export function stickySizeValue(px: number | undefined): string {
  return px == null ? 'mixed' : String(px);
}
const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 200;

// Phase 21 — the swatch palettes come from annotations-layer so the draw-time
// chrome and this per-selection toolbar share ONE hue family. STROKE mode shows
// saturated inks; FILL mode shows the index-paired light tints (FigJam: a
// saturated outline over a pale wash of the same hue). They're referenced
// INSIDE the component (render time) — never at module top-level — because
// annotations-layer ↔ this file form an import cycle and a top-level read would
// hit the TDZ before STROKE_PALETTE initializes.

// Phase 21 — dark "property bar" matching FigJam's selection toolbar. A
// near-black rounded pill that floats above the selection; swatches + icons sit
// on dark so colour reads true. Fixed dark values (not canvas tokens) so the
// bar looks identical on any canvas / DS.
const CTX_SURFACE = 'var(--maude-chrome-bg-2, #26262b)';
const TOOLBAR_CSS = `
.dc-annot-ctx {
  position: fixed;
  z-index: 7;
  display: flex;
  align-items: center;
  gap: 2px;
  /* P8-C2 (15 R4): the board's an-ctx island - the HUD island material (frosted, the 0.5 px edge, the island
     shadow), 40 px tall, radius-lg - not a heavy 0 8 28 dark card */
  background: var(--maude-hud-island-bg, ${CTX_SURFACE});
  -webkit-backdrop-filter: saturate(1.4) blur(18px);
  backdrop-filter: saturate(1.4) blur(18px);
  border: 0;
  border-radius: var(--maude-hud-radius-lg, 14px);
  padding: 4px 6px;
  min-height: 40px;
  box-sizing: border-box;
  box-shadow: var(--maude-hud-island-shadow, 0 2px 10px rgba(0,0,0,0.12)), inset 0 0 0 0.5px var(--maude-hud-island-edge, transparent);
  font-family: var(--maude-chrome-font-body, system-ui, sans-serif);
  font-size: 12px;
  color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 85%, transparent);
  user-select: none;
  pointer-events: auto;
}
/* Swatches sit in a tight touching band so the colour row reads as ONE
   control, not a loose ramp (graphic-critic blocker 1). 22px hit target. */
.dc-annot-ctx-swrow {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}
.dc-annot-ctx-sw {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 16%, transparent);
  cursor: pointer;
  padding: 0;
  margin: 0;
  appearance: none;
  transition: transform 80ms ease;
}
.dc-annot-ctx-sw:hover { transform: scale(1.1); }
.dc-annot-ctx-sw[aria-pressed="true"] {
  box-shadow: 0 0 0 2px ${CTX_SURFACE}, 0 0 0 3px color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 92%, transparent);
  border-color: transparent;
}
.dc-annot-ctx-sw:focus-visible {
  outline: 2px solid var(--maude-chrome-fg-0, #fff);
  outline-offset: 1px;
}
.dc-annot-ctx-fill--none {
  background: #3a3a40;
  position: relative;
}
.dc-annot-ctx-fill--none::after {
  content: "";
  position: absolute; inset: 4px;
  border-radius: 50%;
  background:
    linear-gradient(135deg, transparent 44%, color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 55%, transparent) 44%, color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 55%, transparent) 56%, transparent 56%);
}
.dc-annot-ctx-sep {
  width: 1px;
  height: 16px;
  align-self: center;
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 9%, transparent);
  margin: 0 4px;
}
/* Collapsed Stroke|Fill mode toggle (rect / ellipse selections). */
.dc-annot-ctx-mode {
  display: inline-flex;
  border-radius: 7px;
  overflow: hidden;
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 7%, transparent);
  padding: 2px;
  gap: 2px;
}
.dc-annot-ctx-mode-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 5px;
  padding: 3px 9px;
  font: inherit;
  color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 60%, transparent);
  cursor: pointer;
  font-size: 11px;
  letter-spacing: 0.02em;
  line-height: 1;
}
.dc-annot-ctx-mode-btn[aria-pressed="true"] {
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 16%, transparent);
  color: var(--maude-chrome-fg-0, #fff);
  font-weight: 600;
}
.dc-annot-ctx-mode-btn:not([aria-pressed="true"]):hover {
  color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 90%, transparent);
}
.dc-annot-ctx-mode-btn:focus-visible {
  outline: 2px solid var(--maude-chrome-fg-0, #fff);
  outline-offset: -1px;
}

/* Icon buttons — light glyph on dark, white-tint hover, white-tint active.
   26px to sit closer to the 20px swatch rhythm (graphic-critic blocker 2). */
.dc-annot-ctx-ibtn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 7px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 78%, transparent);
  cursor: pointer;
  padding: 0;
  position: relative;
  transition: background-color 80ms linear, color 80ms linear;
}
.dc-annot-ctx-ibtn:hover {
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 10%, transparent);
  color: var(--maude-chrome-fg-0, #fff);
}
.dc-annot-ctx-ibtn[aria-pressed="true"] {
  /* a pressed segment is the accent outline + accent words (15 an-arrow-kinds), not a grey fill */
  background: var(--maude-hud-accent-muted, color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 18%, transparent));
  color: var(--maude-hud-accent-text, var(--maude-chrome-fg-0, #fff));
  box-shadow: inset 0 0 0 1px var(--maude-hud-accent, transparent);
}
.dc-annot-ctx-ibtn:focus-visible {
  outline: 2px solid var(--maude-chrome-fg-0, #fff);
  outline-offset: -2px;
}
/* the sticky's "..." menu: the words that used to sit in the bar (Resolve, Turn into a comment) */
.dc-annot-ctx-menu--words { flex-direction: column; left: auto; right: 0; transform: none; min-width: 210px; gap: 0; }
.dc-annot-ctx-menu--words .dc-annot-ctx-tbtn { width: 100%; height: 28px; justify-content: flex-start; }
/* S4.12 - a word button (Resolve, Fold, Turn into a comment, Ask AI about it) */
.dc-annot-ctx-tbtn { width: auto; padding: 0 9px; gap: 6px; font-size: 12px; font-weight: 600; font-family: inherit; white-space: nowrap; }
.dc-annot-ctx-ibtn--danger { color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 70%, transparent); }
.dc-annot-ctx-ibtn--danger:hover {
  background: color-mix(in oklab, #ff5a4d 26%, transparent);
  color: var(--maude-chrome-fg-0, #fff);
}
/* Phase 23 — media (image alt / link url) inline text field inside the dark
   property bar. */
.dc-annot-ctx-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px;
}
.dc-annot-ctx-field label { color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 60%, transparent); font-size: 11px; }
.dc-annot-ctx-input {
  width: 220px;
  max-width: 44vw;
  padding: 4px 7px;
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 18%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 6%, transparent);
  color: var(--maude-chrome-fg-0, #fff);
  font: inherit;
  font-size: 12px;
}
.dc-annot-ctx-input::placeholder { color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 40%, transparent); }
.dc-annot-ctx-input:focus-visible { outline: 2px solid var(--maude-chrome-fg-0, #fff); outline-offset: -1px; }
/* Phase 24 — icon dropdown (arrowhead / line-type / text-align). The wrapper
   anchors the menu directly above the trigger. */
.dc-annot-ctx-dd { position: relative; display: inline-flex; }
.dc-annot-ctx-dd-trigger { padding-right: 9px; }
.dc-annot-ctx-dd-caret {
  position: absolute;
  right: 1px;
  bottom: 2px;
  display: inline-flex;
  opacity: 0.5;
  pointer-events: none;
}
.dc-annot-ctx-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 1px;
  padding: 4px;
  background: ${CTX_SURFACE};
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 10%, transparent);
  border-radius: 9px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.24);
  z-index: 9;
}
.dc-annot-ctx-menu button[aria-checked="true"] {
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 18%, transparent);
  color: var(--maude-chrome-fg-0, #fff);
}
/* Font-size dropdown — wider trigger showing the current px + a vertical menu
   of named presets and a numeric input. */
.dc-annot-ctx-fs-trigger {
  width: auto;
  min-width: 30px;
  padding: 0 14px 0 7px;
  font-variant-numeric: tabular-nums;
}
.dc-annot-ctx-fs-val { font-size: 12px; }
/* S4.19 - the sticky's Small to Huge size select (canvas 15 an-sticky). */
.dc-annot-ctx-sel {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.dc-annot-ctx-sel:hover { background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 12%, transparent); }
.dc-annot-ctx-sel option { color: #111; }
.dc-annot-ctx-fs-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px;
  min-width: 132px;
  background: ${CTX_SURFACE};
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 10%, transparent);
  border-radius: 9px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.24);
  z-index: 9;
}
.dc-annot-ctx-fs-item {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 5px 8px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font: inherit;
  font-size: 12px;
  color: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 85%, transparent);
  cursor: pointer;
}
.dc-annot-ctx-fs-item:hover { background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 10%, transparent); }
.dc-annot-ctx-fs-item[aria-checked="true"] { background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 18%, transparent); color: var(--maude-chrome-fg-0, #fff); }
.dc-annot-ctx-fs-px { opacity: 0.5; font-variant-numeric: tabular-nums; }
.dc-annot-ctx-fs-input {
  margin-top: 3px;
  width: 100%;
  box-sizing: border-box;
  background: color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 8%, transparent);
  border: 1px solid color-mix(in oklab, var(--maude-chrome-fg-0, #fff) 14%, transparent);
  border-radius: 6px;
  padding: 4px 8px;
  color: var(--maude-chrome-fg-0, #fff);
  font: inherit;
  font-size: 12px;
}
.dc-annot-ctx-fs-input:focus-visible { outline: 2px solid var(--maude-chrome-fg-0, #fff); outline-offset: -1px; }
@media (prefers-reduced-motion: reduce) {
  .dc-annot-ctx-ibtn, .dc-annot-ctx-sw { transition: none; }
}
`.trim();

function ensureToolbarStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-annot-ctx-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-annot-ctx-css';
  s.textContent = TOOLBAR_CSS;
  document.head.appendChild(s);
}

function unionRect(rects: DOMRect[]): { x: number; y: number; w: number; h: number } | null {
  if (rects.length === 0) return null;
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.width === 0 && r.height === 0) continue;
    if (r.left < xMin) xMin = r.left;
    if (r.top < yMin) yMin = r.top;
    if (r.right > xMax) xMax = r.right;
    if (r.bottom > yMax) yMax = r.bottom;
  }
  if (!Number.isFinite(xMin)) return null;
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

type SwatchMode = 'stroke' | 'fill';

export function AnnotationContextToolbar({
  editingId = null,
}: {
  /**
   * FigJam v3 — while an inline text editor is open, the toolbar flips into
   * TEXT mode: size / B / I / S / U / align controls that drive the EDITOR
   * through editor-channel.ts (mutating the stroke mid-edit would re-render
   * the editor and clobber typed text). The editor echoes its live state back
   * on the same channel.
   */
  editingId?: string | null;
} = {}) {
  ensureToolbarStyles();
  const annotSel = useAnnotationSelectionOptional();
  const store = useStrokesStore();
  const ref = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [, force] = useState({});
  // Edit-mode mirror of the editor's live formatting state.
  const [editorFmt, setEditorFmt] = useState<{
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    fontSize?: number;
    align?: string;
  }>({});
  useEffect(() => {
    if (!editingId) return;
    // Called at once with the editor's current state (it may have mounted first).
    return formatState.listen((s) => setEditorFmt(s ?? {}));
  }, [editingId]);
  // T30 / G_S1 — collapsed Stroke|Fill toggle state. Defaults to 'stroke';
  // auto-reverts to 'stroke' whenever caps.fill is false so the toggle
  // can't get stranded on a hidden mode after the selection changes type.
  const [swatchMode, setSwatchMode] = useState<SwatchMode>('stroke');
  // S4.19 - a sticky's five front papers; "+5" opens the rest in place.
  const [papersMore, setPapersMore] = useState(false);

  const selectedStrokes = useMemo<Stroke[]>(() => {
    if (!annotSel || !store) return [];
    const map = new Map(store.strokes.map((s) => [s.id, s]));
    const out: Stroke[] = [];
    for (const id of annotSel.selectedIds) {
      const s = map.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [annotSel, store]);

  // Capabilities — intersection across selected types.
  const caps = useMemo(() => {
    if (selectedStrokes.length === 0) {
      return {
        color: false,
        fill: false,
        thickness: false,
        fontSize: false,
        arrowDir: false,
        dash: false,
        shapeKind: false,
        stickyBar: false,
      };
    }
    // Wave H — polygons (diamond / triangle) are full shapes: fill + stroke
    // weight, identical toolbar to rect/ellipse. The same "every selected
    // stroke is a closed shape" test gates fill AND the shape-kind switcher.
    const allClosedShapes = selectedStrokes.every(
      (s) => s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
    );
    // T20 — rect + ellipse now carry stroke weight too.
    const allThickness = selectedStrokes.every(
      (s) =>
        s.tool === 'pen' ||
        s.tool === 'arrow' ||
        s.tool === 'rect' ||
        s.tool === 'ellipse' ||
        s.tool === 'polygon'
    );
    // Phase 21 — fontSize applies to text + sticky; arrow direction + dash to
    // arrows. (The Phase-21 rect corner-radius cluster was RETIRED in Wave H —
    // the shape-kind switcher's square/rounded covers it and showing both read
    // as "shapes twice". Pill rects keep rendering; `cornerRadius` stays in
    // the model + serialization, there's just no dedicated toolbar control.)
    const fontSizeApplicable = selectedStrokes.some(
      (s) => s.tool === 'text' || s.tool === 'sticky'
    );
    const allArrow = selectedStrokes.every((s) => s.tool === 'arrow');
    // Dash now applies to arrows AND every outlined shape (rect / ellipse /
    // polygon) — item 7. Heads + line-type (arrowDir) stay arrow-only.
    const allDashable = selectedStrokes.every(
      (s) => s.tool === 'arrow' || s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
    );
    return {
      color: true,
      fill: allClosedShapes,
      thickness: allThickness,
      fontSize: fontSizeApplicable,
      arrowDir: allArrow,
      dash: allDashable,
      // S4.19 (canvas 15 an-sticky, lead decision v2-lead-sticky-toolbar-follows-canvas): a selection of only
      // stickies gets the sticky's own small toolbar - papers, a Small-Huge size, list, Lock - not the text
      // cluster. The sticky's face stays fixed: no B/I/S/U, no alignment.
      stickyBar: selectedStrokes.every((s) => s.tool === 'sticky'),
      // Wave H — the shape-kind switcher (square/rounded/circle/diamond/
      // triangle conversion) shows when EVERY selected stroke is a closed
      // shape. Conversions keep ids, so anchored text + binds follow.
      shapeKind: allClosedShapes,
    };
  }, [selectedStrokes]);

  // Position tracker — uses rAF to follow pan/zoom while the toolbar is up.
  // Edit mode anchors over the EDITED stroke (the selection may be elsewhere).
  useEffect(() => {
    if (selectedStrokes.length === 0 && !editingId) return;
    const targetIds = editingId ? [editingId] : selectedStrokes.map((s) => s.id);
    const tick = () => {
      rafRef.current = null;
      const el = ref.current;
      if (!el) return;
      const rects: DOMRect[] = [];
      for (const id of targetIds) {
        const node = document.querySelector(`[data-id="${cssEscape(id)}"]`);
        if (node) rects.push(node.getBoundingClientRect());
      }
      const u = unionRect(rects);
      if (!u) {
        el.style.display = 'none';
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      el.style.display = 'flex';
      // Lay out off-screen first so the size is real, then position.
      const tbW = el.offsetWidth || 280;
      const tbH = el.offsetHeight || 36;
      // Wave G — clear the selection chrome that floats around the stroke
      // (halo pad + connection dots at ~16 px + the corner rotate zones)
      // instead of sitting glued to the bbox and covering the top dot.
      const margin = 28;
      // p8-fix-a F21 — headroom counts the shell's top island (Preview bar), not only the iframe's edge
      const top = barTopFor(u, tbH, margin, canvasInsets().top);
      let left = u.x + (u.w - tbW) / 2;
      const winW = typeof window !== 'undefined' ? window.innerWidth : tbW + 16;
      if (left < 8) left = 8;
      if (left + tbW > winW - 8) left = winW - tbW - 8;
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [selectedStrokes, editingId]);

  // Force a re-render when the strokes themselves mutate (the position rAF
  // already follows the bbox; this ensures the active-state of the swatches
  // reflects the current color/fill/thickness without a full app re-render).
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedStrokes is the trigger; force is a setState identity.
  useEffect(() => {
    force({});
  }, [selectedStrokes]);

  // FigJam v3 — every bulk style mutation routes through `applyToStrokes` so
  // an N-stroke selection edit is ONE undo record (the pre-v3 per-stroke
  // `updateStroke` loop pushed N records — ⌘Z had to be pressed N times).
  const selectedIds = useMemo(() => selectedStrokes.map((s) => s.id), [selectedStrokes]);
  const setColor = useCallback(
    (c: string) => {
      store?.applyToStrokes(selectedIds, () => ({ color: c }), 'set color');
    },
    [store, selectedIds]
  );
  const setFill = useCallback(
    (f: string | null) => {
      store?.applyToStrokes(
        selectedIds,
        (s) =>
          s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
            ? ({ fill: f } as Partial<Stroke>)
            : null,
        'set fill'
      );
    },
    [store, selectedIds]
  );
  const setThickness = useCallback(
    (w: number) => {
      // T20 — rect + ellipse carry stroke weight too; Wave H adds polygon.
      store?.applyToStrokes(
        selectedIds,
        (s) =>
          s.tool === 'pen' ||
          s.tool === 'arrow' ||
          s.tool === 'rect' ||
          s.tool === 'ellipse' ||
          s.tool === 'polygon'
            ? ({ width: w } as Partial<Stroke>)
            : null,
        'set thickness'
      );
    },
    [store, selectedIds]
  );
  const setFontSize = useCallback(
    (sz: number) => {
      // Phase 21 — sticky carries fontSize too.
      store?.applyToStrokes(
        selectedIds,
        (s) =>
          s.tool === 'text' || s.tool === 'sticky' ? ({ fontSize: sz } as Partial<Stroke>) : null,
        'set font size'
      );
    },
    [store, selectedIds]
  );
  // Phase 24 — bold / strike / italic / underline / list / align on text +
  // sticky bodies, all single-record.
  const applyTextPatch = useCallback(
    (patch: Partial<Stroke>, label: string) => {
      store?.applyToStrokes(
        selectedIds,
        (s) => (s.tool === 'text' || s.tool === 'sticky' ? patch : null),
        label
      );
    },
    [store, selectedIds]
  );
  const setBold = useCallback(
    (bold: boolean) => applyTextPatch({ bold } as Partial<Stroke>, 'set bold'),
    [applyTextPatch]
  );
  const setStrike = useCallback(
    (strike: boolean) => applyTextPatch({ strike } as Partial<Stroke>, 'set strikethrough'),
    [applyTextPatch]
  );
  const setItalic = useCallback(
    (italic: boolean) => applyTextPatch({ italic } as Partial<Stroke>, 'set italic'),
    [applyTextPatch]
  );
  const setUnderline = useCallback(
    (underline: boolean) => applyTextPatch({ underline } as Partial<Stroke>, 'set underline'),
    [applyTextPatch]
  );
  const setListType = useCallback(
    (listType: ListType | undefined) =>
      applyTextPatch({ listType } as Partial<Stroke>, 'set list style'),
    [applyTextPatch]
  );
  const setAlign = useCallback(
    (align: TextAlign) => applyTextPatch({ align } as Partial<Stroke>, 'set alignment'),
    [applyTextPatch]
  );
  // Wave H — convert the selection to another shape kind (one undo record).
  const setSelectionShapeKind = useCallback(
    (kind: ConvertibleShapeKind) => {
      store?.applyToStrokes(selectedIds, (s) => convertShapeKind(s, kind), 'change shape');
    },
    [store, selectedIds]
  );
  // Phase 24 — per-end arrowhead + line-type.
  const setStartHead = useCallback(
    (startHead: ArrowHead) => {
      store?.applyToStrokes(
        selectedIds,
        (s) => (s.tool === 'arrow' ? ({ startHead } as Partial<Stroke>) : null),
        'set arrowhead'
      );
    },
    [store, selectedIds]
  );
  const setEndHead = useCallback(
    (endHead: ArrowHead) => {
      store?.applyToStrokes(
        selectedIds,
        (s) => (s.tool === 'arrow' ? ({ endHead } as Partial<Stroke>) : null),
        'set arrowhead'
      );
    },
    [store, selectedIds]
  );
  // S4.11 (an-arrow-kinds): the end head (a two-way arrow keeps both alike) and the two-way toggle.
  const setHeadPicked = useCallback(
    (head: ArrowHead) => {
      store?.applyToStrokes(
        selectedIds,
        (s) => (s.tool === 'arrow' ? headPatch(s, head) : null),
        'set arrowhead'
      );
    },
    [store, selectedIds]
  );
  const toggleTwoWay = useCallback(() => {
    store?.applyToStrokes(
      selectedIds,
      (s) => (s.tool === 'arrow' ? twoWayPatch(s) : null),
      'toggle two-way arrow'
    );
  }, [store, selectedIds]);
  const setLineType = useCallback(
    (lineType: ArrowLineType) => {
      store?.applyToStrokes(
        selectedIds,
        (s) => (s.tool === 'arrow' ? kindPatch(lineType) : null),
        'set line type'
      );
    },
    [store, selectedIds]
  );
  // Dash toggle — arrow + rect / ellipse / polygon (item 7).
  const setDashed = useCallback(
    (dashed: boolean) => {
      store?.applyToStrokes(
        selectedIds,
        (s) =>
          s.tool === 'arrow' || s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
            ? ({ dashed } as Partial<Stroke>)
            : null,
        'set dash'
      );
    },
    [store, selectedIds]
  );
  // FigJam v3 — group / ungroup / align / distribute on the selection.
  const groupSel = useCallback(() => {
    if (!annotSel || !store) return;
    const members = store.groupSelection(annotSel.selectedIds);
    if (members) annotSel.replace(members);
  }, [annotSel, store]);
  const ungroupSel = useCallback(() => {
    if (!annotSel || !store) return;
    store.ungroupSelection(annotSel.selectedIds);
  }, [annotSel, store]);
  const alignSel = useCallback(
    (op: AlignAction) => {
      if (!annotSel || !store) return;
      if (op === 'dist-h' || op === 'dist-v') {
        store.distributeSelection(annotSel.selectedIds, op === 'dist-h' ? 'h' : 'v');
      } else {
        store.alignSelection(annotSel.selectedIds, op);
      }
    },
    [annotSel, store]
  );
  const remove = useCallback(() => {
    if (!annotSel || !store) return;
    store.deleteStrokes(annotSel.selectedIds);
    annotSel.clear();
  }, [annotSel, store]);

  // FigJam v3 — TEXT mode while an inline editor is open: a focused strip of
  // text controls dispatching to the editor (Image-6 FigJam parity).
  if (editingId) {
    const dispatchFmt = (key: FormatKey, value?: unknown) => {
      formatCommands.send({ key, value });
    };
    const fmtBtn = (
      key: 'bold' | 'italic' | 'strike' | 'underline',
      label: string,
      icon: ReactNode
    ) => (
      <button
        type="button"
        className="dc-annot-ctx-ibtn"
        aria-label={label}
        aria-pressed={!!editorFmt[key]}
        title={label}
        // The editor commits on blur/outside-pointerdown — suppress the
        // mousedown so clicking the toolbar doesn't end the edit session.
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => dispatchFmt(key)}
      >
        {icon}
      </button>
    );
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Text formatting"
        style={{ display: 'flex', top: -9999, left: -9999 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <FontSizeDropdown value={editorFmt.fontSize} onPick={(n) => dispatchFmt('fontSize', n)} />
        {fmtBtn('bold', 'Bold', <IconBold />)}
        {fmtBtn('italic', 'Italic', <IconItalic />)}
        {fmtBtn('strike', 'Strikethrough', <IconStrike />)}
        {fmtBtn('underline', 'Underline', <IconUnderline />)}
        <IconDropdown
          ariaLabel="Text alignment"
          value={editorFmt.align ?? 'left'}
          options={ALIGN_OPTIONS}
          renderIcon={(v) => {
            const I = ALIGN_ICON[v as TextAlign];
            return I ? <I size={16} /> : null;
          }}
          onPick={(v) => dispatchFmt('align', v)}
        />
      </div>
    );
  }

  if (!annotSel || !store || selectedStrokes.length === 0) return null;

  // #137 — lock. A selection holding a locked element collapses to the one
  // control that matters (nothing else on it may change); a fully locked
  // selection offers Unlock, a mixed one Lock (locks the rest too).
  const lockedIds = lockedStrokeIds(store.strokes);
  const anyLocked = selectedStrokes.some((s) => lockedIds.has(s.id));
  const allLocked = isAllLocked(annotSel.selectedIds, store.strokes);
  const lockBtn = (
    <button
      type="button"
      className="dc-annot-ctx-ibtn"
      data-testid={allLocked ? 'annot-ctx-unlock' : 'annot-ctx-lock'}
      aria-label={allLocked ? 'Unlock selection' : 'Lock selection'}
      aria-pressed={allLocked}
      title={allLocked ? 'Unlock (⌘⇧L)' : 'Lock (⌘⇧L)'}
      onClick={() => store.setLocked(annotSel.selectedIds, !allLocked)}
    >
      {allLocked ? <IconLockOpen /> : <IconLock />}
    </button>
  );
  if (anyLocked) {
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Locked selection"
        style={{ display: 'flex', top: -9999, left: -9999 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {allLocked ? (
          // S4.19 G5 (canvas 15 an-layers): "Locked · Unlock ⇧⌘L", the words the shell list speaks too.
          <span
            data-testid="annotation-locked-toolbar"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            <span
              className="dc-annot-ctx-label"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 6px 0 8px',
                fontSize: 12,
                opacity: 0.85,
              }}
            >
              <IconLock size={12} />
              {LOCKED_LINE.label}
            </span>
            <div className="dc-annot-ctx-sep" />
            <button
              type="button"
              className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
              data-testid="annot-ctx-unlock"
              aria-label="Unlock selection"
              title="Unlock (⌘⇧L)"
              onClick={() => store.setLocked(annotSel.selectedIds, false)}
            >
              {LOCKED_LINE.action}
              <span style={{ marginLeft: 6, opacity: 0.6 }}>{LOCKED_LINE.kbd}</span>
            </button>
          </span>
        ) : (
          lockBtn
        )}
      </div>
    );
  }

  // ── Phase 23 — dedicated panel for a single image / link selection. ─────────
  // Image / link carry no color / fill / thickness, so the generic swatch bar is
  // meaningless for them; render a focused panel instead (image alt for a11y;
  // link url/title + Open). Uncontrolled fields keyed by id commit ONCE on
  // blur/Enter (no per-keystroke undo spam). Multi-select / mixed selections
  // fall through to the generic bar below.
  const soleMedia =
    selectedStrokes.length === 1 &&
    (selectedStrokes[0]?.tool === 'image' ||
      selectedStrokes[0]?.tool === 'link' ||
      selectedStrokes[0]?.tool === 'mediaref')
      ? selectedStrokes[0]
      : null;
  if (soleMedia?.tool === 'mediaref') {
    // DDR-150 dogfood — a media-reference chip has no color to set (the generic
    // swatch palette was meaningless noise). Focused panel: filename + delete.
    const mr = soleMedia;
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Media reference properties"
        style={{ display: 'flex', top: -9999, left: -9999 }}
      >
        <span
          className="dc-annot-ctx-label"
          style={{
            padding: '0 8px',
            fontSize: 12,
            opacity: 0.85,
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={`${mr.mediaKind} · ${mr.src}`}
        >
          {mr.mediaKind === 'audio' ? '♪ ' : '▶ '}
          {mr.title}
        </span>
        <div className="dc-annot-ctx-sep" />
        <ToolbarMore onDelete={remove} />
      </div>
    );
  }
  if (soleMedia?.tool === 'image' && isGallerySticker(soleMedia)) {
    // S4.13 (canvas 15 `an-stk-drop`) - a sticker from the gallery: Replace… swaps the picture in place
    // (same spot, same size), Flip mirrors it, then Lock and Duplicate. It is never part of the design.
    const stk = soleMedia;
    const flipped = stk.sticker.flip === true;
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Sticker properties"
        style={{ display: 'flex', top: -9999, left: -9999 }}
      >
        <button
          type="button"
          className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
          data-testid="annot-ctx-replace"
          title="Swap this sticker for another, in the same place and size"
          onClick={() =>
            postToShell({
              dgn: 'tool-panel-open',
              panel: 'stickers',
              anchor: null,
              replace: stk.id,
            })
          }
        >
          <IconStampDisc size={14} />
          Replace…
        </button>
        <button
          type="button"
          className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
          data-testid="annot-ctx-flip"
          aria-pressed={flipped}
          title="Mirror this sticker"
          onClick={() => {
            const patch = flipPatch(stk);
            if (patch) store.updateStroke(stk.id, patch);
          }}
        >
          <IconFlip size={14} />
          Flip
        </button>
        <div className="dc-annot-ctx-sep" />
        {lockBtn}
        <button
          type="button"
          className="dc-annot-ctx-ibtn"
          data-testid="annot-ctx-duplicate"
          aria-label="Duplicate"
          title="Duplicate (⌘D)"
          onClick={() => store.runAction?.('annotation.duplicate')}
        >
          <IconDuplicate size={14} />
        </button>
        <ToolbarMore onDelete={remove} />
      </div>
    );
  }
  if (soleMedia?.tool === 'image') {
    const img = soleMedia;
    const commitAlt = (value: string) => {
      const next = value.trim();
      if ((img.alt ?? '') !== next) {
        store.updateStroke(img.id, { alt: next || undefined } as Partial<Stroke>);
      }
    };
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Image properties"
        style={{ display: 'flex', top: -9999, left: -9999 }}
      >
        <div className="dc-annot-ctx-field">
          <label htmlFor="dc-img-alt">Alt</label>
          <input
            id="dc-img-alt"
            key={img.id}
            className="dc-annot-ctx-input"
            type="text"
            defaultValue={img.alt ?? ''}
            placeholder="Describe this image (alt text)"
            aria-label="Image alt text"
            onBlur={(e) => commitAlt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <div className="dc-annot-ctx-sep" />
        <ToolbarMore onDelete={remove} />
      </div>
    );
  }
  if (soleMedia?.tool === 'link') {
    const link = soleMedia;
    const commitUrl = (value: string) => {
      const next = value.trim();
      if (isHttpUrl(next) && next !== link.url) {
        store.updateStroke(link.id, { url: next, domain: linkDomain(next) } as Partial<Stroke>);
      }
    };
    const commitTitle = (value: string) => {
      const next = value.trim();
      if (next !== link.title) store.updateStroke(link.id, { title: next } as Partial<Stroke>);
    };
    const openLink = () => {
      if (isHttpUrl(link.url)) window.open(link.url, '_blank', 'noopener,noreferrer');
    };
    return (
      <div
        ref={ref}
        className="dc-annot-ctx"
        role="toolbar"
        aria-label="Link properties"
        style={{ display: 'flex', top: -9999, left: -9999 }}
      >
        <button
          type="button"
          className="dc-annot-ctx-ibtn"
          aria-label={`Open ${link.domain || 'link'} in a new tab`}
          title="Open link"
          onClick={openLink}
        >
          <IconLink />
        </button>
        <div className="dc-annot-ctx-sep" />
        <div className="dc-annot-ctx-field">
          <input
            key={`${link.id}-url`}
            className="dc-annot-ctx-input"
            type="url"
            inputMode="url"
            defaultValue={link.url}
            placeholder="https://…"
            aria-label="Link URL"
            onBlur={(e) => commitUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
          <input
            key={`${link.id}-title`}
            className="dc-annot-ctx-input"
            type="text"
            defaultValue={link.title}
            placeholder="Title"
            aria-label="Link title"
            onBlur={(e) => commitTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <div className="dc-annot-ctx-sep" />
        <ToolbarMore onDelete={remove} />
      </div>
    );
  }

  // FigJam v3 — group / align availability. Selection expansion guarantees a
  // group is always selected whole, so "any member grouped" ⇒ ungroupable.
  const canGroup = selectedStrokes.length >= 2;
  const canUngroup = selectedStrokes.some((s) => (s.groupIds?.length ?? 0) > 0);
  const canAlign = selectedStrokes.length >= 2;

  // Active values for swatch highlighting — when uniform across selection.
  // Image / link / mediaref strokes carry no `color` — `uniformValue` already
  // filters undefined out, the `in` check just says so to the checker.
  const uniqColor = uniformValue(selectedStrokes.map((s) => ('color' in s ? s.color : undefined)));
  const uniqFill = caps.fill
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
            ? (s.fill ?? null)
            : undefined
        )
      )
    : undefined;
  const uniqThickness = caps.thickness
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'pen' ||
          s.tool === 'arrow' ||
          s.tool === 'rect' ||
          s.tool === 'ellipse' ||
          s.tool === 'polygon'
            ? s.width
            : undefined
        )
      )
    : undefined;
  const uniqFontSize = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? s.fontSize : undefined
        )
      )
    : undefined;
  // Phase 24 — uniform bold / strike / align across the text-bearing selection.
  // Align default differs per kind: anchored text = centre, standalone + sticky
  // = left (matches the serializer defaults so the active-state reads true).
  const uniqBold = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? !!s.bold : undefined
        )
      )
    : undefined;
  const uniqStrike = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? !!s.strike : undefined
        )
      )
    : undefined;
  const uniqItalic = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? !!s.italic : undefined
        )
      )
    : undefined;
  const uniqUnderline = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? !!s.underline : undefined
        )
      )
    : undefined;
  // List type — undefined when no list (the active-state for the two list
  // toggles reads off this; both off ⇒ no list).
  const uniqListType = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'text' || s.tool === 'sticky' ? (s.listType ?? 'none') : undefined
        )
      )
    : undefined;
  const uniqAlign = caps.fontSize
    ? uniformValue(
        selectedStrokes.map((s) => {
          if (s.tool === 'sticky') return s.align ?? 'left';
          if (s.tool === 'text') return s.align ?? (s.anchorId ? 'center' : 'left');
          return undefined;
        })
      )
    : undefined;
  // Wave H — uniform shape kind across the selection (undefined = mixed).
  const uniqShapeKind = caps.shapeKind
    ? uniformValue(selectedStrokes.map((s) => shapeKindOf(s) ?? undefined))
    : undefined;
  // Phase 21 — uniform arrow head pair (default start none / end triangle).
  const uniqStartHead = caps.arrowDir
    ? uniformValue(
        selectedStrokes.map((s) => (s.tool === 'arrow' ? (s.startHead ?? 'none') : undefined))
      )
    : undefined;
  const uniqEndHead = caps.arrowDir
    ? uniformValue(
        selectedStrokes.map((s) => (s.tool === 'arrow' ? (s.endHead ?? 'triangle') : undefined))
      )
    : undefined;
  const uniqLineType = caps.arrowDir
    ? uniformValue(
        selectedStrokes.map((s) => (s.tool === 'arrow' ? (s.lineType ?? 'straight') : undefined))
      )
    : undefined;
  const uniqTwoWay = caps.arrowDir
    ? uniformValue(selectedStrokes.map((s) => (s.tool === 'arrow' ? isTwoWay(s) : undefined)))
    : undefined;
  const uniqDashed = caps.dash
    ? uniformValue(
        selectedStrokes.map((s) =>
          s.tool === 'arrow' || s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon'
            ? (s.dashed ?? false)
            : undefined
        )
      )
    : undefined;

  // T30 / G_S1 — when caps.fill is false we never enter fill mode. The
  // useEffect below could call setSwatchMode('stroke') but reading the
  // effective mode inline avoids an extra render cycle.
  const effectiveMode: SwatchMode = caps.fill ? swatchMode : 'stroke';
  // Phase 24 — a sticky selection picks its PAPER TINT, not stroke ink. The
  // pre-Phase-24 toolbar showed STROKE_PALETTE for stickies (a latent bug):
  // sticky has no stroke, so its swatch must paint the muted STICKY_PALETTE and
  // write to `color` (the paper tint). No Stroke|Fill toggle for sticky
  // (caps.fill is already false).
  const allSticky = selectedStrokes.every((s) => s.tool === 'sticky');
  // S4.12 - a section picks one of its six tones (canvas 15 an-section), not ink.
  const allSection = selectedStrokes.every((s) => s.tool === 'section');
  const soleSticky =
    selectedStrokes.length === 1 && selectedStrokes[0]?.tool === 'sticky'
      ? selectedStrokes[0]
      : null;
  const soleSection =
    selectedStrokes.length === 1 && selectedStrokes[0]?.tool === 'section'
      ? selectedStrokes[0]
      : null;
  const activeRest = allSticky && uniqColor != null && stickyPapersRest().includes(uniqColor);
  const papersOpen = papersMore || activeRest;
  const showPalette = allSticky
    ? papersOpen
      ? [...stickyPapersFront(), ...stickyPapersRest()]
      : stickyPapersFront()
    : allSection
      ? SECTION_TONES.map((t) => t.value)
      : effectiveMode === 'stroke'
        ? STROKE_PALETTE
        : FILL_PALETTE;
  const onSwatchClick =
    !allSticky && effectiveMode === 'fill' ? (c: string) => setFill(c) : (c: string) => setColor(c);
  const activeValue = allSticky || effectiveMode === 'stroke' ? uniqColor : (uniqFill ?? null);
  const swatchKind = allSticky
    ? 'Sticky color'
    : allSection
      ? 'Section color'
      : effectiveMode === 'stroke'
        ? 'Color'
        : 'Fill';

  // The "…" at the end of every selection bar (15: the board ends each one in a more button). Delete lives here, and
  // whatever the board does not draw on the bar: Resolve for a sticky; an arrow's widths, two-way and dashes.
  const moreItems: MoreItem[] = [];
  if (soleSticky) {
    moreItems.push({
      key: 'resolve',
      label: soleSticky.resolved ? 'Reopen' : 'Resolve',
      testid: 'annot-ctx-resolve',
      title: soleSticky.resolved ? 'Reopen this sticky' : 'Resolve — strike it through',
      resolved: !!soleSticky.resolved,
      onPick: () => store.runAction?.('annotation.resolve'),
    });
  }
  if (caps.arrowDir) {
    moreItems.push(
      {
        key: 'two-way',
        label: 'Two-way',
        testid: 'annot-arrow-two-way',
        title: 'Two-way — a head on both ends',
        checked: uniqTwoWay === true,
        onPick: toggleTwoWay,
      },
      {
        key: 'dashed',
        label: 'Dashed line',
        testid: 'annot-ctx-dashed',
        checked: uniqDashed === true,
        onPick: () => setDashed(!(uniqDashed === true)),
      },
      {
        key: 'thin',
        label: 'Thin line',
        testid: 'annot-ctx-thin',
        title: 'Thin (3px)',
        checked: uniqThickness === 3,
        onPick: () => setThickness(3),
      },
      {
        key: 'thick',
        label: 'Thick line',
        testid: 'annot-ctx-thick',
        title: 'Thick (6px)',
        checked: uniqThickness === 6,
        onPick: () => setThickness(6),
      }
    );
  }

  return (
    <div
      ref={ref}
      className="dc-annot-ctx"
      role="toolbar"
      aria-label="Annotation properties"
      style={{ display: 'flex', top: -9999, left: -9999 }}
    >
      {selectedStrokes.length > 1 ? (
        <>
          <span
            className="dc-annot-ctx-label"
            data-testid="annot-ctx-count"
            style={{ padding: '0 8px', fontSize: 12, whiteSpace: 'nowrap' }}
          >
            <b>{selectedStrokes.length} annotations</b>
          </span>
          <div className="dc-annot-ctx-sep" />
        </>
      ) : null}
      {caps.fill ? (
        <>
          <div className="dc-annot-ctx-mode" role="radiogroup" aria-label="Swatch target">
            <button
              type="button"
              className="dc-annot-ctx-mode-btn"
              aria-pressed={effectiveMode === 'stroke'}
              onClick={() => setSwatchMode('stroke')}
            >
              Stroke
            </button>
            <button
              type="button"
              className="dc-annot-ctx-mode-btn"
              aria-pressed={effectiveMode === 'fill'}
              onClick={() => setSwatchMode('fill')}
            >
              Fill
            </button>
          </div>
          <div className="dc-annot-ctx-sep" />
        </>
      ) : null}
      {caps.arrowDir ? (
        // 15 an-arrow-kinds: kind + head come first, the inks after, then Lock (the bar's own order)
        <>
          <div className="dc-annot-ctx-mode" role="radiogroup" aria-label="Arrow line">
            {ARROW_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                className="dc-annot-ctx-mode-btn"
                data-testid={`annot-arrow-kind-${k.value}`}
                aria-pressed={uniqLineType === k.value}
                onClick={() => setLineType(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="dc-annot-ctx-sep" />
          <IconDropdown
            ariaLabel="Arrowhead"
            value={uniqEndHead ?? 'triangle'}
            options={ARROW_HEAD_CHOICES}
            renderIcon={(v) => {
              const I = HEAD_ICON[v as ArrowHead];
              return I ? <I size={16} /> : null;
            }}
            onPick={(v) => setHeadPicked(v as ArrowHead)}
          />
          <div className="dc-annot-ctx-sep" />
          <ArrowInks value={uniqColor} onPick={setColor} />
        </>
      ) : (
        <div className="dc-annot-ctx-swrow" role="radiogroup" aria-label="Color">
          {effectiveMode === 'fill' ? (
            <button
              type="button"
              className="dc-annot-ctx-sw dc-annot-ctx-fill--none"
              aria-label="No fill"
              aria-pressed={uniqFill == null}
              title="No fill"
              onClick={() => setFill(null)}
            />
          ) : null}
          {showPalette.map((c) => (
            <button
              key={c}
              type="button"
              className="dc-annot-ctx-sw"
              aria-label={`${swatchKind} ${c}`}
              aria-pressed={activeValue === c}
              title={`${swatchKind} ${c}`}
              style={{ background: c }}
              onClick={() => onSwatchClick(c)}
            />
          ))}
          {allSticky && !papersOpen ? (
            <button
              type="button"
              className="dc-annot-ctx-ibtn"
              data-testid="annot-sticky-paper-more"
              aria-label={`${stickyPapersRest().length} more papers`}
              title="All papers"
              onClick={() => setPapersMore(true)}
            >
              +{stickyPapersRest().length}
            </button>
          ) : null}
        </div>
      )}
      {caps.thickness && effectiveMode === 'stroke' && !caps.arrowDir ? (
        <>
          <div className="dc-annot-ctx-sep" />
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Thin stroke"
            aria-pressed={uniqThickness === 3}
            title="Thin (3px)"
            onClick={() => setThickness(3)}
          >
            <IconLineThin />
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Thick stroke"
            aria-pressed={uniqThickness === 6}
            title="Thick (6px)"
            onClick={() => setThickness(6)}
          >
            <IconLineThick />
          </button>
        </>
      ) : null}
      {caps.stickyBar ? (
        <>
          <div className="dc-annot-ctx-sep" />
          <select
            className="dc-annot-ctx-sel"
            data-testid="annot-sticky-size"
            aria-label="Text size"
            title="Text size"
            value={stickySizeValue(uniqFontSize)}
            onChange={(e) => {
              const px = Number(e.target.value);
              if (Number.isFinite(px) && px > 0) setFontSize(px);
            }}
          >
            {uniqFontSize != null && !stickySizes().some((p) => p.px === uniqFontSize) ? (
              <option value={String(uniqFontSize)}>{uniqFontSize} px</option>
            ) : null}
            {uniqFontSize == null ? <option value="mixed">Mixed</option> : null}
            {stickySizes().map((p) => (
              <option key={p.px} value={String(p.px)}>
                {p.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            data-testid="annot-sticky-list"
            aria-label="List"
            aria-pressed={uniqListType === 'bullet' || uniqListType === 'number'}
            title="List - bullets, then numbers, then off"
            onClick={() =>
              setListType(
                uniqListType === 'bullet'
                  ? 'number'
                  : uniqListType === 'number'
                    ? undefined
                    : 'bullet'
              )
            }
          >
            {uniqListType === 'number' ? <IconListOrdered /> : <IconListBullet />}
          </button>
        </>
      ) : null}
      {caps.fontSize && !caps.stickyBar ? (
        <>
          <div className="dc-annot-ctx-sep" />
          <FontSizeDropdown value={uniqFontSize} onPick={setFontSize} />
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Bold"
            aria-pressed={uniqBold === true}
            title="Bold"
            onClick={() => setBold(!(uniqBold === true))}
          >
            <IconBold />
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Italic"
            aria-pressed={uniqItalic === true}
            title="Italic"
            onClick={() => setItalic(!(uniqItalic === true))}
          >
            <IconItalic />
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Strikethrough"
            aria-pressed={uniqStrike === true}
            title="Strikethrough"
            onClick={() => setStrike(!(uniqStrike === true))}
          >
            <IconStrike />
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Underline"
            aria-pressed={uniqUnderline === true}
            title="Underline"
            onClick={() => setUnderline(!(uniqUnderline === true))}
          >
            <IconUnderline />
          </button>
          <IconDropdown
            ariaLabel="Text alignment"
            value={uniqAlign ?? 'left'}
            options={ALIGN_OPTIONS}
            renderIcon={(v) => {
              const I = ALIGN_ICON[v as TextAlign];
              return I ? <I size={16} /> : null;
            }}
            onPick={(v) => setAlign(v as TextAlign)}
          />
          {/* List style — two mutually-exclusive toggles; click-again clears. */}
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Bulleted list"
            aria-pressed={uniqListType === 'bullet'}
            title="Bulleted list"
            onClick={() => setListType(uniqListType === 'bullet' ? undefined : 'bullet')}
          >
            <IconListBullet />
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Numbered list"
            aria-pressed={uniqListType === 'number'}
            title="Numbered list"
            onClick={() => setListType(uniqListType === 'number' ? undefined : 'number')}
          >
            <IconListOrdered />
          </button>
        </>
      ) : null}
      {caps.shapeKind ? (
        <>
          <div className="dc-annot-ctx-sep" />
          {(
            [
              ['square', 'Square'],
              ['rounded', 'Rounded square'],
              ['circle', 'Circle'],
              ['diamond', 'Diamond'],
              ['triangle', 'Triangle'],
              ['triangle-down', 'Triangle down'],
            ] as Array<[ConvertibleShapeKind, string]>
          ).map(([kind, label]) => {
            const KindIcon = SHAPE_KIND_ICONS[kind];
            return (
              <button
                key={kind}
                type="button"
                className="dc-annot-ctx-ibtn"
                aria-label={label}
                aria-pressed={uniqShapeKind === kind}
                title={label}
                onClick={() => setSelectionShapeKind(kind)}
              >
                {KindIcon ? <KindIcon size={16} /> : null}
              </button>
            );
          })}
        </>
      ) : null}
      {caps.dash && !caps.arrowDir ? (
        <>
          <div className="dc-annot-ctx-sep" />
          <button
            type="button"
            className="dc-annot-ctx-ibtn"
            aria-label="Dashed line"
            aria-pressed={uniqDashed === true}
            title="Dashed line"
            onClick={() => setDashed(!(uniqDashed === true))}
          >
            <IconDash />
          </button>
        </>
      ) : null}
      {soleSection ? (
        <>
          <div className="dc-annot-ctx-sep" />
          <button
            type="button"
            className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
            data-testid="annot-ctx-fold"
            aria-pressed={!!soleSection.folded}
            title={soleSection.folded ? 'Unfold this section' : 'Fold this section to one line'}
            onClick={() => store.runAction?.('annotation.fold')}
          >
            {soleSection.folded ? 'Unfold' : 'Fold'}
          </button>
          <button
            type="button"
            className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
            data-testid="annot-ctx-ask-ai"
            title="Ask AI about this section (⌘/)"
            onClick={() => store.runAction?.('annotation.ask-ai')}
          >
            ✦ Ask AI about it
          </button>
        </>
      ) : null}
      <div className="dc-annot-ctx-sep" />
      {lockBtn}
      {soleSticky ? (
        <button
          type="button"
          className="dc-annot-ctx-ibtn"
          data-testid="annot-ctx-to-comment"
          aria-label="Turn into a comment"
          title="Turn into a comment — its words become a thread, the sticky goes to the trash"
          onClick={() => store.runAction?.('annotation.to-comment')}
        >
          <IconComment size={14} />
        </button>
      ) : null}
      {canGroup || canUngroup || canAlign ? (
        <>
          <div className="dc-annot-ctx-sep" />
          {canGroup ? (
            <button
              type="button"
              className="dc-annot-ctx-ibtn"
              aria-label="Group selection"
              title="Group (⌘G)"
              onClick={groupSel}
            >
              <IconGroup />
            </button>
          ) : null}
          {canUngroup ? (
            <button
              type="button"
              className="dc-annot-ctx-ibtn"
              aria-label="Ungroup selection"
              title="Ungroup (⌘⇧G)"
              onClick={ungroupSel}
            >
              <IconUngroup />
            </button>
          ) : null}
          {canAlign ? (
            <ActionDropdown
              ariaLabel="Align and distribute"
              triggerIcon={<IconObjAlignLeft size={16} />}
              options={ALIGN_ACTION_OPTIONS}
              renderIcon={(v) => {
                const I = ALIGN_ACTION_ICON[v];
                return I ? <I size={16} /> : null;
              }}
              isDisabled={(v) => (v === 'dist-h' || v === 'dist-v') && selectedStrokes.length < 3}
              onPick={(v) => alignSel(v as AlignAction)}
            />
          ) : null}
        </>
      ) : null}
      <ToolbarMore items={moreItems} onDelete={remove} />
    </div>
  );
}
AnnotationContextToolbar.displayName = 'AnnotationContextToolbar';

/**
 * Phase 24 — a compact icon dropdown for the context toolbar (arrowhead per
 * end, line-type). Trigger shows the current value's icon + a caret; the menu
 * is a single row of icon-only radio items. Closes on outside-pointerdown or
 * Escape. Reuses the existing `.dc-annot-ctx-ibtn` button styling.
 */
/** S4.11 — an arrow's inks: four up front (black first), "+5" opens the rest in place. */
function ArrowInks({
  value,
  onPick,
}: {
  value: string | undefined;
  onPick: (hex: string) => void;
}) {
  const [more, setMore] = useState(false);
  const all = more ? [...ARROW_INK_FRONT, ...ARROW_INK_MORE] : ARROW_INK_FRONT;
  return (
    <div className="dc-annot-ctx-swrow" role="radiogroup" aria-label="Color">
      {all.map((c) => (
        <button
          key={c.hex}
          type="button"
          className="dc-annot-ctx-sw"
          data-testid={`annot-arrow-ink-${c.name.toLowerCase()}`}
          aria-label={`Color ${c.name}`}
          aria-pressed={value === c.hex}
          title={c.name}
          style={{ background: c.hex }}
          onClick={() => onPick(c.hex)}
        />
      ))}
      {more ? null : (
        <button
          type="button"
          className="dc-annot-ctx-ibtn"
          data-testid="annot-arrow-ink-more"
          aria-label={`${ARROW_INK_MORE.length} more colors`}
          title="More colors"
          onClick={() => setMore(true)}
        >
          +{ARROW_INK_MORE.length}
        </button>
      )}
    </div>
  );
}

function IconDropdown({
  ariaLabel,
  value,
  options,
  renderIcon,
  onPick,
}: {
  ariaLabel: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  renderIcon: (v: string) => ReactNode;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="dc-annot-ctx-dd">
      <button
        type="button"
        className="dc-annot-ctx-ibtn dc-annot-ctx-dd-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${current?.label ?? value}`}
        title={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {renderIcon(value)}
        <span className="dc-annot-ctx-dd-caret" aria-hidden="true">
          <IconChevronDown size={8} />
        </span>
      </button>
      {open ? (
        <div className="dc-annot-ctx-menu" role="menu" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={o.value === value}
              aria-label={o.label}
              title={o.label}
              className="dc-annot-ctx-ibtn"
              onClick={() => {
                onPick(o.value);
                setOpen(false);
              }}
            >
              {renderIcon(o.value)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * FigJam v3 — an ACTION dropdown (vs IconDropdown's radio semantics): each
 * item fires an operation instead of reflecting a current value. Used by the
 * align/distribute cluster; distribute items disable below three strokes.
 */
interface MoreItem {
  key: string;
  label: string;
  testid: string;
  title?: string;
  /** a toggle: the row is a checkbox */
  checked?: boolean;
  resolved?: boolean;
  onPick: () => void;
}

/**
 * The "…" every selection toolbar ends in (canvas 15: the sticky, arrow, section and sticker bars all close on a
 * more button). A word menu: the bar's extras first, then "Move to trash" - Delete is one click away here and on
 * the key.
 */
function ToolbarMore({
  items = [],
  onDelete,
}: {
  items?: readonly MoreItem[];
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="dc-annot-ctx-dd">
      <button
        type="button"
        className="dc-annot-ctx-ibtn"
        data-testid="annot-ctx-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        <IconMore size={16} />
      </button>
      {open ? (
        <div className="dc-annot-ctx-menu dc-annot-ctx-menu--words" role="menu" aria-label="More">
          {items.map((it) => (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is set only when the role is menuitemcheckbox
            <button
              key={it.key}
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked === undefined ? undefined : it.checked}
              className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
              data-testid={it.testid}
              data-resolved={it.resolved ? 'true' : undefined}
              title={it.title}
              onClick={() => {
                it.onPick();
                setOpen(false);
              }}
            >
              {it.label}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="dc-annot-ctx-ibtn dc-annot-ctx-tbtn"
            data-testid="annot-ctx-delete"
            title="Move to trash (⌫)"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
          >
            Move to trash
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ActionDropdown({
  ariaLabel,
  triggerIcon,
  options,
  renderIcon,
  isDisabled,
  onPick,
}: {
  ariaLabel: string;
  triggerIcon: ReactNode;
  options: ReadonlyArray<{ value: string; label: string }>;
  renderIcon: (v: string) => ReactNode;
  isDisabled?: (v: string) => boolean;
  onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="dc-annot-ctx-dd">
      <button
        type="button"
        className="dc-annot-ctx-ibtn dc-annot-ctx-dd-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {triggerIcon}
        <span className="dc-annot-ctx-dd-caret" aria-hidden="true">
          <IconChevronDown size={8} />
        </span>
      </button>
      {open ? (
        <div className="dc-annot-ctx-menu" role="menu" aria-label={ariaLabel}>
          {options.map((o) => {
            const disabled = isDisabled?.(o.value) ?? false;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitem"
                aria-label={o.label}
                title={o.label}
                className="dc-annot-ctx-ibtn"
                disabled={disabled}
                style={disabled ? { opacity: 0.35, cursor: 'default' } : undefined}
                onClick={() => {
                  if (disabled) return;
                  onPick(o.value);
                  setOpen(false);
                }}
              >
                {renderIcon(o.value)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phase 24 — font-size control: named presets (Small → Huge) + a numeric input
 * for an arbitrary px value (clamped 8–200, applied on Enter / blur). The
 * trigger shows the current size, or "—" when the selection is mixed.
 */
function FontSizeDropdown({
  value,
  onPick,
}: {
  value: number | undefined;
  onPick: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const applyInput = (raw: string) => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) onPick(n);
  };
  return (
    <div ref={ref} className="dc-annot-ctx-dd">
      <button
        type="button"
        className="dc-annot-ctx-ibtn dc-annot-ctx-fs-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Font size: ${value != null ? `${value} pixels` : 'mixed'}`}
        title="Font size"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dc-annot-ctx-fs-val">{value != null ? value : '—'}</span>
        <span className="dc-annot-ctx-dd-caret" aria-hidden="true">
          <IconChevronDown size={8} />
        </span>
      </button>
      {open ? (
        <div className="dc-annot-ctx-fs-menu" role="menu" aria-label="Font size">
          {FONT_SIZE_PRESETS.map((p) => (
            <button
              key={p.px}
              type="button"
              role="menuitemradio"
              aria-checked={value === p.px}
              className="dc-annot-ctx-fs-item"
              onClick={() => {
                onPick(p.px);
                setOpen(false);
              }}
            >
              <span>{p.label}</span>
              <span className="dc-annot-ctx-fs-px">{p.px}</span>
            </button>
          ))}
          <input
            key={value ?? 'mixed'}
            className="dc-annot-ctx-fs-input"
            type="number"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            defaultValue={value ?? ''}
            aria-label="Custom font size in pixels"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyInput((e.target as HTMLInputElement).value);
                setOpen(false);
              }
            }}
            onBlur={(e) => applyInput(e.target.value)}
          />
        </div>
      ) : null}
    </div>
  );
}

function uniformValue<T>(values: (T | undefined)[]): T | undefined {
  const filtered = values.filter((v) => v !== undefined) as T[];
  if (filtered.length === 0) return undefined;
  const first = filtered[0];
  return filtered.every((v) => v === first) ? first : undefined;
}

function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
