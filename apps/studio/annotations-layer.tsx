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
  strokesToSvg,
  svgToStrokes,
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
import { buildAnnotationStrokesRecord } from './commands/annotation-strokes-command.ts';
import { ensureMenuStyles as ensureCtxMenuStyles } from './context-menu.tsx';
import { crossedDragThreshold, type Tool } from './input-router.tsx';
import { createMediaCommitChain, type MediaCommitResult } from './media-commit-chain.ts';
import { collapseEntrySelectAll, mountCaret, placeCaretAt } from './text-caret.ts';
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
import { colorForName, useCollab } from './use-collab.tsx';
import { useSelectionSetOptional } from './use-selection-set.tsx';
import { type ShapeKind, useToolMode } from './use-tool-mode.tsx';
import { useUndoSinks, useUndoStackOptional } from './use-undo-stack.tsx';

// FigJam v3 — the pure data model (Stroke types, palettes, serialize/parse,
// geometry) lives in annotations-model.ts: React-free, importable headlessly
// by bun tests and the `maude design annotate` write verb. The layer
// re-exports the whole model so every existing
// `from './annotations-layer.tsx'` import keeps working unchanged.
export * from './annotations-model.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Types

// Phase 24 — arrow style enums are OWNED by canvas-arrowheads.ts (so that
// module imports nothing back from here — no cycle, see DDR-067) and re-exported
// here for back-compat (context-toolbar etc. import them from this module).
export type { ArrowHead, ArrowLineType } from './canvas-arrowheads.ts';

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

/**
 * Shared inline-formatting state for the three text editors (sticky / anchored /
 * standalone) — the unification surface (item 4d). Cmd/Ctrl + B / I / U toggle
 * bold / italic / underline WHILE editing (preventing the browser's native
 * execCommand, which would inject markup the model can't read), preview live via
 * `style`, and commit on the stroke via `fmtRef`. `strike` rides along unchanged
 * (toolbar-only — no universal shortcut). One hook = identical behaviour across
 * all three editors.
 */
function useEditorFormat(initial: EditorFmt): {
  fmtRef: { current: EditorFmt };
  style: CSSProperties;
  onFormatKey: (e: ReactKeyboardEvent) => boolean;
} {
  const [bold, setBold] = useState(!!initial.bold);
  const [italic, setItalic] = useState(!!initial.italic);
  const [underline, setUnderline] = useState(!!initial.underline);
  const [strike, setStrike] = useState(!!initial.strike);
  // FigJam v3 — edit-mode toolbar extensions: size + alignment preview live in
  // the editor and commit with the text (normFmt carries them through).
  const [fontSize, setFontSize] = useState<number | undefined>(initial.fontSize);
  const [align, setAlign] = useState<TextAlign | undefined>(initial.align);
  const fmtRef = useRef<EditorFmt>({ bold, italic, underline, strike, fontSize, align });
  fmtRef.current = { bold, italic, underline, strike, fontSize, align };
  const style: CSSProperties = {
    fontWeight: bold ? 700 : undefined,
    fontStyle: italic ? 'italic' : undefined,
    textDecoration: textDecoCss(strike, underline),
    ...(fontSize != null && fontSize !== initial.fontSize ? { fontSize: `${fontSize}px` } : {}),
    ...(align && align !== initial.align ? { textAlign: align } : {}),
  };
  // FigJam v3 — the edit-mode context toolbar drives the editor through this
  // event (mutating the STROKE mid-edit would re-render the contentEditable
  // and clobber typed text). The editor echoes its state back so the toolbar's
  // pressed-states track live.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFmt = (e: Event) => {
      const d = (e as CustomEvent<{ key?: string; value?: unknown }>).detail;
      if (!d?.key) return;
      if (d.key === 'bold') setBold((v) => !v);
      else if (d.key === 'italic') setItalic((v) => !v);
      else if (d.key === 'underline') setUnderline((v) => !v);
      else if (d.key === 'strike') setStrike((v) => !v);
      else if (d.key === 'fontSize' && typeof d.value === 'number') setFontSize(d.value);
      else if (d.key === 'align' && typeof d.value === 'string') setAlign(d.value as TextAlign);
    };
    document.addEventListener('maude:editor-format', onFmt);
    return () => document.removeEventListener('maude:editor-format', onFmt);
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const broadcast = () => {
      document.dispatchEvent(
        new CustomEvent('maude:editor-format-state', {
          detail: { bold, italic, underline, strike, fontSize, align },
        })
      );
    };
    broadcast();
    // The toolbar may mount AFTER the editor's first broadcast — it asks.
    document.addEventListener('maude:editor-format-request', broadcast);
    return () => document.removeEventListener('maude:editor-format-request', broadcast);
  }, [bold, italic, underline, strike, fontSize, align]);
  const onFormatKey = useCallback((e: ReactKeyboardEvent): boolean => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      setBold((v) => !v);
      return true;
    }
    if (k === 'i') {
      e.preventDefault();
      setItalic((v) => !v);
      return true;
    }
    if (k === 'u') {
      e.preventDefault();
      setUnderline((v) => !v);
      return true;
    }
    return false;
  }, []);
  return { fmtRef, style, onFormatKey };
}

// Phase 24 — moved to canvas-arrowheads.ts (single source for shaft + heads).
// Re-exported so the existing test import (`from '../annotations-layer.tsx'`)
// and the byte-identical canary keep working.
export { arrowHeadPoints } from './canvas-arrowheads.ts';

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
 * An optimistic ImageStroke's `blob:`/`data:` href must never be PUT to the
 * server. `sanitizeAnnotationSvg` (api.ts) strips an href it doesn't
 * recognize — keeping the `<image>` element, dropping only the attribute —
 * so the server's STORED + broadcast SVG silently diverges from whatever the
 * client just sent. That divergence defeats the collab-echo self-suppression
 * guard (the `recentSelfSvgsRef` history, near `putStrokes` below): the
 * echo's content no longer matches anything we recorded as "already
 * applied", so a real `setStrokesState` fires from the (href-stripped)
 * server copy — which can wipe out a SIBLING stroke's still-in-flight
 * optimistic insert that was never itself part of that PUT. This is the
 * concrete failure a 3-file concurrent drop hit: one
 * image ended up href-stripped (a blank frame) and another was dropped
 * entirely once an unrelated commit's echo round-tripped while both were
 * still uploading. See media-commit-chain.ts for the sibling accumulator fix
 * — this closes the other half, at the persistence layer.
 */
function isEphemeralHref(s: Stroke): boolean {
  return s.tool === 'image' && /^(?:blob|data):/i.test(s.href);
}

/**
 * Fold a local mutation's `next` against the live-rendered `prev`, restoring
 * only strokes that are genuinely concurrent additions from ANOTHER
 * in-flight commit — never reverting THIS mutation's own deletions.
 * Disambiguated via `opBefore`, the baseline this mutation's `next` was
 * itself computed from: an id present in `prev` but absent from BOTH
 * `opBefore` and `next` was added by someone else after `opBefore` was
 * captured (fold it in — this is the sibling-insert race this helper was
 * originally written for). An id present in `opBefore` but absent from
 * `next` was deliberately removed BY THIS MUTATION and must stay removed
 * even though `prev` (React's rendered state) hasn't caught up to that
 * removal yet.
 *
 * The prior version of this helper compared only `prev` against `next` —
 * exactly the shape of every delete (an id in `prev`, absent from `next`) —
 * so it silently folded every erased stroke straight back in locally, while
 * the smaller, correct set still went out over PUT. Backspace looked like a
 * no-op until a reload picked up the server's already-correct copy.
 */
export function reconcileCommit(
  prev: readonly Stroke[],
  opBefore: readonly Stroke[],
  next: readonly Stroke[]
): Stroke[] {
  const beforeIds = new Set(opBefore.map((s) => s.id));
  const nextIds = new Set(next.map((s) => s.id));
  const extra = prev.filter((s) => !beforeIds.has(s.id) && !nextIds.has(s.id));
  return extra.length ? [...next, ...extra] : (next as Stroke[]);
}

/**
 * Fold a FOREIGN collab-echo snapshot against local state. A foreign
 * broadcast legitimately omits an id that was deleted (by us or a peer) —
 * reviving it just because local `prev` hasn't caught up would make deletes
 * unsyncable across tabs/peers. The only strokes worth resurrecting here are
 * ones that are still purely local, not-yet-synced optimistic previews (an
 * ephemeral blob:/data: href image mid-upload) that a foreign broadcast could
 * never have known about in the first place.
 *
 * issue-106 deliberately does NOT carve out the stroke a local editor has open.
 * That was tried: hold back its `text` so a peer's commit could not overwrite
 * the editor. But this function's output IS the persisted store — it is
 * serialized to `*.annotations.svg` and re-broadcast on the next commit of ANY
 * stroke — so holding a field back doesn't shield a view, it silently reverts
 * the peer's write and republishes the stale text under the local user's name,
 * for as long as the editor stays open. The editor never needed it: the clobber
 * was React rewriting an UNCONTROLLED contentEditable, which `useSessionValue`
 * fixes at the DOM, and the commit reads `innerText` off the node rather than
 * off the stroke. Last-write-wins stays the model here.
 */
export function reconcileForeignEcho(
  prev: readonly Stroke[],
  incoming: readonly Stroke[]
): Stroke[] {
  const incomingIds = new Set(incoming.map((s) => s.id));
  const extra = prev.filter((s) => !incomingIds.has(s.id) && isEphemeralHref(s));
  return extra.length ? [...incoming, ...extra] : (incoming as Stroke[]);
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
/* Phase 24 — sticky-note body. Word-wrapped multi-line text inside the card's
   foreignObject. Text sits TOP-LEFT (FigJam parity); the editor contentEditable
   mirrors the same box metrics so the read-edit swap doesn't shift the text.
   text-align is overridden inline per-sticky when align is not left. */
.dc-sticky-body {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 14px 16px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
  color: #2a2a28;
  font-family: var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  line-height: 1.35;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: hidden;
}
/* Phase 24 — while editing an annotation's text (a text label OR a sticky body,
   both carry the dc-annot-editor class), force the I-beam. The important flag
   plus the class selector beat use-tool-mode's blanket star-cursor rule (you
   usually open the editor from MOVE mode, whose move glyph would otherwise sit
   over the text you're typing into). The element's inline text cursor can't win
   that fight on its own — a non-important inline style loses to !important.
   See DDR-067. (No backticks in this comment: the whole block is a JS template
   literal, so a backtick here would terminate the string.) */
.dc-annot-editor, .dc-annot-editor * { cursor: text !important; }
/* Phase 7 (unified-text-editing) — hover affordance parity with artboard leaf
   text: a standalone text stroke invites editing with the I-beam in Move mode
   (double-click / Text-tool click enters its editor in place). Shapes and
   stickies keep the selection arrow — their whole body is a move/select
   target first. */
.dc-annot-svg text[data-tool="text"] { cursor: text; }
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
  s.textContent = ANNOT_CSS;
  document.head.appendChild(s);
}

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
}

const StrokesStoreContext = createContext<StrokesStoreValue | null>(null);

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
export { useAnnotationsVisibility } from './use-annotations-visibility.tsx';

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

// ─────────────────────────────────────────────────────────────────────────────
// Component

export function AnnotationsLayer() {
  countRender('annotationRenders');
  ensureAnnotStyles();
  const { tool, setTool, resetTool, sticky, tools, shapeKind } = useToolMode();
  const theme = useCanvasChromeTheme();
  const controller = useViewportControllerContext();
  const vp = controller?.viewport ?? null;
  const worldRef = useWorldRefContext();
  const annotSel = useAnnotationSelectionOptional();
  const elementSel = useSelectionSetOptional();

  const [strokes, setStrokesState] = useState<Stroke[]>([]);
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

  const fileRef = useRef<string | undefined>(undefined);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // like `recentSelfSvgsRef` below — only ever holds ids a delete has
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

  // Load existing annotations on mount.
  // Self-echo suppression (Phase 8 Task 5, hardened — feature-bulk-media-
  // insert follow-up). A single "last applied" string only catches the MOST
  // RECENT self-write: when the chain fires several rapid commits (a batch
  // drop), the server's broadcast of an EARLIER commit can arrive after a
  // LATER local commit has already moved "last applied" on — so the earlier
  // echo no longer matches, gets misread as a foreign change, and rolls
  // local state BACK to that stale snapshot. This is the confirmed cause of
  // images silently vanishing after a multi-file drop (live-tested: 12
  // mismatched/misapplied echoes correlated exactly with lost strokes across
  // a 30-batch stress run). Track a bounded HISTORY of our own recent writes
  // instead of just the latest one, so an out-of-order echo of any recent
  // self-write is still recognized and suppressed.
  const RECENT_SELF_SVG_CAP = 64;
  const recentSelfSvgsRef = useRef<Set<string>>(new Set());
  const rememberSelfSvg = useCallback((svg: string) => {
    const set = recentSelfSvgsRef.current;
    set.add(svg);
    if (set.size > RECENT_SELF_SVG_CAP) {
      const oldest = set.values().next().value;
      if (oldest !== undefined) set.delete(oldest);
    }
  }, []);
  useEffect(() => {
    const file = deriveFile();
    fileRef.current = file;
    if (!file) return;
    let cancelled = false;
    void fetch(`/_api/annotations?file=${encodeURIComponent(file)}`, {
      headers: { Accept: 'image/svg+xml' },
    })
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => {
        if (cancelled) return;
        const loaded = svgToStrokes(text);
        if (loaded.length) {
          setStrokesState(loaded);
          rememberSelfSvg(text);
        }
      })
      .catch(() => {
        /* network blip — start with an empty annotation set */
      });
    return () => {
      cancelled = true;
    };
  }, [rememberSelfSvg]);

  // Phase 8 Task 5 — observe the Y.Map.annotations for live updates from
  // other tabs. Bail when the incoming SVG STRING matches any RECENT
  // self-write (covers the local echo round-trip, including an
  // out-of-order one, without missing real foreign changes). The prior
  // length+first/last-id check was wrong: a resize / move keeps the same id
  // list, so all three predicates matched even though geometry changed —
  // foreign edits silently disappeared.
  const collab = useCollab();
  useEffect(() => {
    if (!collab) return;
    const map = collab.doc.getMap<string>('annotations');
    const apply = () => {
      const svg = map.get('svg');
      if (typeof svg !== 'string' || !svg) return;
      if (recentSelfSvgsRef.current.has(svg)) return;
      rememberSelfSvg(svg);
      const incoming = svgToStrokes(svg);
      setStrokesState((prev) => reconcileForeignEcho(prev, incoming));
    };
    apply();
    map.observe(apply);
    return () => {
      try {
        map.unobserve(apply);
      } catch {
        /* doc destroyed before unmount */
      }
    };
  }, [collab, rememberSelfSvg]);

  const undoStack = useUndoStackOptional();
  const undoSinks = useUndoSinks();
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  // feature-bulk-media-insert follow-up — dedicated PUT dispatch queue.
  // The undo-stack's own `inFlightRef` serializes its PUSH TASKS (each
  // awaits `cmd.do()` before the next task starts), but live network
  // capture during a rapid-fire batch drop showed the actual PUT REQUESTS
  // still overlapping (request N+1 starting before request N's response
  // arrived) — some other async hop between "task starts" and "fetch
  // fires" lets them interleave. Since every PUT body here is a strictly
  // growing superset (the media-commit-chain guarantees each commit is at
  // least as complete as the last), overlap is dangerous: if an EARLIER
  // (smaller) request's write lands on disk AFTER a LATER (larger) one's,
  // the smaller snapshot wins and silently erases the larger one's extra
  // strokes. A dedicated chain — mirroring `editApplyChainRef` in
  // client/app.jsx — makes the fetch DISPATCH itself wait for the
  // previous one's response, independent of whatever the undo-stack does.
  const putChainRef = useRef<Promise<void>>(Promise.resolve());

  /**
   * Apply a `Stroke[]` snapshot: update local React state AND fire-and-forget
   * PUT to the server. Used as the `putFn` injected into the
   * `AnnotationStrokesCommand` — both the initial push AND every undo/redo
   * replay route through here, so the iframe's `strokes` state always
   * tracks the server. (Without the setStrokesState here, Cmd+Z would
   * silently PUT the prior SVG but the canvas would keep painting the
   * post-edit strokes until the user reloaded.)
   *
   * The 200 ms scheduled-save debounce (legacy path) is cleared the moment
   * we push a command, so the server only sees one PUT per edit instead
   * of two-step racing.
   */
  const putStrokes = useCallback(
    (next: readonly Stroke[], before: readonly Stroke[]) => {
      // See reconcileCommit — a direct setStrokesState(next) here can
      // clobber a sibling file's concurrent optimistic insert; folding
      // blindly against `prev` (no baseline) can just as easily revert this
      // very mutation's own delete. `before` (this command's own baseline)
      // disambiguates the two.
      setStrokesState((prev) => reconcileCommit(prev, before, next));
      const file = fileRef.current;
      if (!file) return Promise.resolve();
      const persistable = next.some(isEphemeralHref)
        ? next.filter((s) => !isEphemeralHref(s))
        : next;
      const svg = strokesToSvg(persistable);
      // Phase 8 Task 5 — record the SVG we just authored locally so the
      // server-broadcast echo (PUT → onAnnotationsChanged → syncRoom* →
      // Y.Map.observe) doesn't trigger a redundant setStrokesState.
      rememberSelfSvg(svg);
      const dispatch = () =>
        fetch('/_api/annotations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file, svg }),
        })
          .then((r) => {
            // A refused save (403 read-only, 405 at a proxy door) previously
            // dissolved here without a trace — the user kept drawing on state
            // that never reached disk, a peer, or a reload (the cloud
            // canvas-writes RCA). Optimistic local state is still the right
            // UX; a persistence failure being INVISIBLE is not.
            if (!r.ok) {
              console.warn(`[annotations] save refused (${r.status}) — strokes are local-only`);
            }
            return undefined;
          })
          .catch(() => {
            /* swallow — user sees uncommitted state until the next stroke */
          });
      const chained = putChainRef.current.then(dispatch, dispatch);
      putChainRef.current = chained;
      return chained;
    },
    [rememberSelfSvg]
  );

  // Register the strokes put sink with the undo provider so the rebuilt
  // AnnotationStrokesCommand (after a canvas switch + return) routes through
  // THIS iframe's React state, not the gone iframe's stale closures.
  useEffect(() => {
    undoSinks.setSink('strokesPutFn', putStrokes);
    return () => undoSinks.setSink('strokesPutFn', undefined);
  }, [undoSinks, putStrokes]);

  /**
   * Single entry point for every stroke mutation. Builds an undo record
   * and pushes onto the stack — `push()` rebuilds the command via the
   * registered `strokesPutFn` sink and calls `cmd.do() = putStrokes(next)`,
   * which both updates local state and PUTs. Cancels any pending debounced
   * save first — DDR-050 gotcha: a queued auto-save flushing AFTER our PUT
   * would race the stack into a stale state.
   */
  const commitStrokes = useCallback(
    (prev: readonly Stroke[], next: readonly Stroke[], label?: string) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const record = buildAnnotationStrokesRecord({
        before: prev,
        after: next,
        ...(label ? { label } : {}),
      });
      void undoStackRef.current.push(record);
    },
    []
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
    const deleteStrokes = (ids: string[]): void => {
      const set = new Set(ids);
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
      const set = new Set(ids);
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
      const res = duplicateStrokes(prev, ids, dx, dy);
      if (res.strokes.length === prev.length) return [];
      const added = res.strokes.length - prev.length;
      commitStrokes(prev, res.strokes, `duplicate ${added} stroke${added === 1 ? '' : 's'}`);
      return res.newIds;
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
      const next = recomputeBoundArrows(alignStrokes(prev, ids, edge));
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(prev, next, `align ${edge}`);
    };
    const distributeSelection = (ids: readonly string[], axis: DistributeAxis): void => {
      const prev = strokesRef.current;
      const next = recomputeBoundArrows(distributeStrokes(prev, ids, axis));
      if (strokesShallowEqual(prev, next)) return;
      commitStrokes(prev, next, 'distribute');
    };
    // Wave H — transient per-tick path for handle drags (resize / rotate /
    // endpoint re-anchor). Local React state only — no undo push, no PUT —
    // mirroring the move-drag's onMove. `commitGesture` closes it as ONE
    // record (no-op when the gesture ended where it started).
    const previewStroke = (id: string, patch: Partial<Stroke>): void => {
      setStrokesState(
        recomputeBoundArrows(
          strokesRef.current.map((s) => (s.id === id ? ({ ...s, ...patch } as Stroke) : s))
        )
      );
    };
    const commitGesture = (before: readonly Stroke[], label?: string): void => {
      const cur = strokesRef.current;
      if (strokesShallowEqual(before, cur)) return;
      commitStrokes(before, cur, label);
    };
    return {
      strokes,
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
        setStrokesState((prev) => [...prev, optimistic]);
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
            setStrokesState((prev) => prev.filter((s) => s.id !== id));
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
          setEditCaretPoint({ x: e.clientX, y: e.clientY });
          setEditingId(strokeId);
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
      // z-order so content placed on them keeps rendering above.
      const next = committed.tool === 'section' ? [committed, ...prev] : [...prev, committed];
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

    const onDown = (e: PointerEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey) return; // escape hatch into element-selection
      const target = e.target as Element | null;
      if (target?.closest?.(CHROME_SELECTOR)) return; // chrome owns its clicks
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
          const res = duplicateStrokes(undoBase, ids, 0, 0);
          if (res.newIds.length) {
            altDup = true;
            dragSnapshot = res.strokes;
            setStrokesState(res.strokes);
            annotSel.replace(res.newIds);
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
        // FigJam v3 — dragging a SECTION carries everything sitting on it
        // (bbox-center containment, captured at gesture start).
        for (const s of dragSnapshot) {
          if (s.tool !== 'section' || !movedSet.has(s.id)) continue;
          const sx = Math.min(s.x, s.x + s.w);
          const sy = Math.min(s.y, s.y + s.h);
          const sx2 = sx + Math.abs(s.w);
          const sy2 = sy + Math.abs(s.h);
          for (const t of dragSnapshot) {
            if (movedSet.has(t.id) || t.tool === 'section') continue;
            const bb = strokeBBox(t);
            if (!bb) continue;
            const ccx = bb.x + bb.w / 2;
            const ccy = bb.y + bb.h / 2;
            if (ccx >= sx && ccx <= sx2 && ccy >= sy && ccy <= sy2) movedSet.add(t.id);
          }
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
          setStrokesState(next);
        };
        const onUp = (up: PointerEvent) => {
          const st = dragStateRef.current;
          if (!st || up.pointerId !== st.pointerId) return;
          dragStateRef.current = null;
          setSnapGuides(null);
          document.removeEventListener('pointermove', onMove, true);
          document.removeEventListener('pointerup', onUp, true);
          document.removeEventListener('pointercancel', onUp, true);
          // Commit the gesture as ONE record. Skip on zero-movement
          // (click without drag past threshold or drag back to origin).
          const final = strokesRef.current;
          if (strokesShallowEqual(st.snapshot, final)) {
            if (st.altDup) {
              // Alt+click without a drag — revert the eager clones.
              setStrokesState(st.undoBase);
              annotSel.replace(preAltIds);
            }
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
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
        return;
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
      const onUp = (_up: PointerEvent) => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
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
        const xMin = Math.min(final.ax, final.bx);
        const xMax = Math.max(final.ax, final.bx);
        const yMin = Math.min(final.ay, final.by);
        const yMax = Math.max(final.ay, final.by);
        const hits: string[] = [];
        for (const s of strokesStoreRef.current.strokes) {
          // Anchored text inherits its host's bbox (selected with the host);
          // standalone text (Phase 21) has its own synthetic bbox and IS
          // marquee-selectable.
          if (s.tool === 'text' && s.anchorId != null && s.anchorId !== '') continue;
          const bb = strokeBBox(s);
          if (!bb) continue;
          if (bb.x + bb.w >= xMin && bb.x <= xMax && bb.y + bb.h >= yMin && bb.y <= yMax) {
            hits.push(s.id);
          }
        }
        // Marquee that captured no strokes — preserve existing selection.
        if (hits.length === 0) return;
        // FigJam v3 — a marquee touching any group member selects the whole
        // group (tldraw: the brush resolves to the outermost ancestor).
        const expanded = expandIdsToGroups(hits, strokesStoreRef.current.strokes);
        if (addToSelection) annotSel.add(expanded);
        else annotSel.replace(expanded);
      };
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    };

    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
    // commitStrokes is included defensively (it is a stable useCallback([]) ref,
    // so this never re-binds the listener) to remove the latent stale-closure
    // trap flagged in the Phase 24 frontend review.
  }, [tool, annotSel, elementSel, screenToWorld, strokesStore, commitStrokes]);

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

    const onDown = (e: PointerEvent) => {
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
      setStrokesState(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = groupResizeRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      groupResizeRef.current = null;
      const final = strokesRef.current;
      // No-op drag (grabbed a handle, released without moving past the
      // resize's own resolution) skips the undo record.
      if (strokesShallowEqual(d.undoBase, final)) return;
      commitStrokes(d.undoBase, final, `resize ${d.ids.length} strokes`);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
    };
  }, [tool, annotSel, screenToWorld, anchorsById, commitStrokes]);

  // Double-click enters text-edit mode: rect/ellipse (anchored text), sticky
  // (its own body), or a standalone text node (re-edit in place). Anchored text
  // nodes are edited via their host, so a data-anchor-id text node is skipped.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (tool !== 'move') return;
    const onDbl = (e: MouseEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      const target = e.target as Element | null;
      const node = target?.closest?.('[data-id][data-tool]');
      if (!node) return;
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
        setEditCaretPoint({ x: e.clientX, y: e.clientY });
        setEditingId(id);
        return;
      }
      if (t === 'text' && !node.getAttribute('data-anchor-id')) {
        e.preventDefault();
        e.stopPropagation();
        setEditCaretPoint({ x: e.clientX, y: e.clientY });
        setEditingId(id);
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
  const editingTarget = useMemo<EditingTarget>(() => {
    if (pendingText) return { kind: 'pending', x: pendingText.x, y: pendingText.y };
    if (!editingId) return null;
    const host = anchorsById.get(editingId);
    if (host) return { kind: 'anchored', anchorId: editingId, host };
    const s = strokesById.get(editingId);
    if (s?.tool === 'sticky') return { kind: 'sticky', sticky: s };
    if (s?.tool === 'section') return { kind: 'section', section: s };
    if (s?.tool === 'text' && (s.anchorId == null || s.anchorId === ''))
      return { kind: 'standalone', text: s };
    return null;
  }, [pendingText, editingId, anchorsById, strokesById]);

  const editingTargetRef = useRef(editingTarget);
  editingTargetRef.current = editingTarget;

  const commitEditing = useCallback(
    (text: string, fmt?: EditorFmt, measuredH?: number) => {
      const target = editingTargetRef.current;
      setEditingId(null);
      setPendingText(null);
      setEditCaretPoint(null);
      if (!target) return;
      if (target.kind === 'anchored') commitText(target.anchorId, text, fmt);
      else if (target.kind === 'sticky') commitStickyText(target.sticky.id, text, fmt, measuredH);
      else if (target.kind === 'standalone') commitStandaloneText(target.text.id, text, fmt);
      else if (target.kind === 'section') {
        const label = text.trim().replace(/\s*\n+\s*/g, ' ') || 'Section';
        if (label !== target.section.label) {
          strokesStoreRef.current.updateStroke(target.section.id, {
            label,
          } as Partial<Stroke>);
        }
      } else if (target.kind === 'pending') createStandaloneText(target.x, target.y, text, fmt);
    },
    [commitText, commitStickyText, commitStandaloneText, createStandaloneText]
  );

  const cancelEditing = useCallback(() => {
    setEditingId(null);
    setPendingText(null);
    setEditCaretPoint(null);
  }, []);

  /**
   * FigJam v3 — copy/cut the (expanded) selection to the OS clipboard as a
   * `{"maudeStrokes":1}` JSON text payload. Shared by ⌘C/⌘X and the
   * right-click menu. Returns true when something was copied.
   */
  const copySelection = useCallback(
    (cut: boolean): boolean => {
      if (!annotSel) return false;
      const sel = annotSel.selectedIds;
      if (sel.length === 0) return false;
      const store = strokesStoreRef.current;
      const expanded = new Set(expandIdsToGroups(sel, store.strokes));
      const payload = store.strokes.filter(
        (s) =>
          expanded.has(s.id) ||
          (s.tool === 'text' && s.anchorId != null && expanded.has(s.anchorId))
      );
      if (payload.length === 0) return false;
      try {
        void navigator.clipboard
          ?.writeText(JSON.stringify({ maudeStrokes: 1, strokes: payload }))
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
   * FigJam v3 — paste a strokes JSON payload (⌘V or the right-click menu).
   * Round-trips through the serializer + parser so a malformed foreign payload
   * coerces to valid strokes or drops; clones get fresh ids + a +16/+16 offset.
   */
  const pasteStrokesText = useCallback(
    (txt: string): boolean => {
      if (!annotSel) return false;
      if (!txt.startsWith('{"maudeStrokes"')) return false;
      let parsed: { maudeStrokes?: number; strokes?: unknown } | null = null;
      try {
        parsed = JSON.parse(txt) as { maudeStrokes?: number; strokes?: unknown };
      } catch {
        return false;
      }
      if (parsed?.maudeStrokes !== 1 || !Array.isArray(parsed.strokes)) return false;
      let safe: Stroke[] = [];
      try {
        safe = svgToStrokes(strokesToSvg(parsed.strokes as Stroke[]));
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
  // and asks the layer (via this event) to chain the next sibling. Deferred a
  // tick so the editor's commit lands in strokesRef first.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChain = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      window.setTimeout(() => {
        chainCreate(id);
      }, 0);
    };
    document.addEventListener('maude:chain-create', onChain);
    return () => document.removeEventListener('maude:chain-create', onChain);
  }, [chainCreate]);

  // FigJam v3 — the resize overlay (a sibling component that owns the arrow
  // endpoint handles) broadcasts the bind candidate while an endpoint drags;
  // the halo renders here because the SVG layer owns the world overlay.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onHint = (e: Event) => {
      setBindHintId((e as CustomEvent<{ hostId?: string | null }>).detail?.hostId ?? null);
    };
    document.addEventListener('maude:bind-hint', onHint);
    return () => document.removeEventListener('maude:bind-hint', onHint);
  }, []);

  // FigJam v3 — live size label + dimension-match halos while resizing (the
  // overlay broadcasts; the SVG layer paints).
  const [resizeInfo, setResizeInfo] = useState<{
    box: { x: number; y: number; w: number; h: number } | null;
    matchIds: string[];
  } | null>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onInfo = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          box?: { x: number; y: number; w: number; h: number } | null;
          matchIds?: string[];
        }>
      ).detail;
      setResizeInfo(detail?.box ? { box: detail.box, matchIds: detail.matchIds ?? [] } : null);
    };
    document.addEventListener('maude:resize-info', onInfo);
    return () => document.removeEventListener('maude:resize-info', onInfo);
  }, []);

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
      if (!txt.startsWith('{"maudeStrokes"')) return;
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
    const onDown = (e: PointerEvent) => {
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
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
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
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [tool, screenToWorld, commitStrokes, annotSel, theme]);

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
    const onDown = (e: PointerEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      if (e.button !== 2) return;
      if (!strokeAt(e.target as Element | null)) return;
      e.stopImmediatePropagation();
    };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [tool, annotSel]);

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
}: {
  worldRef: ReturnType<typeof useWorldRefContext>;
  strokes: readonly Stroke[];
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
  const [, force] = useState({});
  useEffect(() => {
    if (worldRef?.current) return;
    const id = setTimeout(() => force({}), 0);
    return () => clearTimeout(id);
  }, [worldRef]);
  const target = worldRef?.current ?? null;
  if (!target) return null;
  // A sticky whose body is being edited hides its read-only text so the
  // editor textarea (rendered below at the same bbox) isn't double-painted.
  const editingStickyId = editingTarget?.kind === 'sticky' ? editingTarget.sticky.id : null;
  // Same double-paint issue for a section being renamed — its label chip must
  // hide while the StandaloneTextEditor sits at the same spot, else the old
  // label reads through behind the new text.
  const editingSectionId = editingTarget?.kind === 'section' ? editingTarget.section.id : null;
  const anchoredExisting =
    editingTarget?.kind === 'anchored'
      ? (strokes.find((s) => s.tool === 'text' && s.anchorId === editingTarget.anchorId) as
          | TextStroke
          | undefined)
      : undefined;
  // Same double-paint issue for a shape's anchored text — hide the read-only
  // <text> stroke while TextEditor sits at the same bbox (Phase 1 jump-fix
  // companion). Only applies once the TextStroke exists; a not-yet-created
  // one has nothing to hide.
  const editingAnchoredTextId = anchoredExisting?.id ?? null;
  // A standalone text being re-edited hides its read-only <text> too — the
  // editor paints at the same x/y, so leaving it visible double-paints (the
  // pre-Phase-2 "ghost" under the editor).
  const editingStandaloneTextId =
    editingTarget?.kind === 'standalone' ? editingTarget.text.id : null;
  return (
    <>
      {createPortal(
        <svg className="dc-annot-svg" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
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
          {strokes.map((s) => (
            <StrokeNode
              key={s.id}
              stroke={s}
              anchorsById={anchorsById}
              interactive={selectMode}
              editing={
                s.id === editingStickyId ||
                s.id === editingSectionId ||
                s.id === editingAnchoredTextId ||
                s.id === editingStandaloneTextId
              }
            />
          ))}
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
      <AnnotEditors
        worldRef={worldRef}
        editingTarget={editingTarget}
        anchoredExisting={anchoredExisting}
        caretPoint={editCaretPoint}
        inkColor={inkColor}
        onCommitEdit={onCommitEdit}
        onCancelEdit={onCancelEdit}
      />
    </>
  );
}

/**
 * The active annotation text editor, rendered as PLAIN HTML absolutely
 * positioned in the world div — NOT as SVG foreignObject. Same architectural
 * move as MediaRefPlayers below (read its docblock): foreignObject content
 * under the transformed `.dc-world` mis-hit-tests clicks at most zoom levels
 * (WebKit + Chromium), and the `.dc-annot-svg` root's pointer-events:none
 * additionally swallowed in-editor clicks — so caret-at-click could never
 * work. HTML children of the transformed div hit-test correctly by
 * construction. World coords map 1:1 (the div carries the pan/zoom
 * transform), so each editor's old foreignObject x/y/w/h becomes left/top/
 * width/height verbatim. The [data-annot-editor] attr keeps document-capture
 * annotation handlers out (isAnnotEditorTarget guard, mirroring
 * [data-mediaref-player]).
 */
function AnnotEditors({
  worldRef,
  editingTarget,
  anchoredExisting,
  caretPoint,
  inkColor,
  onCommitEdit,
  onCancelEdit,
}: {
  worldRef: ReturnType<typeof useWorldRefContext>;
  editingTarget: EditingTarget;
  anchoredExisting: TextStroke | undefined;
  caretPoint: { x: number; y: number } | null;
  inkColor: string;
  onCommitEdit: (text: string, fmt?: EditorFmt, measuredH?: number) => void;
  onCancelEdit: () => void;
}) {
  const target = worldRef?.current ?? null;
  if (!target || !editingTarget) return null;
  return createPortal(
    <>
      {editingTarget.kind === 'anchored' ? (
        <TextEditor
          anchorId={editingTarget.anchorId}
          host={editingTarget.host}
          existing={anchoredExisting}
          caretPoint={caretPoint}
          onCommit={(_anchorId, text, fmt) => onCommitEdit(text, fmt)}
          onCancel={onCancelEdit}
        />
      ) : null}
      {editingTarget.kind === 'sticky' ? (
        <StickyEditor
          sticky={editingTarget.sticky}
          caretPoint={caretPoint}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : null}
      {editingTarget.kind === 'standalone' ? (
        <StandaloneTextEditor
          x={editingTarget.text.x ?? 0}
          y={editingTarget.text.y ?? 0}
          fontSize={editingTarget.text.fontSize}
          color={editingTarget.text.color}
          initialText={editingTarget.text.text}
          bold={editingTarget.text.bold}
          italic={editingTarget.text.italic}
          strike={editingTarget.text.strike}
          underline={editingTarget.text.underline}
          align={editingTarget.text.align ?? 'left'}
          listType={editingTarget.text.listType}
          caretPoint={caretPoint}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : null}
      {editingTarget.kind === 'pending' ? (
        <StandaloneTextEditor
          x={editingTarget.x}
          y={editingTarget.y}
          fontSize={DEFAULT_FONT_SIZE}
          color={inkColor}
          initialText=""
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : null}
      {editingTarget.kind === 'section' ? (
        <SectionTitleEditor
          section={editingTarget.section}
          caretPoint={caretPoint}
          onCommit={onCommitEdit}
          onCancel={onCancelEdit}
        />
      ) : null}
    </>,
    target
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

// An empty flex-centered contentEditable has no line box for `justifyContent:
// 'center'` to center — WebKit parks the caret at the box's top, then jumps it
// to the true centered position the instant a real character exists. A
// zero-width space gives the box real (invisible) content from mount, so the
// caret starts centered and never jumps. Stripped back off on commit.
const JUMP_SENTINEL = '\u200B';
function stripJumpSentinel(text: string): string {
  return text.startsWith(JUMP_SENTINEL) ? text.slice(JUMP_SENTINEL.length) : text;
}

// Unified caret style across every contentEditable text surface (annotation
// editors here + the artboard inline editor's `.dc-text-editing` CSS in
// canvas-shell.tsx use the SAME `--maude-hud-accent` so the caret reads the
// same everywhere). An explicit caretColor makes the caret visible against any
// background. NOTE: deliberately NO `transform: translateZ(0)` / `will-change`
// here \u2014 promoting a contentEditable onto its own compositing layer is a known
// WebKit caret-BLINK killer (the compositor caches the layer and never repaints
// the blink, so the caret shows as a static line). A prior dogfood pass added
// translateZ(0) to "restore" the caret and instead froze its blink; removing it
// lets WebKit run the native blink. The editor already lives inside the
// transformed `.dc-world`, but that ancestor transform alone does not stop the
// blink \u2014 only a compositing trigger ON the editable does.
const CARET_FIX_STYLE = {
  caretColor: 'var(--maude-hud-accent, #4a63e7)',
} as const;

/**
 * Phase 3 (unified-text-editing) — shared caret behavior for every annotation
 * editor. On mount: focus, place a collapsed caret at the entry click point
 * (`placeCaretAt`, the SAME chain the artboard's enterEditModeAt uses;
 * keyboard entry has no point → select-all, the rename convention), and mount
 * the custom blinking caret (text-caret.ts) for the session. Afterwards every
 * plain in-editor click re-places the caret from its coordinates on pointerup
 * so repositioning never depends on native hit-testing (synthetic e2e clicks
 * take the same path — untrusted events get no UA caret action at all).
 * Shift-clicks and drag-selections keep native behavior; ⌘A stays native.
 */
function useEditorCaret(
  ref: RefObject<HTMLDivElement | null>,
  caretPoint: { x: number; y: number } | null | undefined
) {
  const entryPointRef = useRef(caretPoint ?? null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    placeCaretAt(el, window, entryPointRef.current ?? undefined);
    return mountCaret(el, window);
  }, [ref]);
  const downRef = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    downRef.current = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null;
  }, []);
  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = downRef.current;
      downRef.current = null;
      if (!d || e.shiftKey) return;
      // A real drag is a range-selection gesture — leave it to the engine.
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 3) return;
      const el = ref.current;
      if (!el) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // double-click word-select etc.
      placeCaretAt(el, window, { x: e.clientX, y: e.clientY }, false);
    },
    [ref]
  );
  return { onPointerDown, onPointerUp };
}

/**
 * issue-106 — the body an annotation editor hands React as its contentEditable
 * children, snapshotted for the life of ONE edit session.
 *
 * These editors are uncontrolled: the user types straight into the DOM. If the
 * rendered children value changes while the session is open, React writes the
 * new string into the live node and everything typed since — line breaks
 * included — is gone. That is exactly what a peer's commit arriving over
 * shared-doc sync (DDR-064) used to do, and what the hazard note above
 * `useEditorFormat` warns about for local mutations. Snapshotting per target id
 * makes the children a constant for the session, so no store update can reach
 * the DOM; the commit path reads `innerText` from the node itself, which is the
 * user's real content either way. Re-keys when the editor is reused for a
 * different stroke.
 *
 * `listType` is snapshotted through the same hook: the body is prefixed with
 * list markers at OPEN time and stripped again at commit, so if a peer flipped
 * the stroke's list style mid-session the strip would run a different rule than
 * the prefix did — turning a bullet into a literal "• " in the stored text, or
 * eating a leading "1. " the user actually typed.
 */
function useSessionValue<T>(id: string, compute: () => T): T {
  const ref = useRef<{ id: string; value: T } | null>(null);
  if (ref.current === null || ref.current.id !== id) ref.current = { id, value: compute() };
  return ref.current.value;
}

function TextEditor({
  anchorId,
  host,
  existing,
  caretPoint,
  onCommit,
  onCancel,
}: {
  anchorId: string;
  host: AnchorHost | null;
  existing: TextStroke | undefined;
  caretPoint?: { x: number; y: number } | null;
  onCommit: (anchorId: string, text: string, fmt?: EditorFmt) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Show list markers WHILE editing so the read↔edit swap doesn't flicker
  // (item 4c) — stripped back to raw text on commit.
  const sessionListType = useSessionValue(anchorId, () => existing?.listType);
  const initial = useSessionValue(anchorId, () =>
    listPrefixedBody(existing?.text ?? '', sessionListType)
  );
  // Cmd/Ctrl+B/I/U formatting while editing (item 4d).
  const {
    fmtRef,
    style: fmtStyle,
    onFormatKey,
  } = useEditorFormat({
    bold: existing?.bold,
    italic: existing?.italic,
    underline: existing?.underline,
    strike: existing?.strike,
    fontSize: existing?.fontSize ?? DEFAULT_FONT_SIZE,
    align: existing?.align ?? 'center',
  });
  // Both commit sites below (outside-click + Cmd/Ctrl+Enter) need the same
  // sentinel-strip + marker-strip pipeline. Memoized so the outside-click
  // effect below can depend on it directly instead of its own copy of
  // existing?.listType (lint/correctness/useExhaustiveDependencies).
  const toCommittedText = useCallback(
    (raw: string) => stripEditorMarkers(stripJumpSentinel(raw), sessionListType),
    [sessionListType]
  );

  // Caret-at-click on entry + custom blinking caret + click re-placement
  // (select-all only for keyboard entry — see useEditorCaret).
  const caretHandlers = useEditorCaret(ref, caretPoint);

  // Commit on outside click; cancel-on-Esc handled in onKeyDown below.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onDown = (e: PointerEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      // FigJam v3 — the edit-mode text toolbar drives THIS editor; clicking
      // it must not commit-and-close the session.
      if ((e.target as Element | null)?.closest?.('.dc-annot-ctx')) return;
      onCommit(anchorId, toCommittedText(el.innerText || ''), fmtRef.current);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [anchorId, onCommit, fmtRef, toCommittedText]);

  if (!host) return null;
  const bbox = strokeBBox(host);
  if (!bbox) return null;
  const fontSize = existing?.fontSize ?? DEFAULT_FONT_SIZE;
  // Phase 24 — match the committed render's bold / strike / align (anchored
  // default align = centre).
  const align = existing?.align ?? 'center';
  return (
    // Plain HTML host in the world div (NOT foreignObject — see AnnotEditors'
    // docblock): world coords map 1:1 to left/top, clicks hit-test correctly.
    <div
      data-annot-editor="1"
      style={{
        position: 'absolute',
        left: bbox.x,
        top: bbox.y,
        width: Math.max(20, bbox.w),
        height: Math.max(20, bbox.h),
        zIndex: 5,
      }}
    >
      <div
        ref={ref}
        className="dc-annot-editor"
        contentEditable
        suppressContentEditableWarning
        aria-label="Edit annotation text"
        style={{
          width: '100%',
          height: '100%',
          // Column flex (NOT row) so contentEditable line breaks stack
          // vertically; justify-center keeps the block vertically centred in
          // the host. The pre-Task-5 row-flex laid lines out side-by-side
          // (item 4a — the mangled multi-line look).
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
          padding: '0 8px',
          boxSizing: 'border-box',
          textAlign: align,
          whiteSpace: 'pre-wrap',
          color: existing?.color ?? '#1a1a1a',
          fontSize: `${fontSize}px`,
          fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          ...fmtStyle,
          lineHeight: 1.25,
          outline: 'none',
          background: 'transparent',
          cursor: 'text',
          ...CARET_FIX_STYLE,
        }}
        onPointerDown={caretHandlers.onPointerDown}
        onPointerUp={caretHandlers.onPointerUp}
        onKeyDown={(e) => {
          if (onFormatKey(e)) return; // Cmd/Ctrl+B/I/U
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
          // issue-106 — Shift+Enter ADDS a line. On keyboard entry the whole
          // body is still select-all'd (the retype convention), so letting the
          // break replace the selection wiped the text. Collapse that entry
          // selection to its end first; a user's own partial selection is left
          // alone. See collapseEntrySelectAll.
          if (e.key === 'Enter' && e.shiftKey && ref.current) {
            collapseEntrySelectAll(ref.current, window);
          }
          // Unified across every text surface: plain Enter commits,
          // Shift+Enter inserts a newline (falls through untouched). ⌘/Ctrl
          // +Enter also commits AND chains a connected sibling (quick-create).
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const el = ref.current;
            onCommit(anchorId, toCommittedText(el?.innerText || ''), fmtRef.current);
            if (e.metaKey || e.ctrlKey) {
              document.dispatchEvent(
                new CustomEvent('maude:chain-create', { detail: { id: anchorId } })
              );
            }
          }
        }}
      >
        {initial || JUMP_SENTINEL}
      </div>
    </div>
  );
}

// Phase 21 — sticky body editor, hosted as plain HTML at the card's bbox in
// the world div (word-wrap + zoom come from the div's own box + the world
// transform). Commit on blur, cancel on Esc; Enter commits, Shift+Enter
// inserts a newline.
function StickyEditor({
  sticky,
  caretPoint,
  onCommit,
  onCancel,
}: {
  sticky: StickyStroke;
  caretPoint?: { x: number; y: number } | null;
  onCommit: (text: string, fmt?: EditorFmt, measuredH?: number) => void;
  onCancel: () => void;
}) {
  // A flex-centered contentEditable (NOT a textarea) so the edit view matches
  // the committed `.dc-sticky-body` exactly — text stays centered, no jump on
  // commit. Multi-line: Shift+Enter inserts a line break, plain Enter commits;
  // Esc cancels; blur commits; Cmd/Ctrl+B/I/U format (unified with the others).
  const ref = useRef<HTMLDivElement | null>(null);
  const doneRef = useRef(false);
  const sessionListType = useSessionValue(sticky.id, () => sticky.listType);
  const sessionBody = useSessionValue(sticky.id, () => stickyBodyText(sticky));
  const {
    fmtRef,
    style: fmtStyle,
    onFormatKey,
  } = useEditorFormat({
    bold: sticky.bold,
    italic: sticky.italic,
    underline: sticky.underline,
    strike: sticky.strike,
    fontSize: sticky.fontSize,
    align: sticky.align ?? 'left',
  });
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const el = ref.current;
    // issue-106 — the editor IS the measurement: same class, same width, same
    // font as the committed body, and laid out in world units (the pan/zoom
    // transform on `.dc-world` doesn't change layout), so its scrollHeight is
    // the height the card needs. No offscreen measuring rig required.
    onCommit(
      stripEditorMarkers(el?.innerText ?? '', sessionListType),
      fmtRef.current,
      el?.scrollHeight
    );
  };
  // FigJam v3 — a toolbar click steals focus for a tick; don't treat it as
  // "done editing" (the button's onMouseDown preventDefault usually stops the
  // blur, this guards the browsers where it doesn't).
  const onBlur = (e: { relatedTarget?: EventTarget | null }) => {
    const to = e.relatedTarget as Element | null;
    if (to?.closest?.('.dc-annot-ctx')) return;
    commit();
  };
  // Caret-at-click on entry + custom blinking caret + click re-placement.
  const caretHandlers = useEditorCaret(ref, caretPoint);
  const x = Math.min(sticky.x, sticky.x + sticky.w);
  const y = Math.min(sticky.y, sticky.y + sticky.h);
  const w = Math.abs(sticky.w);
  const h = Math.abs(sticky.h);
  const r = sticky.cornerRadius ?? STICKY_CORNER_RADIUS;
  return (
    <div
      data-annot-editor="1"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        // issue-106 — NOT a fixed `height: h`. The card clips at `overflow:
        // hidden`, so on a sticky that is already full the line Shift+Enter
        // inserts landed outside the box: the keystroke worked, nothing moved
        // on screen, and it read as "shift+enter does nothing". While the
        // editor is open it grows downward instead, painting its own paper so
        // the overflow still reads as the note (the SVG card behind is still
        // the old size until the commit below persists the grown height).
        minHeight: h,
        zIndex: 5,
        // `backgroundColor`, never the `background` shorthand: `color` comes
        // verbatim from a synced stroke's `fill` (peer-controlled, and the
        // sanitizer does not touch `fill`), and the shorthand would accept a
        // `url(...)` — an outbound request from the studio origin the moment a
        // note is opened. `background-color` cannot take one.
        backgroundColor: sticky.color,
        // Mirrors stickyCornerPath: TL/TR/BL rounded, BR sharp.
        borderRadius: `${r}px ${r}px 0 ${r}px`,
      }}
    >
      <div
        ref={ref}
        className="dc-annot-editor dc-sticky-body"
        contentEditable
        suppressContentEditableWarning
        aria-label="Edit sticky note text"
        style={{
          ...stickyBodyStyle(sticky),
          ...fmtStyle,
          outline: 'none',
          cursor: 'text',
          ...CARET_FIX_STYLE,
          // Beats `.dc-sticky-body { height: 100%; overflow: hidden }` for the
          // duration of the edit — see the wrapper note above.
          height: 'auto',
          minHeight: h,
          overflow: 'visible',
        }}
        onBlur={onBlur}
        onPointerDown={caretHandlers.onPointerDown}
        onPointerUp={caretHandlers.onPointerUp}
        onKeyDown={(e) => {
          if (onFormatKey(e)) return; // Cmd/Ctrl+B/I/U
          if (e.key === 'Escape') {
            e.preventDefault();
            doneRef.current = true; // suppress the unmount blur-commit
            onCancel();
            return;
          }
          // issue-106 — see the same guard in TextEditor: Shift+Enter must add
          // a line, never consume the entry select-all and delete the body.
          if (e.key === 'Enter' && e.shiftKey && ref.current) {
            collapseEntrySelectAll(ref.current, window);
          }
          // Unified: plain Enter commits, Shift+Enter inserts a newline.
          // ⌘/Ctrl+Enter also commits AND chains the next sticky beside it.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
            if (e.metaKey || e.ctrlKey) {
              document.dispatchEvent(
                new CustomEvent('maude:chain-create', { detail: { id: sticky.id } })
              );
            }
          }
        }}
      >
        {/* Show the list markers while editing (item 4c) so the read↔edit swap
            doesn't flicker; stripped back to raw text on commit. */}
        {sessionBody}
      </div>
    </div>
  );
}

// Phase 21 — standalone text editor. A single-line contentEditable box anchored
// at the world (x, y). Enter / blur / outside-click commit; Esc cancels.
function StandaloneTextEditor({
  x,
  y,
  fontSize,
  color,
  initialText,
  bold,
  italic,
  strike,
  underline,
  align,
  listType,
  singleLine,
  boxStyle,
  caretPoint,
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  fontSize: number;
  color: string;
  initialText: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  underline?: boolean;
  align?: TextAlign;
  listType?: ListType;
  /** The click that opened the editor — caret lands there (Phase 3). */
  caretPoint?: { x: number; y: number } | null;
  /** A one-line field (e.g. a section title rename) — plain Enter commits
   * instead of inserting a newline, matching a native text-input's Enter. */
  singleLine?: boolean;
  /** Extra style merged onto the editable box — e.g. a section rename wants
   * the same chip background/padding/radius the read-only label chip has. */
  boxStyle?: CSSProperties;
  onCommit: (text: string, fmt?: EditorFmt) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Cmd/Ctrl+B/I/U formatting while editing (item 4d).
  const {
    fmtRef,
    style: fmtStyle,
    onFormatKey,
  } = useEditorFormat({
    bold,
    italic,
    underline,
    strike,
    fontSize,
    align: align ?? 'left',
  });
  // Single-fire commit guard — outside-click + blur can both fire in one tick;
  // without this the text would commit twice (two undo records). Markers shown
  // while editing (item 4c) are stripped back to raw text here on commit.
  const doneRef = useRef(false);
  const commitOnce = useCallback(
    (text: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onCommit(stripEditorMarkers(text, listType), fmtRef.current);
    },
    [onCommit, listType, fmtRef]
  );
  // Caret-at-click on entry + custom blinking caret + click re-placement.
  const caretHandlers = useEditorCaret(ref, caretPoint);
  // Commit on outside click.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onDown = (e: PointerEvent) => {
      if (isMediaPlayerTarget(e)) return; // mediaref inline player owns this event
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      // FigJam v3 — clicks into the edit-mode text toolbar keep the session.
      if ((e.target as Element | null)?.closest?.('.dc-annot-ctx')) return;
      commitOnce(el.innerText || '');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [commitOnce]);
  return (
    // Generous box so multi-line text isn't clipped while typing (item 4a).
    // The host passes pointer events through (empty area is not the editor —
    // outside-click must still commit); only the editable itself is
    // interactive, so clicks in it place the caret.
    <div
      data-annot-editor="1"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: 640,
        height: 480,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <div
        ref={ref}
        className="dc-annot-editor"
        contentEditable
        suppressContentEditableWarning
        aria-label="Edit text"
        style={{
          display: 'inline-block',
          minWidth: '8px',
          // The pass-through host (above) is inert — re-enable events HERE so
          // in-editor clicks place the caret instead of falling through.
          pointerEvents: 'auto',
          // pre-wrap so Enter inserts a real newline (multi-line text), not a
          // commit; long lines also wrap within the box.
          whiteSpace: 'pre-wrap',
          padding: '0 2px',
          color,
          fontSize: `${fontSize}px`,
          fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          ...fmtStyle,
          textAlign: align ?? 'left',
          lineHeight: TEXT_LINE_HEIGHT,
          outline: 'none',
          background: 'transparent',
          cursor: 'text',
          ...CARET_FIX_STYLE,
          ...boxStyle,
        }}
        onBlur={() => commitOnce(ref.current?.innerText || '')}
        onPointerDown={caretHandlers.onPointerDown}
        onPointerUp={caretHandlers.onPointerUp}
        onKeyDown={(e) => {
          if (onFormatKey(e)) return; // Cmd/Ctrl+B/I/U
          if (e.key === 'Escape') {
            e.preventDefault();
            // Mark done so the unmount blur that follows doesn't commit.
            doneRef.current = true;
            onCancel();
            return;
          }
          // issue-106 — same guard as the other two editors, for the multi-line
          // case only (a singleLine field commits on Shift+Enter anyway).
          if (e.key === 'Enter' && e.shiftKey && !singleLine && ref.current) {
            collapseEntrySelectAll(ref.current, window);
          }
          // Unified: plain Enter commits, Shift+Enter inserts a newline. A
          // singleLine field (section rename) is a title — Shift+Enter commits
          // too rather than adding a newline the one-line chip can't show.
          if (e.key === 'Enter' && (!e.shiftKey || singleLine)) {
            e.preventDefault();
            commitOnce(ref.current?.innerText || '');
          }
        }}
      >
        {listPrefixedBody(initialText, listType)}
      </div>
    </div>
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
function stickyBodyStyle(s: StickyStroke): CSSProperties {
  const align = s.align ?? 'left';
  return {
    fontSize: `${s.fontSize}px`,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textDecoration: textDecoCss(s.strike, s.underline),
    textAlign: align,
    justifyContent: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
  };
}

/** Sticky body content: raw text for a plain card, else per-line with list
 *  markers prepended (item 4c — markers are render-only). */
function stickyBodyText(s: StickyStroke): string {
  if (!s.listType) return s.text;
  return splitTextLines(s.text)
    .map((line, i) => listPrefixedLine(line, i, s.listType))
    .join('\n');
}

/**
 * Render the inner content of a `<text>` stroke: a single string for single-
 * line unstyled text (item 4a parity with the legacy form), else one `<tspan>`
 * per line with list markers prepended (item 4c). `tx` is the per-line origin;
 * `centered` lifts the block half its height for vertically-centred anchored
 * text. Mirrors `textInnerSvg` so the live + persisted geometry agree.
 */
function renderTextLines(
  text: string,
  fontSize: number,
  tx: number,
  centered: boolean,
  list?: ListType
) {
  if (!list && !text.includes('\n')) return text;
  const lines = splitTextLines(text);
  return lines.map((line, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional + immutable per render
    <tspan key={i} x={tx} dy={textLineDy(i, fontSize, lines.length, centered)}>
      {listPrefixedLine(line, i, list)}
    </tspan>
  ));
}

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

/**
 * FigJam v3 — rotation wrapper. The base node renders axis-aligned geometry;
 * a rotated stroke wraps it in a `rotate()` group around its bbox center
 * (anchored text inherits its HOST's rotation so labels turn with the shape).
 * Pointer events pass through the group, so hit-testing + the ctx-toolbar's
 * getBoundingClientRect positioning keep working on the rotated form.
 */
/** Section title chip — deliberately screen-size-constant. The body/border
 * scale with the world like everything else, but a title that shrinks to
 * unreadable at zoom-out defeats the point of a label (matches the `r={5/zoom}`
 * counter-scale convention used for halos/connector-dots elsewhere in this file). */
function SectionLabelChip({
  stroke,
  x,
  y,
  hitMode,
}: {
  stroke: SectionStroke;
  x: number;
  y: number;
  hitMode: 'visiblePainted' | 'none';
}) {
  // Counter-scaled chrome — must hold a constant screen size while the world
  // scales, so it needs the live zoom, not the settle-cadence published one.
  const zoom = useLiveViewport().zoom || 1;
  const fontSize = SECTION_LABEL_FONT / zoom;
  const chipH = SECTION_LABEL_H / zoom;
  const gap = 4 / zoom;
  const padX = 9 / zoom;
  const chipW = Math.max(56 / zoom, stroke.label.length * fontSize * 0.62 + 18 / zoom);
  // NOTE: this chip geometry (chipW/chipH/gap vs the region's y) is mirrored
  // by findTextStrokeAt's section branch — the Text tool's click-through
  // renames a section only from its label chip. Keep the two in sync.
  return (
    <g pointerEvents={hitMode}>
      <rect
        x={x}
        y={y - chipH - gap}
        width={chipW}
        height={chipH}
        rx={5 / zoom}
        ry={5 / zoom}
        fill={stroke.color}
        fillOpacity={0.16}
      />
      <text
        x={x + padX}
        y={y - chipH / 2 - gap}
        dominantBaseline="middle"
        fontSize={fontSize}
        fill={stroke.color}
        style={{
          fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        }}
      >
        {stroke.label}
      </text>
    </g>
  );
}

/** Section title RENAME field — same chip visuals + zoom-invariant sizing as
 * SectionLabelChip (read state), so switching into edit mode doesn't swap
 * the pill for a bare, ambient-zoomed sliver of text (it used to: the editor
 * had no background and its font-size wasn't counter-scaled, so at any zoom
 * below 1× the chip effectively vanished mid-rename). */
function SectionTitleEditor({
  section,
  caretPoint,
  onCommit,
  onCancel,
}: {
  section: SectionStroke;
  caretPoint?: { x: number; y: number } | null;
  onCommit: (text: string, fmt?: EditorFmt) => void;
  onCancel: () => void;
}) {
  // Counter-scaled chrome — must hold a constant screen size while the world
  // scales, so it needs the live zoom, not the settle-cadence published one.
  const zoom = useLiveViewport().zoom || 1;
  const fontSize = SECTION_LABEL_FONT / zoom;
  const chipH = SECTION_LABEL_H / zoom;
  const gap = 4 / zoom;
  const padX = 9 / zoom;
  const x = Math.min(section.x, section.x + section.w);
  const y = Math.min(section.y, section.y + section.h);
  return (
    <StandaloneTextEditor
      x={x}
      y={y - chipH - gap}
      fontSize={fontSize}
      color={section.color}
      initialText={section.label}
      caretPoint={caretPoint}
      singleLine
      boxStyle={{
        background: `color-mix(in oklab, ${section.color} 16%, transparent)`,
        borderRadius: `${5 / zoom}px`,
        padding: `0 ${padX}px`,
        minHeight: `${chipH}px`,
        lineHeight: `${chipH}px`,
        whiteSpace: 'nowrap',
      }}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

function StrokeNode(props: {
  stroke: Stroke;
  anchorsById: Map<string, AnchorHost>;
  interactive: boolean;
  editing?: boolean;
}) {
  const { stroke, anchorsById } = props;
  let rot = strokeRotation(stroke);
  let pivot = rot !== 0 ? strokeCenter(stroke) : null;
  if (stroke.tool === 'text' && stroke.anchorId != null && stroke.anchorId !== '') {
    const host = anchorsById.get(stroke.anchorId);
    rot = host ? strokeRotation(host) : 0;
    pivot = rot !== 0 && host ? strokeCenter(host) : null;
  }
  const node = <StrokeNodeBase {...props} />;
  if (rot === 0 || !pivot) return node;
  return <g transform={`rotate(${rot} ${pivot[0]} ${pivot[1]})`}>{node}</g>;
}

function StrokeNodeBase({
  stroke,
  anchorsById,
  interactive,
  editing = false,
}: {
  stroke: Stroke;
  anchorsById: Map<string, AnchorHost>;
  interactive: boolean;
  /** Hide the read-only body/text while its editor is up (sticky, section, or
   *  anchored shape text — whichever this stroke is). */
  editing?: boolean;
}) {
  // In Move mode, individual stroke nodes claim pointer events so we can
  // hit-test them from the doc-level capture listener. In draw mode the
  // overlay above handles input, so the strokes themselves stay inert.
  const hitMode = interactive ? 'visiblePainted' : ('none' as const);
  const strokeHit = interactive ? 'stroke' : ('none' as const);
  if (stroke.tool === 'text') {
    // Anchored text renders centered in its host; standalone (Phase 21) renders
    // top-left-anchored at its own world (x, y). bold / italic / strike /
    // underline applied to the rendered <text>; multi-line + list markers via
    // renderTextLines (one <tspan> per line).
    const textStyle = {
      fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      fontWeight: stroke.bold ? 700 : undefined,
      fontStyle: stroke.italic ? 'italic' : undefined,
      textDecoration: textDecoCss(stroke.strike, stroke.underline),
    } as const;
    if (stroke.anchorId != null && stroke.anchorId !== '') {
      const host = anchorsById.get(stroke.anchorId);
      const bbox = host ? strokeBBox(host) : null;
      if (!bbox) return null;
      // Its editor (TextEditor) paints the same bbox while active — skip the
      // read-only <text> so the two don't double-paint (Phase 1 jump-fix
      // companion: the editor was already exempt via editingStickyId's
      // sibling, this stroke type never was).
      if (editing) return null;
      const cy = bbox.y + bbox.h / 2;
      const align = stroke.align ?? 'center';
      const pad = 8;
      const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
      const tx =
        align === 'left'
          ? bbox.x + pad
          : align === 'right'
            ? bbox.x + bbox.w - pad
            : bbox.x + bbox.w / 2;
      return (
        <text
          data-id={stroke.id}
          data-tool="text"
          data-anchor-id={stroke.anchorId}
          data-font-size={stroke.fontSize}
          x={tx}
          y={cy}
          fill={stroke.color}
          fontSize={stroke.fontSize}
          textAnchor={anchor}
          dominantBaseline="middle"
          style={textStyle}
        >
          {renderTextLines(stroke.text, stroke.fontSize, tx, true, stroke.listType)}
        </text>
      );
    }
    // Its editor (StandaloneTextEditor) paints at the same x/y while active —
    // skip the read-only <text> so the two don't double-paint (the "ghost").
    if (editing) return null;
    const align = stroke.align ?? 'left';
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const tx = stroke.x ?? 0;
    return (
      <text
        data-id={stroke.id}
        data-tool="text"
        data-font-size={stroke.fontSize}
        x={tx}
        y={stroke.y ?? 0}
        fill={stroke.color}
        fontSize={stroke.fontSize}
        textAnchor={anchor}
        dominantBaseline="hanging"
        pointerEvents={interactive ? 'visiblePainted' : 'none'}
        style={textStyle}
      >
        {renderTextLines(stroke.text, stroke.fontSize, tx, false, stroke.listType)}
      </text>
    );
  }
  if (stroke.tool === 'sticky') {
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const w = Math.abs(stroke.w);
    const h = Math.abs(stroke.h);
    const r = stroke.cornerRadius ?? STICKY_CORNER_RADIUS;
    return (
      <g data-id={stroke.id} data-tool="sticky" pointerEvents={hitMode}>
        {/* Paper card: soft drop shadow + hairline edge so it reads as a
            lifted sticky, not a flat colored box (FigJam-style). The body is a
            path with a SHARP bottom-right corner (item 1) — TL/TR/BL rounded.
            The persisted form stays a <rect> (DDR), so this is render-only. */}
        <path
          d={stickyCornerPath(x, y, w, h, r)}
          fill={stroke.color}
          stroke="rgba(0,0,0,0.05)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          filter="url(#dc-sticky-shadow)"
        />
        {editing ? null : (
          <foreignObject x={x} y={y} width={w} height={h} pointerEvents="none">
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              className="dc-sticky-body"
              style={stickyBodyStyle(stroke)}
            >
              {stickyBodyText(stroke)}
            </div>
          </foreignObject>
        )}
        {/* Phase 3 (whiteboard-improvements) — author badge, bottom-right
            corner. A name label (not an avatar — a full name/nickname reads
            faster than initials and doesn't need a legend to decode). Color
            re-derives from the (sanitized) name via colorForName — NEVER a
            stored/wire color — so it matches the author's live presence hue
            (cursor/avatar use the same function). foreignObject width is a
            fixed generous box right-anchored via flex, since a name's pixel
            width isn't known without measuring the DOM. */}
        {stroke.authorName && (
          <foreignObject
            x={x + w - 160}
            y={y + h - 20}
            width={160}
            height={20}
            pointerEvents="none"
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                height: '100%',
                paddingRight: 4,
              }}
            >
              <span
                title={stroke.authorName}
                style={{
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 9,
                  fontWeight: 600,
                  fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
                  color: colorForName(stroke.authorName),
                  background: 'rgba(255,255,255,0.78)',
                  padding: '1px 5px',
                  borderRadius: 8,
                  lineHeight: 1.4,
                }}
              >
                {stroke.authorName}
              </span>
            </div>
          </foreignObject>
        )}
      </g>
    );
  }
  if (stroke.tool === 'image') {
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const w = Math.abs(stroke.w);
    const h = Math.abs(stroke.h);
    return (
      <image
        data-id={stroke.id}
        data-tool="image"
        x={x}
        y={y}
        width={w}
        height={h}
        href={resolveAssetHref(stroke.href)}
        preserveAspectRatio="xMidYMid meet"
        aria-label={stroke.alt || undefined}
        pointerEvents={hitMode}
      />
    );
  }
  if (stroke.tool === 'link') {
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const w = Math.abs(stroke.w);
    const h = Math.abs(stroke.h);
    const lay = linkCardLayout(x, y, w, h);
    const shownTitle = clampLinkTitle(stroke.title, lay.textMaxChars);
    const textFont = {
      fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    } as const;
    return (
      <g
        data-id={stroke.id}
        data-tool="link"
        data-url={stroke.url}
        data-title={stroke.title}
        data-domain={stroke.domain}
        pointerEvents={hitMode}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={8}
          ry={8}
          fill={LINK_CARD_FILL}
          stroke={LINK_CARD_STROKE}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          filter="url(#dc-sticky-shadow)"
        />
        <svg
          x={lay.glyph.x}
          y={lay.glyph.y}
          width={lay.glyph.size}
          height={lay.glyph.size}
          viewBox="0 0 24 24"
          fill="none"
          stroke={LINK_GLYPH_STROKE}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={LINK_GLYPH_D1} />
          <path d={LINK_GLYPH_D2} />
        </svg>
        <text
          x={lay.textX}
          y={lay.domain.y}
          fontSize={lay.domain.fontSize}
          fill={LINK_DOMAIN_FILL}
          dominantBaseline="hanging"
          style={textFont}
        >
          {stroke.domain}
        </text>
        <text
          x={lay.textX}
          y={lay.title.y}
          fontSize={lay.title.fontSize}
          fill={LINK_TITLE_FILL}
          fontWeight={600}
          dominantBaseline="hanging"
          style={textFont}
        >
          {shownTitle}
        </text>
      </g>
    );
  }
  if (stroke.tool === 'mediaref') {
    // DDR-150 P4 + dogfood #8 — reference chip with a REAL inline player.
    // LIVE-RENDER ONLY: the <foreignObject> + <video>/<audio> below never
    // persist — the model serializer still writes the sanitizer-safe data-*
    // card (foreignObject is stripped by sanitizeAnnotationSvg by design).
    // The 26px header strip (badge + filename) is the select/drag handle; the
    // player area is fenced off from the annotation handlers by the
    // [data-mediaref-player] window-capture guard.
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const w = Math.abs(stroke.w);
    const h = Math.abs(stroke.h);
    const HEADER = 26;
    const isAudio = stroke.mediaKind === 'audio';
    const mediaUrl = stroke.src ? resolveAssetHref(stroke.src) : '';
    const shownTitle = clampLinkTitle(stroke.title, Math.max(8, Math.floor((w - 40) / 7)));
    const textFont = {
      fontFamily: 'var(--u-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
    } as const;
    return (
      <g
        data-id={stroke.id}
        data-tool="mediaref"
        data-src={stroke.src}
        data-media-kind={stroke.mediaKind}
        data-title={stroke.title}
        pointerEvents={hitMode}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={8}
          ry={8}
          fill={LINK_CARD_FILL}
          stroke={LINK_CARD_STROKE}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          filter="url(#dc-sticky-shadow)"
        />
        <svg
          x={x + 8}
          y={y + 5}
          width={16}
          height={16}
          viewBox="0 0 24 24"
          fill={LINK_GLYPH_STROKE}
          stroke="none"
          aria-hidden="true"
        >
          <path d={isAudio ? MEDIAREF_AUDIO_GLYPH : MEDIAREF_VIDEO_GLYPH} />
        </svg>
        <text
          x={x + 30}
          y={y + 9}
          fontSize={11}
          fill={LINK_TITLE_FILL}
          fontWeight={600}
          dominantBaseline="hanging"
          style={textFont}
        >
          {shownTitle}
        </text>
        {/* The inline player itself is an HTML overlay portaled beside this SVG
            (MediaRefPlayers below) — NOT a foreignObject: Chromium hit-tests
            foreignObject content under a CSS-transformed ancestor in the WRONG
            coordinate space (the un-panned/un-zoomed one), so real clicks miss
            the player at most zoom levels while elementFromPoint lies that
            they'd land. Plain HTML in the transformed world hit-tests right. */}
        {!mediaUrl ? (
          <text
            x={x + 30}
            y={y + HEADER + 10}
            fontSize={10}
            fill={LINK_DOMAIN_FILL}
            dominantBaseline="hanging"
            style={textFont}
          >
            (missing media reference)
          </text>
        ) : null}
      </g>
    );
  }
  if (stroke.tool === 'section') {
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const w = Math.abs(stroke.w);
    const h = Math.abs(stroke.h);
    return (
      <g data-id={stroke.id} data-tool="section">
        {/* Region body — pure backdrop, CLICK-THROUGH (FigJam: content on a
            section selects normally; the section is grabbed by border/chip). */}
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={SECTION_CORNER_RADIUS}
          ry={SECTION_CORNER_RADIUS}
          fill={stroke.color}
          fillOpacity={0.07}
          stroke={stroke.color}
          strokeOpacity={0.45}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        {/* Invisible border hit ring — the grabbable edge. */}
        {interactive ? (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            rx={SECTION_CORNER_RADIUS}
            ry={SECTION_CORNER_RADIUS}
            fill="none"
            stroke="transparent"
            strokeWidth={12}
            vectorEffect="non-scaling-stroke"
            pointerEvents="stroke"
          />
        ) : null}
        {/* Label chip above the top-left corner — also a grab handle. Hidden
            while the rename editor (StandaloneTextEditor) is up at the same
            spot, else the old label reads through behind the new text. */}
        {editing ? null : <SectionLabelChip stroke={stroke} x={x} y={y} hitMode={hitMode} />}
      </g>
    );
  }
  // Deliberately NO `vector-effect="non-scaling-stroke"` here: drawn ink is
  // world-space content and must thicken/thin with the zoom, the way it does in
  // Figma/FigJam. The attribute also rendered differently per engine — Blink
  // honours it under the world's CSS `zoom` (ink stayed a fixed screen width at
  // every zoom level), WebKit ignores it under `transform: scale`, so the same
  // board drew differently in Chrome than in the desktop shell. Card hairlines
  // and selection chrome below still opt in — those ARE fixed-px by intent.
  const common = {
    'data-id': stroke.id,
    'data-tool': stroke.tool,
    stroke: stroke.color,
    strokeWidth: stroke.width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (stroke.tool === 'pen') {
    // Highlighter (item 8) — overlaps darken via multiply; the translucent hue
    // lives in `stroke.color`, the wide nib in `stroke.width`.
    return (
      <path
        {...common}
        fill="none"
        d={penPathD(stroke.points)}
        style={stroke.highlighter ? { mixBlendMode: 'multiply' } : undefined}
        pointerEvents={strokeHit}
      />
    );
  }
  if (stroke.tool === 'rect') {
    const x = Math.min(stroke.x, stroke.x + stroke.w);
    const y = Math.min(stroke.y, stroke.y + stroke.h);
    const r = stroke.cornerRadius ?? 0;
    return (
      <rect
        {...common}
        fill={stroke.fill ?? 'none'}
        x={x}
        y={y}
        width={Math.abs(stroke.w)}
        height={Math.abs(stroke.h)}
        rx={r}
        ry={r}
        strokeDasharray={stroke.dashed ? '6 4' : undefined}
        pointerEvents={hitMode}
      />
    );
  }
  if (stroke.tool === 'ellipse') {
    return (
      <ellipse
        {...common}
        fill={stroke.fill ?? 'none'}
        cx={stroke.cx}
        cy={stroke.cy}
        rx={Math.max(0, stroke.rx)}
        ry={Math.max(0, stroke.ry)}
        strokeDasharray={stroke.dashed ? '6 4' : undefined}
        pointerEvents={hitMode}
      />
    );
  }
  if (stroke.tool === 'polygon') {
    const nx = Math.min(stroke.x, stroke.x + stroke.w);
    const ny = Math.min(stroke.y, stroke.y + stroke.h);
    return (
      <polygon
        {...common}
        data-shape={stroke.shape}
        fill={stroke.fill ?? 'none'}
        points={polygonPoints(stroke.shape, nx, ny, Math.abs(stroke.w), Math.abs(stroke.h))}
        strokeDasharray={stroke.dashed ? '6 4' : undefined}
        pointerEvents={hitMode}
      />
    );
  }
  // arrow — Phase 24 renders the SAME ordered primitives the serializer emits
  // (canvas-arrowheads), so the on-canvas and persisted forms can never drift.
  return (
    <g {...common} fill="none" pointerEvents={hitMode}>
      {arrowPrimitives(stroke).map((p, i) => renderArrowPrimitive(p, i))}
    </g>
  );
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
