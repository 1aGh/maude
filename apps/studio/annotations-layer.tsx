import { MAX_BOARD_BYTES, MAX_ELEMENTS } from './annotations/constants.ts';
import { v1ToV2 } from './annotations/migrate-v1.ts';
import { type Op as AnnotationOp, applyOps, diffToOps } from './annotations/ops.ts';
import { defOf } from './annotations/registry.ts';
import { observeReplica } from './annotations/replica.ts';
import { parseBoard, validateElements } from './annotations/schema.ts';
import type { AnnotationElement } from './annotations/types.ts';
import { BoardStore } from './annotations/ui/board.ts';
import {
  Containment,
  expandForOp,
  insertSection,
  type MarqueeItem,
  marqueeHits,
} from './annotations/ui/containment.ts';
import type { EditRequest } from './annotations/ui/element-node.tsx';
import { AnnotationPipelineContext } from './annotations/ui/pipeline-context.ts';
import { type Claim, PointerPipeline } from './annotations/ui/pointer-pipeline.ts';
import { type RenderItem, renderItemsFromStrokes } from './annotations/ui/render-model.ts';
import { AnnotationScene } from './annotations/ui/scene.tsx';
import {
  aimCommitOps,
  draftOp,
  markSent,
  openSession,
  remotelyEdited,
  restoreOp,
  type TextSession,
} from './annotations/ui/text-session.ts';
import { TEXT_LAYER_CSS } from './annotations/ui/text-style.ts';
import { projectStrokes, type StrokeCache } from './annotations/ui/world.ts';
import { elementsToStrokes, strokesToElementMap } from './annotations/v1-adapter.ts';
/**
 * @file       annotations-layer.tsx — FigJam-style annotation overlay
 * @scope      apps/studio/annotations-layer.tsx
 * @purpose    Portal-rendered draw layer. Strokes live in world coords and
 *             render INSIDE `.dc-world` via `createPortal`, so CSS `zoom` +
 *             `translate` on the world move them in lockstep with artboards
 *             with zero frame lag. A separate transparent input overlay
 *             (also portal-mounted inside the host) captures pointerdown
 *             only for draw / erase tools; viewport gestures (space-pan,
 *             middle-mouse, wheel/pinch) bypass us and reach
 *             `useViewportController` directly.
 *
 * Schema (back-compatible with Phase 5):
 *   - pen     → <path data-tool="pen" d="M.. L..">
 *   - rect    → <rect data-tool="rect" x= y= width= height= [fill=]>
 *   - ellipse → <ellipse data-tool="ellipse" cx= cy= rx= ry= [fill=]>   NEW
 *   - arrow   → <g data-tool="arrow"><line/><polyline/></g>
 *   - text    → <text data-tool="text" data-anchor-id= x= y= fill= …>    NEW
 *
 * Persists to `<designRoot>/<slug>.annotations.svg` via PUT /_api/annotations
 * on commit, debounced 200 ms.
 */

import type { JSX } from 'react';
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  type AlignEdge,
  alignStrokes,
  type DistributeAxis,
  distributeStrokes,
} from './annotations-align.ts';
import {
  anchorPoint,
  BIND_THRESHOLD_PX,
  bindCandidate,
  isBindable,
  recomputeBoundArrows,
} from './annotations-bindings.ts';
import { AnnotationContextToolbar } from './annotations-context-toolbar.tsx';
import {
  duplicateStrokes,
  expandIdsToGroups,
  groupStrokes,
  normalizeGroups,
  outermostGroupOf,
  reorderStrokes,
  ungroupStrokes,
  type ZOrderOp,
} from './annotations-groups.ts';
import {
  type AnchorHost,
  type ArrowStroke,
  applyDrawModifiers,
  clampLinkTitle,
  DEFAULT_FONT_SIZE,
  DEFAULT_HIGHLIGHTER_COLOR,
  DEFAULT_HIGHLIGHTER_WIDTH,
  DEFAULT_SECTION_COLOR,
  DEFAULT_STICKY_COLOR,
  type DrawMods,
  defaultFillFor,
  type EditorFmt,
  type EllipseStroke,
  FILL_PALETTE,
  fmtEqual,
  grownStickyBox,
  HALO_PAD_PX,
  HIGHLIGHTER_PALETTE,
  HIGHLIGHTER_WIDTHS,
  IMAGE_MAX_DROP_SIDE,
  IMAGE_MIN_SIZE,
  type ImageStroke,
  isStrokeMeaningful,
  LINK_CARD_FILL,
  LINK_CARD_STROKE,
  LINK_DEFAULT_H,
  LINK_DEFAULT_W,
  LINK_DOMAIN_FILL,
  LINK_GLYPH_D1,
  LINK_GLYPH_D2,
  LINK_GLYPH_STROKE,
  LINK_TITLE_FILL,
  type LinkStroke,
  type ListType,
  linkCardLayout,
  listPrefixedBody,
  listPrefixedLine,
  MEDIAREF_AUDIO_GLYPH,
  MEDIAREF_DEFAULT_H,
  MEDIAREF_DEFAULT_W,
  MEDIAREF_VIDEO_GLYPH,
  MEDIAREF_VIDEO_H,
  type MediaRefStroke,
  normalizeBox,
  normalizeRect,
  normalizeSticky,
  normFmt,
  type PenStroke,
  penPathD,
  polygonPoints,
  resolveDefaultInk,
  rid,
  SECTION_CORNER_RADIUS,
  SECTION_DEFAULT_H,
  SECTION_DEFAULT_W,
  SECTION_LABEL_FONT,
  SECTION_LABEL_H,
  SECTION_MIN_SIZE,
  type SectionStroke,
  SHAPE_DEFAULT_SIZE,
  STICKER_DROP_SIZE,
  STICKY_CORNER_RADIUS,
  STICKY_DEFAULT_H,
  STICKY_DEFAULT_W,
  STICKY_MIN_SIZE,
  STICKY_PALETTE,
  STROKE_PALETTE,
  STROKE_WIDTH_THICK,
  STROKE_WIDTH_THIN,
  type StickyStroke,
  type Stroke,
  splitTextLines,
  stickyCornerPath,
  stripEditorMarkers,
  strokeBBox,
  strokeCenter,
  strokeHitTest,
  strokeRotation,
  strokesShallowEqual,
  TEXT_LINE_HEIGHT,
  type TextAlign,
  type TextStroke,
  type Thickness,
  textDecoCss,
  textLineDy,
  translateOne,
  type WorldPoint,
} from './annotations-model.ts';
import {
  computeSnap,
  GRID_PITCH_PX,
  SNAP_THRESHOLD_PX,
  type SnapGuide,
} from './annotations-snap.ts';
import { arrowPrimitives, type SvgPrimitive } from './canvas-arrowheads.ts';
import { IconLineThick, IconLineThin } from './canvas-icons.tsx';
import {
  countRender,
  getLiveViewport,
  useLiveViewport,
  useViewportControllerContext,
  useWorldRefContext,
} from './canvas-lib.tsx';
import { buildAnnotationOpsRecord } from './commands/annotation-ops-command.ts';
import { ensureMenuStyles as ensureCtxMenuStyles } from './context-menu.tsx';
import { crossedDragThreshold, type Tool } from './input-router.tsx';
import { createMediaCommitChain, type MediaCommitResult } from './media-commit-chain.ts';
import {
  AnnotationResizeOverlay,
  bboxResize,
  type Corner,
  padDX,
  padDY,
  type ResizeMods,
} from './use-annotation-resize.tsx';
import { useAnnotationSelectionOptional } from './use-annotation-selection.tsx';
import { useAnnotationsVisibility } from './use-annotations-visibility.tsx';
import {
  BATCH_DROP_CASCADE_PX,
  isHttpUrl,
  linkDomain,
  prettifyUrl,
  showCanvasToast,
  uploadAsset,
  useCanvasMediaDrop,
} from './use-canvas-media-drop.tsx';
import { useChromeVisibility } from './use-chrome-visibility.tsx';
import { type AnnotationGesture, colorForName, useCollab } from './use-collab.tsx';
import { useSelectionSetOptional } from './use-selection-set.tsx';
import { type ShapeKind, useToolMode } from './use-tool-mode.tsx';
import { useUndoSinks, useUndoStackOptional } from './use-undo-stack.tsx';

// FigJam v3 — the pure data model (Stroke types, palettes, serialize/parse,
// geometry) lives in annotations-model.ts: React-free, importable headlessly
// by bun tests and the `maude design annotate` write verb. The layer
// re-exports the whole model so every existing
// `from './annotations-layer.tsx'` import keeps working unchanged.
export * from './annotations-model.ts';
// Arrow style enums are owned by canvas-arrowheads.ts (no cycle, DDR-067).
export type { ArrowHead, ArrowLineType } from './canvas-arrowheads.ts';
export { arrowHeadPoints } from './canvas-arrowheads.ts';
export { useAnnotationsVisibility } from './use-annotations-visibility.tsx';

// ─────────────────────────────────────────────────────────────────────────────
// Types

// Phase 24 — arrow style enums are OWNED by canvas-arrowheads.ts (so that
// module imports nothing back from here — no cycle, see DDR-067) and re-exported
// here for back-compat (context-toolbar etc. import them from this module).

/** Phase 24 — cursor-following ghost placeholder descriptor (pure chrome). */
type GhostDescriptor =
  | { kind: 'text'; x: number; y: number; color: string }
  | { kind: 'sticky'; x: number; y: number; color: string }
  | { kind: 'shape'; x: number; y: number; shapeKind: ShapeKind; color: string };

/**
 * Phase 21 — what the inline editor is currently bound to. `anchored` edits
 * the text hosted by a rect/ellipse; `sticky` edits a card body; `standalone`
 * re-edits a free text node; `pending` is a not-yet-born text caret (no stroke
 * exists until real text is committed).
 */
type EditingTarget =
  | { kind: 'anchored'; anchorId: string; host: AnchorHost }
  | { kind: 'sticky'; sticky: StickyStroke }
  | { kind: 'standalone'; text: TextStroke }
  /** FigJam v3 — renaming a section's label chip. */
  | { kind: 'section'; section: SectionStroke }
  | { kind: 'pending'; x: number; y: number }
  | null;

/**
 * The canvas-shell CHROME theme — `data-maude-theme` on `<html>`, default
 * 'dark'. This (NOT the DS `data-theme`, which is deliberately separate and
 * themes only artboard palettes — canvas-shell.tsx) is what flips the canvas
 * BACKGROUND the annotation ink sits on, so the theme-aware default ink follows
 * it. Re-resolves on `data-maude-theme` mutation (the dark/light toggle posts it
 * into the iframe after mount, so we re-read once on mount too).
 */
function readChromeTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.dataset.maudeTheme === 'light' ? 'light' : 'dark';
}
function useCanvasChromeTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>(readChromeTheme);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const sync = () => setTheme(readChromeTheme());
    sync(); // catch a value stamped between the initializer and this effect
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-maude-theme'],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}

// Phase 24 — moved to canvas-arrowheads.ts (single source for shaft + heads).
// Re-exported so the existing test import (`from './annotations/annotations-layer.tsx'`)
// and the byte-identical canary keep working.

/** A whiteboard clipboard payload (v2 elements, or a pre-v2 strokes list). */
function isBoardClipboard(txt: string): boolean {
  // The clipboard is foreign input (any page the user copied from can set it):
  // nothing larger than a whole board is ever parsed (security review W3/A6).
  if (txt.length > MAX_BOARD_BYTES) return false;
  return txt.startsWith('{"maudeElements"') || txt.startsWith('{"maudeStrokes"');
}

function isEditable(t: EventTarget | null): boolean {
  if (!t || !(t as HTMLElement).tagName) return false;
  const el = t as HTMLElement;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function deriveFile(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const p = window.location.pathname;
    if (p === '/_canvas-shell.html' || p === '/_canvas-shell') {
      const qs = new URLSearchParams(window.location.search);
      const canvas = qs.get('canvas') ?? '';
      const designRel = (qs.get('designRel') ?? '.design').replace(/^\/+|\/+$/g, '');
      return `${designRel}/${canvas}`;
    }
    return decodeURIComponent(p).replace(/^\//, '');
  } catch {
    return undefined;
  }
}

/**
 * Phase 23 — the served designRoot prefix for the current canvas document. An
 * image stroke persists its href as a RELATIVE `assets/<sha8>.<ext>` path (the
 * shape the sanitizer allowlists), but a bare relative href resolves against
 * `/_canvas-shell.html` → `/assets/…`, which the canvas-origin gate 403s. The
 * real served path is `/<designRel>/assets/…`, so the render must prefix it.
 */
function canvasDesignRel(): string {
  if (typeof window === 'undefined') return '.design';
  try {
    const p = window.location.pathname;
    if (p === '/_canvas-shell.html' || p === '/_canvas-shell') {
      const qs = new URLSearchParams(window.location.search);
      return (qs.get('designRel') ?? '.design').replace(/^\/+|\/+$/g, '');
    }
    // Direct `/<designRel>/<group>/<canvas>.tsx` route → the first path segment.
    const seg = decodeURIComponent(p).replace(/^\/+/, '').split('/')[0];
    return seg || '.design';
  } catch {
    return '.design';
  }
}

/**
 * Resolve an image stroke href for the browser. The persisted `assets/<name>`
 * form is rewritten to the served `/<designRel>/assets/<name>` path; an
 * optimistic `blob:`/`data:` preview href (pre-upload) is used verbatim.
 */
function resolveAssetHref(href: string): string {
  return /^assets\//.test(href) ? `/${canvasDesignRel()}/${href}` : href;
}

/**
 * An optimistic ImageStroke's `blob:`/`data:` href (an upload in flight) is
 * never sent to the board: the image is shown from `uploading` and committed
 * once, with its `assets/…` href, when the upload lands.
 */
function isEphemeralHref(s: Stroke): boolean {
  return s.tool === 'image' && /^(?:blob|data):/i.test(s.href);
}

/**
 * Decide what `createImageFromFile`'s post-upload swap should do with a
 * given `before` chain link. Extracted as a pure function (no React) so the
 * delete-during-upload race is unit-testable: `wasDeleted` reflects whether
 * `deleteStrokes` recorded this id (via `deletedStrokeIdsRef`) before the
 * upload resolved — checking that FIRST, rather than inferring intent from
 * `before`'s membership alone, is what stops a Backspace-then-still-
 * uploading image from resurrecting once the upload lands (and syncing the
 * resurrection to every collab peer). When not deleted, an id absent from
 * `before` is assumed to be render lag (this same file's optimistic insert
 * hasn't rendered yet) rather than a delete, and gets folded back in.
 */
export function resolveImageUploadSwap(
  before: readonly Stroke[],
  id: string,
  optimistic: Stroke,
  realHref: string,
  wasDeleted: boolean
): MediaCommitResult<Stroke> | null {
  if (wasDeleted) {
    if (!before.some((s) => s.id === id)) return null;
    return { after: before.filter((s) => s.id !== id), label: 'add image' };
  }
  const base = before.some((s) => s.id === id) ? before : [...before, optimistic];
  const after = base.map((s) => (s.id === id ? ({ ...s, href: realHref } as Stroke) : s));
  // The optimistic blob: entry was never itself committed, so the undo
  // "before" excludes it — undo should remove the image outright, not
  // restore a revoked blob:.
  const commitBefore = base.filter((s) => s.id !== id);
  return { after, commitBefore, label: 'add image' };
}

// feature-bulk-media-insert Task 11 — classify an already-uploaded
// `assets/<sha8>.<ext>` path client-side, mirroring the same extension sets
// `listAssets` uses server-side (api.ts). The picker only ever surfaces paths
// it already listed via /_api/assets, so every path resolves to one of these;
// `null` (unrecognized) is treated as "skip" by the caller.
const ANNOTATION_IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);
const ANNOTATION_VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'm4v', 'ogg']);
const ANNOTATION_AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'oga', 'opus']);
function classifyAssetPathKind(path: string): 'image' | 'video' | 'audio' | null {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (ANNOTATION_IMAGE_EXT.has(ext)) return 'image';
  if (ANNOTATION_VIDEO_EXT.has(ext)) return 'video';
  if (ANNOTATION_AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

/**
 * DDR-150 dogfood #8 — true when a pointer/click event targets the inline
 * media player inside a mediaref chip. Every document-capture annotation
 * handler early-returns on it, so the player's native controls (and its
 * click-to-toggle) work instead of starting a stroke select/drag/draw.
 * (NOT a stopPropagation guard — that would also kill React's delegated
 * listeners, which attach later on the capture path.)
 */
function isMediaPlayerTarget(e: Event): boolean {
  const t = e.target as Element | null;
  return !!(t && typeof t.closest === 'function' && t.closest('[data-mediaref-player]'));
}

/**
 * Dogfood fix — the Text tool's click-through target for ARTBOARD text. This
 * layer's own input-capture div sits above the artboard content (z-index), so
 * `elementsFromPoint` (the full z-stack at that point, topmost first) is
 * needed to see past it. Mirrors canvas-shell.tsx's own `isLeafText` check
 * exactly (all children are text nodes) so "would this be a leaf-text edit
 * target" agrees between the Text-tool click-through and the native
 * double-click path it delegates to.
 */
function findEditableElementAt(clientX: number, clientY: number): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') {
    return null;
  }
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    const stamped = el.closest?.('[data-cd-id]') as HTMLElement | null;
    if (!stamped) continue;
    const kids = Array.from(stamped.childNodes);
    const isLeafText = kids.length > 0 && kids.every((n) => n.nodeType === 3);
    return isLeafText ? stamped : null;
  }
  return null;
}

/**
 * Phase 4 (unified-text-editing) — the Text tool's click-through target for
 * ANNOTATION strokes. Deliberately GEOMETRIC (world-coord bbox containment),
 * not DOM elementsFromPoint: while a draw tool is armed, every stroke node
 * renders with pointer-events:none (`hitMode`), which makes it invisible to
 * DOM hit-testing — measured in the WKWebView harness. Walks strokes topmost
 * (last-rendered) first. An anchored text is skipped — its HOST shape's bbox
 * already covers it and resolves to the same editor. A section matches only
 * on its label CHIP (geometry mirrored from SectionLabelChip) so a click
 * inside the region body still drops a NEW text there.
 */
const TEXT_EDITABLE_TOOLS = new Set(['text', 'sticky', 'rect', 'ellipse', 'polygon', 'section']);

function findTextStrokeAt(
  wx: number,
  wy: number,
  strokes: readonly Stroke[],
  zoom: number
): string | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (!s || !TEXT_EDITABLE_TOOLS.has(s.tool)) continue;
    if (s.tool === 'section') {
      const x = Math.min(s.x, s.x + s.w);
      const y = Math.min(s.y, s.y + s.h);
      const fontSize = SECTION_LABEL_FONT / zoom;
      const chipH = SECTION_LABEL_H / zoom;
      const gap = 4 / zoom;
      const chipW = Math.max(56 / zoom, s.label.length * fontSize * 0.62 + 18 / zoom);
      if (wx >= x && wx <= x + chipW && wy >= y - chipH - gap && wy <= y - gap) return s.id;
      continue;
    }
    if (s.tool === 'text' && s.anchorId != null && s.anchorId !== '') continue;
    const bb = strokeBBox(s);
    if (!bb) continue;
    if (wx >= bb.x && wx <= bb.x + bb.w && wy >= bb.y && wy <= bb.y + bb.h) return s.id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles

const ANNOT_CSS = `
.dc-annot-chrome {
  /* Stacks directly above the centered tool toolbar (which is bottom:16px,
     32px tall → top edge ~ bottom:48px). 8 px gap → chrome at bottom:60px.
     Phase 21 — dark "marker tray" matching the FigJam selection bar. */
  position: absolute;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  background: #26262b;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  padding: 5px 8px;
  font-family: var(--maude-chrome-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  color: rgba(255,255,255,0.85);
  z-index: 6;
  box-shadow: 0 8px 28px rgba(0,0,0,0.34), 0 2px 6px rgba(0,0,0,0.22);
  user-select: none;
}
.dc-annot-chrome .dc-annot-swatches { display: flex; align-items: center; gap: 1px; }
.dc-annot-chrome .dc-annot-sw {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.16);
  cursor: pointer;
  padding: 0;
  appearance: none;
  transition: transform 80ms ease;
}
.dc-annot-chrome .dc-annot-sw:hover { transform: scale(1.1); }
.dc-annot-chrome .dc-annot-sw[aria-pressed="true"] {
  box-shadow: 0 0 0 2px #26262b, 0 0 0 3px rgba(255,255,255,0.92);
  border-color: transparent;
}
.dc-annot-chrome .dc-annot-sw:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 1px;
}
.dc-annot-chrome .dc-annot-sep {
  width: 1px;
  height: 16px;
  align-self: center;
  background: rgba(255,255,255,0.09);
  margin: 0 4px;
}
.dc-annot-chrome .dc-annot-fill {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.16);
  cursor: pointer;
  padding: 0;
  appearance: none;
  position: relative;
  transition: transform 80ms ease;
}
.dc-annot-chrome .dc-annot-fill:hover { transform: scale(1.1); }
.dc-annot-chrome .dc-annot-fill:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 1px;
}
.dc-annot-chrome .dc-annot-fill--none {
  background: #3a3a40;
}
.dc-annot-chrome .dc-annot-fill--none::after {
  content: "";
  position: absolute; inset: 4px;
  border-radius: 50%;
  background:
    linear-gradient(135deg, transparent 44%, rgba(255,255,255,0.55) 44%, rgba(255,255,255,0.55) 56%, transparent 56%);
}
.dc-annot-chrome .dc-annot-fill[aria-pressed="true"] {
  box-shadow: 0 0 0 2px #26262b, 0 0 0 3px rgba(255,255,255,0.92);
  border-color: transparent;
}
/* Phase 21 — icon buttons (light glyph on dark, white-tint active). */
.dc-annot-chrome .dc-annot-ibtn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 7px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: rgba(255,255,255,0.78);
  cursor: pointer;
  padding: 0;
  transition: background-color 80ms linear, color 80ms linear;
}
.dc-annot-chrome .dc-annot-ibtn:hover {
  background: rgba(255,255,255,0.1);
  color: #ffffff;
}
.dc-annot-chrome .dc-annot-ibtn[aria-pressed="true"] {
  background: rgba(255,255,255,0.18);
  color: #ffffff;
}
.dc-annot-chrome .dc-annot-ibtn:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .dc-annot-chrome .dc-annot-ibtn, .dc-annot-chrome .dc-annot-sw, .dc-annot-chrome .dc-annot-fill { transition: none; }
}
.dc-annot-input {
  position: absolute;
  inset: 0;
  z-index: 4;
}
.dc-annot-svg {
  position: absolute;
  left: 0;
  top: 0;
  /*
   * .dc-world has no intrinsic dimensions — its children render via absolute
   * positioning. An SVG inside with width:100%/height:100% resolves to 0 px
   * and Chrome clips children even under overflow:visible. We hardcode a
   * very large width/height instead so the SVG viewport easily covers any
   * world-coord stroke; overflow:visible covers the rare edge case of a
   * stroke straying outside this 200k box.
   */
  width: 200000px;
  height: 200000px;
  overflow: visible;
  pointer-events: none;
}
/* Drag-select marquee — rendered while user is dragging to select strokes. */
.dc-annot-marquee {
  pointer-events: none;
  fill: color-mix(in oklab, var(--maude-hud-accent, #d63b1f) 8%, transparent);
  stroke: var(--maude-hud-accent, #d63b1f);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
/* Phase 24 — while editing an annotation's text (a text label OR a sticky body,
   both carry the dc-annot-editor class), force the I-beam. The important flag
   plus the class selector beat use-tool-mode's blanket star-cursor rule (you
   usually open the editor from MOVE mode, whose move glyph would otherwise sit
   over the text you're typing into). The element's inline text cursor can't win
   that fight on its own — a non-important inline style loses to !important.
   See DDR-067. (No backticks in this comment: the whole block is a JS template
   literal, so a backtick here would terminate the string.) */
.dc-annot-editor, .dc-annot-editor *, textarea.dc-annot-text { cursor: text !important; }
/* Phase 7 (unified-text-editing) — hover affordance parity with artboard leaf
   text: a standalone text stroke invites editing with the I-beam in Move mode
   (double-click / Text-tool click enters its editor in place). Shapes and
   stickies keep the selection arrow — their whole body is a move/select
   target first. */
.dc-annot-el[data-tool="text"] .dc-annot-text { cursor: text; }
/* FigJam v3 — connection dots on a selected bindable shape. The important flag
   beats use-tool-mode's blanket star-cursor rule (same fight as the editor +
   resize handles — DDR-067). */
.dc-annot-conn-dot { cursor: crosshair !important; }
`.trim();

function ensureAnnotStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('dc-annot-css')) return;
  const s = document.createElement('style');
  s.id = 'dc-annot-css';
  s.textContent = `${ANNOT_CSS}\n${TEXT_LAYER_CSS}`;
  document.head.appendChild(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// Strokes store — lifted out of the layer so the contextual toolbar (Phase 5.1
// Task 8) can mutate strokes without prop-drilling.

// ─────────────────────────────────────────────────────────────────────────────
// Strokes store — lifted out of the layer so the contextual toolbar (Phase 5.1
// Task 8) can mutate strokes without prop-drilling.

export interface StrokesStoreValue {
  strokes: Stroke[];
  setStrokes: (next: Stroke[]) => void;
  updateStroke: (id: string, patch: Partial<Stroke>) => void;
  deleteStrokes: (ids: string[]) => void;
  translateStrokes: (ids: string[], dx: number, dy: number) => void;
  /**
   * FigJam v3 — bulk mutation in ONE undo record (the per-stroke
   * `updateStroke` loop the context toolbar used pre-v3 pushed N records for
   * an N-stroke selection). `fn` returns the patch for a stroke or null to
   * leave it untouched.
   */
  applyToStrokes: (
    ids: readonly string[],
    fn: (s: Stroke) => Partial<Stroke> | null,
    label?: string
  ) => void;
  /** Group the (expanded) selection; returns the member ids to select, or null. */
  groupSelection: (ids: readonly string[]) => string[] | null;
  /** Dissolve the outermost group of every selected stroke. */
  ungroupSelection: (ids: readonly string[]) => void;
  /** Cmd+D / paste — clone with fresh ids; returns the clone ids to select. */
  duplicateSelection: (ids: readonly string[], dx: number, dy: number) => string[];
  /** Z-order — `]` `[` `Cmd+]` `Cmd+[`; group units move contiguously. */
  reorderSelection: (ids: readonly string[], op: ZOrderOp) => void;
  alignSelection: (ids: readonly string[], edge: AlignEdge) => void;
  distributeSelection: (ids: readonly string[], axis: DistributeAxis) => void;
  /**
   * Wave H — transient gesture preview: applies the patch to local React
   * state ONLY (no undo record, no persistence), exactly like the move-drag's
   * per-tick path. Close the gesture with `commitGesture` on pointerup so the
   * whole drag lands as ONE undo record (undo used to walk every resize px).
   */
  previewStroke: (id: string, patch: Partial<Stroke>) => void;
  /** Wave H — single undo record from a preview gesture's start snapshot. */
  commitGesture: (before: readonly Stroke[], label?: string) => void;
  /** The host a dragged arrow endpoint would bind to (halo), or null. */
  setBindHint?: (hostId: string | null) => void;
  /** Live size label + dimension-match halos while resizing, or null. */
  setResizeInfo?: (
    info: { box: { x: number; y: number; w: number; h: number }; matchIds: string[] } | null
  ) => void;
}

export const StrokesStoreContext = createContext<StrokesStoreValue | null>(null);

export function useStrokesStore(): StrokesStoreValue | null {
  return useContext(StrokesStoreContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// FigJam v3 — one-time contextual hints (first-use discoverability). Behaviour-
// triggered micro-toasts, never a modal tour: each key fires at most once per
// browser profile (localStorage bitmap), reusing the existing canvas toast.

// Chrome elements never deselect. Includes the per-shape context toolbar,
// the main tool palette, the in-canvas draw chrome, the minimap, and the
// right-click menu. Clicks on these route to their own handlers.
const CHROME_SELECTOR =
  '.dc-annot-conn-dot, .dc-annot-ctx, .dc-tool-palette, .dc-annot-chrome, .dc-mm, .dc-context-menu, .dc-tp-popover, .dc-multi-artboard-tb, .dc-elem-ctx-tb, .dc-cv-eq-spacing-layer, .cm-composer, .cm-thread, .cm-mention-popup, .cm-pin, .dc-annot-resize-handle, .dc-annot-rotate-zone, .dc-annot-editor, [data-group-resize-corner]';

const HINTS_KEY = 'maude-annot-hints-v1';

/** Below this zoom a pointer entry into text editing first zooms to the element (AD7). */
const EDIT_ZOOM_FLOOR = 0.5;

function showOnceHint(key: string, msg: string): void {
  if (typeof window === 'undefined') return;
  try {
    const seen = JSON.parse(window.localStorage.getItem(HINTS_KEY) || '{}') as Record<
      string,
      number
    >;
    if (seen[key]) return;
    seen[key] = 1;
    window.localStorage.setItem(HINTS_KEY, JSON.stringify(seen));
  } catch {
    return; // storage blocked — skip rather than re-toast forever
  }
  showCanvasToast(msg);
}

// Annotations visibility now lives in use-annotations-visibility.tsx so the
// ToolPalette (a sibling under CanvasRouter, not a descendant of this layer)
// can read the same state. Re-exported here for back-compat.

/**
 * Phase 2 (whiteboard-improvements) — proportional group resize. Maps one
 * stroke's geometry from its position inside the group's START bbox (`b0`)
 * to the equivalent position inside the RESIZED bbox (`b1`) — the same
 * affine transform applied to every selected member, so the whole selection
 * scales as one rigid composition anchored at whichever corner `bboxResize`
 * derived `b1` from (reused verbatim for the group's own outer bbox — see
 * the pointerdown handler below). Returns null for a stroke with nothing to
 * scale: anchored text inherits its host's bbox at render time already, so
 * scaling it too would double-transform it.
 */
function scaleStrokeInGroup(
  s: Stroke,
  b0: { x: number; y: number; w: number; h: number },
  b1: { x: number; y: number; w: number; h: number }
): Partial<Stroke> | null {
  if (s.tool === 'text' && s.anchorId != null && s.anchorId !== '') return null;
  const sx = b0.w === 0 ? 1 : b1.w / b0.w;
  const sy = b0.h === 0 ? 1 : b1.h / b0.h;
  // Non-uniform group stretches (no Shift held) still need ONE scalar for
  // things that don't have an independent width/height, like font size.
  const avgScale = (sx + sy) / 2;
  const tp = (px: number, py: number): [number, number] => [
    b1.x + (px - b0.x) * sx,
    b1.y + (py - b0.y) * sy,
  ];
  if (s.tool === 'pen') {
    return { points: s.points.map(([px, py]) => tp(px, py)) } as Partial<PenStroke>;
  }
  if (s.tool === 'arrow') {
    const [x1, y1] = tp(s.x1, s.y1);
    const [x2, y2] = tp(s.x2, s.y2);
    return { x1, y1, x2, y2 } as Partial<ArrowStroke>;
  }
  if (s.tool === 'ellipse') {
    const [cx, cy] = tp(s.cx, s.cy);
    return {
      cx,
      cy,
      rx: Math.max(1, s.rx * sx),
      ry: Math.max(1, s.ry * sy),
    } as Partial<EllipseStroke>;
  }
  if (s.tool === 'text') {
    // Standalone (unanchored) text — its own origin scales with the group;
    // font size scales by the average factor so a non-uniform stretch keeps
    // the text legible instead of only stretching its box.
    const [x, y] = tp(s.x ?? 0, s.y ?? 0);
    return {
      x,
      y,
      fontSize: Math.max(6, Math.round(s.fontSize * avgScale)),
    } as Partial<TextStroke>;
  }
  if (
    s.tool === 'rect' ||
    s.tool === 'polygon' ||
    s.tool === 'link' ||
    s.tool === 'mediaref' ||
    s.tool === 'section' ||
    s.tool === 'image' ||
    s.tool === 'sticky'
  ) {
    const bb = strokeBBox(s);
    if (!bb) return null;
    const [x, y] = tp(bb.x, bb.y);
    const patch: Partial<Stroke> = { x, y, w: Math.max(1, bb.w * sx), h: Math.max(1, bb.h * sy) };
    if (s.tool === 'sticky') {
      (patch as Partial<StickyStroke>).fontSize = Math.max(6, Math.round(s.fontSize * avgScale));
    }
    return patch;
  }
  return null;
}

/** The copies of `ids` in a duplicate result (what to select afterwards). */
function cloneRoots(ids: readonly string[], res: { idMap: ReadonlyMap<string, string> }): string[] {
  return ids.map((id) => res.idMap.get(id)).filter((x): x is string => !!x);
}

/** The element an editing target edits (a shape label edits on the shape). */
function editTargetId(t: EditingTarget): string | null {
  if (!t) return null;
  if (t.kind === 'anchored') return t.anchorId;
  if (t.kind === 'sticky') return t.sticky.id;
  if (t.kind === 'standalone') return t.text.id;
  if (t.kind === 'section') return t.section.id;
  return null;
}

function editTargetStroke(t: Exclude<EditingTarget, null | { kind: 'pending' }>): Stroke {
  if (t.kind === 'anchored') return t.host;
  if (t.kind === 'sticky') return t.sticky;
  if (t.kind === 'standalone') return t.text;
  return t.section;
}

/** The text a slot keeps for what was typed (the commit writers' own rules). */
function storedSlotText(kind: string, text: string): string {
  if (kind === 'sticky') return text;
  if (kind === 'section') return text.trim().replace(/\s*\n+\s*/g, ' ') || 'Section';
  return text.trim();
}

/** `strokes` with the session's slot back at its base text — the undo target of a text commit. */
function withSlotText(strokes: readonly Stroke[], s: TextSession): Stroke[] {
  if (s.kind === 'label-record') {
    const label = strokes.find((x) => x.tool === 'text' && x.anchorId === s.id);
    if (!s.base) return strokes.filter((x) => x !== label);
    return label
      ? strokes.map((x) => (x === label ? { ...label, text: s.base } : x))
      : [...strokes];
  }
  return strokes.map((x) => {
    if (x.id !== s.id) return x;
    if (x.tool === 'section') return { ...x, label: s.base };
    if (x.tool === 'sticky' || x.tool === 'text') return { ...x, text: s.base };
    return x;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component

export function AnnotationsLayer() {
  countRender('annotationRenders');
  ensureAnnotStyles();
  const { tool, setTool, resetTool, sticky, tools, shapeKind } = useToolMode();
  const theme = useCanvasChromeTheme();
  const controller = useViewportControllerContext();
  const vp = controller?.viewport ?? null;
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const worldRef = useWorldRefContext();
  const annotSel = useAnnotationSelectionOptional();
  const elementSel = useSelectionSetOptional();
  // Task 21 — ONE pointer pipeline for every annotation gesture: stages tried
  // in explicit priority order, one owner per gesture (pointer-pipeline.ts).
  const pipeline = useMemo(() => new PointerPipeline(), []);
  const collab = useCollab();
  const collabRef = useRef(collab);
  collabRef.current = collab;
  /**
   * Task 22 — the gesture in flight, for peers: awareness only (throttled,
   * never storage). The op still commits once at gesture end; null clears.
   */
  const publishGesture = useCallback((g: AnnotationGesture | null) => {
    collabRef.current?.publishAwareness({ annotationGesture: g });
  }, []);
  const [gestureState, setGestureState] = useState('idle');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    pipeline.onState = setGestureState;
    return pipeline.attach(document);
  }, [pipeline]);
  // Chrome owns its own presses (toolbars, handles, editors, menus, the
  // palette, comments, an inline media player): one decision, here, instead of
  // a skip-list copied into every handler (the ce641b18 class of bug).
  useEffect(
    () =>
      pipeline.add({
        priority: 5,
        name: 'chrome',
        down: (e) => {
          const t = e.target as Element | null;
          return isMediaPlayerTarget(e) || t?.closest?.(CHROME_SELECTOR) ? 'pass' : undefined;
        },
      }),
    [pipeline]
  );

  // DDR-242 AD8 (Task 26) — the board is the element store: what the project
  // delivered plus this tab's optimistic op batches. The editing UI reads it
  // as world-space strokes, projected per element (unchanged elements keep
  // their identity, so only what changed re-renders).
  const boardRef = useRef<BoardStore | null>(null);
  if (!boardRef.current) boardRef.current = new BoardStore();
  const board = boardRef.current;
  const boardVersion = useSyncExternalStore(board.subscribe, board.getVersion, board.getVersion);
  const strokeCacheRef = useRef<StrokeCache>(new WeakMap());
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-projected per board version
  const boardStrokes = useMemo(
    () => projectStrokes(board.scene(), strokeCacheRef.current),
    [board, boardVersion]
  );
  // Images still uploading (a `blob:` href) — shown, never on the board.
  const [uploading, setUploading] = useState<Stroke[]>([]);
  // A gesture in flight (drag, resize): the strokes as the gesture shows them.
  // Never stored; the gesture commits once, as one op batch.
  const [preview, setPreview] = useState<Stroke[] | null>(null);
  const strokes = useMemo(
    () => preview ?? (uploading.length ? [...boardStrokes, ...uploading] : boardStrokes),
    [preview, uploading, boardStrokes]
  );
  const [drawing, setDrawing] = useState<Stroke | null>(null);
  // Theme-aware live default ink (items 3/5/6). Initialized from the current
  // theme; tracked-untouched until the user picks a swatch, after which it
  // sticks (colorTouchedRef). The themed-default effect lives below.
  const [color, setColorState] = useState<string>(() => resolveDefaultInk(theme));
  const colorTouchedRef = useRef(false);
  const setColor = useCallback((c: string) => {
    colorTouchedRef.current = true;
    setColorState(c);
  }, []);
  // While the user hasn't picked an ink swatch yet, follow the theme — so a
  // dark canvas arms a light-reading default and a light canvas a dark one.
  useEffect(() => {
    if (!colorTouchedRef.current) setColorState(resolveDefaultInk(theme));
  }, [theme]);
  // Shape default fill (item 2). A freshly-armed Shape tool gets a fill (not
  // outline-only); the index-paired tint of the active ink. Untouched until the
  // user picks a fill swatch (incl. "No fill"), after which it sticks.
  const [fill, setFillState] = useState<string | null>(null);
  const fillTouchedRef = useRef(false);
  const setFill = useCallback((f: string | null) => {
    fillTouchedRef.current = true;
    setFillState(f);
  }, []);
  // While the Shape tool is armed and the fill is untouched, follow the ink
  // (and theme) so a square/circle/diamond lands with a paired-tint wash. Once
  // the user picks a fill swatch (or "No fill"), this stops.
  useEffect(() => {
    if (tool === 'shape' && !fillTouchedRef.current) setFillState(defaultFillFor(color, theme));
  }, [tool, color, theme]);
  const [thickness, setThickness] = useState<Thickness>(STROKE_WIDTH_THIN);
  // Phase 21 — draw-time paper tint for the sticky tool (recolor-after via the
  // context toolbar). Separate from `color` (ink for pen/rect/text/arrow).
  const [stickyColor, setStickyColor] = useState<string>(DEFAULT_STICKY_COLOR);
  // Annotation polish (item 8) — draw-time highlighter marker hue + nib width.
  const [highlighterColor, setHighlighterColor] = useState<string>(DEFAULT_HIGHLIGHTER_COLOR);
  const [highlighterWidth, setHighlighterWidth] = useState<number>(DEFAULT_HIGHLIGHTER_WIDTH);
  // Phase 21 — a standalone-text caret waiting for its first keystroke. No
  // stroke exists yet (mirrors anchored text: the stroke is born on commit,
  // so an abandoned empty caret leaves nothing behind / no undo record).
  const [pendingText, setPendingText] = useState<{ x: number; y: number } | null>(null);
  // Phase 24 — ghost placeholder: world coords the cursor is hovering while a
  // shape/sticky/text tool is armed and nothing is being drawn yet. Pure chrome
  // (low-opacity, pointer-events:none) — never selectable, hit-tested, or saved.
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  // FigJam v3 — smart-guide lines painted while a drag is snapping, and the
  // id of the host a dragged arrow endpoint would bind to (accent halo).
  const [snapGuides, setSnapGuides] = useState<SnapGuide[] | null>(null);
  const [bindHintId, setBindHintId] = useState<string | null>(null);
  // FigJam v3 — live size label + dimension-match halos while resizing (the
  // resize overlay sets it through the strokes store; the SVG layer paints).
  const [resizeInfo, setResizeInfo] = useState<{
    box: { x: number; y: number; w: number; h: number } | null;
    matchIds: string[];
  } | null>(null);
  // Cmd/Ctrl held — suppresses binding at arrow draw-end (FigJam: ⌘ keeps the
  // endpoint free). Tracked here because endStroke (pointerup) carries no
  // modifier state of its own.
  const cmdHeldRef = useRef(false);
  const vpFallbackRef = useRef(vp);
  vpFallbackRef.current = vp;
  // Reads the LIVE viewport, not the published one. Publishing is settle-only
  // (gesture-static React), so mirroring the published value here would freeze
  // this ref for the whole gesture and every zoom-scaled threshold computed
  // from it — bind distance, snap tolerance, hit-test slop, sticker placement —
  // would silently use the pre-gesture zoom. Shaped as a ref so the ~40 existing
  // `vpRef.current` call sites keep working unchanged.
  const vpRef = useMemo(
    () => ({
      get current() {
        return getLiveViewport() ?? vpFallbackRef.current;
      },
    }),
    []
  );
  const visibilityCtx = useAnnotationsVisibility();
  const chrome = useChromeVisibility();
  // Presentation Mode hides annotations without mutating the user's own
  // visibility toggle — render/input gate folds `present` in, the stored value
  // (visibilityCtx.visible) is left untouched so exiting restores it.
  const visible = (visibilityCtx?.visible ?? true) && !(chrome?.present ?? false);
  const setVisible = useCallback(
    (next: boolean | ((cur: boolean) => boolean)) => {
      if (!visibilityCtx) return;
      const v =
        typeof next === 'function'
          ? (next as (cur: boolean) => boolean)(visibilityCtx.visible)
          : next;
      visibilityCtx.setVisible(v);
    },
    [visibilityCtx]
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  // Phase 3 (unified-text-editing) — the click that OPENED the editor, so the
  // editor can place a collapsed caret at that exact character on mount
  // instead of select-all. Set only by pointer entry paths (double-click /
  // text-tool click-through); keyboard entries (Enter, fresh-create,
  // ⌘Enter chain) leave it null → select-all, the rename convention.
  const [editCaretPoint, setEditCaretPoint] = useState<{ x: number; y: number } | null>(null);
  /**
   * Open an element's text editor from a pointer (double-click, Text-tool
   * click). Below the editing zoom floor the view first zooms to the element
   * (AD7), so the caret and the text are readable; the entry click then no
   * longer points at the text, so the editor opens with the text selected.
   */
  const openEditorAt = useCallback((id: string, clientX: number, clientY: number) => {
    const zoom = getLiveViewport()?.zoom ?? 1;
    const s = strokesRef.current.find((x) => x.id === id);
    const bb = s ? strokeBBox(s) : null;
    if (zoom < EDIT_ZOOM_FLOOR && bb && controllerRef.current) {
      const pad = 48;
      controllerRef.current.jumpTo({
        x: bb.x - pad,
        y: bb.y - pad,
        w: bb.w + pad * 2,
        h: bb.h + pad * 2,
      } as Parameters<NonNullable<typeof controller>['jumpTo']>[0]);
      setEditCaretPoint(null);
    } else {
      setEditCaretPoint({ x: clientX, y: clientY });
    }
    setEditingId(id);
  }, []);

  const fileRef = useRef<string | undefined>(undefined);
  const drawingRef = useRef<Stroke | null>(null);
  drawingRef.current = drawing;
  // Phase 24 — pointer-down anchor + last cursor (world coords) for the active
  // draw, so the resize modifiers (Shift 1:1 / Alt from-center) can re-constrain
  // the draft on a bare keydown/keyup, not just on pointer-move.
  const drawAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  /**
   * Phase 20 — latest strokes mirror so command builders can read the
   * pre-mutation snapshot synchronously (React state isn't refreshed
   * between rapid taps in the same tick).
   */
  const strokesRef = useRef<Stroke[]>(strokes);
  strokesRef.current = strokes;
  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;
  // Phase 23 batch-drop fix — see media-commit-chain.ts. Every async media
  // completion (image upload swap, video/audio upload commit) that can be
  // triggered concurrently (N Finder files dropped at once) enqueues onto
  // this instead of calling commitStrokes directly off a `strokesRef.current`
  // read, so two completions landing before a render commit don't clobber
  // each other.
  const mediaCommitChainRef = useRef(
    createMediaCommitChain<Stroke>(
      () => strokesRef.current,
      (s) => s.id
    )
  );
  // Live-security-review finding (feature-bulk-media-insert follow-up) —
  // `createImageFromFile`'s upload-completion swap folds its optimistic
  // stroke back in whenever the chain's `before` doesn't have it yet,
  // reasoning "render lag, not a delete" (see the comment there). That
  // reasoning has no way to tell a genuine delete apart from render lag by
  // array membership alone — if the user drops an image then hits
  // Backspace before the upload resolves, the id is legitimately gone, and
  // the old code resurrected it anyway once the upload landed (and synced
  // the resurrection to every collab peer). Tracked explicitly here instead
  // of inferred: `deleteStrokes` records every id it removes; the swap
  // checks (and consumes) this before assuming absence means lag. Bounded
  // like the annotation echo history below — only ever holds ids a delete has
  // touched, which is small in practice, but capped for safety.
  const DELETED_STROKE_IDS_CAP = 128;
  const deletedStrokeIdsRef = useRef<Set<string>>(new Set());
  const rememberDeletedIds = useCallback((ids: readonly string[]) => {
    const set = deletedStrokeIdsRef.current;
    for (const id of ids) {
      set.add(id);
      if (set.size > DELETED_STROKE_IDS_CAP) {
        const oldest = set.values().next().value;
        if (oldest !== undefined) set.delete(oldest);
      }
    }
  }, []);

  const isDraw =
    tool === 'pen' ||
    tool === 'highlighter' ||
    tool === 'shape' ||
    tool === 'arrow' ||
    tool === 'sticky' ||
    tool === 'section' ||
    tool === 'text';
  const isErase = tool === 'eraser';
  const isActive = isDraw || isErase;
  // T20 / Phase 24 — every shape primitive carries stroke weight (FigJam ships
  // thickness on all of them). The annotation toolbar reads supportsThickness
  // to decide whether to render the Thin / Thick chips.
  const supportsThickness = tool === 'pen' || tool === 'arrow' || tool === 'shape';
  const supportsFill = tool === 'shape';
  // Phase 24 — tools that show a cursor-following ghost placeholder.
  const ghostCapable = tool === 'shape' || tool === 'sticky' || tool === 'text';

  // Clear the ghost when the active tool stops being ghost-capable (or
  // visibility toggles) so a stale ghost never lingers after a tool change.
  useEffect(() => {
    if (!ghostCapable || !visible) setGhost(null);
  }, [ghostCapable, visible]);

  // Op batches applied here but not yet seen back from the replica, in send
  // order. A snapshot from the replica is rebased onto them, so a
  // collaborator's change never hides an edit of ours still in flight.
  const pendingRef = useRef<Array<{ actionId: string; ops: readonly AnnotationOp[] }>>([]);
  const annotationsChangedRef = useRef(false);
  // Task 19 — the open text edit session (text-session.ts): its base (undo
  // target) and the text it last sent (every text op expects it). `commit…`
  // hands the session to commitStrokes for exactly one commit.
  const textSessionRef = useRef<TextSession | null>(null);
  const commitSessionRef = useRef<TextSession | null>(null);
  const sessionCommittedRef = useRef(false);
  // The edited element as the board last had it — what "keep my text" restores.
  const sessionElRef = useRef<AnnotationElement | null>(null);
  const [remoteEdited, setRemoteEdited] = useState(false);
  useEffect(() => {
    const file = deriveFile();
    fileRef.current = file;
    if (!file) return;
    let cancelled = false;
    void fetch(`/_api/annotations?file=${encodeURIComponent(file)}`, {
      headers: { Accept: 'application/json' },
    })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (cancelled || annotationsChangedRef.current) return;
        board.setAll(parseBoard(text).elements);
      })
      .catch(() => {
        /* network blip — start with an empty annotation set */
      });
    return () => {
      cancelled = true;
    };
  }, [board]);

  useEffect(() => {
    if (!collab) return;
    return observeReplica(collab.doc, (elements, _changed, actionId) => {
      annotationsChangedRef.current = true;
      const pending = pendingRef.current;
      const landed = actionId ? pending.findIndex((p) => p.actionId === actionId) : -1;
      // Batches reach the board in send order: this one and every earlier one landed.
      if (landed >= 0) pending.splice(0, landed + 1);
      const isOwn = landed >= 0;
      // A collaborator changed the text under an open editor: the editor keeps
      // the user's text and shows a marker; the commit merges both (Task 19).
      const session = textSessionRef.current;
      if (session && !isOwn) {
        const el = elements.find((e) => e.id === session.id);
        if (el && remotelyEdited(session, el)) setRemoteEdited(true);
      }
      let state = new Map(elements.map((e) => [e.id, e]));
      for (const p of pending) state = applyOps(state, p.ops).state;
      board.setAll(state.values());
    });
  }, [collab, board]);

  const undoStack = useUndoStackOptional();
  const undoSinks = useUndoSinks();
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  // feature-bulk-media-insert follow-up — dedicated dispatch queue. Rapid-fire
  // commits (a batch media drop) must reach the server in order: ops are
  // applied in arrival order, and an undo batch sent before the edit it undoes
  // would be rejected as `gone`. A dedicated chain makes each POST wait for
  // the previous one's response.
  const putChainRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * Send one element-op batch to the board (DDR-242 §4), in order after every
   * batch before it. `local` marks a batch already applied to the store: it
   * stays pending (re-applied over replica snapshots) until its echo arrives.
   */
  const sendOps = useCallback((ops: readonly AnnotationOp[], local = false): Promise<void> => {
    const file = fileRef.current;
    if (!file || !ops.length) return putChainRef.current;
    const actionId = crypto.randomUUID();
    const pending = pendingRef.current;
    if (local) {
      pending.push({ actionId, ops });
      if (pending.length > 64) pending.splice(0, pending.length - 64);
    }
    const settle = () => {
      const i = pending.findIndex((p) => p.actionId === actionId);
      if (i >= 0) pending.splice(i, 1);
    };
    const dispatch = () =>
      fetch('/_api/annotations/ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, actionId, ops }),
      })
        .then(async (r) => {
          // A refused save (403 read-only, 405 at a proxy door) previously
          // dissolved without a trace — the user kept drawing on state that
          // never reached disk, a peer, or a reload (the cloud canvas-writes
          // RCA). Optimistic local state is still the right UX; a persistence
          // failure being INVISIBLE is not.
          if (!r.ok) {
            settle();
            console.warn(`[annotations] save refused (${r.status}) — strokes are local-only`);
            return undefined;
          }
          const res = (await r.json().catch(() => null)) as {
            rejected?: Array<{ id?: string; reason: string }>;
          } | null;
          if (res?.rejected?.length) {
            console.warn('[annotations] some changes were not applied', res.rejected);
          }
          // Without a replica no echo will come; with one, the echo settles
          // it — unless the board had nothing to change (no echo either).
          if (!collabRef.current || res?.rejected?.length) settle();
          else setTimeout(settle, 10_000);
          return undefined;
        })
        .catch(() => {
          settle();
          /* Pending persistence UX is handled by the project outbox work. */
        });
    const chained = putChainRef.current.then(dispatch, dispatch);
    putChainRef.current = chained;
    return chained;
  }, []);

  /** Apply a batch here (optimistic) and send it. Returns what undoes it. */
  const applyOpsLocal = useCallback(
    (ops: readonly AnnotationOp[]): AnnotationOp[] => {
      if (!ops.length) return [];
      annotationsChangedRef.current = true;
      const r = board.apply(ops);
      void sendOps(ops, true);
      return r.inverse;
    },
    [board, sendOps]
  );

  // Undo / redo replay an op batch through THIS iframe's store (the stack is
  // rebuilt from records after a canvas switch — DDR-050).
  useEffect(() => {
    undoSinks.setSink('annotationOpsFn', (ops: readonly AnnotationOp[], file?: string) => {
      // A record made on another canvas never applies here (security review A5).
      if (file !== fileRef.current) return [];
      setPreview(null);
      return applyOpsLocal(ops);
    });
    return () => undoSinks.setSink('annotationOpsFn', undefined);
  }, [undoSinks, applyOpsLocal]);

  /**
   * Single entry point for every stroke mutation: the change from `prev` to
   * `next` becomes ONE element-op batch (only what the user changed — a
   * peer's concurrent edit to another element or another field is never
   * overwritten, and concurrent typing in the same text is merged), applied
   * here, sent, and recorded as one undo step whose undo is the batch's
   * inverse (peer-safe: it reverts only fields still holding our values).
   */
  const commitStrokes = useCallback(
    (prev: readonly Stroke[], next: readonly Stroke[], label?: string) => {
      setPreview(null);
      // An upload still in flight is not on the board: it leaves the view
      // when this commit removes it or when its uploaded form lands.
      if (uploadingRef.current.length) {
        const before = new Set(prev.map((s) => s.id));
        const after = new Map(next.map((s) => [s.id, s]));
        setUploading((list) =>
          list.filter((u) => {
            const n = after.get(u.id);
            if (n) return isEphemeralHref(n);
            return !before.has(u.id);
          })
        );
      }
      const persist = (list: readonly Stroke[]) =>
        list.some(isEphemeralHref) ? list.filter((s) => !isEphemeralHref(s)) : list;
      const committed = board.committed;
      const prevMap = strokesToElementMap(persist(prev), committed);
      const nextMap = strokesToElementMap(persist(next), committed);
      const ops = diffToOps(prevMap, nextMap);
      // A text edit session's commit (Task 19): the board merges against what
      // the session last SENT (its drafts), while undo goes back to the text
      // before the edit. Drafts never reach undo.
      const session = commitSessionRef.current;
      if (session) {
        commitSessionRef.current = null;
        sessionCommittedRef.current = true;
        applyOpsLocal(aimCommitOps(ops, session));
        const baseMap = strokesToElementMap(persist(withSlotText(prev, session)), committed);
        const redo = diffToOps(baseMap, nextMap);
        if (!redo.length) return;
        // Undo MERGES back (not a strict inverse): a collaborator's typing
        // that landed in the same text survives the undo of ours.
        undoStackRef.current.record(
          buildAnnotationOpsRecord({
            ops: redo,
            inverse: diffToOps(nextMap, baseMap),
            label: label ?? 'edit text',
            file: fileRef.current,
          })
        );
        return;
      }
      if (!ops.length) return;
      const inverse = applyOpsLocal(ops);
      undoStackRef.current.record(
        buildAnnotationOpsRecord({
          ops,
          inverse,
          label: label ?? 'edit annotations',
          file: fileRef.current,
        })
      );
    },
    [board, applyOpsLocal]
  );

  const setStrokes = useCallback(
    (next: Stroke[]) => {
      const prev = strokesRef.current;
      commitStrokes(prev, next);
    },
    [commitStrokes]
  );

  const strokesStore = useMemo<StrokesStoreValue>(() => {
    const updateStroke = (id: string, patch: Partial<Stroke>): void => {
      const prev = strokesRef.current;
      // FigJam v3 — bound arrow endpoints re-derive from their host after ANY
      // geometry patch (resize ticks included), so connectors track live.
      const next = recomputeBoundArrows(
        prev.map((s) => (s.id === id ? ({ ...s, ...patch } as Stroke) : s))
      );
      commitStrokes(prev, next);
    };
    // Task 20 — an operation on a section acts on its subtree (containment.ts).
    const containmentNow = () =>
      new Containment(strokesToElementMap(strokesRef.current, board.committed).values());
    const withSubtree = (ids: readonly string[]) =>
      expandForOp(ids, (x) => expandIdsToGroups(x, strokesRef.current), containmentNow());
    const deleteStrokes = (ids: string[]): void => {
      const set = new Set(withSubtree(ids));
      const prev = strokesRef.current;
      const filtered = prev.filter(
        (s) => !set.has(s.id) && !(s.tool === 'text' && s.anchorId != null && set.has(s.anchorId))
      );
      if (filtered.length === prev.length) return;
      // Record every id actually removed (not just the requested `ids` —
      // bound text anchors get swept too) so an in-flight image upload's
      // swap (see deletedStrokeIdsRef above) knows this id is a genuine
      // delete, not render lag, if it resolves after this point.
      const filteredIds = new Set(filtered.map((s) => s.id));
      rememberDeletedIds(prev.filter((s) => !filteredIds.has(s.id)).map((s) => s.id));
      // FigJam v3 — deleting a bind host strips the bind (endpoint frozen,
      // arrow survives); singleton/empty groups dissolve (tldraw lifecycle).
      commitStrokes(prev, recomputeBoundArrows(normalizeGroups(filtered)));
    };
    const translateStrokes = (ids: string[], dx: number, dy: number): void => {
      const set = new Set(withSubtree(ids));
      const prev = strokesRef.current;
      const next = recomputeBoundArrows(
        prev.map((s) => (set.has(s.id) ? translateOne(s, dx, dy) : s))
      );
      commitStrokes(prev, next, `move ${ids.length} stroke${ids.length === 1 ? '' : 's'}`);
    };
    const applyToStrokes = (
      ids: readonly string[],
      fn: (s: Stroke) => Partial<Stroke> | null,
      label?: string
    ): void => {
      const set = new Set(ids);
      const prev = strokesRef.current;
      let touched = 0;
      const next = recomputeBoundArrows(
        prev.map((s) => {
          if (!set.has(s.id)) return s;
          const patch = fn(s);
          if (!patch) return s;
          touched++;
          return { ...s, ...patch } as Stroke;
        })
      );
      if (touched === 0) return;
      commitStrokes(prev, next, label ?? `edit ${touched} stroke${touched === 1 ? '' : 's'}`);
    };
    const groupSelection = (ids: readonly string[]): string[] | null => {
      const prev = strokesRef.current;
      const res = groupStrokes(prev, ids);
      if (!res) return null;
      commitStrokes(prev, res.strokes, `group ${res.memberIds.length} strokes`);
      return res.memberIds;
    };
    const ungroupSelection = (ids: readonly string[]): void => {
      const prev = strokesRef.current;
      const next = ungroupStrokes(prev, ids);
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(prev, next, 'ungroup');
    };
    const duplicateSelection = (ids: readonly string[], dx: number, dy: number): string[] => {
      const prev = strokesRef.current;
      const res = duplicateStrokes(prev, withSubtree(ids), dx, dy);
      if (res.strokes.length === prev.length) return [];
      const added = res.strokes.length - prev.length;
      commitStrokes(prev, res.strokes, `duplicate ${added} stroke${added === 1 ? '' : 's'}`);
      // Select the copies of what was selected (their contents ride along).
      return cloneRoots(ids, res);
    };
    const reorderSelection = (ids: readonly string[], op: ZOrderOp): void => {
      const prev = strokesRef.current;
      const next = reorderStrokes(prev, ids, op);
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(
        prev,
        next,
        op === 'front' || op === 'forward' ? 'bring forward' : 'send backward'
      );
    };
    const alignSelection = (ids: readonly string[], edge: AlignEdge): void => {
      const prev = strokesRef.current;
      const c = containmentNow();
      const next = recomputeBoundArrows(
        alignStrokes(prev, c.roots(ids), edge, (id) => c.contentsOf(id))
      );
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(prev, next, `align ${edge}`);
    };
    const distributeSelection = (ids: readonly string[], axis: DistributeAxis): void => {
      const prev = strokesRef.current;
      const c = containmentNow();
      const next = recomputeBoundArrows(
        distributeStrokes(prev, c.roots(ids), axis, (id) => c.contentsOf(id))
      );
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(prev, next, 'distribute');
    };
    // Wave H — transient per-tick path for handle drags (resize / rotate /
    // endpoint re-anchor). Local React state only — no undo push, no PUT —
    // mirroring the move-drag's onMove. `commitGesture` closes it as ONE
    // record (no-op when the gesture ended where it started).
    const previewStroke = (id: string, patch: Partial<Stroke>): void => {
      const next = recomputeBoundArrows(
        strokesRef.current.map((s) => (s.id === id ? ({ ...s, ...patch } as Stroke) : s))
      );
      setPreview(next);
      const moved = next.find((s) => s.id === id);
      const box = moved ? strokeBBox(moved) : null;
      if (box) publishGesture({ kind: 'resize', ids: [id], box });
    };
    const commitGesture = (before: readonly Stroke[], label?: string): void => {
      publishGesture(null);
      const cur = strokesRef.current;
      if (strokesShallowEqual(before, cur)) {
        setPreview(null);
        return;
      }
      commitStrokes(before, cur, label);
    };
    return {
      strokes,
      setBindHint: setBindHintId,
      setResizeInfo,
      setStrokes,
      updateStroke,
      deleteStrokes,
      translateStrokes,
      applyToStrokes,
      groupSelection,
      ungroupSelection,
      duplicateSelection,
      reorderSelection,
      alignSelection,
      distributeSelection,
      previewStroke,
      commitGesture,
    };
  }, [strokes, setStrokes, commitStrokes, rememberDeletedIds]);

  // feature-bulk-media-insert Task 11 — the picker's "Add as annotation"
  // confirm posts N already-uploaded asset paths in ONE message; unlike
  // createImageFromFile/createMediaReference (which each race an independent
  // upload), every path here is already on disk, so this resolves every
  // image's natural size up front (Promise.all) and performs exactly ONE
  // commitStrokes for the whole batch — correct by construction, no chain
  // needed since there's no per-item async race once all N are resolved.
  const createMediaFromAssetPaths = useCallback(
    (paths: readonly string[], world: [number, number]) => {
      if (typeof window === 'undefined' || !paths.length) return;
      const classified = paths
        .map((path) => ({ path, kind: classifyAssetPathKind(path) }))
        .filter((it): it is { path: string; kind: 'image' | 'video' | 'audio' } => it.kind != null);
      if (!classified.length) return;

      type Resolved = { path: string; kind: 'image' | 'video' | 'audio'; w: number; h: number };
      const probeOne = (path: string, kind: 'image' | 'video' | 'audio'): Promise<Resolved> => {
        if (kind !== 'image') {
          const h = kind === 'video' ? MEDIAREF_VIDEO_H : MEDIAREF_DEFAULT_H;
          return Promise.resolve({ path, kind, w: MEDIAREF_DEFAULT_W, h });
        }
        return new Promise<Resolved>((resolve) => {
          const probe = new Image();
          probe.onload = () => {
            const natW = probe.naturalWidth || IMAGE_MAX_DROP_SIDE;
            const natH = probe.naturalHeight || Math.round(IMAGE_MAX_DROP_SIDE * 0.66);
            const longest = Math.max(natW, natH) || 1;
            const scale = longest > IMAGE_MAX_DROP_SIDE ? IMAGE_MAX_DROP_SIDE / longest : 1;
            resolve({
              path,
              kind: 'image',
              w: Math.max(IMAGE_MIN_SIZE, Math.round(natW * scale)),
              h: Math.max(IMAGE_MIN_SIZE, Math.round(natH * scale)),
            });
          };
          // Couldn't decode — fall back to a small square rather than
          // dropping this item from the batch (the file is already on disk).
          probe.onerror = () => resolve({ path, kind: 'image', w: 64, h: 64 });
          probe.src = resolveAssetHref(path);
        });
      };

      void Promise.all(classified.map(({ path, kind }) => probeOne(path, kind))).then(
        (resolved) => {
          // Ids generated up front (stable regardless of chain timing) so
          // they're available for the selection call below without waiting
          // on the chain to settle.
          const withIds = resolved.map((item, i) => ({ ...item, id: rid(), i }));
          const label = `add ${withIds.length} item${withIds.length === 1 ? '' : 's'}`;
          // Batch-drop fix (see media-commit-chain.ts) — every path here is
          // already resolved, so THIS call alone is race-free by
          // construction, but a SECOND overlapping bulk-insert (or a
          // concurrent drag-drop via createImageFromFile/createMediaReference)
          // can still land while this one's Promise.all was in flight (large
          // photos take real, non-trivial decode time) — both read/write the
          // same `strokes` state, so this must enqueue onto the shared chain
          // too, not read `strokesRef.current` + commit directly.
          void mediaCommitChainRef.current.enqueue((before) => {
            const added: Stroke[] = withIds.map((item) => {
              const cx = world[0] + item.i * BATCH_DROP_CASCADE_PX;
              const cy = world[1] + item.i * BATCH_DROP_CASCADE_PX;
              if (item.kind === 'image') {
                return {
                  id: item.id,
                  tool: 'image',
                  x: cx - item.w / 2,
                  y: cy - item.h / 2,
                  w: item.w,
                  h: item.h,
                  href: item.path,
                } as ImageStroke;
              }
              return {
                id: item.id,
                tool: 'mediaref',
                x: cx - item.w / 2,
                y: cy - item.h / 2,
                w: item.w,
                h: item.h,
                src: item.path,
                mediaKind: item.kind,
                title: item.path.split('/').pop() || item.path,
              } as MediaRefStroke;
            });
            return { after: [...before, ...added], label };
          }, commitStrokes);
          annotSel?.replace(withIds.map((item) => item.id));
        }
      );
    },
    [commitStrokes, annotSel]
  );

  // Menubar bridge (Phase 5.1 Task 10) — listen for postMessages from the
  // dev-server shell. `selection-clear` + `tool-set` live in canvas-shell
  // (those providers are above us); we own visibility + annotation-select-all
  // because they read this layer's local state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = e.data as { dgn?: string; visible?: boolean } | null;
      if (!m || typeof m !== 'object' || !m.dgn) return;
      if (m.dgn === 'view-annotations') {
        if (typeof m.visible === 'boolean') setVisible(m.visible);
        return;
      }
      if (m.dgn === 'annotation-select-all') {
        if (annotSel) annotSel.replace(strokes.map((s) => s.id));
        return;
      }
      // Stage F3 — the shell's AssetPicker (main-origin, DDR-054) resolved a new
      // asset for an ImageStroke/MediaRefStroke's "Replace…" context-menu entry;
      // the canvas iframe owns the annotation model, so the shell REQUESTS the
      // swap here rather than writing strokes itself. `href`/`src` mirrors each
      // stroke shape (ImageStroke.href / MediaRefStroke.src) — swap whichever key
      // the target stroke actually carries, everything else survives byte-for-byte.
      if (
        m.dgn === 'replace-annotation-media' &&
        typeof (m as { id?: unknown }).id === 'string' &&
        typeof (m as { path?: unknown }).path === 'string'
      ) {
        const id = (m as { id: string }).id;
        const path = (m as { path: string }).path;
        const before = strokesRef.current;
        const target = before.find((s) => s.id === id);
        if (!target || (target.tool !== 'image' && target.tool !== 'mediaref')) return;
        const after = before.map((s) => {
          if (s.id !== id) return s;
          return target.tool === 'image'
            ? ({ ...s, href: path } as ImageStroke)
            : ({ ...s, src: path } as MediaRefStroke);
        });
        commitStrokes(before, after, 'replace media');
        return;
      }
      // Phase 4 (whiteboard-improvements) — the shell's StickerPicker (main-
      // origin) already uploaded the picked bundled sticker to a PROJECT asset
      // path via /_api/asset (canvas-origin-allowlisted — the round-trip
      // through the shell exists only because /_stickers/* itself is main-
      // origin-only, same posture as AssetPicker/replace-annotation-media
      // above). Drop it at the current viewport center — no cross-origin
      // cursor position to reuse. Inlines the screenToWorld formula (that
      // callback isn't declared until below this effect) against vpRef, which
      // is.
      if (m.dgn === 'insert-sticker' && typeof (m as { path?: unknown }).path === 'string') {
        const path = (m as { path: string }).path;
        const v = vpRef.current ?? { x: 0, y: 0, zoom: 1 };
        const z = v.zoom || 1;
        const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
        const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
        const wx = (cx - v.x) / z;
        const wy = (cy - v.y) / z;
        const size = STICKER_DROP_SIZE;
        const id = rid();
        const stroke: ImageStroke = {
          id,
          tool: 'image',
          x: wx - size / 2,
          y: wy - size / 2,
          w: size,
          h: size,
          href: path,
        };
        const before = strokesRef.current;
        commitStrokes(before, [...before, stroke], 'add sticker');
        annotSel?.replace([id]);
      }
      // feature-bulk-media-insert Task 11 — the shell's AssetPicker (main-
      // origin) multi-select "Add as annotation" confirm. Every path is
      // already an uploaded assets/… path (no upload step here); same
      // viewport-center placement as insert-sticker above (no cross-origin
      // cursor position to reuse).
      if (m.dgn === 'insert-annotation-media' && Array.isArray((m as { paths?: unknown }).paths)) {
        const paths = (m as { paths: unknown[] }).paths.filter(
          (p): p is string => typeof p === 'string'
        );
        if (paths.length) {
          const v = vpRef.current ?? { x: 0, y: 0, zoom: 1 };
          const z = v.zoom || 1;
          const cx = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
          const cy = typeof window !== 'undefined' ? window.innerHeight / 2 : 0;
          const wx = (cx - v.x) / z;
          const wy = (cy - v.y) / z;
          createMediaFromAssetPaths(paths, [wx, wy]);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [annotSel, strokes, setVisible, commitStrokes, createMediaFromAssetPaths]);

  // Document-level toggle: Shift+P (presentation). Annotation-shortcut help is
  // owned by the dev-server menubar (Help button); we no longer ship an
  // in-canvas help dialog from this layer.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (e.key === 'P' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [setVisible]);

  const screenToWorld = useCallback(
    (cx: number, cy: number): [number, number] => {
      // Live: this runs at event time (drop/placement), where the published
      // viewport can be a whole gesture behind.
      const v = vpRef.current ?? { x: 0, y: 0, zoom: 1 };
      const z = v.zoom || 1;
      return [(cx - v.x) / z, (cy - v.y) / z];
    },
    [vp]
  );

  // ── Phase 23 — media intake (drag-drop / paste / file-picker / link input) ──
  // Image: optimistic blob: preview stroke (LOCAL only — never persisted) →
  // POST /_api/asset → swap href to assets/… and commit (one undo record) →
  // revoke the blob URL. On failure the optimistic stroke is removed + a toast.
  const createImageFromFile = useCallback(
    (file: File, world: [number, number]) => {
      if (typeof window === 'undefined' || !file.type.startsWith('image/')) return;
      const blobUrl = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const natW = probe.naturalWidth || IMAGE_MAX_DROP_SIDE;
        const natH = probe.naturalHeight || Math.round(IMAGE_MAX_DROP_SIDE * 0.66);
        const longest = Math.max(natW, natH) || 1;
        const scale = longest > IMAGE_MAX_DROP_SIDE ? IMAGE_MAX_DROP_SIDE / longest : 1;
        const w = Math.max(IMAGE_MIN_SIZE, Math.round(natW * scale));
        const h = Math.max(IMAGE_MIN_SIZE, Math.round(natH * scale));
        const id = rid();
        const optimistic: ImageStroke = {
          id,
          tool: 'image',
          x: world[0] - w / 2,
          y: world[1] - h / 2,
          w,
          h,
          href: blobUrl,
        };
        // Local-only insert — the blob: href must NOT reach the server (it's
        // ephemeral + would be stripped by the sanitizer); we commit only the
        // assets/… form once the upload lands. Functional updater — a batch
        // drop fires this for every file independently, so two optimistic
        // inserts landing before a render commit must compose against each
        // other rather than each overwriting the other's array snapshot.
        setUploading((prev) => [...prev, optimistic]);
        void uploadAsset(file).then((res) => {
          if ('path' in res) {
            // Batch-drop fix (see media-commit-chain.ts) — N concurrent
            // uploads resolve at unpredictable relative speed; enqueue the
            // swap instead of reading strokesRef.current directly, so this
            // completion always builds on the latest accumulated state
            // rather than a stale pre-render snapshot another completion
            // already moved past.
            void mediaCommitChainRef.current
              .enqueue((before) => {
                const wasDeleted = deletedStrokeIdsRef.current.has(id);
                if (wasDeleted) deletedStrokeIdsRef.current.delete(id);
                return resolveImageUploadSwap(before, id, optimistic, res.path, wasDeleted);
              }, commitStrokes)
              .then((after) => {
                if (after.some((s) => s.id === id)) annotSel?.replace([id]);
              });
          } else {
            // Failure cleanup — no undo record (the optimistic stroke was
            // never committed), so a plain functional updater (not the
            // chain) is enough: it still composes correctly against any
            // chain-driven setStrokesState queued in the same batch.
            setUploading((prev) => prev.filter((s) => s.id !== id));
            deletedStrokeIdsRef.current.delete(id); // never reached the chain — nothing to consume there
            showCanvasToast(`Image upload failed — ${res.error}`, 'error');
          }
          URL.revokeObjectURL(blobUrl);
        });
      };
      probe.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        showCanvasToast('Could not read that image file', 'error');
      };
      probe.src = blobUrl;
    },
    [commitStrokes, annotSel]
  );

  // Link: client-only preview chip — no upload, no server fetch. Only http(s)
  // URLs are accepted (the hook already gates, re-checked here defensively).
  const createLink = useCallback(
    (url: string, title: string, world: [number, number]) => {
      if (!isHttpUrl(url)) return;
      const w = LINK_DEFAULT_W;
      const h = LINK_DEFAULT_H;
      const id = rid();
      const link: LinkStroke = {
        id,
        tool: 'link',
        x: world[0] - w / 2,
        y: world[1] - h / 2,
        w,
        h,
        url,
        title: (title || prettifyUrl(url)).slice(0, 300),
        domain: linkDomain(url),
      };
      const before = strokesRef.current;
      commitStrokes(before, [...before, link], 'add link');
      annotSel?.replace([id]);
    },
    [commitStrokes, annotSel]
  );

  // Media reference (DDR-150 P4): a video/audio file dropped on the canvas BODY
  // becomes a versioned reference chip (NOT a source insert, NOT a played
  // element) carrying its assets/ path — the "nahazet klipy → agent z toho udělá
  // video" artifact. Upload to assets/, then commit a MediaRefStroke; on failure
  // toast. No poster probe in v1 — a media glyph tile (▶/♪) + filename.
  const createMediaReference = useCallback(
    (file: File, mediaKind: 'video' | 'audio', world: [number, number]) => {
      const w = MEDIAREF_DEFAULT_W;
      // Video chips are taller — they host the inline 16:9 player (dogfood #8).
      const h = mediaKind === 'video' ? MEDIAREF_VIDEO_H : MEDIAREF_DEFAULT_H;
      void uploadAsset(file).then((res) => {
        if (!('path' in res)) {
          showCanvasToast(`Couldn't add ${mediaKind}: ${res.error}`, 'error');
          return;
        }
        const id = rid();
        const ref: MediaRefStroke = {
          id,
          tool: 'mediaref',
          x: world[0] - w / 2,
          y: world[1] - h / 2,
          w,
          h,
          src: res.path,
          mediaKind,
          title: (file.name || res.path).slice(0, 300),
        };
        // Batch-drop fix (see media-commit-chain.ts) — same accumulator
        // chain as createImageFromFile's swap, so a video/audio upload
        // resolving interleaved with concurrent image uploads (or other
        // media uploads) in the same batch never commits against a stale
        // pre-render snapshot.
        void mediaCommitChainRef.current.enqueue(
          (before) => ({ after: [...before, ref], label: `add ${mediaKind} reference` }),
          commitStrokes
        );
        annotSel?.replace([id]);
        const sizeMb = file.size / (1024 * 1024);
        showCanvasToast(
          `Added ${mediaKind} reference · ${res.path}${sizeMb > 20 ? ' · ⚠ >20 MB rides git + sync' : ''}`
        );
      });
    },
    [commitStrokes, annotSel]
  );

  const mediaCallbacks = useMemo(
    () => ({ onImage: createImageFromFile, onLink: createLink, onMedia: createMediaReference }),
    [createImageFromFile, createLink, createMediaReference]
  );
  // Media intake is paste/drop only (per product steer — no toolbar buttons):
  // drop an image / URL or Cmd+V a clipboard image / link straight onto the
  // canvas. The hook owns the dragover/drop/paste wiring; the create callbacks
  // hold the commit/undo sink + screenToWorld.
  //
  // DDR-150 dogfood #8 — intake was gated on `visible` (annotations toggled on),
  // so with annotations hidden (⇧P) a Finder drop silently did NOTHING. Intake
  // now stays live whenever we're not presenting; the committed stroke simply
  // shows once annotations are visible again.
  useCanvasMediaDrop({
    enabled: !(chrome?.present ?? false),
    screenToWorld,
    callbacks: mediaCallbacks,
  });

  const eraseAt = useCallback(
    (wx: number, wy: number) => {
      const zoom = vpRef.current?.zoom || 1;
      const tol = 8 / zoom;
      const prev = strokesRef.current;
      for (let i = prev.length - 1; i >= 0; i--) {
        const candidate = prev[i];
        if (candidate && strokeHitTest(candidate, wx, wy, tol)) {
          const removedId = candidate.id;
          const next = prev
            .slice(0, i)
            .concat(prev.slice(i + 1))
            .filter((s) => !(s.tool === 'text' && s.anchorId === removedId));
          commitStrokes(prev, next, 'erase 1 stroke');
          return;
        }
      }
    },
    [vp, commitStrokes]
  );

  const beginStroke = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, spaceHeld: boolean) => {
      if (!isActive || !visible) return false;
      if (e.button !== 0) return false;
      if (spaceHeld) return false;
      if (e.metaKey || e.ctrlKey) return false;
      // We do NOT stopPropagation — viewport-controller listens on the host
      // ancestor and never claims a bare-left/no-space pointerdown anyway.
      e.preventDefault();
      setGhost(null); // a draw is starting — the ghost placeholder is done
      try {
        (e.target as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
          e.pointerId
        );
      } catch {
        /* some browsers reject capture on synthetic events */
      }
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      drawAnchorRef.current = { x: wx, y: wy };
      lastDrawPointRef.current = { x: wx, y: wy };
      if (isErase) {
        eraseAt(wx, wy);
        return true;
      }
      const id = rid();
      const width: number = supportsThickness ? thickness : STROKE_WIDTH_THIN;
      const activeFill = supportsFill ? fill : null;
      if (tool === 'pen') {
        setDrawing({ id, tool: 'pen', color, width, points: [[wx, wy]] });
      } else if (tool === 'highlighter') {
        // Highlighter (item 8) — a pen stroke with a wide width, a translucent
        // marker hue, and the highlighter flag (renders multiply at draw time).
        setDrawing({
          id,
          tool: 'pen',
          color: highlighterColor,
          width: highlighterWidth,
          points: [[wx, wy]],
          highlighter: true,
        });
      } else if (tool === 'shape') {
        // Phase 24 — the single Shape tool maps its kind onto a stroke type:
        // circle → ellipse; square/rounded → rect (cornerRadius 0 / 8);
        // diamond/triangle/triangle-down → polygon.
        if (shapeKind === 'circle') {
          setDrawing({
            id,
            tool: 'ellipse',
            color,
            width,
            cx: wx,
            cy: wy,
            rx: 0,
            ry: 0,
            fill: activeFill,
          });
        } else if (shapeKind === 'square' || shapeKind === 'rounded') {
          setDrawing({
            id,
            tool: 'rect',
            color,
            width,
            x: wx,
            y: wy,
            w: 0,
            h: 0,
            fill: activeFill,
            cornerRadius: shapeKind === 'rounded' ? 8 : 0,
          });
        } else {
          setDrawing({
            id,
            tool: 'polygon',
            shape: shapeKind,
            color,
            width,
            x: wx,
            y: wy,
            w: 0,
            h: 0,
            fill: activeFill,
          });
        }
      } else if (tool === 'arrow') {
        setDrawing({
          id,
          tool: 'arrow',
          color,
          width,
          x1: wx,
          y1: wy,
          x2: wx,
          y2: wy,
        });
      } else if (tool === 'sticky') {
        // Phase 21 — drag-create a paper card. Default size if the user just
        // taps (no drag) is applied in endStroke.
        // Phase 3 (whiteboard-improvements) — stamp who drew it from presence
        // identity (git user.name via useCollab, else its anonymous-* / no-op
        // fallback); collab is optional (test harnesses without a provider).
        setDrawing({
          id,
          tool: 'sticky',
          color: stickyColor,
          x: wx,
          y: wy,
          w: 0,
          h: 0,
          text: '',
          fontSize: DEFAULT_FONT_SIZE,
          cornerRadius: STICKY_CORNER_RADIUS,
          ...(collab?.myName ? { authorName: collab.myName, authorId: collab.myConnId } : null),
        });
      } else if (tool === 'section') {
        // FigJam v3 — drag-create a labelled container; a bare tap drops the
        // default-sized region (endStroke applies the default).
        setDrawing({
          id,
          tool: 'section',
          x: wx,
          y: wy,
          w: 0,
          h: 0,
          label: 'Section',
          color: DEFAULT_SECTION_COLOR,
        });
      } else if (tool === 'text') {
        // Dogfood fix + Phase 4 (unified-text-editing) — the Text tool
        // clicking EXISTING editable text edits it in place rather than
        // dropping a new standalone annotation on top of it. Precedence is
        // z-order: annotation strokes paint above artboard content, so the
        // geometric stroke hit-test (findTextStrokeAt — DOM hit-testing can't
        // see pointer-events:none stroke nodes while a tool is armed) runs
        // first; then artboard leaf-text (delegated to canvas-shell.tsx,
        // which owns the DOM/contentEditable side, via maude:enter-text-edit).
        const strokeId = findTextStrokeAt(wx, wy, strokesRef.current, vpRef.current?.zoom || 1);
        if (strokeId) {
          openEditorAt(strokeId, e.clientX, e.clientY);
          if (annotSel) annotSel.replace(strokeId);
          // DDR-223 — back to the MODE's resting tool (move in edit, browse in
          // preview): editing a text annotation shouldn't exit preview.
          resetTool();
          return true;
        }
        const editableTarget = findEditableElementAt(e.clientX, e.clientY);
        if (editableTarget) {
          // Phase 6 — leaf-looking text the engine would refuse (mixed /
          // expression source; no build-time data-cd-editable marker) gets an
          // honest hint, not a new annotation dropped on top of it.
          if (!editableTarget.hasAttribute('data-cd-editable')) {
            showCanvasToast(
              'This text is filled in from code (a variable) — edit it via chat or /design:edit.'
            );
            resetTool();
            return true;
          }
          document.dispatchEvent(
            new CustomEvent('maude:enter-text-edit', {
              detail: { el: editableTarget, clientX: e.clientX, clientY: e.clientY },
            })
          );
          // Deliberately `move`, not `resetTool` — editing ARTBOARD content is
          // an edit-mode activity, so this one flips to edit even from preview
          // (DDR-223 mode⇄tool sync).
          setTool('move');
          return true;
        }
        // Phase 21 — single click drops an editable caret at the click point.
        // No stroke is created until the user commits real text (mirrors the
        // anchored double-click flow), so an empty caret leaves nothing behind.
        setPendingText({ x: wx, y: wy });
        if (annotSel) annotSel.clear();
        const stickyOnText = sticky.locked && sticky.tool === 'text';
        if (!stickyOnText) resetTool();
        return true;
      }
      return true;
    },
    [
      tool,
      shapeKind,
      color,
      fill,
      thickness,
      stickyColor,
      highlighterColor,
      highlighterWidth,
      supportsThickness,
      supportsFill,
      isActive,
      isErase,
      visible,
      screenToWorld,
      eraseAt,
      annotSel,
      sticky,
      setTool,
      resetTool,
    ]
  );

  const moveStroke = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isActive || !visible) return;
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      cmdHeldRef.current = e.metaKey || e.ctrlKey;
      if (isErase) {
        if ((e.buttons & 1) === 0) return;
        eraseAt(wx, wy);
        return;
      }
      // Phase 24 — ghost placeholder. While nothing is being drawn, track the
      // cursor so a translucent preview can follow it; an active draw hides it.
      if (drawingRef.current == null) {
        if (ghostCapable) setGhost({ x: wx, y: wy });
        return;
      }
      setGhost(null);
      lastDrawPointRef.current = { x: wx, y: wy };
      const anchor = drawAnchorRef.current;
      const mods: DrawMods = { shift: e.shiftKey, alt: e.altKey };
      // FigJam v3 — while dragging an arrow, halo the host the dragged end
      // would magnetically attach to (⌘ suppresses binding entirely).
      if (drawingRef.current.tool === 'arrow') {
        const zoom = vpRef.current?.zoom || 1;
        const cand = cmdHeldRef.current
          ? null
          : bindCandidate(wx, wy, strokesRef.current, BIND_THRESHOLD_PX / zoom);
        setBindHintId(cand?.hostId ?? null);
      }
      setDrawing((cur) => {
        if (!cur) return cur;
        if (cur.tool === 'pen') {
          const last = cur.points[cur.points.length - 1] as WorldPoint | undefined;
          if (last && Math.hypot(wx - last[0], wy - last[1]) < 1) return cur;
          return { ...cur, points: [...cur.points, [wx, wy] as WorldPoint] };
        }
        // Phase 24 — Shift (1:1) / Alt (from-center) apply to every box + arrow
        // shape, mirroring the resize handles. The anchor is the pointer-down
        // point; without it (shouldn't happen mid-draw) fall back to no change.
        if (!anchor) return cur;
        return applyDrawModifiers(cur, anchor, wx, wy, mods);
      });
    },
    [isActive, isErase, visible, screenToWorld, eraseAt, ghostCapable]
  );

  const endStroke = useCallback(() => {
    if (!isActive || !visible) return;
    if (isErase) return;
    const cur = drawingRef.current;
    if (!cur) return;
    let final: Stroke | null = cur;
    // Phase 24 — a bare tap (both axes below the drag threshold) drops a
    // default-sized shape at the tap point so "click to place" works like
    // FigJam; a real drag sizes it. A thin/degenerate drag still gets discarded
    // by isStrokeMeaningful below.
    const isTap = (w: number, h: number) => Math.abs(w) < 4 && Math.abs(h) < 4;
    if (cur.tool === 'rect') {
      const norm = normalizeRect(cur);
      final = isTap(norm.w, norm.h)
        ? { ...norm, x: cur.x, y: cur.y, w: SHAPE_DEFAULT_SIZE, h: SHAPE_DEFAULT_SIZE }
        : norm;
    } else if (cur.tool === 'polygon') {
      const norm = normalizeBox(cur);
      final = isTap(norm.w, norm.h)
        ? { ...norm, x: cur.x, y: cur.y, w: SHAPE_DEFAULT_SIZE, h: SHAPE_DEFAULT_SIZE }
        : norm;
    } else if (cur.tool === 'ellipse') {
      final =
        cur.rx < 2 && cur.ry < 2
          ? { ...cur, rx: SHAPE_DEFAULT_SIZE / 2, ry: SHAPE_DEFAULT_SIZE / 2 }
          : cur;
    } else if (cur.tool === 'sticky') {
      const norm = normalizeSticky(cur);
      // A bare tap (or a drag too small to be a usable card) drops a
      // default-sized note at the tap point — FigJam parity.
      final =
        Math.abs(norm.w) < STICKY_MIN_SIZE || Math.abs(norm.h) < STICKY_MIN_SIZE
          ? { ...norm, w: STICKY_DEFAULT_W, h: STICKY_DEFAULT_H }
          : norm;
    } else if (cur.tool === 'section') {
      const norm = normalizeBox(cur);
      final =
        Math.abs(norm.w) < SECTION_MIN_SIZE || Math.abs(norm.h) < SECTION_MIN_SIZE
          ? { ...norm, w: SECTION_DEFAULT_W, h: SECTION_DEFAULT_H }
          : norm;
    }
    if (final && !isStrokeMeaningful(final)) final = null;
    // FigJam v3 — magnetic connector binding at draw-end. Each arrow endpoint
    // within the zoom-scaled threshold of a bindable host attaches to its
    // nearest side/center magnet and snaps onto it; the bind persists and the
    // endpoint re-derives from the host from then on. ⌘ held = stay free.
    if (final && final.tool === 'arrow' && !cmdHeldRef.current) {
      const zoom = vpRef.current?.zoom || 1;
      const threshold = BIND_THRESHOLD_PX / zoom;
      const others = strokesRef.current;
      const sb = bindCandidate(final.x1, final.y1, others, threshold);
      const eb = bindCandidate(final.x2, final.y2, others, threshold);
      if (sb) {
        const host = others.find((s) => s.id === sb.hostId);
        const pt = host ? anchorPoint(host, sb.nx, sb.ny) : null;
        if (pt) final = { ...final, startBind: sb, x1: pt[0], y1: pt[1] };
      }
      // A zero-length self-loop (both ends on the same magnet) is useless —
      // keep the end free when it would collapse onto the start bind.
      const sameMagnet = sb && eb && sb.hostId === eb.hostId && sb.nx === eb.nx && sb.ny === eb.ny;
      if (eb && !sameMagnet) {
        const host = others.find((s) => s.id === eb.hostId);
        const pt = host ? anchorPoint(host, eb.nx, eb.ny) : null;
        if (pt) final = { ...final, endBind: eb, x2: pt[0], y2: pt[1] };
      }
      if ((final as ArrowStroke).startBind || (final as ArrowStroke).endBind) {
        showOnceHint(
          'bind',
          'Arrow attached — it follows the shape now. Drag an endpoint to re-anchor, hold ⌘ to keep it free.'
        );
      }
    }
    setBindHintId(null);
    if (final) {
      const committed = final;
      const prev = strokesRef.current;
      // FigJam — sections are CONTAINERS: they slot in at the BACK of the
      // z-order so content placed on them keeps rendering above — and a
      // section drawn INSIDE another goes right above that one (Task 20), so
      // it renders in front of its outer section and adopts what sits on it.
      let next: Stroke[];
      if (committed.tool === 'section') {
        const bb = strokeBBox(committed);
        const outer = bb
          ? new Containment(strokesToElementMap(prev, board.committed).values()).containerAt(
              bb.x + bb.w / 2,
              bb.y + bb.h / 2
            )
          : null;
        next = insertSection(prev, committed, outer);
      } else {
        next = [...prev, committed];
      }
      commitStrokes(prev, next, `draw ${committed.tool}`);
      // T18 — auto-select the freshly drawn shape so the user can immediately
      // see + adjust it. annotSel is optional (some test harnesses mount
      // AnnotationsLayer without the provider), so guard the call.
      if (annotSel) annotSel.replace(committed.id);
      // Phase 21 — a fresh sticky opens in edit mode (FigJam parity: drop a
      // note, type immediately). Phase 1 whiteboard-improvements — shapes get
      // the same treatment (rect/ellipse/polygon are all AnchorHost, so
      // setEditingId resolves them via editingTarget's 'anchored' branch same
      // as a double-click would).
      if (
        committed.tool === 'sticky' ||
        committed.tool === 'rect' ||
        committed.tool === 'ellipse' ||
        committed.tool === 'polygon'
      ) {
        setEditingId(committed.id);
        showOnceHint('chain', '⌘Enter commits and creates the next one beside it.');
      }
    }
    // T18 / T19 — flip the tool back to the MODE's resting tool after every
    // commit UNLESS sticky mode is locked on this tool (DDR-223: move in edit
    // — byte-identical to the old hardcode — browse in preview, so drawing an
    // annotation never silently exits the alive posture). Sticky lets the user
    // draw many shapes in a row (canonical pattern: tldraw double-click to
    // lock). Map a highlighter pen (a 'pen' stroke with the flag) back to the
    // 'highlighter' tool id so its sticky-lock check matches the active tool.
    //
    // No eraser case here: an eraser commits no stroke, so `cur.tool` (a stroke
    // KIND, off `drawingRef`) can never be 'eraser' — erase leaves through the
    // `isErase` branch above. It stays armed by being unreachable from here,
    // not by a guard. The typecheck surface completion (A2) proved the old
    // `!== 'eraser'` test was dead.
    const toolJustUsed = cur.tool === 'pen' && cur.highlighter ? 'highlighter' : cur.tool;
    const stickyOnThis = sticky.locked && sticky.tool === toolJustUsed;
    if (!stickyOnThis) resetTool();
    drawAnchorRef.current = null;
    lastDrawPointRef.current = null;
    setDrawing(null);
  }, [isActive, isErase, visible, commitStrokes, annotSel, resetTool, sticky]);

  // T21 — abort a mid-stroke draw without committing. Dispatched by the
  // canvas-shell Esc handler (`maude:cancel-stroke`). Safe to call when
  // nothing is being drawn — the early-return on drawingRef keeps it
  // a no-op.
  const cancelStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawAnchorRef.current = null;
    lastDrawPointRef.current = null;
    setDrawing(null);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onCancel = () => cancelStroke();
    document.addEventListener('maude:cancel-stroke', onCancel);
    return () => document.removeEventListener('maude:cancel-stroke', onCancel);
  }, [cancelStroke]);

  // Phase 24 — holding/releasing Shift or Alt mid-draw re-constrains the draft
  // at the last cursor position (FigJam: the modifier engages while held, no
  // pointer-move needed). Pen / text carry no box, so they're skipped.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const cur = drawingRef.current;
      const anchor = drawAnchorRef.current;
      const p = lastDrawPointRef.current;
      if (!cur || !anchor || !p) return;
      if (e.key !== 'Shift' && e.key !== 'Alt') return;
      if (cur.tool === 'pen' || cur.tool === 'text') return;
      e.preventDefault();
      const mods: DrawMods = { shift: e.shiftKey, alt: e.altKey };
      setDrawing((c) => (c ? applyDrawModifiers(c, anchor, p.x, p.y, mods) : c));
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKey, true);
    };
  }, []);

  const renderStrokes = useMemo(
    () => (drawing ? [...strokes, drawing] : strokes),
    [strokes, drawing]
  );
  // Task 22 — what is being drawn, live for peers (pen ink tail, or the box).
  const drawPublishedRef = useRef(false);
  useEffect(() => {
    if (!drawing) {
      if (drawPublishedRef.current) publishGesture(null);
      drawPublishedRef.current = false;
      return;
    }
    drawPublishedRef.current = true;
    if (drawing.tool === 'pen') {
      publishGesture({ kind: 'draw', ids: [], points: drawing.points.slice(-256).flat() });
      return;
    }
    const box = strokeBBox(drawing);
    if (box) publishGesture({ kind: 'draw', ids: [], box });
  }, [drawing, publishGesture]);
  // A newer peer's element types: v1 strokes can't hold them, the board still
  // does — they are drawn as placeholders (DDR-242: never dropped).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read per board version
  const unknownElements = useMemo(
    () => [...board.elements.values()].filter((e) => !defOf(e.type)),
    [board, boardVersion]
  );

  // Phase 24 — the ghost descriptor handed to the SVG layer. Suppressed while a
  // draw is in progress (the real preview takes over) so the two never overlap.
  const ghostPreview = useMemo<GhostDescriptor | null>(() => {
    if (!ghost || !ghostCapable || drawing) return null;
    if (tool === 'text') return { kind: 'text', x: ghost.x, y: ghost.y, color };
    if (tool === 'sticky') return { kind: 'sticky', x: ghost.x, y: ghost.y, color: stickyColor };
    return { kind: 'shape', x: ghost.x, y: ghost.y, shapeKind, color };
  }, [ghost, ghostCapable, drawing, tool, shapeKind, color, stickyColor]);

  const anchorsById = useMemo(() => {
    const map = new Map<string, AnchorHost>();
    for (const s of strokes) {
      if (s.tool === 'rect' || s.tool === 'ellipse' || s.tool === 'polygon') map.set(s.id, s);
    }
    return map;
  }, [strokes]);

  // Task 19 — an element that vanished (a collaborator deleted it, an undo
  // removed it) leaves the selection, unless its editor is still open. Only
  // ids that WERE on the board go: a just-created element selected before its
  // stroke lands must stay selected.
  const prevStrokeIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = new Set(strokes.map((s) => s.id));
    const before = prevStrokeIdsRef.current;
    prevStrokeIdsRef.current = now;
    if (!annotSel || annotSel.selectedIds.length === 0) return;
    const gone = annotSel.selectedIds.filter(
      (id) => before.has(id) && !now.has(id) && id !== editingIdRef.current
    );
    if (gone.length) annotSel.remove(gone);
  }, [strokes, annotSel]);

  const strokesById = useMemo(() => {
    const map = new Map<string, Stroke>();
    for (const s of strokes) map.set(s.id, s);
    return map;
  }, [strokes]);

  // ──────────────────────────────────────────────────────────────────────────
  // Move-tool selection + drag (Phase 5.1 Tasks 6 + 7). Single doc-level
  // capture pointerdown listener:
  //   - target is a stroke → select (replace, or add with Shift)
  //   - bare click on empty world → clear annotation selection
  //   - Cmd / Cmd+Shift falls through to element-selection (we bail).
  // Once a stroke is selected, clicking inside its bbox starts a drag.

  /**
   * Annotation drag state. Snapshot of strokes captured at pointerdown so the
   * whole gesture (pointermove × N → pointerup) commits as ONE undo record at
   * release time. Without the snapshot, each pointermove tick became its own
   * `translateStrokes` call and each call became its own undo record — Cmd+Z
   * had to be pressed dozens of times to walk back a single drag.
   */
  const dragStateRef = useRef<{
    pointerId: number;
    startWX: number;
    startWY: number;
    movedIds: string[];
    snapshot: Stroke[];
    /** FigJam v3 — pre-Alt-duplicate baseline. Differs from `snapshot` only
     *  during an Alt+drag duplicate; the undo record spans undoBase → final
     *  so clone + move land as ONE step. */
    undoBase: Stroke[];
    altDup: boolean;
  } | null>(null);

  // Phase 2 (whiteboard-improvements) — proportional group resize drag state.
  // See the gesture effect below (registered after strokesStoreRef).
  const groupResizeRef = useRef<{
    pointerId: number;
    corner: Corner;
    /** The selection's own union bbox at drag start — unpadded (AnnotGroupBbox
     *  renders it with a screen-constant pad; the resize math works in the raw
     *  content bbox, same convention single-resize's padDX/padDY correct for). */
    groupB0: { x: number; y: number; w: number; h: number };
    ids: string[];
    /** Full-strokes undo baseline (the drag-start snapshot). */
    undoBase: Stroke[];
  } | null>(null);

  // Drag-select marquee state. World-coord rectangle (anchor + cursor); the
  // cursor end animates with pointermove. `null` = no marquee active.
  const [marquee, setMarquee] = useState<{
    ax: number;
    ay: number;
    bx: number;
    by: number;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: commitStrokes/strokesStore are stable refs from parent context; manual dep list reflects effect-trigger semantics, not internal callbacks
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    if (!annotSel) return;

    const findStrokeId = (el: Element | null): string | null => {
      const node = el?.closest?.('[data-id][data-tool]') ?? null;
      const id = node?.getAttribute('data-id') ?? null;
      const t = node?.getAttribute('data-tool') ?? null;
      if (
        id &&
        t &&
        (t === 'pen' ||
          t === 'rect' ||
          t === 'ellipse' ||
          t === 'polygon' ||
          t === 'arrow' ||
          t === 'text' ||
          t === 'sticky' ||
          t === 'image' ||
          t === 'link' ||
          t === 'mediaref' ||
          t === 'section')
      ) {
        return id;
      }
      return null;
    };

    const onDown = (e: PointerEvent): Claim => {
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) return; // escape hatch into element-selection
      const target = e.target as Element | null;
      const strokeId = findStrokeId(target);
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      const startClientX = e.clientX;
      const startClientY = e.clientY;

      // Stroke hit OR multi-selection hull hit — start a group drag. Clicking a
      // selected stroke, OR anywhere inside the current selection's bounding box
      // (FigJam parity), moves the whole group. Without the hull case, grabbing
      // the empty space BETWEEN selected strokes fell through to the marquee
      // branch below and DESELECTED them.
      let ids: string[] | null = null;
      if (strokeId) {
        // feature-photo-editor — an image-stroke hit routes to the Photo-only
        // Inspector tab (`edit-annotation-photo-request`, the singleSelectedImageId
        // effect below), which the shell shows via `photoSel` taking priority over
        // the DOM `selected` channel. `elementSel.clear()` posts a DEBOUNCED
        // (50ms, use-selection-set.tsx POST_DEBOUNCE_MS) `select-set: null` — that
        // lands AFTER the (undebounced) photo-request and the shell's `select-set`
        // handler unconditionally nulls `photoSel` back out, so the Photo tab
        // flickers open then goes blank. Skip the clear for an image stroke: it
        // isn't needed (photoSel already takes precedence in tab resolution) and
        // is the only case that races with a still-in-flight photo-tab request.
        const strokeTool = target?.closest?.('[data-id][data-tool]')?.getAttribute('data-tool');
        if (strokeTool !== 'image') elementSel?.clear();
        // FigJam v3 — clicking a group member acts on the WHOLE outermost
        // group. Double-click deep-selects the member (see the dblclick
        // handler); an already-selected stroke keeps the current selection, so
        // a deep-selected member drags alone without re-expanding.
        const members = expandIdsToGroups([strokeId], strokesStoreRef.current.strokes);
        if (e.shiftKey && members.every((m) => annotSel.contains(m))) {
          // Shift-click on something already selected takes it OUT of the
          // selection (FigJam / Figma toggle) and starts no drag.
          e.preventDefault();
          e.stopImmediatePropagation();
          annotSel.remove(members);
          return;
        }
        if (e.shiftKey) {
          annotSel.add(members);
          const merged = new Set([...annotSel.selectedIds, ...members]);
          ids = [...merged];
        } else if (annotSel.contains(strokeId)) {
          ids = annotSel.selectedIds;
        } else {
          annotSel.replace(members);
          ids = members;
        }
      } else if (!e.shiftKey && annotSel.selectedIds.length > 0) {
        // Hull hit-test — union bbox of the currently-selected strokes.
        let hx1 = Infinity;
        let hy1 = Infinity;
        let hx2 = -Infinity;
        let hy2 = -Infinity;
        for (const s of strokesStoreRef.current.strokes) {
          if (!annotSel.contains(s.id)) continue;
          const bb = strokeBBox(s);
          if (!bb) continue;
          hx1 = Math.min(hx1, bb.x);
          hy1 = Math.min(hy1, bb.y);
          hx2 = Math.max(hx2, bb.x + bb.w);
          hy2 = Math.max(hy2, bb.y + bb.h);
        }
        if (hx2 >= hx1 && wx >= hx1 && wx <= hx2 && wy >= hy1 && wy <= hy2) {
          ids = annotSel.selectedIds;
        }
      }
      if (ids?.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        // preventDefault also stops the press from moving focus — so after the
        // toolbar (its focused button then unmounted: focus on <body>) Esc,
        // arrows and ⌘-shortcuts never reached the canvas. A press on the
        // board gives the canvas its keyboard back, as a plain click would.
        const canvasEl = target?.closest?.('.dc-canvas') as HTMLElement | null;
        const focused = document.activeElement as HTMLElement | null;
        if (
          canvasEl &&
          (!focused ||
            !canvasEl.contains(focused) ||
            focused.closest?.('.dc-annot-ctx, .dc-context-menu, .dc-annot-chrome'))
        ) {
          canvasEl.focus({ preventScroll: true });
        }
        // Capture a snapshot of all strokes at drag start. Every pointermove
        // re-translates FROM the snapshot using the cumulative cursor delta
        // (NOT a delta-from-last-frame mutation), so dragging back to origin
        // restores positions exactly. Optimistic state-only updates during
        // the move; ONE undo record + ONE server PUT fires on pointerup.
        const undoBase = strokesRef.current.slice();
        const preAltIds = ids;
        let dragSnapshot = undoBase;
        let altDup = false;
        // FigJam v3 — Alt+drag duplicates: clone the (expanded) selection up
        // front and drag the CLONES; a zero-movement release reverts so a bare
        // Alt+click can't silently mint copies. undoBase stays pre-clone, so
        // clone + move commit as one record.
        if (e.altKey) {
          // The section's contents are cloned with it and only the CLONES move.
          const subtree = expandForOp(
            ids,
            (x) => expandIdsToGroups(x, undoBase),
            new Containment(strokesToElementMap(undoBase, board.committed).values())
          );
          const res = duplicateStrokes(undoBase, subtree, 0, 0);
          if (res.newIds.length) {
            altDup = true;
            dragSnapshot = res.strokes;
            setPreview(res.strokes);
            // Select the copies of what was selected; drag EVERY clone — the
            // copied contents move with the copied section by id, not by
            // geometry (the copy lies exactly on its original).
            annotSel.replace(cloneRoots(ids, res));
            ids = res.newIds;
          }
        }
        dragStateRef.current = {
          pointerId: e.pointerId,
          startWX: wx,
          startWY: wy,
          movedIds: ids,
          snapshot: dragSnapshot,
          undoBase,
          altDup,
        };
        const movedSet = new Set(ids);
        // A section carries its whole subtree — nested sections and their
        // contents too (explicit containment, Task 20), captured at start.
        if (dragSnapshot.some((x) => x.tool === 'section' && movedSet.has(x.id))) {
          const c = new Containment(
            strokesToElementMap(
              dragSnapshot.filter((x) => !isEphemeralHref(x)),
              board.committed
            ).values()
          );
          for (const id of c.withContents([...movedSet])) movedSet.add(id);
        }
        // FigJam v3 — snap setup, computed ONCE per gesture: candidates are
        // the bboxes of every non-moved stroke plus the artboard rects (in
        // world coords); the moving hull is the union bbox of the dragged
        // strokes at drag start.
        const candidates: Array<{ x: number; y: number; w: number; h: number }> = [];
        for (const s of dragSnapshot) {
          if (movedSet.has(s.id)) continue;
          const bb = strokeBBox(s);
          if (bb && bb.w > 0 && bb.h > 0) candidates.push(bb);
        }
        for (const screenEl of Array.from(document.querySelectorAll('[data-dc-screen]'))) {
          const r = screenEl.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const [ax, ay] = screenToWorld(r.left, r.top);
          const [bx, by] = screenToWorld(r.right, r.bottom);
          candidates.push({ x: ax, y: ay, w: bx - ax, h: by - ay });
        }
        let hull: { x: number; y: number; w: number; h: number } | null = null;
        for (const s of dragSnapshot) {
          if (!movedSet.has(s.id)) continue;
          const bb = strokeBBox(s);
          if (!bb) continue;
          if (!hull) {
            hull = { ...bb };
          } else {
            const hx = Math.min(hull.x, bb.x);
            const hy = Math.min(hull.y, bb.y);
            hull = {
              x: hx,
              y: hy,
              w: Math.max(hull.x + hull.w, bb.x + bb.w) - hx,
              h: Math.max(hull.y + hull.h, bb.y + bb.h) - hy,
            };
          }
        }
        const zoom = vpRef.current?.zoom || 1;
        const onMove = (mv: PointerEvent) => {
          const st = dragStateRef.current;
          if (!st || mv.pointerId !== st.pointerId) return;
          const [cwx, cwy] = screenToWorld(mv.clientX, mv.clientY);
          let dx = cwx - st.startWX;
          let dy = cwy - st.startWY;
          // FigJam v3 — edge/center snapping; ⌘ suppresses (Figma convention).
          // Axes with no smart-guide match fall back to the 24px dot grid
          // (GRID_PITCH_PX = the DS --canvas-grid pitch).
          if (hull && !(mv.metaKey || mv.ctrlKey)) {
            const snap = computeSnap(
              { x: hull.x + dx, y: hull.y + dy, w: hull.w, h: hull.h },
              candidates,
              SNAP_THRESHOLD_PX / zoom,
              { grid: GRID_PITCH_PX }
            );
            dx += snap.dx;
            dy += snap.dy;
            setSnapGuides(snap.guides.length ? snap.guides : null);
          } else {
            setSnapGuides(null);
          }
          // Drag-back-to-origin: restore exact references so the pointerup
          // shallow-equality check skips committing a no-op record. Bound
          // arrows re-derive from their hosts so connectors track live.
          const next =
            dx === 0 && dy === 0
              ? st.snapshot
              : recomputeBoundArrows(
                  st.snapshot.map((s) => (movedSet.has(s.id) ? translateOne(s, dx, dy) : s))
                );
          // Local React state only. No commitStrokes — no PUT, no undo push.
          setPreview(next);
          publishGesture({ kind: 'move', ids: [...movedSet].slice(0, 256), dx, dy });
        };
        const onUp = (up: PointerEvent) => {
          const st = dragStateRef.current;
          if (!st || up.pointerId !== st.pointerId) return;
          dragStateRef.current = null;
          setSnapGuides(null);
          publishGesture(null);
          // Commit the gesture as ONE record. Skip on zero-movement
          // (click without drag past threshold or drag back to origin).
          const final = strokesRef.current;
          if (strokesShallowEqual(st.snapshot, final)) {
            // Nothing moved (an Alt+click also drops its eager clones).
            setPreview(null);
            if (st.altDup) annotSel.replace(preAltIds);
            return;
          }
          commitStrokes(
            st.undoBase,
            final,
            `${st.altDup ? 'duplicate' : 'move'} ${st.movedIds.length} stroke${
              st.movedIds.length === 1 ? '' : 's'
            }`
          );
        };
        return {
          kind: altDup ? 'duplicating' : 'dragging',
          move: onMove,
          up: onUp,
          cancel: (ev) => onUp(ev ?? ({ pointerId: e.pointerId } as PointerEvent)),
        };
      }

      // Not a stroke / hull-group drag. When pointerdown lands inside an
      // artboard the gesture belongs to artboard-drag / element-marquee — not
      // the annotation marquee (post-Wave-3 grievance G5). Checked AFTER the
      // group-drag decision so a multi-selection hull-drag still wins even when
      // the strokes sit over an artboard. FigJam v3 exception: SHIFT+drag is
      // the additive annotation marquee, so it rubber-bands annotations
      // sitting ON an artboard instead of falling through to artboard-drag.
      if (!strokeId && !e.shiftKey && target?.closest?.('[data-dc-screen]')) return;

      // Empty world — start a drag-select gesture. A bare click without
      // moving clears annotation selection (post-Wave-3 feedback: click-to-
      // deselect is back; Esc also still works).
      const addToSelection = e.shiftKey;
      let moved = false;
      const onMove = (mv: PointerEvent) => {
        if (!moved && !crossedDragThreshold(startClientX, startClientY, mv.clientX, mv.clientY)) {
          return;
        }
        moved = true;
        const [cwx, cwy] = screenToWorld(mv.clientX, mv.clientY);
        setMarquee({ ax: wx, ay: wy, bx: cwx, by: cwy });
      };
      const onUp = () => {
        if (!moved) {
          // Click without movement on empty world → clear annotation
          // selection (post-Wave-3 user feedback). Shift-click preserves
          // existing selection for additive-mode workflows.
          if (!addToSelection) annotSel.clear();
          return;
        }
        const final = marqueeRef.current;
        setMarquee(null);
        if (!final) return;
        // Anchored text rides its host (selected with it); a section is taken
        // only when the marquee encloses it (containment.ts marqueeHits).
        const items: MarqueeItem[] = [];
        for (const s of strokesStoreRef.current.strokes) {
          if (s.tool === 'text' && s.anchorId != null && s.anchorId !== '') continue;
          const bb = strokeBBox(s);
          if (bb) items.push({ id: s.id, box: bb, container: s.tool === 'section' });
        }
        const hits = marqueeHits(items, { x1: final.ax, y1: final.ay, x2: final.bx, y2: final.by });
        // Marquee that captured no strokes — preserve existing selection.
        if (hits.length === 0) return;
        // FigJam v3 — a marquee touching any group member selects the whole
        // group (tldraw: the brush resolves to the outermost ancestor).
        const expanded = expandIdsToGroups(hits, strokesStoreRef.current.strokes);
        if (addToSelection) annotSel.add(expanded);
        else annotSel.replace(expanded);
      };
      return { kind: 'marquee', move: onMove, up: onUp, cancel: onUp };
    };

    return pipeline.add({ priority: 100, name: 'select', down: onDown });
    // commitStrokes is included defensively (it is a stable useCallback([]) ref,
    // so this never re-registers the stage) to remove the latent stale-closure
    // trap flagged in the Phase 24 frontend review.
  }, [pipeline, tool, annotSel, elementSel, screenToWorld, strokesStore, commitStrokes]);

  // Latest marquee + strokes refs for the doc-level pointerup callback
  // (avoids re-binding the listener on every state tick).
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  const strokesStoreRef = useRef(strokesStore);
  strokesStoreRef.current = strokesStore;

  // Phase 2 (whiteboard-improvements) — proportional group resize. A grabbed
  // corner (AnnotGroupBbox's `[data-group-resize-corner]` handles) scales the
  // SELECTION's own outer bbox via bboxResize — the exact single-shape corner-
  // anchor / Shift-aspect-lock / Alt-center-scale math, applied here to the
  // group's union bbox instead of one stroke's — then propagates that affine
  // transform to every selected stroke via scaleStrokeInGroup. One local
  // preview per pointermove, one commitStrokes on pointerup: mirrors the
  // hull-drag gesture above. Registering pointermove/up unconditionally
  // (no-op via the groupResizeRef null-check) rather than adding them inside
  // onDown matches AnnotationResizeOverlay's own pattern in
  // use-annotation-resize.tsx.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    if (!annotSel) return;

    const onDown = (e: PointerEvent): Claim => {
      const target = e.target as Element | null;
      const cornerEl = target?.closest?.('[data-group-resize-corner]') ?? null;
      if (!cornerEl) return;
      const corner = cornerEl.getAttribute('data-group-resize-corner') as Corner | null;
      if (!corner) return;
      const ids = annotSel.selectedIds;
      if (ids.length < 2) return;
      const idSet = new Set(ids);
      const strokesNow = strokesStoreRef.current.strokes;
      let xMin = Number.POSITIVE_INFINITY;
      let yMin = Number.POSITIVE_INFINITY;
      let xMax = Number.NEGATIVE_INFINITY;
      let yMax = Number.NEGATIVE_INFINITY;
      let any = false;
      for (const s of strokesNow) {
        if (!idSet.has(s.id)) continue;
        const b = strokeBBox(s, anchorsById);
        if (!b) continue;
        any = true;
        if (b.x < xMin) xMin = b.x;
        if (b.y < yMin) yMin = b.y;
        if (b.x + b.w > xMax) xMax = b.x + b.w;
        if (b.y + b.h > yMax) yMax = b.y + b.h;
      }
      if (!any) return;
      e.preventDefault();
      e.stopPropagation();
      groupResizeRef.current = {
        pointerId: e.pointerId,
        corner,
        groupB0: { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin },
        ids,
        undoBase: strokesNow,
      };
      try {
        (cornerEl as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
          e.pointerId
        );
      } catch {
        /* some browsers reject capture on synthetic events */
      }
      return {
        kind: 'resizing',
        move: onMove,
        up: onUp,
        cancel: (ev) => onUp(ev ?? ({ pointerId: e.pointerId } as PointerEvent)),
      };
    };
    const onMove = (e: PointerEvent) => {
      const d = groupResizeRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const [wxRaw, wyRaw] = screenToWorld(e.clientX, e.clientY);
      const zoom = vpRef.current?.zoom || 1;
      // Handles render padded OFF the group bbox (screen-constant, same as
      // AnnotGroupBbox's `pad`) — shift the cursor back onto the true corner
      // so the first move doesn't jump-grow by the pad amount (mirrors
      // single-resize applyResize's padDX/padDY correction).
      const padWorld = HALO_PAD_PX / zoom;
      const wx = wxRaw + padDX(d.corner) * padWorld;
      const wy = wyRaw + padDY(d.corner) * padWorld;
      const mods: ResizeMods = { shift: e.shiftKey, alt: e.altKey };
      const groupB1 = bboxResize(d.groupB0, d.corner, wx, wy, mods, false);
      const idSet = new Set(d.ids);
      // Local React state only — no commitStrokes, no PUT, matching the
      // hull-drag / single-resize preview convention (one undo record lands
      // on pointerup, not one per pixel moved).
      const next = recomputeBoundArrows(
        d.undoBase.map((s) => {
          if (!idSet.has(s.id)) return s;
          const patch = scaleStrokeInGroup(s, d.groupB0, groupB1);
          return patch ? ({ ...s, ...patch } as Stroke) : s;
        })
      );
      setPreview(next);
      publishGesture({ kind: 'resize', ids: d.ids.slice(0, 256), box: groupB1 });
    };
    const onUp = (e: PointerEvent) => {
      const d = groupResizeRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      groupResizeRef.current = null;
      publishGesture(null);
      const final = strokesRef.current;
      // No-op drag (grabbed a handle, released without moving past the
      // resize's own resolution) skips the undo record.
      if (strokesShallowEqual(d.undoBase, final)) {
        setPreview(null);
        return;
      }
      commitStrokes(d.undoBase, final, `resize ${d.ids.length} strokes`);
    };
    return pipeline.add({ priority: 3, name: 'group-resize', down: onDown });
  }, [pipeline, tool, annotSel, screenToWorld, anchorsById, commitStrokes]);

  // Double-click enters text-edit mode: rect/ellipse (anchored text), sticky
  // (its own body), or a standalone text node (re-edit in place). Anchored text
  // nodes are edited via their host, so a data-anchor-id text node is skipped.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    const onDbl = (e: MouseEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      const target = e.target as Element | null;
      // Inside an open editor a double-click selects a word (native).
      if (target?.closest?.('[data-annot-editor]')) return;
      let node = target?.closest?.('[data-id][data-tool]');
      if (!node) return;
      // A shape's label is its own <text data-anchor-id=host>: a double-click
      // on the words of a label edits the SHAPE. It used to be skipped here,
      // so the event fell through to the canvas-shell dblclick→fit() handler
      // and the view jumped to "fit all" instead of opening the editor.
      const hostId =
        node.getAttribute('data-tool') === 'text' ? node.getAttribute('data-anchor-id') : null;
      if (hostId) {
        const host = node.ownerDocument?.querySelector?.(
          `[data-id="${CSS.escape(hostId)}"][data-tool]`
        );
        if (host) node = host;
      }
      const id = node.getAttribute('data-id');
      const t = node.getAttribute('data-tool');
      if (!id) return;
      // FigJam v3 — double-click DEEP-SELECTS a group member (a single click
      // selects the whole outermost group; Esc clears back out). The editor
      // still opens below for text-bearing types — FigJam's enter-group-then-
      // edit flow in one gesture.
      const stroke = strokesRef.current.find((s) => s.id === id);
      if (stroke && outermostGroupOf(stroke) && annotSel) {
        e.preventDefault();
        e.stopPropagation();
        annotSel.replace(id);
      }
      if (t === 'rect' || t === 'ellipse' || t === 'polygon' || t === 'sticky' || t === 'section') {
        // A double-click we've claimed for editing must not also reach the
        // canvas-shell dblclick-empty→fit() handler (bubble phase, below us) —
        // without this it fired right after, so renaming a section or editing
        // a shape's text jumped the viewport to fit().
        e.preventDefault();
        e.stopPropagation();
        openEditorAt(id, e.clientX, e.clientY);
        return;
      }
      if (t === 'text' && !node.getAttribute('data-anchor-id')) {
        e.preventDefault();
        e.stopPropagation();
        openEditorAt(id, e.clientX, e.clientY);
      }
    };
    document.addEventListener('dblclick', onDbl, true);
    return () => document.removeEventListener('dblclick', onDbl, true);
  }, [tool, annotSel]);

  const commitText = useCallback(
    (anchorId: string, text: string, fmt?: EditorFmt) => {
      const trimmed = text.trim();
      const prev = strokesRef.current;
      const existing = prev.find((s) => s.tool === 'text' && s.anchorId === anchorId) as
        | TextStroke
        | undefined;
      let next: Stroke[];
      let label = 'edit text';
      if (trimmed.length === 0) {
        if (!existing) return; // nothing to do
        next = prev.filter((s) => s.id !== existing.id);
        label = 'delete text';
      } else if (existing) {
        if (existing.text === trimmed && fmtEqual(existing, fmt)) return; // identity edit
        next = prev.map((s) =>
          s.id === existing.id ? { ...existing, text: trimmed, ...normFmt(fmt) } : s
        );
      } else {
        next = [
          ...prev,
          {
            id: rid(),
            tool: 'text',
            color: '#1a1a1a',
            fontSize: DEFAULT_FONT_SIZE,
            text: trimmed,
            anchorId,
            ...normFmt(fmt),
          } as TextStroke,
        ];
        label = 'add text';
      }
      commitStrokes(prev, next, label);
    },
    [commitStrokes]
  );

  // Phase 21 — sticky body edit. Sticky text is freeform (newlines preserved,
  // no trim) and the card persists even when blank, so this only updates text.
  const commitStickyText = useCallback(
    (id: string, text: string, fmt?: EditorFmt, measuredH?: number) => {
      const prev = strokesRef.current;
      const existing = prev.find((s) => s.id === id && s.tool === 'sticky') as
        | StickyStroke
        | undefined;
      if (!existing) return;
      // issue-106 — grow the card to whatever the editor actually rendered, so
      // the lines the user just typed survive the return to the clipped read
      // view. Null when the text already fits (the common case).
      // The growth rides along with a real edit — it is NOT itself a reason to
      // write. Otherwise opening a peer's already-overflowing note and clicking
      // away, having typed nothing, would produce an undo entry, a
      // full-document PUT and a sync broadcast.
      if (existing.text === text && fmtEqual(existing, fmt)) return;
      const grown = measuredH == null ? null : grownStickyBox(existing, measuredH);
      const next = prev.map((s) =>
        s.id === id ? { ...existing, text, ...normFmt(fmt), ...(grown ?? {}) } : s
      );
      commitStrokes(prev, next, 'edit sticky');
    },
    [commitStrokes]
  );

  // Phase 21 — re-edit an EXISTING standalone text node. Empty text deletes it
  // (same rule as anchored text).
  const commitStandaloneText = useCallback(
    (id: string, text: string, fmt?: EditorFmt) => {
      const trimmed = text.trim();
      const prev = strokesRef.current;
      const existing = prev.find((s) => s.id === id && s.tool === 'text') as TextStroke | undefined;
      if (!existing) return;
      if (trimmed.length === 0) {
        commitStrokes(
          prev,
          prev.filter((s) => s.id !== id),
          'delete text'
        );
        return;
      }
      if (existing.text === trimmed && fmtEqual(existing, fmt)) return;
      commitStrokes(
        prev,
        prev.map((s) => (s.id === id ? { ...existing, text: trimmed, ...normFmt(fmt) } : s)),
        'edit text'
      );
    },
    [commitStrokes]
  );

  // Phase 21 — born-on-commit standalone text (from the text-tool caret). An
  // empty caret persists nothing — ONE undo record only when real text lands.
  const createStandaloneText = useCallback(
    (x: number, y: number, text: string, fmt?: EditorFmt) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;
      const prev = strokesRef.current;
      const id = rid();
      const next: Stroke[] = [
        ...prev,
        {
          id,
          tool: 'text',
          color,
          fontSize: DEFAULT_FONT_SIZE,
          text: trimmed,
          x,
          y,
          ...normFmt(fmt),
        },
      ];
      commitStrokes(prev, next, 'add text');
      if (annotSel) annotSel.replace(id);
    },
    [commitStrokes, color, annotSel]
  );

  // Phase 21 — resolve what (if anything) is being edited, and route a single
  // commit call to the right writer. `editingId` doubles as the host id
  // (anchored) OR the sticky/standalone stroke id; `pendingText` is the
  // not-yet-born text caret.
  // The last resolved target: when a collaborator deletes the element being
  // edited, the editor stays open on it (Task 19 — never drop typed text).
  const lastTargetRef = useRef<EditingTarget>(null);
  const editingTarget = useMemo<EditingTarget>(() => {
    if (pendingText) return { kind: 'pending', x: pendingText.x, y: pendingText.y };
    if (!editingId) return null;
    let t: EditingTarget = null;
    const host = anchorsById.get(editingId);
    const s = strokesById.get(editingId);
    if (host) t = { kind: 'anchored', anchorId: editingId, host };
    else if (s?.tool === 'sticky') t = { kind: 'sticky', sticky: s };
    else if (s?.tool === 'section') t = { kind: 'section', section: s };
    else if (s?.tool === 'text' && (s.anchorId == null || s.anchorId === ''))
      t = { kind: 'standalone', text: s };
    if (t) {
      lastTargetRef.current = t;
      return t;
    }
    const last = lastTargetRef.current;
    return last && editTargetId(last) === editingId ? last : null;
  }, [pendingText, editingId, anchorsById, strokesById]);
  const editGone = !!editingId && !strokesById.has(editingId);

  const editingTargetRef = useRef(editingTarget);
  editingTargetRef.current = editingTarget;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;

  // One edit session per opened element (Task 19). Opened from the board as
  // last delivered, so its base is what everyone agreed on at that moment.
  useEffect(() => {
    textSessionRef.current = null;
    setRemoteEdited(false);
    if (!editingId) {
      sessionElRef.current = null;
      return;
    }
    const el = board.committed.get(editingId);
    if (el) {
      textSessionRef.current = openSession(el);
      sessionElRef.current = el;
    }
  }, [editingId]);
  if (editingId) {
    const el = board.committed.get(editingId);
    if (el) sessionElRef.current = el;
  }

  /** The session for `id`, opened lazily (an element born a moment ago). */
  const sessionFor = useCallback((id: string): TextSession | null => {
    const cur = textSessionRef.current;
    if (cur && cur.id === id) return cur;
    const el = board.committed.get(id);
    const next = el ? openSession(el) : null;
    textSessionRef.current = next;
    return next;
  }, []);

  /** Idle-typing draft: the board (and every peer) sees the text so far. Never undo. */
  const draftEditing = useCallback(
    (text: string) => {
      const id = editingIdRef.current;
      if (!id) return;
      const session = sessionFor(id);
      if (!session) return;
      const op = draftOp(session, board.committed.get(id), text);
      if (!op) return;
      void sendOps([op]);
      textSessionRef.current = markSent(session, text);
    },
    [sessionFor, sendOps]
  );

  const commitEditing = useCallback(
    (text: string, fmt?: EditorFmt, measuredH?: number) => {
      const target = editingTargetRef.current;
      setEditingId(null);
      setPendingText(null);
      setEditCaretPoint(null);
      if (!target) return;
      if (target.kind === 'pending') {
        createStandaloneText(target.x, target.y, text, fmt);
        return;
      }
      const id = editTargetId(target) as string;
      const session = sessionFor(id);
      const stored = storedSlotText(target.kind, text);
      // A collaborator deleted it while we typed: keep the text by putting the
      // element back (same id) — unless the text is empty anyway.
      if (!strokesRef.current.some((s) => s.id === id)) {
        const lastKnown = sessionElRef.current;
        if (!session || !lastKnown || !stored.trim()) return;
        const parentExists = !!lastKnown.parent && board.committed.has(lastKnown.parent);
        const bb = strokeBBox(editTargetStroke(target));
        applyOpsLocal([
          restoreOp(
            session,
            lastKnown,
            stored,
            parentExists,
            bb ? { x: bb.x, y: bb.y } : undefined
          ),
        ]);
        return;
      }
      commitSessionRef.current = session;
      sessionCommittedRef.current = false;
      try {
        if (target.kind === 'anchored') commitText(target.anchorId, text, fmt);
        else if (target.kind === 'sticky') commitStickyText(target.sticky.id, text, fmt, measuredH);
        else if (target.kind === 'standalone') commitStandaloneText(target.text.id, text, fmt);
        else if (target.kind === 'section' && stored !== target.section.label) {
          strokesStoreRef.current.updateStroke(target.section.id, {
            label: stored,
          } as Partial<Stroke>);
        }
      } finally {
        commitSessionRef.current = null;
      }
      // No change to commit — but drafts may have moved the board: bring it
      // back to the text the element keeps (no undo step: nothing changed).
      if (session && !sessionCommittedRef.current) {
        const op = draftOp(session, board.committed.get(id), stored);
        if (op) applyOpsLocal([op]);
      }
      textSessionRef.current = null;
    },
    [
      commitText,
      commitStickyText,
      commitStandaloneText,
      createStandaloneText,
      sessionFor,
      applyOpsLocal,
      board,
    ]
  );

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setPendingText(null);
    setEditCaretPoint(null);
  }, []);

  /**
   * FigJam v3 — copy/cut the (expanded) selection to the OS clipboard as a
   * `{"maudeElements":2}` JSON text payload (v2 elements, world coordinates). Shared by ⌘C/⌘X and the
   * right-click menu. Returns true when something was copied.
   */
  const copySelection = useCallback(
    (cut: boolean): boolean => {
      if (!annotSel) return false;
      const sel = annotSel.selectedIds;
      if (sel.length === 0) return false;
      const store = strokesStoreRef.current;
      const expanded = new Set(
        expandForOp(
          sel,
          (x) => expandIdsToGroups(x, store.strokes),
          new Containment(strokesToElementMap(store.strokes, board.committed).values())
        )
      );
      const payload = store.strokes.filter(
        (s) =>
          expanded.has(s.id) ||
          (s.tool === 'text' && s.anchorId != null && expanded.has(s.anchorId))
      );
      if (payload.length === 0) return false;
      try {
        void navigator.clipboard
          ?.writeText(
            JSON.stringify({
              maudeElements: 2,
              elements: v1ToV2(payload, { flat: true }).elements,
            })
          )
          .catch(() => {
            /* clipboard permission denied — copy is best-effort */
          });
      } catch {
        /* clipboard API absent — non-fatal */
      }
      if (cut) {
        store.deleteStrokes([...expanded]);
        annotSel.clear();
      }
      return true;
    },
    [annotSel]
  );

  /**
   * FigJam v3 — paste a board clipboard payload (⌘V or the right-click menu).
   * Every element is validated like a peer's (DDR-242 — foreign JSON is
   * untrusted); a malformed one is dropped. Clones get fresh ids and a
   * +16/+16 offset. A pre-v2 `{"maudeStrokes":1}` payload is upconverted.
   */
  const pasteStrokesText = useCallback(
    (txt: string): boolean => {
      if (!annotSel || !isBoardClipboard(txt)) return false;
      let safe: Stroke[] = [];
      try {
        const parsed = JSON.parse(txt) as {
          maudeElements?: number;
          elements?: unknown;
          maudeStrokes?: number;
          strokes?: unknown;
        };
        const raw =
          parsed.maudeElements === 2 && Array.isArray(parsed.elements)
            ? parsed.elements.slice(0, MAX_ELEMENTS)
            : parsed.maudeStrokes === 1 && Array.isArray(parsed.strokes)
              ? v1ToV2((parsed.strokes as Stroke[]).slice(0, MAX_ELEMENTS), { flat: true }).elements
              : null;
        if (!raw) return false;
        // What lands is THIS user's paste: it carries their authorship, never a
        // name the clipboard claims, and a link card's domain comes from its
        // url (a pastejacked card must not read "accounts.google.com" while
        // pointing elsewhere — security review A3).
        const me = collabRef.current?.myName;
        const author = me
          ? { kind: 'human', name: me, id: collabRef.current?.myConnId }
          : undefined;
        const mine = validateElements(raw).elements.map((el) => {
          const out: Record<string, unknown> = { ...el };
          delete out.author;
          if (author) out.author = author;
          if (el.type === 'link' && typeof el.url === 'string') out.domain = linkDomain(el.url);
          return out;
        });
        safe = elementsToStrokes(validateElements(mine).elements);
      } catch {
        return false;
      }
      if (safe.length === 0) return false;
      const res = duplicateStrokes(
        safe,
        safe.map((s) => s.id),
        16,
        16
      );
      const clones = res.strokes.slice(safe.length);
      if (clones.length === 0) return false;
      const prev = strokesRef.current;
      // recompute keeps binds to hosts present in THIS canvas and strips the
      // cross-canvas danglers (endpoint frozen).
      const next = recomputeBoundArrows([...prev, ...clones]);
      commitStrokes(prev, next, `paste ${clones.length} stroke${clones.length === 1 ? '' : 's'}`);
      annotSel.replace(res.newIds);
      return true;
    },
    [annotSel, commitStrokes]
  );

  /**
   * FigJam v3 — quick-create chain (⌘Enter): with a sticky or shape selected,
   * spawn a sibling of the same type/size/style to the right with its editor
   * active. Shapes ALSO get a bound connector source → sibling (FigJam quick-
   * create: shapes connect, stickies don't). Returns true when spawned.
   */
  const chainCreate = useCallback(
    (sourceId: string): boolean => {
      const prev = strokesRef.current;
      const src = prev.find((s) => s.id === sourceId);
      if (!src) return false;
      if (
        src.tool !== 'sticky' &&
        src.tool !== 'rect' &&
        src.tool !== 'ellipse' &&
        src.tool !== 'polygon'
      ) {
        return false;
      }
      const bb = strokeBBox(src);
      if (!bb) return false;
      const gap = src.tool === 'sticky' ? 40 : 64;
      const nid = rid();
      // The sibling copies style + size but starts loose (no group membership,
      // human provenance) and empty-bodied. Undefined-assignment (not rest-
      // destructuring) keeps the discriminated-union narrowing intact for the
      // branches below; the serializer treats undefined as absent.
      const bare = structuredClone(src);
      bare.groupIds = undefined;
      bare.author = undefined;
      let sibling: Stroke;
      if (bare.tool === 'ellipse') {
        sibling = { ...bare, id: nid, cx: bare.cx + bb.w + gap };
      } else if (bare.tool === 'sticky') {
        sibling = { ...bare, id: nid, x: bb.x + bb.w + gap, y: bb.y, text: '' };
      } else {
        sibling = { ...bare, id: nid, x: bb.x + bb.w + gap, y: bb.y };
      }
      let next: Stroke[] = [...prev, sibling];
      if (src.tool !== 'sticky') {
        const p1 = anchorPoint(src, 1, 0.5);
        const p2 = anchorPoint(sibling, 0, 0.5);
        if (p1 && p2) {
          next = [
            ...next,
            {
              id: rid(),
              tool: 'arrow',
              color: resolveDefaultInk(theme),
              width: STROKE_WIDTH_THIN,
              x1: p1[0],
              y1: p1[1],
              x2: p2[0],
              y2: p2[1],
              startBind: { hostId: src.id, nx: 1, ny: 0.5 },
              endBind: { hostId: nid, nx: 0, ny: 0.5 },
            },
          ];
        }
      }
      commitStrokes(prev, next, `quick-create ${sibling.tool}`);
      annotSel?.replace(nid);
      // Sticky → body editor; rect/ellipse/polygon → anchored-text editor
      // (Wave G widened anchorsById to every closed shape).
      if (
        sibling.tool === 'sticky' ||
        sibling.tool === 'rect' ||
        sibling.tool === 'ellipse' ||
        sibling.tool === 'polygon'
      ) {
        setEditingId(nid);
      }
      return true;
    },
    [commitStrokes, annotSel, theme]
  );

  // FigJam v3 — ⌘Enter pressed INSIDE a sticky/anchored editor commits there
  // and chains the next sibling. Deferred a tick so the editor's commit lands
  // in strokesRef (React state) before the chain reads it.
  const chainAfterCommit = useCallback(
    (id: string) => {
      window.setTimeout(() => chainCreate(id), 0);
    },
    [chainCreate]
  );

  // FigJam v3 — manipulation shortcuts: ⌘G group / ⌘⇧G ungroup, ⌘D duplicate,
  // ] [ ⌘] ⌘[ z-order, ⌘C/⌘X copy/cut (selection → OS clipboard as a JSON
  // text payload), ⌘Enter quick-create chain. Document capture, mirroring the
  // nudge handler below; the input-router never claims these combos.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!annotSel) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const store = strokesStoreRef.current;
      const sel = annotSel.selectedIds;
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (cmd && !e.altKey && k === 'g') {
        // ⌘G claims the browser's find-next ONLY when a selection exists.
        if (sel.length === 0) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) {
          store.ungroupSelection(sel);
        } else {
          const members = store.groupSelection(sel);
          if (members) annotSel.replace(members);
        }
        return;
      }
      if (cmd && !e.shiftKey && !e.altKey && k === 'd') {
        if (sel.length === 0) return; // browser bookmark stays available
        e.preventDefault();
        e.stopImmediatePropagation();
        const ids = store.duplicateSelection(sel, 16, 16);
        if (ids.length) annotSel.replace(ids);
        return;
      }
      if ((e.key === ']' || e.key === '[') && !e.altKey && !e.shiftKey) {
        if (sel.length === 0) return;
        e.preventDefault();
        const op: ZOrderOp =
          e.key === ']' ? (cmd ? 'forward' : 'front') : cmd ? 'backward' : 'back';
        store.reorderSelection(sel, op);
        return;
      }
      if (cmd && !e.shiftKey && !e.altKey && (k === 'c' || k === 'x')) {
        if (sel.length === 0) return; // let the native copy run
        if (copySelection(k === 'x')) e.preventDefault();
        return;
      }
      if (cmd && e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        if (sel.length !== 1) return;
        const only = sel[0];
        if (only && chainCreate(only)) e.preventDefault();
        return;
      }
      // FigJam v3 — plain Enter on a single text-capable stroke opens its
      // editor (FigJam: select a shape, press Enter, start typing).
      if (e.key === 'Enter' && !cmd && !e.shiftKey && !e.altKey) {
        if (sel.length !== 1) return;
        const only = strokesRef.current.find((x) => x.id === sel[0]);
        if (!only) return;
        if (
          only.tool === 'rect' ||
          only.tool === 'ellipse' ||
          only.tool === 'polygon' ||
          only.tool === 'sticky' ||
          (only.tool === 'text' && (only.anchorId == null || only.anchorId === ''))
        ) {
          e.preventDefault();
          setEditingId(only.id);
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [annotSel, chainCreate, copySelection]);

  // FigJam v3 — paste strokes. ⌘C serialized the selection as a JSON text
  // payload; this CAPTURE-phase listener claims it before the media-intake
  // hook (bubble phase) so a strokes payload never falls through to the URL/
  // link branch.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!annotSel) return;
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const txt = e.clipboardData?.getData('text/plain') ?? '';
      if (!isBoardClipboard(txt)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pasteStrokesText(txt);
    };
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [annotSel, pasteStrokesText]);

  // feature-4 text-gestures (user steer 2026-07-20) — Text tool hover shows
  // WHICH artboard text it would edit: hit-test the editable leaf under the
  // cursor (the same resolver the click-through uses) and outline it. rAF-
  // coalesced; class removed on tool change/unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let marked: HTMLElement | null = null;
    const clear = () => {
      if (marked) {
        marked.classList.remove('dc-text-editable-hover');
        marked = null;
      }
    };
    if (tool !== 'text') return clear;
    let raf: number | null = null;
    let last: { x: number; y: number } | null = null;
    const apply = () => {
      raf = null;
      if (!last) return;
      const el = findEditableElementAt(last.x, last.y);
      const target = el?.hasAttribute('data-cd-editable') ? el : null;
      if (target === marked) return;
      clear();
      if (target) {
        target.classList.add('dc-text-editable-hover');
        marked = target;
      }
    };
    const onMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY };
      if (raf == null && typeof requestAnimationFrame !== 'undefined') {
        raf = requestAnimationFrame(apply);
      }
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (raf != null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
      clear();
    };
  }, [tool]);

  // FigJam v3 — hover "Add text" affordance: an empty rect/ellipse hovered in
  // move mode shows a ghost label; double-click (existing) or Enter edits.
  const [addTextHintId, setAddTextHintId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') {
      setAddTextHintId(null);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const node = (e.target as Element | null)?.closest?.('[data-id][data-tool]');
      const t = node?.getAttribute('data-tool');
      const id = node?.getAttribute('data-id') ?? null;
      if (!id || (t !== 'rect' && t !== 'ellipse' && t !== 'polygon')) {
        setAddTextHintId(null);
        return;
      }
      const hasText = strokesRef.current.some(
        (x) => x.tool === 'text' && x.anchorId === id && x.text.length > 0
      );
      setAddTextHintId(hasText ? null : id);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, [tool]);

  // FigJam v3 — connector draft: dragging from a connection dot (the side
  // magnets shown on a selected bindable shape) draws a BOUND curved
  // connector; releasing over another bindable shape binds the far end too
  // (⌘ keeps it free). The draft renders through the same arrow primitives.
  const [connDraft, setConnDraft] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    startBind: { hostId: string; nx: number; ny: number };
    endBind?: { hostId: string; nx: number; ny: number };
  } | null>(null);
  const connDraftRef = useRef(connDraft);
  connDraftRef.current = connDraft;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    const onDown = (e: PointerEvent): Claim => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      if (e.button !== 0) return;
      const dot = (e.target as Element | null)?.closest?.('.dc-annot-conn-dot');
      if (!dot) return;
      const hostId = dot.getAttribute('data-host') ?? '';
      const nx = Number.parseFloat(dot.getAttribute('data-nx') ?? '');
      const ny = Number.parseFloat(dot.getAttribute('data-ny') ?? '');
      const host = strokesRef.current.find((s) => s.id === hostId);
      if (!host || !Number.isFinite(nx) || !Number.isFinite(ny)) return;
      const pt = anchorPoint(host, nx, ny);
      if (!pt) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const pointerId = e.pointerId;
      const startBind = { hostId, nx, ny };
      setConnDraft({ x1: pt[0], y1: pt[1], x2: pt[0], y2: pt[1], startBind });
      const onMove = (mv: PointerEvent) => {
        if (mv.pointerId !== pointerId) return;
        const [wx, wy] = screenToWorld(mv.clientX, mv.clientY);
        const zoom = vpRef.current?.zoom || 1;
        const cand =
          mv.metaKey || mv.ctrlKey
            ? null
            : bindCandidate(
                wx,
                wy,
                strokesRef.current,
                BIND_THRESHOLD_PX / zoom,
                new Set([hostId])
              );
        setBindHintId(cand?.hostId ?? null);
        if (cand) {
          const target = strokesRef.current.find((s) => s.id === cand.hostId);
          const tp = target ? anchorPoint(target, cand.nx, cand.ny) : null;
          if (tp) {
            setConnDraft({ x1: pt[0], y1: pt[1], x2: tp[0], y2: tp[1], startBind, endBind: cand });
            return;
          }
        }
        setConnDraft({ x1: pt[0], y1: pt[1], x2: wx, y2: wy, startBind });
      };
      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        const draft = connDraftRef.current;
        setConnDraft(null);
        setBindHintId(null);
        if (!draft) return;
        // A bare tap on the dot creates nothing.
        if (Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) < 8) return;
        const arrow: ArrowStroke = {
          id: rid(),
          tool: 'arrow',
          color: resolveDefaultInk(theme),
          width: STROKE_WIDTH_THIN,
          x1: draft.x1,
          y1: draft.y1,
          x2: draft.x2,
          y2: draft.y2,
          lineType: 'curved',
          startBind: draft.startBind,
          ...(draft.endBind ? { endBind: draft.endBind } : {}),
        };
        const prev = strokesRef.current;
        commitStrokes(prev, [...prev, arrow], 'draw connector');
        annotSel?.replace(arrow.id);
        if (arrow.endBind) {
          showOnceHint(
            'bind',
            'Arrow attached — it follows the shape now. Drag an endpoint to re-anchor, hold ⌘ to keep it free.'
          );
        }
      };
      return {
        kind: 'connecting',
        move: onMove,
        up: onUp,
        cancel: (ev) => onUp(ev ?? ({ pointerId } as PointerEvent)),
      };
    };
    return pipeline.add({ priority: 2, name: 'connector', down: onDown });
  }, [pipeline, tool, screenToWorld, commitStrokes, annotSel, theme]);

  // FigJam v3 — right-click on a stroke SELECTS it (keeping a multi-selection
  // the press lands inside) and opens the annotation context menu (z-order,
  // group, copy/paste, delete). Capture phase on document so it claims the
  // event before the input-router's host-level contextmenu handler.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    if (!annotSel) return;
    const strokeAt = (target: Element | null): string | null => {
      if (target?.closest?.(CHROME_SELECTOR)) return null;
      const node = target?.closest?.('[data-id][data-tool]');
      const id = node?.getAttribute('data-id');
      if (!id || !strokesRef.current.some((s) => s.id === id)) return null;
      return id;
    };
    const onCtx = (e: MouseEvent) => {
      const id = strokeAt(e.target as Element | null);
      if (!id) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!annotSel.contains(id)) {
        annotSel.replace(expandIdsToGroups([id], strokesRef.current));
      }
      setCtxMenu({ x: e.clientX, y: e.clientY });
    };
    // Wave G — the input-router ALSO opens the shell canvas menu from a
    // right-button POINTERDOWN (classify maps button 2 → 'context-menu'), so
    // claiming only the contextmenu event left BOTH menus open. This document-
    // capture listener fires before the router's host-capture one and stops
    // propagation WITHOUT preventDefault, so the native contextmenu event
    // (which opens OUR menu above) still follows.
    const onDown = (e: PointerEvent): Claim => {
      if (isMediaPlayerTarget(e)) return;
      if (e.button !== 2) return;
      if (!strokeAt(e.target as Element | null)) return;
      e.stopImmediatePropagation();
      return 'pass';
    };
    document.addEventListener('contextmenu', onCtx, true);
    const unstage = pipeline.add({ priority: 1, name: 'context-menu', down: onDown });
    return () => {
      document.removeEventListener('contextmenu', onCtx, true);
      unstage();
    };
  }, [pipeline, tool, annotSel]);

  // Keyboard: arrow nudge + Backspace/Delete remove selected strokes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!annotSel) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (annotSel.selectedIds.length === 0) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        strokesStore.translateStrokes(annotSel.selectedIds, -step, 0);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        strokesStore.translateStrokes(annotSel.selectedIds, step, 0);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        strokesStore.translateStrokes(annotSel.selectedIds, 0, -step);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        strokesStore.translateStrokes(annotSel.selectedIds, 0, step);
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        strokesStore.deleteStrokes(annotSel.selectedIds);
        annotSel.clear();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [annotSel, strokesStore]);

  /** FigJam v3 — context-menu action dispatcher (shares the shortcut paths). */
  const onMenuAction = useCallback(
    (action: string) => {
      const store = strokesStoreRef.current;
      if (!annotSel) return;
      const sel = annotSel.selectedIds;
      if (action === 'copy') copySelection(false);
      else if (action === 'cut') copySelection(true);
      else if (action === 'paste') {
        try {
          void navigator.clipboard
            ?.readText()
            .then((t) => {
              pasteStrokesText(t);
            })
            .catch(() => {
              /* clipboard read blocked — paste is best-effort from the menu */
            });
        } catch {
          /* clipboard API absent */
        }
      } else if (action === 'duplicate') {
        const ids = store.duplicateSelection(sel, 16, 16);
        if (ids.length) annotSel.replace(ids);
      } else if (action === 'delete') {
        store.deleteStrokes(sel);
        annotSel.clear();
      } else if (
        action === 'front' ||
        action === 'forward' ||
        action === 'backward' ||
        action === 'back'
      ) {
        store.reorderSelection(sel, action);
      } else if (action === 'group') {
        const members = store.groupSelection(sel);
        if (members) annotSel.replace(members);
      } else if (action === 'ungroup') {
        store.ungroupSelection(sel);
      } else if (action === 'replace') {
        // Stage F3 — "Replace…" on an ImageStroke/MediaRefStroke. The canvas
        // REQUESTS (untrusted-origin postMessage, DDR-054); the main-origin shell
        // opens the AssetPicker and posts the picked path back down (handled by
        // the `replace-annotation-media` listener above, which owns the write —
        // this model has no data-cd-id, so it can't ride edit-attr like F2).
        if (sel.length !== 1) return;
        const target = strokesById.get(sel[0] as string);
        if (!target || (target.tool !== 'image' && target.tool !== 'mediaref')) return;
        const before = target.tool === 'image' ? target.href : target.src;
        try {
          window.parent.postMessage(
            { dgn: 'replace-annotation-media-request', id: target.id, before },
            '*'
          );
        } catch {
          /* detached / cross-origin teardown */
        }
      } else if (action === 'edit-photo') {
        // feature-photo-editor (Task 17) — "Edit Photo…" on an ImageStroke. Same
        // untrusted-origin REQUEST shape as Replace (DDR-054); the shell opens the
        // Photo-only Inspector tab on this stroke's content-addressed asset.
        if (sel.length !== 1) return;
        const target = strokesById.get(sel[0] as string);
        if (target?.tool !== 'image') return;
        try {
          window.parent.postMessage(
            { dgn: 'edit-annotation-photo-request', id: target.id, asset: target.href },
            '*'
          );
        } catch {
          /* detached / cross-origin teardown */
        }
      }
    },
    [annotSel, copySelection, pasteStrokesText, strokesById]
  );

  // FigJam v3 — first time a multi-selection lands, surface the group /
  // duplicate affordances once (behaviour-triggered, never a tour).
  const selCount = annotSel?.selectedIds.length ?? 0;
  useEffect(() => {
    if (selCount >= 2) {
      showOnceHint(
        'multi',
        '⌘G groups the selection · drag inside the box moves everything · ⌘D duplicates.'
      );
    }
  }, [selCount]);

  // feature-photo-editor — auto-open the Inspector's Photo tab whenever the
  // annotation selection becomes exactly one ImageStroke. Previously this
  // only fired from the "Edit Photo…" context-menu action; a plain click/
  // select left the Inspector showing its no-selection placeholder, since an
  // annotation stroke has no data-cd-id / DOM selection to ride the normal
  // `select`/`select-set` path. An ImageStroke has no OTHER inspectable
  // surface (Task 13: Photo is the only tab for this content type), so
  // requiring a right-click detour to reach it was pure friction. Same
  // `edit-annotation-photo-request` message + confused-deputy gate (DDR-054)
  // the context-menu action already used.
  const singleSelectedImageId =
    selCount === 1 && strokesById.get(annotSel?.selectedIds[0] as string)?.tool === 'image'
      ? (annotSel?.selectedIds[0] as string)
      : null;
  useEffect(() => {
    if (!singleSelectedImageId) return;
    const s = strokesById.get(singleSelectedImageId);
    if (s?.tool !== 'image') return;
    try {
      window.parent.postMessage(
        { dgn: 'edit-annotation-photo-request', id: s.id, asset: s.href },
        '*'
      );
    } catch {
      /* detached / cross-origin teardown */
    }
  }, [singleSelectedImageId, strokesById]);

  // Selected stroke halos — bboxes in world coords, vector-effect non-scaling-stroke.
  const selectedStrokes = useMemo(() => {
    if (!annotSel || annotSel.selectedIds.length === 0) return [] as Stroke[];
    const out: Stroke[] = [];
    for (const id of annotSel.selectedIds) {
      const s = strokesById.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [annotSel, strokesById]);

  return (
    <AnnotationPipelineContext.Provider value={pipeline}>
      <StrokesStoreContext.Provider value={strokesStore}>
        <AnnotationsInput
          isActive={isActive}
          visible={visible}
          cursor={tools.find((t) => t.id === tool)?.cursor ?? 'crosshair'}
          beginStroke={beginStroke}
          moveStroke={moveStroke}
          endStroke={endStroke}
          onLeave={() => setGhost(null)}
        />
        {visible ? (
          <AnnotationsSvg
            worldRef={worldRef}
            strokes={renderStrokes}
            anchorsById={anchorsById}
            selectMode={tool === 'move'}
            selectedStrokes={selectedStrokes}
            marquee={marquee}
            snapGuides={snapGuides}
            bindHintId={bindHintId}
            resizeInfo={resizeInfo}
            connDraft={connDraft}
            addTextHintId={editingTarget ? null : addTextHintId}
            ghost={ghostPreview}
            editingTarget={editingTarget}
            editCaretPoint={editCaretPoint}
            inkColor={color}
            onCommitEdit={commitEditing}
            onCancelEdit={cancelEditing}
            onDraftEdit={draftEditing}
            onChainEdit={chainAfterCommit}
            gestureState={gestureState}
            editNotice={editGone ? 'deleted' : remoteEdited ? 'edited' : null}
            unknownElements={unknownElements}
          />
        ) : null}
        {/* DDR-150 dogfood #8 — inline players for media-reference chips (HTML
          overlay in the world div; see MediaRefPlayers for why not
          foreignObject). */}
        <MediaRefPlayers worldRef={worldRef} strokes={renderStrokes} visible={visible} />
        <AnnotationContextToolbar
          editingId={
            editingTarget?.kind === 'anchored'
              ? editingTarget.anchorId
              : editingTarget?.kind === 'sticky'
                ? editingTarget.sticky.id
                : editingTarget?.kind === 'standalone'
                  ? editingTarget.text.id
                  : null
          }
        />
        {ctxMenu && annotSel ? (
          <AnnotationContextMenu
            pos={ctxMenu}
            selCount={annotSel.selectedIds.length}
            canUngroup={selectedStrokes.some((s) => (s.groupIds?.length ?? 0) > 0)}
            canReplace={
              selectedStrokes.length === 1 &&
              (selectedStrokes[0]?.tool === 'image' || selectedStrokes[0]?.tool === 'mediaref')
            }
            canEditPhoto={
              selectedStrokes.length === 1 &&
              selectedStrokes[0]?.tool === 'image' &&
              /assets\/[0-9a-f]{8}\.[a-z0-9]+/i.test((selectedStrokes[0] as ImageStroke).href || '')
            }
            onAction={onMenuAction}
            onClose={() => setCtxMenu(null)}
          />
        ) : null}
        {visible && tool === 'move' ? <AnnotationResizeOverlay store={strokesStore} /> : null}
        {isActive ? (
          <AnnotationsChrome
            tool={tool}
            theme={theme}
            color={color}
            setColor={setColor}
            stickyColor={stickyColor}
            setStickyColor={setStickyColor}
            highlighterColor={highlighterColor}
            setHighlighterColor={setHighlighterColor}
            highlighterWidth={highlighterWidth}
            setHighlighterWidth={setHighlighterWidth}
            supportsFill={supportsFill}
            fill={fill}
            setFill={setFill}
            supportsThickness={supportsThickness}
            thickness={thickness}
            setThickness={setThickness}
          />
        ) : null}
      </StrokesStoreContext.Provider>
    </AnnotationPipelineContext.Provider>
  );
}
AnnotationsLayer.displayName = 'AnnotationsLayer';

// ─────────────────────────────────────────────────────────────────────────────
// Input — transparent overlay portaled into the host (.dc-canvas). Receives
// pointer events for draw / erase ONLY; viewport gestures (middle-mouse,
// space-pan, wheel) reach `useViewportController` because we never call
// stopPropagation and the controller listens at the host level alongside us.

function AnnotationsInput({
  isActive,
  visible,
  cursor,
  beginStroke,
  moveStroke,
  endStroke,
  onLeave,
}: {
  isActive: boolean;
  visible: boolean;
  /** Active-tool cursor (crosshair / text / cell) — applied to the capture
   *  overlay so the affordance shows over the whole canvas while drawing. */
  cursor: string;
  beginStroke: (e: ReactPointerEvent<HTMLDivElement>, spaceHeld: boolean) => boolean;
  moveStroke: (e: ReactPointerEvent<HTMLDivElement>) => void;
  endStroke: () => void;
  /** Phase 24 — clear the ghost placeholder when the pointer leaves the canvas. */
  onLeave: () => void;
}) {
  const worldRef = useWorldRefContext();
  const host = worldRef?.current?.parentElement ?? null;
  const [, force] = useState({});
  // Host may not be attached on first commit; nudge a re-render once it is.
  useEffect(() => {
    if (host) return;
    const id = setTimeout(() => force({}), 0);
    return () => clearTimeout(id);
  }, [host]);

  const spaceHeldRef = useRef(false);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditable(e.target)) spaceHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeldRef.current = false;
    };
    document.addEventListener('keydown', down, true);
    document.addEventListener('keyup', up, true);
    return () => {
      document.removeEventListener('keydown', down, true);
      document.removeEventListener('keyup', up, true);
    };
  }, []);

  if (!host) return null;
  const interactive = isActive && visible;
  return createPortal(
    <div
      className="dc-annot-input"
      aria-hidden="true"
      style={{
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: interactive ? cursor : 'default',
      }}
      onPointerDown={(e) => {
        beginStroke(e, spaceHeldRef.current);
      }}
      onPointerMove={moveStroke}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={onLeave}
    />,
    host
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG — portaled INTO `.dc-world` so the world's CSS zoom + translate apply
// natively, which is what makes drawn ink scale with the zoom. Selection chrome
// and card hairlines opt into `vector-effect="non-scaling-stroke"` per element
// to stay px-thick; drawn ink deliberately does not (see `common` in
// `renderStroke`). `pointer-events: none` on the container — strokes are decorative
// for now (Phase 5.1 Task 6 will reintroduce hit-test via the selection store).

function AnnotationsSvg({
  worldRef,
  strokes,
  anchorsById,
  selectMode,
  selectedStrokes,
  marquee,
  snapGuides,
  bindHintId,
  resizeInfo,
  connDraft,
  addTextHintId,
  ghost,
  editingTarget,
  editCaretPoint,
  inkColor,
  onCommitEdit,
  onCancelEdit,
  onDraftEdit,
  onChainEdit,
  editNotice,
  gestureState,
  unknownElements,
}: {
  worldRef: ReturnType<typeof useWorldRefContext>;
  strokes: readonly Stroke[];
  /** Elements of a type this build does not know — drawn as placeholders, never dropped. */
  unknownElements: readonly AnnotationElement[];
  /** Idle-typing draft of the open editor (Task 19). */
  onDraftEdit: (text: string) => void;
  /** ⌘Enter in a sticky / shape label: spawn the next sibling. */
  onChainEdit: (id: string) => void;
  /** The pointer pipeline's state (`idle`, `dragging`, `marquee`, …) — a tooling hook. */
  gestureState: string;
  /** A collaborator edited or deleted the element under the open editor. */
  editNotice: 'edited' | 'deleted' | null;
  anchorsById: Map<string, AnchorHost>;
  selectMode: boolean;
  selectedStrokes: readonly Stroke[];
  marquee: { ax: number; ay: number; bx: number; by: number } | null;
  /** FigJam v3 — smart-guide lines painted while a drag is snapping. */
  snapGuides: SnapGuide[] | null;
  /** FigJam v3 — host a dragged arrow endpoint would bind to (accent halo). */
  bindHintId: string | null;
  /** FigJam v3 — live size label + dimension-match halos while resizing. */
  resizeInfo: {
    box: { x: number; y: number; w: number; h: number } | null;
    matchIds: string[];
  } | null;
  /** FigJam v3 — in-flight connector drawn from a connection dot. */
  connDraft: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    startBind: { hostId: string; nx: number; ny: number };
    endBind?: { hostId: string; nx: number; ny: number };
  } | null;
  /** FigJam v3 — hovered empty shape that shows the "Add text" ghost label. */
  addTextHintId: string | null;
  ghost: GhostDescriptor | null;
  editingTarget: EditingTarget;
  /** The click that opened the editor — caret-at-click on mount (Phase 3). */
  editCaretPoint: { x: number; y: number } | null;
  /** Live default ink (theme-aware) for a not-yet-born pending text caret. */
  inkColor: string;
  onCommitEdit: (text: string, fmt?: EditorFmt, measuredH?: number) => void;
  onCancelEdit: () => void;
}) {
  const annotSel = useAnnotationSelectionOptional();
  const [, force] = useState({});
  useEffect(() => {
    if (worldRef?.current) return;
    const id = setTimeout(() => force({}), 0);
    return () => clearTimeout(id);
  }, [worldRef]);
  // DDR-242 AD7/AD8 — one node per element, text as HTML (annotations/ui/).
  const baseItems = useMemo(
    () => renderItemsFromStrokes(strokes, unknownElements),
    [strokes, unknownElements]
  );
  // The element whose text slot is open: a shape's label edits on the shape,
  // everything else on itself; `pending` is a caret not yet backed by an element.
  const editingId =
    editingTarget?.kind === 'anchored'
      ? editingTarget.anchorId
      : editingTarget?.kind === 'sticky'
        ? editingTarget.sticky.id
        : editingTarget?.kind === 'standalone'
          ? editingTarget.text.id
          : editingTarget?.kind === 'section'
            ? editingTarget.section.id
            : null;
  const pending =
    editingTarget?.kind === 'pending'
      ? { x: editingTarget.x, y: editingTarget.y, color: inkColor, fontSize: DEFAULT_FONT_SIZE }
      : null;
  const sessionKey = editingTarget
    ? `${editingTarget.kind}:${editingId ?? `${pending?.x},${pending?.y}`}`
    : null;
  // An element deleted by a collaborator mid-edit keeps drawing (its last
  // known form) while its editor is open, so the typed text is never lost.
  const lastEditItemRef = useRef<RenderItem | null>(null);
  let items = baseItems;
  if (editingId) {
    const live = baseItems.find((it) => it.el.id === editingId);
    if (live) lastEditItemRef.current = live;
    else if (lastEditItemRef.current?.el.id === editingId) {
      items = [...baseItems, lastEditItemRef.current];
    }
  }
  const draftRef = useRef(onDraftEdit);
  draftRef.current = onDraftEdit;
  const chainRef = useRef(onChainEdit);
  chainRef.current = onChainEdit;
  const commitRef = useRef(onCommitEdit);
  commitRef.current = onCommitEdit;
  const cancelRef = useRef(onCancelEdit);
  cancelRef.current = onCancelEdit;
  const chainKindRef = useRef<string | null>(null);
  chainKindRef.current = editingTarget?.kind ?? null;
  // One request object per edit session, so only the edited node re-renders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the session, callbacks via refs
  const edit = useMemo<EditRequest | null>(() => {
    if (!sessionKey) return null;
    const id = editingId;
    return {
      caretPoint: editCaretPoint,
      notice: editNotice,
      onDraft: pending ? undefined : (text: string) => draftRef.current(text),
      onCommit: (info) => {
        commitRef.current(info.text, info.fmt, info.measured.h);
        // ⌘Enter in a sticky or a shape label also spawns the next sibling.
        const kind = chainKindRef.current;
        if (info.chain && id && (kind === 'sticky' || kind === 'anchored')) {
          chainRef.current(id);
        }
      },
      onCancel: () => cancelRef.current(),
    };
  }, [sessionKey, editNotice]);
  const target = worldRef?.current ?? null;
  if (!target) return null;
  return (
    <>
      {createPortal(
        <AnnotationScene
          items={items}
          interactive={selectMode}
          editingId={editingId}
          edit={edit}
          pending={pending}
          resolveAsset={resolveAssetHref}
        />,
        target
      )}
      {createPortal(
        <svg
          className="dc-annot-svg"
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          // DOM-driven E2E + tooling hook: the current annotation selection.
          data-selection={annotSel?.selectedIds.join(' ') ?? ''}
          data-annot-state={gestureState}
        >
          <defs>
            {/* Phase 21 — soft "lifted paper" drop shadow for sticky notes. */}
            <filter id="dc-sticky-shadow" x="-25%" y="-25%" width="150%" height="170%">
              <feDropShadow
                dx="0"
                dy="4"
                stdDeviation="8"
                floodColor="#000000"
                floodOpacity="0.28"
              />
            </filter>
          </defs>
          {selectedStrokes.map((s) => (
            <SelectionHalo
              key={`halo-${s.id}`}
              stroke={s}
              anchorsById={anchorsById}
              multi={selectedStrokes.length > 1}
            />
          ))}
          <AnnotGroupBbox selectedStrokes={selectedStrokes} anchorsById={anchorsById} />
          {marquee ? (
            <rect
              className="dc-annot-marquee"
              x={Math.min(marquee.ax, marquee.bx)}
              y={Math.min(marquee.ay, marquee.by)}
              width={Math.abs(marquee.bx - marquee.ax)}
              height={Math.abs(marquee.by - marquee.ay)}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {/* FigJam v3 — smart guides: solid 1px accent lines at the snapped edge/
          center, painted only while a drag is actively snapping. */}
          {snapGuides?.map((g, i) => (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: guides are positional + rebuilt per move tick
              key={`guide-${i}`}
              x1={g.axis === 'x' ? g.at : g.from}
              y1={g.axis === 'x' ? g.from : g.at}
              x2={g.axis === 'x' ? g.at : g.to}
              y2={g.axis === 'x' ? g.to : g.at}
              stroke="var(--maude-hud-accent, #d63b1f)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ))}
          {/* FigJam v3 — bind hint: halo the host a dragged arrow endpoint would
          magnetically attach to. */}
          <BindHintHalo strokes={strokes} bindHintId={bindHintId} />
          {/* FigJam v3 — connection dots on a single selected bindable shape;
          dragging one draws a bound connector (rendered below as a draft). */}
          {selectMode && !connDraft && selectedStrokes.length === 1 && selectedStrokes[0] ? (
            <ConnectorDots stroke={selectedStrokes[0]} />
          ) : null}
          {connDraft ? (
            <g
              stroke={inkColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              fill="none"
              pointerEvents="none"
            >
              {arrowPrimitives({
                x1: connDraft.x1,
                y1: connDraft.y1,
                x2: connDraft.x2,
                y2: connDraft.y2,
                width: 2.5,
                color: inkColor,
                lineType: 'curved',
                startBind: connDraft.startBind,
                ...(connDraft.endBind ? { endBind: connDraft.endBind } : {}),
              }).map((prim, i) => renderArrowPrimitive(prim, i))}
            </g>
          ) : null}
          {/* FigJam v3 — hover affordance: an empty shape invites text. */}
          <AddTextHint strokes={strokes} hintId={addTextHintId} />
          {/* FigJam v3 — resize chrome: live W × H label at the box corner plus a
          dashed halo on any neighbour whose dimension the resize just matched
          (the "same size as that one" quota). */}
          {resizeInfo?.box ? (
            <g pointerEvents="none">
              {resizeInfo.matchIds.map((id) => {
                const m = strokes.find((s) => s.id === id);
                const bb = m ? strokeBBox(m) : null;
                if (!bb) return null;
                return (
                  <rect
                    key={`dim-${id}`}
                    x={bb.x - 2}
                    y={bb.y - 2}
                    width={bb.w + 4}
                    height={bb.h + 4}
                    fill="none"
                    stroke="var(--maude-hud-accent, #d63b1f)"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    vectorEffect="non-scaling-stroke"
                    rx={2}
                  />
                );
              })}
              <text
                x={resizeInfo.box.x + resizeInfo.box.w / 2}
                y={resizeInfo.box.y + resizeInfo.box.h + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--maude-hud-accent, #d63b1f)"
                style={{
                  fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                }}
              >
                {`${Math.round(resizeInfo.box.w)} × ${Math.round(resizeInfo.box.h)}`}
              </text>
            </g>
          ) : null}
          {ghost ? <GhostPreview ghost={ghost} /> : null}
        </svg>,
        target
      )}
    </>
  );
}

/**
 * DDR-150 dogfood #8 — the mediaref chips' inline players, rendered as PLAIN
 * HTML absolutely positioned in the world div (which carries the pan/zoom CSS
 * transform), NOT as SVG foreignObject: Chromium hit-tests foreignObject
 * content under a transformed ancestor in the un-transformed coordinate space,
 * so real clicks miss the player at most zoom levels. HTML children of the
 * transformed div hit-test correctly. The [data-mediaref-player] attr keeps
 * every document-capture annotation handler out (isMediaPlayerTarget guard).
 */
function MediaRefPlayers({
  worldRef,
  strokes,
  visible,
}: {
  // Same shape the context actually hands out (nullable OUTSIDE a world
  // provider, exactly like the sibling overlay at MediaRefChrome) — the old
  // `RefObject<HTMLElement | null>` both mis-typed the caller and let
  // `worldRef.current` be dereferenced on a null context.
  worldRef: ReturnType<typeof useWorldRefContext>;
  strokes: readonly Stroke[];
  visible: boolean;
}) {
  const target = worldRef?.current ?? null;
  if (!target || !visible) return null;
  const HEADER = 26;
  const refs = strokes.filter(
    (s): s is MediaRefStroke => s.tool === 'mediaref' && !!s.src && Math.abs(s.h) > HEADER + 12
  );
  if (refs.length === 0) return null;
  return createPortal(
    <>
      {refs.map((s) => {
        const x = Math.min(s.x, s.x + s.w);
        const y = Math.min(s.y, s.y + s.h);
        const w = Math.abs(s.w);
        const h = Math.abs(s.h);
        const mediaUrl = resolveAssetHref(s.src);
        const isAudio = s.mediaKind === 'audio';
        return (
          <div
            key={`mrp-${s.id}`}
            data-mediaref-player="1"
            style={{
              position: 'absolute',
              left: x + 4,
              top: y + HEADER,
              width: Math.max(8, w - 8),
              height: Math.max(8, h - HEADER - 4),
              borderRadius: 6,
              overflow: 'hidden',
              zIndex: 4,
            }}
          >
            {isAudio ? (
              // biome-ignore lint/a11y/useMediaCaption: user-dropped reference media — there is no caption source to point a <track> at.
              <audio
                controls
                preload="metadata"
                src={mediaUrl}
                style={{ width: '100%', height: '100%' }}
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: user-dropped reference media — no caption source exists for an arbitrary dragged-in clip.
              <video
                // Chromium's native controls already toggle play/pause on a
                // content-area click (a custom click listener would double-fire
                // against it and cancel itself out — verified live). The router
                // overlay-skip + the annotation-handler guards are what make
                // these native interactions reachable.
                controls
                preload="metadata"
                playsInline
                src={mediaUrl}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  display: 'block',
                }}
              />
            )}
          </div>
        );
      })}
    </>,
    target
  );
}

/**
 * FigJam v3 — centered ghost "Add text" label on a hovered EMPTY rect/ellipse
 * (FigJam shows the same invitation). Pure chrome; double-click / Enter edits.
 */
function AddTextHint({ strokes, hintId }: { strokes: readonly Stroke[]; hintId: string | null }) {
  if (!hintId) return null;
  const host = strokes.find((s) => s.id === hintId);
  if (!host || (host.tool !== 'rect' && host.tool !== 'ellipse' && host.tool !== 'polygon'))
    return null;
  const bb = strokeBBox(host);
  if (!bb || bb.w < 48 || bb.h < 28) return null;
  const rot = strokeRotation(host);
  const label = (
    <text
      x={bb.x + bb.w / 2}
      y={bb.y + bb.h / 2}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={13}
      fill={host.color}
      opacity={0.45}
      pointerEvents="none"
      style={{ fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' }}
    >
      Add text
    </text>
  );
  if (rot === 0) return label;
  return (
    <g transform={`rotate(${rot} ${bb.x + bb.w / 2} ${bb.y + bb.h / 2})`} pointerEvents="none">
      {label}
    </g>
  );
}

/**
 * FigJam v3 — connection dots: the four side magnets of a selected bindable
 * shape, screen-constant size, accent-ringed. Dragging one starts a bound
 * connector (the layer owns the gesture; dots are in CHROME_SELECTOR so the
 * marquee/drag handler yields).
 */
function ConnectorDots({ stroke }: { stroke: Stroke }) {
  // LIVE zoom, deliberately not the published one. These are the counter-scaled
  // chrome elements (connector dots, selection bbox, section-label chips): they
  // must hold a constant SCREEN size while the world scales. Publishing is
  // settle-only since the gesture-static change, so reading published zoom here
  // would let this chrome grow and shrink with the world through a pinch and
  // then jump back at settle — the visible fidelity-pop a previous LOD attempt
  // was reverted for. These components render only for selected/hovered
  // strokes, so tracking the gesture frame-by-frame stays cheap.
  const zoom = useLiveViewport().zoom || 1;
  if (!isBindable(stroke)) return null;
  const center = strokeCenter(stroke);
  if (!center) return null;
  const magnets: Array<[number, number]> = [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ];
  // FigJam parity — the dots float a step OUTSIDE the edge (along the outward
  // normal), which also keeps them clear of the mid-edge RESIZE handles that
  // sit exactly on the edge midpoints (DOM, higher layer — they'd swallow the
  // drag otherwise). Deriving the normal from center→anchor keeps rotated
  // shapes correct for free.
  const offset = 16 / zoom;
  return (
    <g>
      {magnets.map(([nx, ny]) => {
        const pt = anchorPoint(stroke, nx, ny);
        if (!pt) return null;
        const dx = pt[0] - center[0];
        const dy = pt[1] - center[1];
        const len = Math.hypot(dx, dy) || 1;
        return (
          <circle
            key={`${nx}-${ny}`}
            className="dc-annot-conn-dot"
            data-host={stroke.id}
            data-nx={nx}
            data-ny={ny}
            cx={pt[0] + (dx / len) * offset}
            cy={pt[1] + (dy / len) * offset}
            r={5 / zoom}
            fill="var(--maude-hud-accent, #d63b1f)"
            stroke="var(--maude-chrome-bg-0, #ffffff)"
            strokeWidth={1.5 / zoom}
            pointerEvents="all"
          />
        );
      })}
    </g>
  );
}

/**
 * FigJam v3 — right-click context menu for annotation strokes. Reuses the
 * `.dc-context-menu` visual language (stylesheet injected by context-menu.tsx)
 * so the annotation menu and the canvas menu read as one product surface.
 */
function AnnotationContextMenu({
  pos,
  selCount,
  canUngroup,
  canReplace,
  canEditPhoto,
  onAction,
  onClose,
}: {
  pos: { x: number; y: number };
  selCount: number;
  canUngroup: boolean;
  /** Stage F3 — exactly one ImageStroke/MediaRefStroke is selected. */
  canReplace: boolean;
  /** feature-photo-editor (Task 17) — exactly one content-addressed ImageStroke. */
  canEditPhoto: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  ensureCtxMenuStyles();
  const ref = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ x: number; y: number }>(pos);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    let nx = pos.x;
    let ny = pos.y;
    if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8);
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    if (nx !== at.x || ny !== at.y) setAt({ x: nx, y: ny });
    el.querySelector<HTMLButtonElement>('button.dc-menu-item:not([disabled])')?.focus();
    const onDown = (e: PointerEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      if (!el.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [pos, onClose, at.x, at.y]);
  const item = (
    id: string,
    label: string,
    shortcut?: string,
    opts?: { destructive?: boolean; disabled?: boolean }
  ) => (
    <button
      type="button"
      role="menuitem"
      data-action={id}
      disabled={opts?.disabled}
      className={`dc-menu-item${opts?.destructive ? ' is-destructive' : ''}`}
      onClick={() => {
        if (opts?.disabled) return;
        onAction(id);
        onClose();
      }}
    >
      <span>{label}</span>
      {shortcut ? <span className="dc-menu-shortcut">{shortcut}</span> : null}
    </button>
  );
  return (
    <div
      ref={ref}
      className="dc-context-menu"
      role="menu"
      aria-label="Annotation actions"
      style={{ left: at.x, top: at.y }}
    >
      {item('copy', 'Copy', '⌘C')}
      {item('cut', 'Cut', '⌘X')}
      {item('paste', 'Paste', '⌘V')}
      {item('duplicate', 'Duplicate', '⌘D')}
      {canReplace ? item('replace', 'Replace…') : null}
      {canEditPhoto ? item('edit-photo', 'Edit Photo…') : null}
      <div className="dc-menu-sep" aria-hidden="true" />
      {item('front', 'Bring to front', ']')}
      {item('forward', 'Bring forward', '⌘]')}
      {item('backward', 'Send backward', '⌘[')}
      {item('back', 'Send to back', '[')}
      <div className="dc-menu-sep" aria-hidden="true" />
      {item('group', 'Group selection', '⌘G', { disabled: selCount < 2 })}
      {canUngroup ? item('ungroup', 'Ungroup', '⌘⇧G') : null}
      <div className="dc-menu-sep" aria-hidden="true" />
      {item('delete', 'Delete', '⌫', { destructive: true })}
    </div>
  );
}

/**
 * FigJam v3 — accent halo on the host a dragged arrow endpoint would bind to.
 * Pure chrome (pointer-events:none); renders nothing when no candidate.
 */
function BindHintHalo({
  strokes,
  bindHintId,
}: {
  strokes: readonly Stroke[];
  bindHintId: string | null;
}) {
  if (!bindHintId) return null;
  const host = strokes.find((s) => s.id === bindHintId);
  if (!host) return null;
  const bbox = strokeBBox(host);
  if (!bbox) return null;
  const pad = 3;
  return (
    <rect
      x={bbox.x - pad}
      y={bbox.y - pad}
      width={bbox.w + pad * 2}
      height={bbox.h + pad * 2}
      fill="none"
      stroke="var(--maude-hud-accent, #d63b1f)"
      strokeWidth={2}
      strokeOpacity={0.8}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
      rx={3}
    />
  );
}

function SelectionHalo({
  stroke,
  anchorsById,
  multi,
}: {
  stroke: Stroke;
  anchorsById: Map<string, AnchorHost>;
  multi: boolean;
}) {
  // Counter-scaled chrome — must hold a constant screen size while the world
  // scales, so it needs the live zoom, not the settle-cadence published one.
  const zoom = useLiveViewport().zoom || 1;
  const bbox = strokeBBox(stroke, anchorsById);
  if (!bbox) return null;
  // T17 + post-Wave-2 fix — annotation halo idioms:
  //   * Single select → 2 px solid border, NO ring, NO corner ticks.
  //     The resize overlay (T23) renders the corner handles in screen-space,
  //     so painting SVG ticks here too would duplicate them. The element
  //     halo uses CSS box-shadow for the 18% ring; the SVG equivalent (a
  //     second outline rect) reads as "double frame" rather than a halo —
  //     user feedback flagged this immediately. Solid 2 px is enough signal
  //     once the resize handles claim the corners.
  //   * Multi member → 1.5 px solid full accent, no ring, no ticks (group
  //     bbox above carries the container affordance).
  // Marquee STAYS dashed (drawn elsewhere) — dashed is reserved for the
  // ambient group-container + active-gesture idioms per DDR-046 rev 2.
  // Wave H — screen-constant breathing room (matches the resize handles,
  // which sit on the same padded frame — HALO_PAD_PX single source).
  const pad = HALO_PAD_PX / zoom;
  const halo = (
    <rect
      x={bbox.x - pad}
      y={bbox.y - pad}
      width={bbox.w + pad * 2}
      height={bbox.h + pad * 2}
      fill="none"
      stroke="var(--maude-hud-accent, #d63b1f)"
      strokeWidth={multi ? 1.5 : 2}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
      rx={2}
    />
  );
  // FigJam v3 — the halo turns with a rotated stroke.
  const rot = strokeRotation(stroke);
  if (rot === 0) return halo;
  return <g transform={`rotate(${rot} ${bbox.x + bbox.w / 2} ${bbox.y + bbox.h / 2})`}>{halo}</g>;
}

// T17 — group bbox dashed rect for multi-stroke annotation selection. Mirrors
// the element-side GroupBbox idiom (1 px dashed accent + 6 × 6 corner handles).
function AnnotGroupBbox({
  selectedStrokes,
  anchorsById,
}: {
  selectedStrokes: readonly Stroke[];
  anchorsById: Map<string, AnchorHost>;
}) {
  // Counter-scaled chrome — must hold a constant screen size while the world
  // scales, so it needs the live zoom, not the settle-cadence published one.
  const zoom = useLiveViewport().zoom || 1;
  if (selectedStrokes.length < 2) return null;
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const s of selectedStrokes) {
    const b = strokeBBox(s, anchorsById);
    if (!b) continue;
    any = true;
    if (b.x < xMin) xMin = b.x;
    if (b.y < yMin) yMin = b.y;
    if (b.x + b.w > xMax) xMax = b.x + b.w;
    if (b.y + b.h > yMax) yMax = b.y + b.h;
  }
  if (!any) return null;
  // Wave H — screen-constant pad, one step wider than the single halo.
  const pad = (HALO_PAD_PX + 2) / zoom;
  const x = xMin - pad;
  const y = yMin - pad;
  const w = xMax - xMin + pad * 2;
  const h = yMax - yMin + pad * 2;
  const handle = 6;
  const inset = 3;
  // Screen-constant hit target — bigger than the visible 6×6 square (matches
  // the single-resize DOM handles' generous grab area) so the corner stays
  // easy to grab at any zoom.
  const hit = 16 / zoom;
  const cursorFor: Record<string, string> = {
    nw: 'nwse-resize',
    se: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
  };
  const handles = [
    { corner: 'nw', x: x - inset, y: y - inset },
    { corner: 'ne', x: x + w - handle + inset, y: y - inset },
    { corner: 'sw', x: x - inset, y: y + h - handle + inset },
    { corner: 'se', x: x + w - handle + inset, y: y + h - handle + inset },
  ];
  return (
    <g pointerEvents="none">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="var(--maude-hud-accent, #d63b1f)"
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
        rx={2}
      />
      {/* Phase 2 (whiteboard-improvements) — proportional group resize: these
          corners used to be decorative (pointerEvents inherited 'none' from
          the wrapping <g>). Each now sets its OWN pointerEvents, which SVG
          lets a descendant override independent of an ancestor's value, and
          carries `data-group-resize-corner` for the drag gesture registered
          in AnnotationsLayer to identify which corner was grabbed. */}
      {handles.map((c) => {
        const cx = c.x + handle / 2;
        const cy = c.y + handle / 2;
        return (
          <g key={c.corner}>
            <rect
              x={cx - hit / 2}
              y={cy - hit / 2}
              width={hit}
              height={hit}
              fill="transparent"
              pointerEvents="all"
              data-group-resize-corner={c.corner}
              style={{ cursor: cursorFor[c.corner] }}
            />
            <rect
              x={c.x}
              y={c.y}
              width={handle}
              height={handle}
              fill="var(--maude-hud-accent, #d63b1f)"
              stroke="var(--maude-chrome-bg-0, #ffffff)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              rx={1}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stroke renderer

/**
 * Phase 24 — inline style for a sticky body (read view + editor share it so the
 * read↔edit swap doesn't shift). Applies bold / strike / align atop the
 * `.dc-sticky-body` defaults (top-left).
 */
/**
 * Phase 24 — the translucent cursor-following ghost placeholder. Pure chrome:
 * `pointer-events:none`, never added to `strokes`, so it can't be selected,
 * hit-tested, erased, or persisted. Static (no animation) — reduced-motion safe.
 * Geometry mirrors what a click/tap would create at the cursor (shape +
 * SHAPE_DEFAULT_SIZE top-left at cursor; sticky default square; text I-beam).
 */
function GhostPreview({ ghost }: { ghost: GhostDescriptor }) {
  const { x, y } = ghost;
  if (ghost.kind === 'text') {
    const h = 22;
    return (
      <path
        d={`M${x - 4} ${y}H${x + 4}M${x} ${y}V${y + h}M${x - 4} ${y + h}H${x + 4}`}
        stroke={ghost.color}
        strokeWidth={1.5}
        strokeOpacity={0.5}
        fill="none"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    );
  }
  if (ghost.kind === 'sticky') {
    const s = STICKY_DEFAULT_W;
    return (
      <rect
        x={x}
        y={y}
        width={s}
        height={s}
        rx={STICKY_CORNER_RADIUS}
        ry={STICKY_CORNER_RADIUS}
        fill={ghost.color}
        fillOpacity={0.32}
        stroke={ghost.color}
        strokeOpacity={0.55}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    );
  }
  // shape — dashed outline of the default-sized primitive at the cursor.
  const sz = SHAPE_DEFAULT_SIZE;
  const common = {
    fill: 'none',
    stroke: ghost.color,
    strokeWidth: 2,
    strokeOpacity: 0.5,
    strokeDasharray: '6 5',
    vectorEffect: 'non-scaling-stroke' as const,
    pointerEvents: 'none' as const,
  };
  if (ghost.shapeKind === 'circle') {
    return <ellipse cx={x + sz / 2} cy={y + sz / 2} rx={sz / 2} ry={sz / 2} {...common} />;
  }
  if (ghost.shapeKind === 'square' || ghost.shapeKind === 'rounded') {
    const r = ghost.shapeKind === 'rounded' ? 8 : 0;
    return <rect x={x} y={y} width={sz} height={sz} rx={r} ry={r} {...common} />;
  }
  return <polygon points={polygonPoints(ghost.shapeKind, x, y, sz, sz)} {...common} />;
}

/** Map one arrow primitive to JSX (heads inherit stroke from the parent <g>). */
function renderArrowPrimitive(p: SvgPrimitive, key: number): JSX.Element {
  switch (p.el) {
    case 'line':
      return (
        <line
          key={key}
          x1={p.x1}
          y1={p.y1}
          x2={p.x2}
          y2={p.y2}
          strokeDasharray={p.dash ? '6 4' : undefined}
        />
      );
    case 'path':
      return <path key={key} d={p.d} strokeDasharray={p.dash ? '6 4' : undefined} />;
    case 'polyline':
      return <polyline key={key} points={p.points} fill={p.fill} />;
    case 'polygon':
      return <polygon key={key} points={p.points} fill={p.fill} />;
    case 'circle':
      return <circle key={key} cx={p.cx} cy={p.cy} r={p.r} fill={p.fill} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chrome — color swatches + (optional fill picker) + (optional thickness chip)
// + presentation toggle + help button.

function AnnotationsChrome({
  tool,
  theme,
  color,
  setColor,
  stickyColor,
  setStickyColor,
  highlighterColor,
  setHighlighterColor,
  highlighterWidth,
  setHighlighterWidth,
  supportsFill,
  fill,
  setFill,
  supportsThickness,
  thickness,
  setThickness,
}: {
  tool: Tool;
  /** Canvas theme — the ink swatch (slot 8) renders the themed default so the
   *  active default reads true on dark canvases. */
  theme: string;
  color: string;
  setColor: (c: string) => void;
  stickyColor: string;
  setStickyColor: (c: string) => void;
  highlighterColor: string;
  setHighlighterColor: (c: string) => void;
  highlighterWidth: number;
  setHighlighterWidth: (w: number) => void;
  supportsFill: boolean;
  fill: string | null;
  setFill: (f: string | null) => void;
  supportsThickness: boolean;
  thickness: Thickness;
  setThickness: (t: Thickness) => void;
}) {
  // Sticky tool picks a paper tint (its own palette); every other draw tool
  // picks ink from the stroke PALETTE.
  if (tool === 'sticky') {
    return (
      <div className="dc-annot-chrome" role="toolbar" aria-label="Sticky note tools">
        <div className="dc-annot-swatches" role="radiogroup" aria-label="Sticky color">
          {STICKY_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="dc-annot-sw"
              aria-pressed={c === stickyColor}
              aria-label={`Sticky color ${c}`}
              title={`Sticky color ${c}`}
              style={{ background: c }}
              onClick={() => setStickyColor(c)}
            />
          ))}
        </div>
      </div>
    );
  }
  // Highlighter picks a translucent marker hue (item 8) — its own palette,
  // mirroring sticky. Each swatch previews on a dark chip via its alpha.
  if (tool === 'highlighter') {
    return (
      <div className="dc-annot-chrome" role="toolbar" aria-label="Highlighter tools">
        <div className="dc-annot-swatches" role="radiogroup" aria-label="Highlighter color">
          {HIGHLIGHTER_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="dc-annot-sw"
              aria-pressed={c === highlighterColor}
              aria-label={`Highlighter color ${c}`}
              title={`Highlighter color ${c}`}
              style={{ background: c }}
              onClick={() => setHighlighterColor(c)}
            />
          ))}
        </div>
        <div className="dc-annot-sep" />
        {/* Nib width — three filled dots of increasing size (item 8). */}
        <div className="dc-annot-swatches" role="radiogroup" aria-label="Highlighter width">
          {HIGHLIGHTER_WIDTHS.map((w) => {
            const dot = Math.round(6 + (w / 28) * 8); // 8–14 px preview dot
            return (
              <button
                key={w}
                type="button"
                className="dc-annot-ibtn"
                aria-pressed={w === highlighterWidth}
                aria-label={`Highlighter width ${w}`}
                title={`Width ${w}px`}
                onClick={() => setHighlighterWidth(w)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: dot,
                    height: dot,
                    borderRadius: '50%',
                    background: 'currentColor',
                    display: 'inline-block',
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="dc-annot-chrome" role="toolbar" aria-label="Annotation tools">
      <div className="dc-annot-swatches" role="radiogroup" aria-label="Stroke color">
        {STROKE_PALETTE.map((base, i) => {
          // The last slot is the default ink — render it themed so the active
          // default reads true on dark canvases (white-ish ink) without
          // touching the other hues. Key by the immutable base hex so a theme
          // flip recolours the swatch in place rather than remounting.
          const c = i === STROKE_PALETTE.length - 1 ? resolveDefaultInk(theme) : base;
          return (
            <button
              key={base}
              type="button"
              className="dc-annot-sw"
              aria-pressed={c === color}
              aria-label={`Color ${c}`}
              title={`Color ${c}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          );
        })}
      </div>
      {supportsFill ? (
        <>
          <div className="dc-annot-sep" />
          <div className="dc-annot-swatches" role="radiogroup" aria-label="Fill color">
            <button
              type="button"
              className="dc-annot-fill dc-annot-fill--none"
              aria-pressed={fill == null}
              aria-label="No fill"
              title="No fill"
              onClick={() => setFill(null)}
            />
            {FILL_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="dc-annot-fill"
                aria-pressed={c === fill}
                aria-label={`Fill ${c}`}
                title={`Fill ${c}`}
                style={{ background: c }}
                onClick={() => setFill(c)}
              />
            ))}
          </div>
        </>
      ) : null}
      {supportsThickness ? (
        <>
          <div className="dc-annot-sep" />
          <button
            type="button"
            className="dc-annot-ibtn"
            aria-label="Thin stroke"
            aria-pressed={thickness === STROKE_WIDTH_THIN}
            title="Thin (3px)"
            onClick={() => setThickness(STROKE_WIDTH_THIN)}
          >
            <IconLineThin />
          </button>
          <button
            type="button"
            className="dc-annot-ibtn"
            aria-label="Thick stroke"
            aria-pressed={thickness === STROKE_WIDTH_THICK}
            title="Thick (6px)"
            onClick={() => setThickness(STROKE_WIDTH_THICK)}
          >
            <IconLineThick />
          </button>
        </>
      ) : null}
    </div>
  );
}
