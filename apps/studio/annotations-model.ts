/**
 * @file       annotations-model.ts — React-free annotation data model
 * @scope      apps/studio/annotations-model.ts
 * @purpose    Single source for the annotation Stroke types, palettes, pure
 *             geometry helpers, and the SVG serialize/parse pair. Extracted
 *             from annotations-layer.tsx (FigJam v3) so headless consumers —
 *             bun tests, the `maude design annotate` write verb, future
 *             tooling — can import the model without pulling React or any
 *             canvas runtime. The layer re-exports everything from here, so
 *             every existing `from './annotations-layer.tsx'` import keeps
 *             working unchanged.
 *
 *             HARD INVARIANT (Phase 24 canary): `strokeToSvgEl` emits every
 *             post-Phase-5.1 attribute ONLY for non-default values, so legacy
 *             `.annotations.svg` files round-trip byte-identically. The
 *             FigJam-v3 additions (`data-group-ids`, `data-author`,
 *             `data-start-bind`, `data-end-bind`) follow the same rule.
 *
 * Schema (back-compatible with Phase 5):
 *   - pen     → <path data-tool="pen" d="M.. L..">
 *   - rect    → <rect data-tool="rect" x= y= width= height= [fill=]>
 *   - ellipse → <ellipse data-tool="ellipse" cx= cy= rx= ry= [fill=]>
 *   - arrow   → <g data-tool="arrow"><line/><polyline/></g>
 *   - text    → <text data-tool="text" data-anchor-id= x= y= fill= …>
 *   - sticky / polygon / image / link — see the per-tool serializers below.
 */

import { defOf } from './annotations/registry.ts';
import type { AnnotationElement, GeomCtx } from './annotations/types.ts';
import {
  ARROW_HEADS,
  type ArrowHead,
  type ArrowLineType,
  arrowPrimitives,
  type SvgPrimitive,
} from './canvas-arrowheads.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Types

export type WorldPoint = readonly [number, number];

/** Phase 24 — polygon shape primitives (diamond + the two triangle pointings). */
export type PolygonShape = 'diamond' | 'triangle' | 'triangle-down';
/** Phase 24 — horizontal alignment for text + sticky bodies. */
export type TextAlign = 'left' | 'center' | 'right';
/** Annotation polish (item 4c) — list style for text + sticky bodies. */
export type ListType = 'bullet' | 'number';

/**
 * FigJam v3 — a bound arrow endpoint. `hostId` is the bound stroke's id;
 * `nx`/`ny` are the anchor normalized over the host's bbox ([0..1], snapped to
 * the {0, 0.5, 1} side/center magnets at bind time — FigJam connector magnets,
 * Excalidraw `fixedPoint` semantics). The endpoint's world position is always
 * DERIVED from the host (`anchorPoint` in annotations-bindings.ts); the stored
 * x1/y1/x2/y2 are kept in sync so legacy consumers keep working.
 */
export interface ArrowBind {
  hostId: string;
  nx: number;
  ny: number;
  /**
   * FigJam v3 — true when the user EXPLICITLY re-anchored this endpoint (drag
   * onto a specific magnet). Auto (absent) binds re-route as the shapes move:
   * `recomputeBoundArrows` re-picks the side facing the other end, so a
   * connector always leaves the box in a sensible direction. Serialized as a
   * trailing ` p` token.
   */
  pinned?: boolean;
}

/**
 * FigJam v3 — fields shared by every stroke variant.
 *   - `groupIds` — group membership, ordered DEEPEST → SHALLOWEST (the
 *     Excalidraw flat tag-array model; the outermost group is the LAST
 *     element). Absent / empty = ungrouped. Serialized as `data-group-ids`.
 *   - `author` — provenance. `'ai'` when created through the
 *     `maude design annotate` write surface. Absent = human-drawn.
 *   - `authorName` / `authorId` — Phase 3 (whiteboard-improvements): who drew
 *     a human-authored stroke, stamped from presence identity (`useCollab`'s
 *     `myName`/`myConnId` — git `user.name`, else an `anonymous-*` fallback).
 *     Absent on AI-authored strokes and on any stroke drawn before this
 *     field existed (back-compat — no author badge, not an error). Never
 *     trust a wire/stored COLOR for this identity — badges re-derive their
 *     color from the name via `colorForName` so they match the author's live
 *     presence hue.
 */
interface StrokeBase {
  id: string;
  groupIds?: string[];
  author?: 'ai';
  authorName?: string;
  authorId?: string;
  /**
   * Locked against accidental edits (#137): selectable, but not movable,
   * resizable, deletable or text-editable from the UI. Absent = unlocked.
   * A UX guard, not a permission — anyone can unlock. Serialized as
   * `data-locked`.
   */
  locked?: true;
  /**
   * FigJam v3 — rotation in degrees (clockwise) around the stroke's bbox
   * center. Absent / 0 = axis-aligned (back-compat). Honoured by the box-
   * shaped strokes + standalone text; pen ink and arrows ignore it (their
   * geometry IS their orientation) and anchored text inherits its host's.
   * Serialized as `data-rot` plus a presentational `transform="rotate(…)"`.
   */
  rotation?: number;
}

export interface PenStroke extends StrokeBase {
  tool: 'pen';
  color: string;
  width: number;
  points: WorldPoint[];
  /**
   * Highlighter (item 8). A `highlighter:true` pen reuses ALL pen draw / erase /
   * hit-test / translate logic; it just renders wide + translucent with
   * `mix-blend-mode:multiply` (overlaps darken) and carries a translucent
   * marker colour. Absent / false = a normal solid pen (back-compat).
   */
  highlighter?: boolean;
}
export interface RectStroke extends StrokeBase {
  tool: 'rect';
  color: string;
  width: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string | null;
  /** Phase 21 — corner radius (rx/ry). Absent / 0 = sharp 90° corners (back-compat). */
  cornerRadius?: number;
  /** Dashed outline (stroke-dasharray). Absent / false = solid (back-compat). */
  dashed?: boolean;
}
export interface EllipseStroke extends StrokeBase {
  tool: 'ellipse';
  color: string;
  width: number;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string | null;
  /** Dashed outline (stroke-dasharray). Absent / false = solid (back-compat). */
  dashed?: boolean;
}
/**
 * Phase 24 — diamond / triangle / triangle-down primitives. Stored as a bbox
 * (x/y/w/h, exactly like a rect) + a `shape` discriminant; the actual SVG
 * points are derived from the bbox at serialize + render time. Brand-new on
 * disk (`<polygon data-tool="polygon" data-shape="…">`), so no back-compat
 * constraint — only idempotent round-trip.
 */
export interface PolygonStroke extends StrokeBase {
  tool: 'polygon';
  shape: PolygonShape;
  color: string;
  width: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string | null;
  /** Dashed outline (stroke-dasharray). Absent / false = solid. */
  dashed?: boolean;
}
export interface ArrowStroke extends StrokeBase {
  tool: 'arrow';
  color: string;
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Head on the (x1,y1) start. Absent = 'none' (back-compat). Phase 24 widened the enum. */
  startHead?: ArrowHead;
  /** Head on the (x2,y2) end. Absent = 'triangle' (back-compat). Phase 24 widened the enum. */
  endHead?: ArrowHead;
  /** Phase 21 — dashed shaft (stroke-dasharray). Absent / false = solid. */
  dashed?: boolean;
  /** Phase 24 — shaft routing. Absent = 'straight' (back-compat). */
  lineType?: ArrowLineType;
  /** FigJam v3 — magnetic binding of the (x1,y1) start to a host stroke. */
  startBind?: ArrowBind;
  /** FigJam v3 — magnetic binding of the (x2,y2) end to a host stroke. */
  endBind?: ArrowBind;
}
export interface TextStroke extends StrokeBase {
  tool: 'text';
  color: string;
  fontSize: number;
  text: string;
  /**
   * Host shape id for anchored text (double-click a rect/ellipse). Phase 21
   * relaxed this to optional: standalone text (the `text` tool) carries no
   * anchor and renders at its own world `(x, y)` instead.
   */
  anchorId?: string;
  /** Phase 21 — world coords for standalone (unanchored) text. */
  x?: number;
  y?: number;
  /** Phase 24 — bold weight. Absent / false = normal (back-compat). */
  bold?: boolean;
  /** Phase 24 — strikethrough. Absent / false = none (back-compat). */
  strike?: boolean;
  /** Italic style (item 4b). Absent / false = upright (back-compat). */
  italic?: boolean;
  /** Underline (item 4b). Combined with strike into one text-decoration. */
  underline?: boolean;
  /** List style (item 4c). Markers are render-only — never stored in `text`. */
  listType?: ListType;
  /**
   * Phase 24 — horizontal alignment. Absent default differs by kind: anchored
   * text = 'center' (legacy, byte-identical), standalone = 'left'.
   */
  align?: TextAlign;
}
/** Phase 21 — sticky note: a paper-tone card with its own word-wrapped text. */
export interface StickyStroke extends StrokeBase {
  tool: 'sticky';
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fontSize: number;
  /** Corner radius; defaults to STICKY_CORNER_RADIUS (8 = soft). */
  cornerRadius?: number;
  /** Phase 24 — bold body weight. Absent / false = normal. */
  bold?: boolean;
  /** Phase 24 — strikethrough body. Absent / false = none. */
  strike?: boolean;
  /** Italic body (item 4b). Absent / false = upright. */
  italic?: boolean;
  /** Underline body (item 4b). Combined with strike into one text-decoration. */
  underline?: boolean;
  /** List style (item 4c). Markers are render-only — never stored in `text`. */
  listType?: ListType;
  /** Phase 24 — body alignment. Absent = 'left' (FigJam sticky default). */
  align?: TextAlign;
}
/**
 * Phase 23 — dropped / pasted raster image. Free-floating, rect-shaped, moves
 * and resizes like any annotation. `href` is ALWAYS a relative
 * `assets/<sha8>.<ext>` path (never a data: URL — keeps the persisted SVG under
 * its 1 MB cap and matches the sanitizer's `<image>` href allowlist). The live
 * canvas may briefly render an optimistic `blob:` href before the upload swaps
 * it to the content-addressed path; only the `assets/…` form is ever persisted.
 */
export interface ImageStroke extends StrokeBase {
  tool: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  href: string;
  /**
   * Alt text. Persisted in `data-alt` and emitted as `aria-label` on the
   * `<image>`, so it travels with the exported / saved SVG (where AT reads it).
   * NOTE: in the LIVE canvas the whole annotation SVG root is `aria-hidden`
   * (editor chrome — AT shouldn't be flooded by decorative strokes), so the live
   * in-canvas `aria-label` is pruned; the alt's audience is the export. Absent ⇒ ''.
   */
  alt?: string;
}
/**
 * Phase 23 — pasted / dropped URL rendered as a client-only preview chip. NO
 * server fetch and NO external favicon (the dev-server stays zero-egress —
 * DDR-054/060). `title` comes from the clipboard/DnD `text/html` anchor text
 * when present, else the prettified URL; `domain` is `new URL(url).hostname`.
 * Persists as an allowlisted `<g>` (rect + vector glyph + two `<text>` runs) —
 * the click-to-open handler reads `data-url`, no `<a href>` is ever stored.
 */
export interface LinkStroke extends StrokeBase {
  tool: 'link';
  x: number;
  y: number;
  w: number;
  h: number;
  url: string;
  title: string;
  domain: string;
}
/**
 * DDR-150 P4 — a video/audio file dropped on the canvas BODY (not the timeline)
 * as a reference chip. It's the "nahazet klipy → agent z toho udělá video"
 * artifact: a non-destructive, versioned pointer to an `assets/…` clip the agent
 * can enumerate off the saved `.annotations.svg` (via `data-src`), then assemble
 * into a comp. Distinct from a timeline drop (which INSERTS a `<Sequence>`) and
 * from an ImageStroke (a rendered picture). Renders as a card: a media glyph
 * (▶ video / ♪ audio) + the filename. `src` is ALWAYS a relative `assets/<sha8>`
 * path (never seeked by the capture spine — it's a reference, excluded from
 * export by `?hide-chrome`). Persists as an allowlisted `<g>` like LinkStroke —
 * `data-src`/`data-media-kind`/`data-title` are the round-trip source of truth.
 */
export interface MediaRefStroke extends StrokeBase {
  tool: 'mediaref';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Relative `assets/<sha8>.<ext>` path — the agent reads this off the SVG. */
  src: string;
  mediaKind: 'video' | 'audio';
  /** Human-facing label (the dropped file's name). */
  title: string;
}
/**
 * FigJam v3 — section: a labelled organizing container. Renders as a soft
 * rounded region with a name chip above the top-left corner; its INTERIOR is
 * click-through (only the border + chip select it) and dragging a section
 * carries every stroke whose center sits inside it. Persists as an inert
 * `<g data-tool="section" data-label>` wrapping the region rect + chip text.
 */
export interface SectionStroke extends StrokeBase {
  tool: 'section';
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Region tint (rendered at low opacity). */
  color: string;
}

/**
 * DDR-242 (Task 25) — an element of a registered type with no stroke form of
 * its own. Its world-space record rides along and every geometry question is
 * answered by its registry definition, so a new element type is one model file:
 * the whiteboard draws, selects, moves, syncs and hands it to the AI verbs
 * without another `tool ===` branch.
 */
export interface ElementStroke extends StrokeBase {
  tool: 'element';
  /** The element in WORLD coordinates, without `parent`. */
  el: AnnotationElement;
}

export type Stroke =
  | ElementStroke
  | PenStroke
  | RectStroke
  | EllipseStroke
  | PolygonStroke
  | ArrowStroke
  | TextStroke
  | StickyStroke
  | ImageStroke
  | LinkStroke
  | MediaRefStroke
  | SectionStroke;

/**
 * Wave G — stroke types that can host anchored text (a TextStroke whose
 * `anchorId` points at them). Every closed shape qualifies: rect, ellipse,
 * and the polygon primitives (diamond / triangle). The text renders centered
 * in the host's bbox and inherits its rotation.
 */
export type AnchorHost = RectStroke | EllipseStroke | PolygonStroke;

/**
 * Wave H — the selection chrome's breathing room, in SCREEN px (divide by
 * zoom for world units). Single source for the halo rect, the resize-handle
 * positions, and the resize cursor pad-correction, so they always sit on the
 * same frame.
 */
export const HALO_PAD_PX = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Wave H — shape-kind conversion (the ctx-toolbar's square/rounded/circle/
// diamond/triangle switcher). Mirrors the tool palette's ShapeKind vocabulary.

export type ConvertibleShapeKind =
  | 'square'
  | 'rounded'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'triangle-down';

/** The kind a closed shape currently is, or null for non-shape strokes. */
export function shapeKindOf(s: Stroke): ConvertibleShapeKind | null {
  if (s.tool === 'rect') return (s.cornerRadius ?? 0) > 0 ? 'rounded' : 'square';
  if (s.tool === 'ellipse') return 'circle';
  if (s.tool === 'polygon') return s.shape;
  return null;
}

/**
 * Patch converting a closed shape to another kind, preserving its bbox,
 * styling (color/width/fill/dashed), rotation, groups — and its ID, so
 * anchored text and arrow bindings follow the conversion. Returns null for
 * non-shapes and identity conversions. Stale source-geometry fields are
 * explicitly cleared (they would not serialize, but a clean in-memory object
 * keeps copy/paste payloads and debugging honest).
 */
export function convertShapeKind(s: Stroke, kind: ConvertibleShapeKind): Partial<Stroke> | null {
  const from = shapeKindOf(s);
  if (from == null || from === kind) return null;
  const bb = strokeBBox(s);
  if (!bb) return null;
  const clear = {
    x: undefined,
    y: undefined,
    w: undefined,
    h: undefined,
    cx: undefined,
    cy: undefined,
    rx: undefined,
    ry: undefined,
    cornerRadius: undefined,
    shape: undefined,
  };
  if (kind === 'square' || kind === 'rounded') {
    return {
      ...clear,
      tool: 'rect',
      x: bb.x,
      y: bb.y,
      w: bb.w,
      h: bb.h,
      cornerRadius: kind === 'rounded' ? 8 : 0,
    } as unknown as Partial<Stroke>;
  }
  if (kind === 'circle') {
    return {
      ...clear,
      tool: 'ellipse',
      cx: bb.x + bb.w / 2,
      cy: bb.y + bb.h / 2,
      rx: Math.max(1, bb.w / 2),
      ry: Math.max(1, bb.h / 2),
    } as unknown as Partial<Stroke>;
  }
  return {
    ...clear,
    tool: 'polygon',
    shape: kind,
    x: bb.x,
    y: bb.y,
    w: bb.w,
    h: bb.h,
  } as unknown as Partial<Stroke>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Palettes + defaults

// Phase 21 colour system — a single coherent hue family used everywhere.
// FigJam model: stroke (saturated ink) is INDEPENDENT of fill, and fills are
// light TINTS of the same hue (index-paired with STROKE_PALETTE). Stickies use
// their own lightened paper set (STICKY_PALETTE). Exported so the draw-time
// chrome AND the per-selection context toolbar share ONE palette instead of
// drifting apart.
export const STROKE_PALETTE = [
  '#e5484d', // red (default — markup ink)
  '#f2762a', // orange
  '#e0a500', // amber
  '#30a46c', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#e93d82', // pink
  '#7c7c7c', // gray
  '#1f1f1f', // ink
] as const;
export type PaletteColor = (typeof STROKE_PALETTE)[number];
// Phase 24 — default markup ink is BLACK (the `#1f1f1f` ink swatch, slot 8) for
// EVERY ink tool (pen / shape / arrow / text). It's a palette member so the
// draw chrome + per-selection toolbar highlight it as the active swatch; the
// other hues stay one click away. (Stickies keep their warm-paper default —
// DEFAULT_STICKY_COLOR — they're paper, not ink.)
export const DEFAULT_COLOR: PaletteColor = STROKE_PALETTE[8];
// Annotation polish — the LIVE default ink follows the canvas theme so a
// freshly-armed pen/shape/arrow/text reads true on dark canvases (the
// `#1f1f1f` ink is near-invisible on a dark mock). Light → the `#1f1f1f`
// ink slot; dark → a light ink that reads on dark. This is the live draw
// default ONLY — `DEFAULT_COLOR` stays the parse fallback (round-trip
// determinism + back-compat), and stored strokes keep their literal hex
// (FigJam parity — no retroactive recolour).
const DEFAULT_INK_DARK = '#ededed';
export function resolveDefaultInk(theme: string): string {
  return theme === 'dark' ? DEFAULT_INK_DARK : DEFAULT_COLOR;
}

// Light tints, index-paired to STROKE_PALETTE — picking "blue fill" gives a
// pale blue wash under a saturated stroke, exactly like FigJam shapes.
export const FILL_PALETTE = [
  '#fbe0e1', // red tint
  '#fce6d6', // orange tint
  '#fbeec2', // amber tint
  '#d9f1e2', // green tint
  '#e0ebfd', // blue tint
  '#ebe3fc', // purple tint
  '#fbdfeb', // pink tint
  '#ededed', // gray tint
  '#e7e7e7', // ink tint
] as const;

// Neutral fill wash for the ink slot (no paired hue) — light vs dark canvas.
const NEUTRAL_FILL_LIGHT = FILL_PALETTE[8]; // '#e7e7e7'
const NEUTRAL_FILL_DARK = '#2a2a2a';
/**
 * Annotation polish (item 2) — the LIVE default fill for a freshly-armed Shape
 * tool. A coloured ink maps to its index-paired light tint (FigJam: a saturated
 * outline over a pale wash of the same hue); the ink slot / themed-dark ink /
 * any unknown hex maps to a neutral wash. "No fill" stays one click away (the
 * chrome's None swatch) and, once picked, sticks (fillTouchedRef). Stored
 * shapes keep their literal fill — only NEW shapes pick up this default.
 */
export function defaultFillFor(color: string, theme: string): string {
  const idx = STROKE_PALETTE.indexOf(color as PaletteColor);
  // Coloured ink (slots 0–7) → its paired tint; ink slot (8) / unknown → neutral.
  if (idx >= 0 && idx < FILL_PALETTE.length - 1) return FILL_PALETTE[idx] as string;
  return theme === 'dark' ? NEUTRAL_FILL_DARK : NEUTRAL_FILL_LIGHT;
}

export const STROKE_WIDTH_THIN = 3;
export const STROKE_WIDTH_THICK = 6;
export type Thickness = typeof STROKE_WIDTH_THIN | typeof STROKE_WIDTH_THICK;

const FONT_SIZE_MEDIUM = 14;
export const DEFAULT_FONT_SIZE = FONT_SIZE_MEDIUM;

// Phase 24 — sticky-note paper tints. A muted/desaturated FigJam-style set
// (Image #2): a warm paper yellow default, then white/grey + soft pastels.
// Wholly separate from the stroke ink PALETTE and the translucent FILL_PALETTE
// so stickies read as "paper", not "ink". Slot 0 (yellow) is the default.
// Existing stickies keep their stored hex; only NEW stickies pick up the new
// default tint.
export const STICKY_PALETTE = [
  '#fce8a6', // muted yellow (default — warm paper)
  '#ffffff', // white
  '#e6e4e0', // light grey
  '#f7c5c0', // salmon
  '#f8d2a6', // peach
  '#bfe3c0', // mint
  '#a9dbdb', // aqua
  '#bcd2f0', // light blue
  '#cfc4ec', // lavender
  '#f3c4dd', // light pink
] as const;
export const DEFAULT_STICKY_COLOR = STICKY_PALETTE[0];
export const STICKY_CORNER_RADIUS = 8;

// Annotation polish (item 8) — highlighter marker hues. Translucent 8-digit hex
// (RRGGBBAA, ~50% alpha) so overlaps darken under `mix-blend-mode:multiply`.
// Yellow is the default; green / pink / blue follow. Wholly separate from the
// ink PALETTE — the highlighter draws a soft wash, not a saturated line.
export const HIGHLIGHTER_PALETTE = [
  '#ffe24d80', // yellow (default)
  '#7ce8a080', // green
  '#ff9ed180', // pink
  '#7ec5ff80', // blue
] as const;
export const DEFAULT_HIGHLIGHTER_COLOR = HIGHLIGHTER_PALETTE[0];
// Highlighter marker nib widths (item 8) — three sizes (thin / medium / thick),
// all wider than the pen. Default medium.
export const HIGHLIGHTER_WIDTHS = [10, 18, 28] as const;
export const DEFAULT_HIGHLIGHTER_WIDTH = HIGHLIGHTER_WIDTHS[1];
// Phase 24 — stickies are 1:1; the default tap size is a square.
export const STICKY_DEFAULT_W = 200;
export const STICKY_DEFAULT_H = 200;
export const STICKY_MIN_SIZE = 40;
/**
 * Ceiling for the grow-to-fit in `grownStickyBox` — ~370 lines at the default
 * type. `fontSize` comes from a synced stroke's `data-fs` and is only checked
 * for finiteness, so without this a peer could set `data-fs="200000"`, wait for
 * the local user to edit that note, and have THEIR client persist a card
 * millions of units tall — grow-only, undoable by hand alone.
 */
export const STICKY_MAX_GROWN_H = 8000;

/**
 * issue-106 — the box a sticky needs so its committed text is not clipped, or
 * null when the text already fits.
 *
 * `.dc-sticky-body` is `overflow: hidden` on a card whose size was fixed at
 * creation, and nothing ever grew it: past a card's capacity every further line
 * was simply invisible, which is what made Shift+Enter look inert on a full
 * note. `measuredH` is the editor's own `scrollHeight` — same class, width and
 * font as the committed body, in world units — so the growth is exact rather
 * than estimated.
 *
 * GROWS ONLY, and never past `STICKY_MAX_GROWN_H`: a sticky the user
 * deliberately made roomy never shrinks back on a text edit. The box is normalized on the way out (a sticky dragged bottom-up
 * carries a negative w/h), which is idempotent — every renderer already reads
 * it through the same min/abs pair.
 */
export function grownStickyBox(
  s: Pick<StickyStroke, 'x' | 'y' | 'w' | 'h'>,
  measuredH: number
): { x: number; y: number; w: number; h: number } | null {
  if (!Number.isFinite(measuredH) || measuredH <= 0) return null;
  const next = Math.min(Math.ceil(measuredH), STICKY_MAX_GROWN_H);
  if (next <= Math.abs(s.h)) return null;
  return {
    x: Math.min(s.x, s.x + s.w),
    y: Math.min(s.y, s.y + s.h),
    w: Math.abs(s.w),
    h: next,
  };
}
// Phase 24 — a bare tap with the Shape tool drops a default-sized shape at the
// tap point (FigJam parity: click commits, drag sizes). Square aspect.
export const SHAPE_DEFAULT_SIZE = 120;

// FigJam v3 — section container defaults.
export const SECTION_DEFAULT_W = 480;
export const SECTION_DEFAULT_H = 320;
export const SECTION_MIN_SIZE = 64;
export const DEFAULT_SECTION_COLOR = '#8b8b94';
export const SECTION_CORNER_RADIUS = 12;
/** Label chip geometry (world units; the chip scales with the canvas). */
export const SECTION_LABEL_FONT = 12;
export const SECTION_LABEL_H = 20;

// Phase 23 — image + link media strokes.
/** Below this side an image stroke is discarded as an accidental micro-drop. */
export const IMAGE_MIN_SIZE = 16;
/** Longest side a freshly dropped/pasted image is scaled down to (world px). */
export const IMAGE_MAX_DROP_SIDE = 480;
export const LINK_DEFAULT_W = 260;
export const LINK_DEFAULT_H = 76;
// Phase 4 (whiteboard-improvements) — a sticker dropped from the picker has no
// natural size to probe (unlike createImageFromFile's Image.onload path — the
// shell already resolved it to a project asset by the time the canvas hears
// about it) — one fixed, friendly on-board size for every sticker.
export const STICKER_DROP_SIZE = 160;
// DDR-150 P4 — media-reference chip (dropped video/audio → assets/ pointer).
export const MEDIAREF_DEFAULT_W = 280;
export const MEDIAREF_DEFAULT_H = 76;
/** Video chips are taller: 26px header + a 16:9 inline player area (dogfood #8). */
export const MEDIAREF_VIDEO_H = 190;
export const LINK_CARD_FILL = '#ffffff';
export const LINK_CARD_STROKE = '#d4d4d8';
export const LINK_DOMAIN_FILL = '#71717a';
export const LINK_TITLE_FILL = '#18181b';
export const LINK_GLYPH_STROKE = '#52525b';
// Lucide "link" icon (24×24 viewBox) — two interlocked loops. ONE source for the
// serialized nested-<svg> glyph AND the StrokeNode render so re-serialize stays
// byte-stable. The parser ignores the glyph entirely (it reads data-* + the
// <rect> geometry), so render/serialize only need to agree visually.
export const LINK_GLYPH_D1 = 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71';
export const LINK_GLYPH_D2 = 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71';
// DDR-150 P4 — media-reference chip glyphs (24×24 viewBox, filled). One source
// for serialize + StrokeNode render, like the link glyph. Video = play triangle;
// audio = a filled note. The parser ignores the glyph (reads data-* + geometry).
export const MEDIAREF_VIDEO_GLYPH = 'M8 5v14l11-7z';
export const MEDIAREF_AUDIO_GLYPH =
  'M9 18V6l10-2v11.5a2.5 2.5 0 1 1-2-2.45V7.3L11 8.6v6.9a2.5 2.5 0 1 1-2-2.45z';

/** Card text positions, derived purely from the bbox (idempotent round-trip). */
export function linkCardLayout(x: number, y: number, w: number, h: number) {
  const textX = x + 48;
  return {
    glyph: { x: x + 16, y: y + h / 2 - 10, size: 20 },
    textX,
    domain: { y: y + h / 2 - 14, fontSize: 11 },
    title: { y: y + h / 2, fontSize: 13 },
    textMaxChars: Math.max(8, Math.floor((w - 60) / 7)),
  };
}

/** Clamp a link title to the card's character budget (pure → byte-stable). */
export function clampLinkTitle(title: string, maxChars: number): string {
  return title.length > maxChars ? `${title.slice(0, Math.max(1, maxChars - 1))}…` : title;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported for unit tests.

export function rid(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The id of an annotation element that was written WITHOUT a `data-id` (a
 * hand-edited or externally generated SVG). It used to be `rid()` — a new
 * random id on every parse — so the same element had a different id in every
 * tab, on every peer and after every reload, and nothing could point at it: a
 * comment anchored to it (#134/#136), a peer's selection halo, an agent's
 * `annotate update`. Now it is derived from the element's own markup, plus its
 * occurrence among identical elements, so every parse of the same SVG gives
 * every element the same id everywhere. The first edit writes it back as a real
 * `data-id` (strokesToSvg always emits one), after which it never changes.
 *
 * Contract for the annotations-v2 element model
 * (.ai/plans/feature-annotations-v2-element-model.md): an annotation's id is
 * stable for the life of the element — across edits, moves, undo/redo, sync
 * and reload — and is what external references (comments' `annotationId`)
 * hold. A migration must carry ids over unchanged.
 */
export function stableAnnotationId(el: SvgElLike, seen: Map<string, number>): string {
  const content = el.outerHTML;
  const n = seen.get(content) ?? 0;
  seen.set(content, n + 1);
  // FNV-1a, 32-bit — deterministic, dependency-free, plenty for a per-board id.
  let h = 0x811c9dc5;
  const key = `${content}#${n}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s_h${h.toString(36)}`;
}

/** FigJam v3 — group ids mirror the stroke id scheme (`g_` prefix). */
export function gid(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}`;
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Phase 23 — attribute-safe escape: `esc()` plus `>`. The legacy text/sticky
 * paths only put user text in element CONTENT (where a bare `>` is harmless),
 * so `esc()` never escaped it; but the media strokes carry user text (pasted
 * link title/url, image alt) inside ATTRIBUTES (data-title / data-url / data-alt
 * / href). A bare `>` there would prematurely close the tag and confuse the
 * `[^>]*>` element scan in `sanitizeAnnotationSvg`. Use this for every media
 * attribute value; element CONTENT keeps plain `esc()`.
 */
export function escAttr(s: string): string {
  return esc(s).replace(/>/g, '&gt;');
}

export function penPathD(points: readonly WorldPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points as readonly WorldPoint[];
  if (!first) return '';
  let d = `M${first[0]} ${first[1]}`;
  for (const p of rest) d += ` L${p[0]} ${p[1]}`;
  return d;
}

// ── Multi-line text (item 4a) ────────────────────────────────────────────────
// SVG <text> ignores `\n`, so multi-line annotation text must render as one
// <tspan> per line. The serialized + live forms share this geometry; single-
// line text keeps the legacy single-run form (no tspan) so the canary holds.

/** Line-height multiplier for multi-line annotation text. */
export const TEXT_LINE_HEIGHT = 1.25;

/** Split a text body into its display lines. */
export function splitTextLines(text: string): string[] {
  return text.split('\n');
}

/**
 * Render-time list marker prefix for one line. Markers are PRESENTATION ONLY —
 * never stored in `text` (DDR) — so the stored string stays clean and
 * contentEditable editing is sane. Bullet → `• `; number → `${i + 1}. `.
 */
export function listPrefixedLine(line: string, index: number, list?: ListType): string {
  if (!list) return line;
  return list === 'bullet' ? `• ${line}` : `${index + 1}. ${line}`;
}

/** Inverse of {@link listPrefixedLine} — strip a render-time marker on parse. */
export function stripListPrefix(line: string, index: number, list?: ListType): string {
  if (!list) return line;
  const marker = list === 'bullet' ? '• ' : `${index + 1}. `;
  return line.startsWith(marker) ? line.slice(marker.length) : line;
}

/** Prefix every line of a body with its list marker (for the editor display). */
export function listPrefixedBody(text: string, list?: ListType): string {
  if (!list) return text;
  return splitTextLines(text)
    .map((line, i) => listPrefixedLine(line, i, list))
    .join('\n');
}

/**
 * Strip list markers off editor `innerText` on commit (item 4c). Generic — a
 * `•` bullet OR any leading `N. ` number is removed once per line, regardless of
 * the index the user actually typed, so re-numbering while editing round-trips
 * cleanly (the stored text stays marker-free; the read view re-derives markers).
 */
export function stripEditorMarkers(text: string, list?: ListType): string {
  if (!list) return text;
  const re = list === 'bullet' ? /^• / : /^\d+\.\s/;
  return splitTextLines(text)
    .map((line) => line.replace(re, ''))
    .join('\n');
}

/**
 * Combined `text-decoration` SVG attribute for strike + underline (item 4b).
 * Strike-only stays `text-decoration="line-through"` (byte-identical to the
 * legacy Phase-24 form); both → `line-through underline`; neither → empty.
 */
export function textDecoAttr(strike?: boolean, underline?: boolean): string {
  const vals: string[] = [];
  if (strike) vals.push('line-through');
  if (underline) vals.push('underline');
  return vals.length ? ` text-decoration="${vals.join(' ')}"` : '';
}

/** CSS `text-decoration` value for the live render (strike + underline). */
export function textDecoCss(strike?: boolean, underline?: boolean): string | undefined {
  const vals: string[] = [];
  if (strike) vals.push('line-through');
  if (underline) vals.push('underline');
  return vals.length ? vals.join(' ') : undefined;
}

/**
 * Inline text formatting carried by an editor through commit (item 4b/4d
 * unification) — so Cmd+B / Cmd+I / Cmd+U toggled WHILE editing land on the
 * stroke. `strike` rides along unchanged (no shortcut; toolbar-only).
 */
export interface EditorFmt {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** FigJam v3 — live-editable font size (edit-mode text toolbar). */
  fontSize?: number;
  /** FigJam v3 — live-editable alignment (edit-mode text toolbar). */
  align?: TextAlign;
}
/** Normalize an EditorFmt → only-true keys kept; false becomes undefined so the
 *  serialize-only-when-set invariant + byte-identical canary hold. */
export function normFmt(fmt?: EditorFmt): EditorFmt {
  const out: EditorFmt = {
    bold: fmt?.bold || undefined,
    italic: fmt?.italic || undefined,
    underline: fmt?.underline || undefined,
    strike: fmt?.strike || undefined,
  };
  // FigJam v3 — carry the edit-mode toolbar's size/align through commit, but
  // ONLY when set: an absent key must not clobber the stroke's stored value
  // (the spread `{ ...stroke, ...normFmt(fmt) }` would write undefined).
  if (typeof fmt?.fontSize === 'number' && Number.isFinite(fmt.fontSize)) {
    out.fontSize = fmt.fontSize;
  }
  if (fmt?.align) out.align = fmt.align;
  return out;
}
/** True when a stroke's existing formatting already matches `fmt` (so a pure
 *  identity edit can short-circuit without a redundant undo record). */
export function fmtEqual(s: EditorFmt, fmt?: EditorFmt): boolean {
  if (!fmt) return true;
  if (typeof fmt.fontSize === 'number' && s.fontSize !== fmt.fontSize) return false;
  if (fmt.align && s.align !== fmt.align) return false;
  return (
    !!s.bold === !!fmt.bold &&
    !!s.italic === !!fmt.italic &&
    !!s.underline === !!fmt.underline &&
    !!s.strike === !!fmt.strike
  );
}

/**
 * Per-line baseline offset (`dy`). Line 0 sits at the anchor when top-anchored
 * (hanging) or is lifted half the block height when vertically centred
 * (anchored-in-host); every later line advances one line-height.
 */
export function textLineDy(
  i: number,
  fontSize: number,
  lineCount: number,
  centered: boolean
): number {
  const lh = fontSize * TEXT_LINE_HEIGHT;
  if (i > 0) return lh;
  return centered ? (-(lineCount - 1) / 2) * lh : 0;
}

/**
 * Inner content for a serialized `<text>` stroke: the legacy single esc'd run
 * when there's no newline (byte-identical, canary-safe), else one `<tspan>` per
 * line. `x` is set on each tspan for standalone text (resets the line origin);
 * anchored text omits it (the persisted form carries no absolute position —
 * geometry is resolved against the host at render time). A `list` prefix
 * (bullet / number) is prepended per line at render time only (DDR — never
 * stored in `text`).
 */
function textInnerSvg(
  text: string,
  fontSize: number,
  centered: boolean,
  x: number | undefined,
  list?: ListType
): string {
  if (!list && !text.includes('\n')) return esc(listPrefixedLine(text, 0, list));
  const lines = splitTextLines(text);
  const xAttr = x != null ? ` x="${x}"` : '';
  return lines
    .map(
      (line, i) =>
        `<tspan${xAttr} dy="${textLineDy(i, fontSize, lines.length, centered)}">${esc(
          listPrefixedLine(line, i, list)
        )}</tspan>`
    )
    .join('');
}

/**
 * Phase 24 — polygon vertices derived from the bbox. `diamond` = the four
 * edge-midpoints; `triangle` = apex-up; `triangle-down` = apex-down. Every
 * shape's vertices span the FULL bbox, so a parse-back via the points' min/max
 * recovers x/y/w/h exactly (idempotent round-trip).
 */
export function polygonVertices(
  shape: PolygonShape,
  x: number,
  y: number,
  w: number,
  h: number
): Array<[number, number]> {
  if (shape === 'diamond') {
    return [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
  }
  if (shape === 'triangle') {
    return [
      [x + w / 2, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  // triangle-down — apex at the bottom.
  return [
    [x, y],
    [x + w, y],
    [x + w / 2, y + h],
  ];
}

/** Vertices as an SVG `points` string. */
export function polygonPoints(
  shape: PolygonShape,
  x: number,
  y: number,
  w: number,
  h: number
): string {
  return polygonVertices(shape, x, y, w, h)
    .map(([px, py]) => `${px},${py}`)
    .join(' ');
}

/**
 * Annotation polish (item 1) — a rounded-rect `d` with TL/TR/BL rounded at `r`
 * and the **bottom-right corner SHARP** (the FigJam sticky-note silhouette). The
 * radius is clamped to half the smaller side so it never self-overlaps. Used by
 * `StrokeNode`'s LIVE sticky render only; the persisted form (`strokeToSvgEl`)
 * stays a plain `<rect>` (DDR — zero canary / sanitizer / parse impact).
 */
export function stickyCornerPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return [
    `M${x + rr} ${y}`,
    `L${x + w - rr} ${y}`,
    `Q${x + w} ${y} ${x + w} ${y + rr}`,
    `L${x + w} ${y + h}`, // sharp bottom-right
    `L${x + rr} ${y + h}`,
    `Q${x} ${y + h} ${x} ${y + h - rr}`,
    `L${x} ${y + rr}`,
    `Q${x} ${y} ${x + rr} ${y}`,
    'Z',
  ].join(' ');
}

/** Even-odd ray-cast point-in-polygon test. */
function pointInPolygon(px: number, py: number, pts: ReadonlyArray<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Parse a polygon `points` string back into its bounding box. */
function polygonBBox(points: string): { x: number; y: number; w: number; h: number } | null {
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const pair of points.trim().split(/\s+/)) {
    const [px, py] = pair.split(',').map((n) => Number.parseFloat(n));
    // Skip non-finite points (NaN AND Infinity from a poisoned `1e999`) so a
    // bad vertex can't push the bbox to an Infinity extent — Wave H F4.
    if (px == null || py == null || !Number.isFinite(px) || !Number.isFinite(py)) continue;
    if (px < xMin) xMin = px;
    if (px > xMax) xMax = px;
    if (py < yMin) yMin = py;
    if (py > yMax) yMax = py;
  }
  if (!Number.isFinite(xMin)) return null;
  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialize

/**
 * FigJam v3 — cross-tool root attributes (group membership / AI provenance /
 * arrow binds), serialized ONLY for non-default values so every legacy stroke
 * stays byte-identical (the canary). Injected into the stroke's root tag.
 */
function rootExtraAttrs(s: Stroke): string {
  let extra = '';
  if (s.tool === 'arrow') {
    if (s.startBind) {
      const b = s.startBind;
      extra += ` data-start-bind="${esc(b.hostId)} ${b.nx} ${b.ny}${b.pinned ? ' p' : ''}"`;
    }
    if (s.endBind) {
      const b = s.endBind;
      extra += ` data-end-bind="${esc(b.hostId)} ${b.nx} ${b.ny}${b.pinned ? ' p' : ''}"`;
    }
  }
  if (s.groupIds && s.groupIds.length > 0) {
    extra += ` data-group-ids="${esc(s.groupIds.join(' '))}"`;
  }
  if (s.author === 'ai') extra += ' data-author="ai"';
  if (s.locked) extra += ' data-locked="1"';
  // Phase 3 (whiteboard-improvements) — human author identity, independent of
  // `data-author="ai"` (never both: a stroke is either agent- or human-drawn).
  // escAttr (not esc) — these are attribute values, not element content; see
  // the Phase 23 escAttr() docblock above for why a bare `>` here is unsafe.
  if (s.authorName) extra += ` data-author-name="${escAttr(s.authorName)}"`;
  if (s.authorId) extra += ` data-author-id="${escAttr(s.authorId)}"`;
  // FigJam v3 — rotation: `data-rot` is the round-trip source of truth; the
  // transform is presentational so the persisted SVG renders rotated in any
  // viewer. The pivot derives from stored geometry → idempotent re-serialize.
  const rot = strokeRotation(s);
  if (rot !== 0) {
    const c = strokeCenter(s);
    if (c) extra += ` data-rot="${rot}" transform="rotate(${rot} ${c[0]} ${c[1]})"`;
  }
  return extra;
}

/**
 * Insert extra attributes at the end of the root tag's attribute list. Safe
 * because no legit attribute VALUE contains a literal `>` (media attrs are
 * escAttr'd; ids/colors/enums can't carry one), so the first `>` is always the
 * end of the opening tag.
 */
function injectRootAttrs(el: string, extra: string): string {
  if (!extra) return el;
  const gt = el.indexOf('>');
  if (gt < 0) return el;
  const insertAt = el[gt - 1] === '/' ? gt - 1 : gt;
  return el.slice(0, insertAt) + extra + el.slice(insertAt);
}

export function strokeToSvgEl(s: Stroke): string {
  return injectRootAttrs(strokeToSvgElBase(s), rootExtraAttrs(s));
}

function strokeToSvgElBase(s: Stroke): string {
  // No legacy SVG form: such an element only ever lives in a v2 board.
  if (s.tool === 'element') return '';
  if (s.tool === 'text') {
    // Phase 21 — anchored text keeps the byte-identical Phase 5.1 form;
    // standalone text (no anchorId) writes its own world x/y and omits
    // data-anchor-id (so the parser routes it back to the standalone branch).
    // bold/italic/strike/underline/align/list serialize ONLY for non-default
    // values, so a legacy text node stays byte-identical (every added fragment
    // is empty). Multi-line text emits one <tspan> per line (item 4a); a
    // single-line unstyled run stays the legacy single esc'd text.
    const weight = s.bold ? ' font-weight="700"' : '';
    const italic = s.italic ? ' font-style="italic"' : '';
    const deco = textDecoAttr(s.strike, s.underline);
    // esc() the enum attrs too — a no-op for the constrained values, but it
    // keeps the "every value reaching serialize is escaped" invariant uniform
    // with the arrow-head attrs (Wave H defender suggestion, DDR-067).
    const listAttr = s.listType ? ` data-list="${esc(s.listType)}"` : '';
    if (s.anchorId != null && s.anchorId !== '') {
      const align = s.align ?? 'center'; // anchored default = centre (legacy)
      const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
      const alignAttr = align !== 'center' ? ` data-align="${esc(align)}"` : '';
      return `<text data-id="${esc(s.id)}" data-tool="text" data-anchor-id="${esc(
        s.anchorId
      )}" data-font-size="${s.fontSize}" fill="${esc(
        s.color
      )}"${weight}${italic}${deco}${listAttr} text-anchor="${anchor}" dominant-baseline="middle"${alignAttr}>${textInnerSvg(
        s.text,
        s.fontSize,
        true,
        undefined,
        s.listType
      )}</text>`;
    }
    const tx = s.x ?? 0;
    const ty = s.y ?? 0;
    const align = s.align ?? 'left'; // standalone default = left
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    const alignAttr = align !== 'left' ? ` data-align="${esc(align)}"` : '';
    return `<text data-id="${esc(s.id)}" data-tool="text" x="${tx}" y="${ty}" data-font-size="${
      s.fontSize
    }" fill="${esc(
      s.color
    )}"${weight}${italic}${deco}${listAttr} text-anchor="${anchor}" dominant-baseline="hanging"${alignAttr}>${textInnerSvg(
      s.text,
      s.fontSize,
      false,
      tx,
      s.listType
    )}</text>`;
  }
  if (s.tool === 'sticky') {
    // Phase 21 — sticky body lives in an allowlisted <text> child so it
    // survives sanitizeAnnotationSvg (which strips <foreignObject>, DDR-060
    // F1). The live canvas re-renders this stroke with a foreignObject so the
    // text word-wraps; the persisted <text> is the inert, sanitizer-safe form.
    const r = s.cornerRadius ?? STICKY_CORNER_RADIUS;
    const w = Math.max(0, s.w);
    const h = Math.max(0, s.h);
    // bold/italic/strike/underline/align/list on the <g> data-attrs, emitted
    // ONLY for non-default values (sticky default align = left) so Phase-21
    // stickies serialize byte-identically. The body <text> stays raw text —
    // list markers are render-only (item 4c), never persisted.
    const align = s.align ?? 'left';
    const styleAttrs =
      (s.bold ? ' data-bold="1"' : '') +
      (s.italic ? ' data-italic="1"' : '') +
      (s.strike ? ' data-strike="1"' : '') +
      (s.underline ? ' data-underline="1"' : '') +
      (align !== 'left' ? ` data-align="${esc(align)}"` : '') +
      (s.listType ? ` data-list="${esc(s.listType)}"` : '');
    return `<g data-id="${esc(s.id)}" data-tool="sticky" data-r="${r}" data-fs="${
      s.fontSize
    }" fill="${esc(s.color)}"${styleAttrs}><rect x="${s.x}" y="${
      s.y
    }" width="${w}" height="${h}" rx="${r}" ry="${r}"/><text data-sticky-body="1" x="${
      s.x + 12
    }" y="${s.y + 12}" font-size="${
      s.fontSize
    }" fill="#1a1a1a" dominant-baseline="hanging">${esc(s.text)}</text></g>`;
  }
  if (s.tool === 'image') {
    // Phase 23 — `href` is ALWAYS a relative assets/<sha8>.<ext> path (asserted
    // on create + re-validated by the sanitizer's <image> href allowlist). Alt
    // text persists in `data-alt` + is emitted as `aria-label` for the exported
    // SVG (the live annotation root is aria-hidden — see ImageStroke.alt).
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const nw = Math.abs(s.w);
    const nh = Math.abs(s.h);
    const altAttr = s.alt ? ` data-alt="${escAttr(s.alt)}"` : '';
    return `<image data-id="${esc(s.id)}" data-tool="image" x="${nx}" y="${ny}" width="${nw}" height="${nh}" href="${escAttr(
      s.href
    )}" preserveAspectRatio="xMidYMid meet"${altAttr}/>`;
  }
  if (s.tool === 'link') {
    // Phase 23 — client-only preview chip. data-url/title/domain are the
    // round-trip source of truth; the inner rect/glyph/text are the inert,
    // sanitizer-safe visual (no <a href> persisted — click-to-open reads
    // data-url client-side and validates http(s) before window.open).
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const nw = Math.abs(s.w);
    const nh = Math.abs(s.h);
    const lay = linkCardLayout(nx, ny, nw, nh);
    const shownTitle = clampLinkTitle(s.title, lay.textMaxChars);
    return (
      `<g data-id="${esc(s.id)}" data-tool="link" data-url="${escAttr(s.url)}" data-title="${escAttr(
        s.title
      )}" data-domain="${escAttr(s.domain)}">` +
      `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="8" ry="8" fill="${LINK_CARD_FILL}" stroke="${LINK_CARD_STROKE}" stroke-width="1"/>` +
      `<svg x="${lay.glyph.x}" y="${lay.glyph.y}" width="${lay.glyph.size}" height="${lay.glyph.size}" viewBox="0 0 24 24" fill="none" stroke="${LINK_GLYPH_STROKE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${LINK_GLYPH_D1}"/><path d="${LINK_GLYPH_D2}"/></svg>` +
      `<text x="${lay.textX}" y="${lay.domain.y}" font-size="${lay.domain.fontSize}" fill="${LINK_DOMAIN_FILL}" dominant-baseline="hanging">${esc(
        s.domain
      )}</text>` +
      `<text x="${lay.textX}" y="${lay.title.y}" font-size="${lay.title.fontSize}" fill="${LINK_TITLE_FILL}" font-weight="600" dominant-baseline="hanging">${esc(
        shownTitle
      )}</text>` +
      `</g>`
    );
  }
  if (s.tool === 'mediaref') {
    // DDR-150 P4 — reference chip for a dropped clip. Like the link card: the
    // data-* are the round-trip source of truth (the agent reads data-src to
    // enumerate refs); the inner rect/glyph/text are the inert, sanitizer-safe
    // visual. NEVER a <Video>/<Audio> element (that would try to play/seek) —
    // it's a pointer, drawn as a still card.
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const nw = Math.abs(s.w);
    const nh = Math.abs(s.h);
    const lay = linkCardLayout(nx, ny, nw, nh);
    const shownTitle = clampLinkTitle(s.title, lay.textMaxChars);
    const glyph =
      s.mediaKind === 'audio'
        ? `<path d="${MEDIAREF_AUDIO_GLYPH}"/>`
        : `<path d="${MEDIAREF_VIDEO_GLYPH}"/>`;
    return (
      `<g data-id="${esc(s.id)}" data-tool="mediaref" data-src="${escAttr(s.src)}" data-media-kind="${escAttr(
        s.mediaKind
      )}" data-title="${escAttr(s.title)}">` +
      `<rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="8" ry="8" fill="${LINK_CARD_FILL}" stroke="${LINK_CARD_STROKE}" stroke-width="1"/>` +
      `<svg x="${lay.glyph.x}" y="${lay.glyph.y}" width="${lay.glyph.size}" height="${lay.glyph.size}" viewBox="0 0 24 24" fill="${LINK_GLYPH_STROKE}" stroke="none">${glyph}</svg>` +
      `<text x="${lay.textX}" y="${lay.domain.y}" font-size="${lay.domain.fontSize}" fill="${LINK_DOMAIN_FILL}" dominant-baseline="hanging">${esc(
        `${s.mediaKind} · reference`
      )}</text>` +
      `<text x="${lay.textX}" y="${lay.title.y}" font-size="${lay.title.fontSize}" fill="${LINK_TITLE_FILL}" font-weight="600" dominant-baseline="hanging">${esc(
        shownTitle
      )}</text>` +
      `</g>`
    );
  }
  if (s.tool === 'section') {
    // FigJam v3 — inert persisted form: region rect + chip label text. Colors
    // are render-time chrome; the parser reads geometry off the rect and the
    // label off data-label (the inner <text> is presentational, like sticky).
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const nw = Math.abs(s.w);
    const nh = Math.abs(s.h);
    return `<g data-id="${esc(s.id)}" data-tool="section" data-label="${escAttr(
      s.label
    )}" fill="${esc(s.color)}"><rect x="${nx}" y="${ny}" width="${nw}" height="${nh}" rx="${SECTION_CORNER_RADIUS}" ry="${SECTION_CORNER_RADIUS}" fill-opacity="0.06"/><text x="${
      nx + 2
    }" y="${ny - 8}" font-size="${SECTION_LABEL_FONT}">${esc(s.label)}</text></g>`;
  }
  const common = `data-id="${esc(s.id)}" data-tool="${s.tool}" stroke="${esc(s.color)}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  if (s.tool === 'pen') {
    // Highlighter (item 8) — data-highlighter ONLY when true so a normal pen
    // stays byte-identical (canary).
    const hl = s.highlighter ? ' data-highlighter="1"' : '';
    return `<path ${common} fill="none" d="${penPathD(s.points)}"${hl} pointer-events="stroke"/>`;
  }
  if (s.tool === 'rect') {
    const fill = s.fill ? esc(s.fill) : 'none';
    // Phase 21 — corner radius: append rx/ry/data-r ONLY when > 0 so legacy
    // sharp-corner rects serialize byte-identically (Task 10 canary).
    const r = s.cornerRadius ?? 0;
    const round = r > 0 ? ` rx="${r}" ry="${r}" data-r="${r}"` : '';
    // Dashed outline (item 7) — emitted ONLY when true (mirror polygon/arrow)
    // so a legacy solid rect stays byte-identical.
    const dash = s.dashed ? ' stroke-dasharray="6 4"' : '';
    const dashAttr = s.dashed ? ' data-dash="1"' : '';
    return `<rect ${common} fill="${fill}" x="${s.x}" y="${s.y}" width="${Math.max(
      0,
      s.w
    )}" height="${Math.max(0, s.h)}"${round}${dash}${dashAttr}/>`;
  }
  if (s.tool === 'ellipse') {
    const fill = s.fill ? esc(s.fill) : 'none';
    const dash = s.dashed ? ' stroke-dasharray="6 4"' : '';
    const dashAttr = s.dashed ? ' data-dash="1"' : '';
    return `<ellipse ${common} fill="${fill}" cx="${s.cx}" cy="${s.cy}" rx="${Math.max(
      0,
      s.rx
    )}" ry="${Math.max(0, s.ry)}"${dash}${dashAttr}/>`;
  }
  if (s.tool === 'polygon') {
    // Phase 24 — bbox-derived points + data-shape. Normalize the bbox so a
    // negative-extent (mid-flip) stroke serializes idempotently.
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const nw = Math.abs(s.w);
    const nh = Math.abs(s.h);
    const fill = s.fill ? esc(s.fill) : 'none';
    const dash = s.dashed ? ' stroke-dasharray="6 4"' : '';
    const dashAttr = s.dashed ? ' data-dash="1"' : '';
    return `<polygon ${common} fill="${fill}" data-shape="${esc(s.shape)}" points="${polygonPoints(
      s.shape,
      nx,
      ny,
      nw,
      nh
    )}"${dash}${dashAttr}/>`;
  }
  // arrow — Phase 24 reduces to ordered SVG primitives (canvas-arrowheads), the
  // same primitives StrokeNode renders. Defaults (startHead 'none', endHead
  // 'triangle', lineType 'straight', solid) reduce to exactly
  // [<line>, <polyline fill=color>] → the byte-identical Phase 5.1 form. data-*
  // attrs appear only for non-default values.
  const startHead = s.startHead ?? 'none';
  const endHead = s.endHead ?? 'triangle';
  const lineType = s.lineType ?? 'straight';
  const dashed = s.dashed ?? false;
  // esc() every interpolated value (defence-in-depth, Phase 24 security review
  // DDR-067) — heads are clamped on parse, but a value reaching serialize must
  // never be able to break out of the attribute.
  const dataAttrs =
    (startHead !== 'none' ? ` data-start-head="${esc(startHead)}"` : '') +
    (endHead !== 'triangle' ? ` data-end-head="${esc(endHead)}"` : '') +
    (lineType !== 'straight' ? ` data-line-type="${esc(lineType)}"` : '') +
    (dashed ? ' data-dash="1"' : '');
  const body = arrowPrimitives(s).map(svgPrimitiveToString).join('');
  return `<g ${common} fill="none"${dataAttrs}>${body}</g>`;
}

/** Format one arrow SVG primitive for the persisted string (byte-identical to
 *  the Phase-5.1 `<line>`/`<polyline>` forms for the legacy default arrow). */
function svgPrimitiveToString(p: SvgPrimitive): string {
  const dash = 'dash' in p && p.dash ? ' stroke-dasharray="6 4"' : '';
  switch (p.el) {
    case 'line':
      return `<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}"${dash}/>`;
    case 'path':
      return `<path d="${p.d}"${dash}/>`;
    case 'polyline':
      return `<polyline points="${p.points}" fill="${esc(p.fill)}"/>`;
    case 'polygon':
      return `<polygon points="${p.points}" fill="${esc(p.fill)}"/>`;
    case 'circle':
      return `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${esc(p.fill)}"/>`;
  }
}

export function strokesToSvg(strokes: readonly Stroke[]): string {
  const header = '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1">';
  if (strokes.length === 0) return `${header}</svg>`;
  const body = strokes.map(strokeToSvgEl).join('');
  return `${header}${body}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse

/**
 * Parse a numeric attribute, clamping non-finite results to `fallback`.
 * A poisoned/synced SVG can carry `x="1e999"` (→ Infinity) or `"abc"` (→ NaN);
 * those must NOT survive into geometry, because the `read-annotations` reader
 * coerces non-finite to 0 while the renderer would keep Infinity — the AI and
 * the human would then see the stroke at different positions (a content-spoof
 * side-channel — Wave H security review F4). Clamping here keeps the two views
 * in agreement and protects the bind / resize math from NaN propagation.
 */
function pfloat(raw: string | null | undefined, fallback = 0): number {
  const v = Number.parseFloat(raw ?? '');
  return Number.isFinite(v) ? v : fallback;
}

function parsePathD(d: string): WorldPoint[] {
  const out: WorldPoint[] = [];
  const re = /[ML]\s*(-?\d+(?:\.\d+)?)\s*[\s,]\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = re.exec(d)) !== null) {
    const [, x = '0', y = '0'] = m;
    out.push([pfloat(x), pfloat(y)]);
  }
  return out;
}

function parseFill(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent') return null;
  return raw;
}

/**
 * Phase 24 — recover an arrow's two endpoints from its shaft. A straight arrow
 * persists a `<line>`; a curved/elbow arrow persists a `<path>` whose first and
 * last coordinate pairs are the endpoints (the bow control / elbow corner sit
 * between them, so first-pair = start, last-pair = end recovers the ends
 * exactly → idempotent re-serialize).
 */
function arrowEndpoints(el: SvgElLike): { x1: number; y1: number; x2: number; y2: number } | null {
  const line = el.querySelector('line');
  if (line) {
    return {
      x1: pfloat(line.getAttribute('x1')),
      y1: pfloat(line.getAttribute('y1')),
      x2: pfloat(line.getAttribute('x2')),
      y2: pfloat(line.getAttribute('y2')),
    };
  }
  const path = el.querySelector('path');
  if (path) {
    const nums = (path.getAttribute('d') || '').match(/-?\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 4) {
      return {
        x1: pfloat(nums[0]),
        y1: pfloat(nums[1]),
        x2: pfloat(nums[nums.length - 2]),
        y2: pfloat(nums[nums.length - 1]),
      };
    }
  }
  return null;
}

/**
 * FigJam v3 — parse a `data-start-bind` / `data-end-bind` value (`"<hostId>
 * <nx> <ny>"`). Out-of-range / malformed values are rejected (a poisoned
 * hub-pushed SVG must not cast through unchecked — same posture as the
 * arrowhead clamp, DDR-067).
 */
function parseBindAttr(raw: string | null): ArrowBind | null {
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3 && !(parts.length === 4 && parts[3] === 'p')) return null;
  const [hostId, nxRaw, nyRaw] = parts;
  const nx = Number.parseFloat(nxRaw ?? '');
  const ny = Number.parseFloat(nyRaw ?? '');
  if (!hostId || !Number.isFinite(nx) || !Number.isFinite(ny)) return null;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
  const bind: ArrowBind = { hostId, nx, ny };
  if (parts.length === 4) bind.pinned = true;
  return bind;
}

const AUTHOR_NAME_MAX_LEN = 64;

/**
 * Phase 3 (whiteboard-improvements) — an `authorName` parsed off disk may
 * have come from a peer's synced `.annotations.svg` (untrusted foreign
 * input, same class of risk `use-collab.tsx`'s `sanitizeForeignState` /
 * `sanitizeName` already guard presence names against). Strips control
 * chars, bidi overrides/isolates, zero-width chars, and the BOM; caps
 * length. Mirrors that function's code-point ranges rather than importing
 * it — this module stays dependency-free of the stateful collab layer.
 */
function sanitizeAuthorName(raw: string): string {
  let cleaned = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0) ?? 0;
    const unsafe =
      cp <= 0x1f ||
      (cp >= 0x7f && cp <= 0x9f) ||
      (cp >= 0x200b && cp <= 0x200f) ||
      (cp >= 0x202a && cp <= 0x202e) ||
      (cp >= 0x2066 && cp <= 0x2069) ||
      cp === 0xfeff;
    if (!unsafe) cleaned += ch;
  }
  return cleaned.trim().slice(0, AUTHOR_NAME_MAX_LEN);
}

/** FigJam v3 — read the cross-tool root attrs back onto a parsed stroke. */
function readSharedAttrs(el: SvgElLike, s: Stroke): void {
  const g = el.getAttribute('data-group-ids');
  if (g) {
    const ids = g.split(/\s+/).filter(Boolean);
    if (ids.length) s.groupIds = ids;
  }
  if (el.getAttribute('data-author') === 'ai') s.author = 'ai';
  if (el.getAttribute('data-locked') === '1') s.locked = true;
  const authorName = el.getAttribute('data-author-name');
  if (authorName) {
    const cleaned = sanitizeAuthorName(authorName);
    if (cleaned) s.authorName = cleaned;
  }
  const authorId = el.getAttribute('data-author-id');
  if (authorId) {
    const cleanedId = sanitizeAuthorName(authorId);
    if (cleanedId) s.authorId = cleanedId;
  }
  // FigJam v3 — rotation. `data-rot` is authoritative (the transform attr is
  // presentational); malformed / out-of-range values drop to axis-aligned.
  const rotRaw = el.getAttribute('data-rot');
  if (rotRaw != null && canRotate(s)) {
    const rot = normalizeRotation(Number.parseFloat(rotRaw));
    if (rot !== 0) s.rotation = rot;
  }
}

/**
 * The slice of the DOM `Element` API the parser reads. A browser `Element`
 * satisfies it; so does the DOM-free tree in `annotations/legacy/mini-dom.ts`,
 * which lets the hub (Node, no DOMParser) upconvert legacy SVG history for the
 * annotations-v2 migration (DDR-242 §6).
 */
export interface SvgElLike {
  getAttribute(name: string): string | null;
  querySelector(selector: string): SvgElLike | null;
  querySelectorAll(selector: string): ArrayLike<SvgElLike>;
  readonly textContent: string | null;
  readonly outerHTML: string;
}

export interface SvgDocLike {
  querySelector(selector: string): SvgElLike | null;
  querySelectorAll(selector: string): ArrayLike<SvgElLike>;
}

export function svgToStrokes(svgText: string): Stroke[] {
  const text = (svgText ?? '').trim();
  if (!text) return [];
  if (typeof DOMParser === 'undefined') return [];
  try {
    return strokesFromDocument(new DOMParser().parseFromString(text, 'image/svg+xml'));
  } catch {
    return [];
  }
}

/** The parser proper, over any document exposing `SvgDocLike`. Never throws. */
export function strokesFromDocument(doc: SvgDocLike): Stroke[] {
  try {
    if (doc.querySelector('parsererror')) return [];
    const out: Stroke[] = [];
    const seenContent = new Map<string, number>();
    for (const el of Array.from(doc.querySelectorAll('[data-tool]'))) {
      const tool = el.getAttribute('data-tool');
      const id = el.getAttribute('data-id') || stableAnnotationId(el, seenContent);
      const color = el.getAttribute('stroke') || el.getAttribute('fill') || DEFAULT_COLOR;
      const width = Number.parseFloat(el.getAttribute('stroke-width') || '2') || 2;
      // FigJam v3 — every branch funnels through push() so the shared attrs
      // (group ids / provenance) are read uniformly.
      const push = (s: Stroke): void => {
        readSharedAttrs(el, s);
        out.push(s);
      };
      if (tool === 'pen') {
        const d = el.getAttribute('d') || '';
        const points = parsePathD(d);
        if (points.length) {
          const pen: PenStroke = { id, tool: 'pen', color, width, points };
          // Highlighter flag; absent ⇒ undefined so a normal pen round-trips.
          if (el.getAttribute('data-highlighter') === '1') pen.highlighter = true;
          push(pen);
        }
        continue;
      }
      if (tool === 'sticky') {
        // Phase 21 — sticky reads geometry off its <rect> child, paper tint
        // off the group fill, body text off the inner <text>.
        const rectEl = el.querySelector('rect');
        const x = pfloat(rectEl?.getAttribute('x'));
        const y = pfloat(rectEl?.getAttribute('y'));
        const w = pfloat(rectEl?.getAttribute('width'));
        const h = pfloat(rectEl?.getAttribute('height'));
        const cornerRadius = pfloat(el.getAttribute('data-r'), STICKY_CORNER_RADIUS);
        const fontSize = pfloat(el.getAttribute('data-fs'), DEFAULT_FONT_SIZE) || DEFAULT_FONT_SIZE;
        const stickyColor = el.getAttribute('fill') || DEFAULT_STICKY_COLOR;
        const body = el.querySelector('text');
        const sticky: StickyStroke = {
          id,
          tool: 'sticky',
          color: stickyColor,
          x,
          y,
          w,
          h,
          text: body?.textContent ?? '',
          fontSize,
          cornerRadius,
        };
        // Style attrs; absent ⇒ defaults (normal / left), left unset.
        if (el.getAttribute('data-bold') === '1') sticky.bold = true;
        if (el.getAttribute('data-italic') === '1') sticky.italic = true;
        if (el.getAttribute('data-strike') === '1') sticky.strike = true;
        if (el.getAttribute('data-underline') === '1') sticky.underline = true;
        const sticAlign = el.getAttribute('data-align');
        if (sticAlign === 'left' || sticAlign === 'center' || sticAlign === 'right') {
          sticky.align = sticAlign;
        }
        const sticList = el.getAttribute('data-list');
        if (sticList === 'bullet' || sticList === 'number') sticky.listType = sticList;
        push(sticky);
        continue;
      }
      if (tool === 'section') {
        const rectEl = el.querySelector('rect');
        const x = pfloat(rectEl?.getAttribute('x'));
        const y = pfloat(rectEl?.getAttribute('y'));
        const w = pfloat(rectEl?.getAttribute('width'));
        const h = pfloat(rectEl?.getAttribute('height'));
        const section: SectionStroke = {
          id,
          tool: 'section',
          x,
          y,
          w,
          h,
          label: el.getAttribute('data-label') || 'Section',
          color: el.getAttribute('fill') || DEFAULT_SECTION_COLOR,
        };
        push(section);
        continue;
      }
      if (tool === 'rect') {
        const x = pfloat(el.getAttribute('x'));
        const y = pfloat(el.getAttribute('y'));
        const w = pfloat(el.getAttribute('width'));
        const h = pfloat(el.getAttribute('height'));
        const fill = parseFill(el.getAttribute('fill'));
        // Phase 21 — corner radius; absent ⇒ 0 (sharp, back-compat).
        const cornerRadius = pfloat(el.getAttribute('data-r'));
        const rect: RectStroke = { id, tool: 'rect', color, width, x, y, w, h, fill, cornerRadius };
        // Dashed (item 7); absent ⇒ undefined so a solid rect round-trips.
        const rectDash = el.getAttribute('data-dash');
        if (rectDash === '1' || rectDash === 'true') rect.dashed = true;
        push(rect);
        continue;
      }
      if (tool === 'ellipse') {
        const cx = pfloat(el.getAttribute('cx'));
        const cy = pfloat(el.getAttribute('cy'));
        const rx = pfloat(el.getAttribute('rx'));
        const ry = pfloat(el.getAttribute('ry'));
        const fill = parseFill(el.getAttribute('fill'));
        const ell: EllipseStroke = { id, tool: 'ellipse', color, width, cx, cy, rx, ry, fill };
        const ellDash = el.getAttribute('data-dash');
        if (ellDash === '1' || ellDash === 'true') ell.dashed = true;
        push(ell);
        continue;
      }
      if (tool === 'polygon') {
        // Phase 24 — recover the bbox from the points; shape from data-shape.
        const shapeRaw = el.getAttribute('data-shape');
        const shape: PolygonShape =
          shapeRaw === 'triangle' || shapeRaw === 'triangle-down' ? shapeRaw : 'diamond';
        const bb = polygonBBox(el.getAttribute('points') || '');
        if (bb) {
          const fill = parseFill(el.getAttribute('fill'));
          const poly: PolygonStroke = {
            id,
            tool: 'polygon',
            shape,
            color,
            width,
            x: bb.x,
            y: bb.y,
            w: bb.w,
            h: bb.h,
            fill,
          };
          const dashRaw = el.getAttribute('data-dash');
          if (dashRaw === '1' || dashRaw === 'true') poly.dashed = true;
          push(poly);
        }
        continue;
      }
      if (tool === 'arrow') {
        // Phase 24 — shaft is a <line> (straight) OR a <path> (curved/elbow).
        // Recover the two endpoints from whichever is present.
        const ends = arrowEndpoints(el);
        if (ends) {
          const arrow: ArrowStroke = {
            id,
            tool: 'arrow',
            color,
            width,
            x1: ends.x1,
            y1: ends.y1,
            x2: ends.x2,
            y2: ends.y2,
          };
          // Heads + dash + line-type. The serializer writes a data-* attribute
          // only for a NON-default value, so a legacy arrow carries none of
          // these and stays { startHead/endHead/dashed/lineType: undefined } →
          // defaults on re-serialize (byte-identical, canary). Phase 24 widened
          // the head enum, so read the literal value rather than match a single
          // string.
          // Clamp to the known head vocabulary — an out-of-vocab / poisoned
          // value (hub-pushed SVG) is rejected, never cast through unchecked
          // (Phase 24 security review, DDR-067).
          const sh = el.getAttribute('data-start-head');
          if (sh && ARROW_HEADS.has(sh)) arrow.startHead = sh as ArrowHead;
          const eh = el.getAttribute('data-end-head');
          if (eh && ARROW_HEADS.has(eh)) arrow.endHead = eh as ArrowHead;
          const lt = el.getAttribute('data-line-type');
          if (lt === 'curved' || lt === 'elbow' || lt === 'straight') arrow.lineType = lt;
          const dashRaw = el.getAttribute('data-dash');
          if (dashRaw === '1' || dashRaw === 'true') arrow.dashed = true;
          // FigJam v3 — magnetic endpoint bindings (validated + clamped).
          const sb = parseBindAttr(el.getAttribute('data-start-bind'));
          if (sb) arrow.startBind = sb;
          const eb = parseBindAttr(el.getAttribute('data-end-bind'));
          if (eb) arrow.endBind = eb;
          push(arrow);
        }
        continue;
      }
      if (tool === 'image') {
        // Phase 23 — geometry off the element; href is whatever survived the
        // sanitizer (a valid assets/<sha8>.<ext> path, or '' if it was stripped
        // — an external/data:/`..` href is dropped server-side, so a poisoned
        // SVG round-trips to an inert empty-href stroke that fetches nothing).
        const x = pfloat(el.getAttribute('x'));
        const y = pfloat(el.getAttribute('y'));
        const w = pfloat(el.getAttribute('width'));
        const h = pfloat(el.getAttribute('height'));
        const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        const img: ImageStroke = { id, tool: 'image', x, y, w, h, href };
        const alt = el.getAttribute('data-alt');
        if (alt) img.alt = alt;
        push(img);
        continue;
      }
      if (tool === 'link') {
        // Phase 23 — data-* are the source of truth; geometry off the <rect>
        // child (mirrors sticky). Defensive: missing title ⇒ domain.
        const rectEl = el.querySelector('rect');
        const x = pfloat(rectEl?.getAttribute('x'));
        const y = pfloat(rectEl?.getAttribute('y'));
        const w = pfloat(rectEl?.getAttribute('width'), LINK_DEFAULT_W);
        const h = pfloat(rectEl?.getAttribute('height'), LINK_DEFAULT_H);
        const url = el.getAttribute('data-url') || '';
        const domain = el.getAttribute('data-domain') || '';
        const title = el.getAttribute('data-title') || domain || url;
        push({ id, tool: 'link', x, y, w, h, url, title, domain });
        continue;
      }
      if (tool === 'mediaref') {
        // DDR-150 P4 — geometry off the <rect> child (mirrors link/sticky);
        // data-src is the pointer the agent enumerates. A src that fails the
        // assets/ shape is dropped to '' (an inert chip that references nothing).
        const rectEl = el.querySelector('rect');
        const x = pfloat(rectEl?.getAttribute('x'));
        const y = pfloat(rectEl?.getAttribute('y'));
        const w = pfloat(rectEl?.getAttribute('width'), MEDIAREF_DEFAULT_W);
        const h = pfloat(rectEl?.getAttribute('height'), MEDIAREF_DEFAULT_H);
        const rawSrc = el.getAttribute('data-src') || '';
        const src = ASSET_MEDIA_SRC_RE.test(rawSrc) ? rawSrc : '';
        const mediaKind = el.getAttribute('data-media-kind') === 'audio' ? 'audio' : 'video';
        const title = el.getAttribute('data-title') || src;
        push({ id, tool: 'mediaref', x, y, w, h, src, mediaKind, title });
        continue;
      }
      if (tool === 'text') {
        const rawAnchor = el.getAttribute('data-anchor-id');
        const fontSize =
          pfloat(el.getAttribute('data-font-size'), DEFAULT_FONT_SIZE) || DEFAULT_FONT_SIZE;
        const inkColor = el.getAttribute('fill') || color;
        // List style (item 4c) — read FIRST so per-line markers can be stripped
        // off the parsed text (markers are render-only; never stored).
        const listRaw = el.getAttribute('data-list');
        const listType: ListType | undefined =
          listRaw === 'bullet' || listRaw === 'number' ? listRaw : undefined;
        // Multi-line text (item 4a) — one <tspan> per line. Recover `\n` by
        // joining tspan text content (markers stripped); a legacy single-run
        // <text> has no tspans → read its trimmed textContent.
        const tspans = el.querySelectorAll('tspan');
        const body =
          tspans.length > 0
            ? Array.from(tspans)
                .map((t, i) => stripListPrefix(t.textContent ?? '', i, listType))
                .join('\n')
            : stripListPrefix((el.textContent || '').trim(), 0, listType);
        // bold / italic / strike / underline / align. `data-align` is the
        // round-trip source of truth (text-anchor is derived from it). Absent ⇒
        // default (normal / per-kind align), left unset so legacy nodes
        // round-trip.
        const isBold = el.getAttribute('font-weight') === '700';
        const isItalic = el.getAttribute('font-style') === 'italic';
        const decoAttr = el.getAttribute('text-decoration') || '';
        const isStrike = decoAttr.includes('line-through');
        const isUnderline = decoAttr.includes('underline');
        const da = el.getAttribute('data-align');
        const align: TextAlign | undefined =
          da === 'left' || da === 'center' || da === 'right' ? da : undefined;
        // Phase 21 — standalone text (no data-anchor-id) carries world x/y
        // instead of a host id.
        if (!rawAnchor) {
          const t: TextStroke = {
            id,
            tool: 'text',
            color: inkColor,
            fontSize,
            text: body,
            x: pfloat(el.getAttribute('x')),
            y: pfloat(el.getAttribute('y')),
          };
          if (isBold) t.bold = true;
          if (isItalic) t.italic = true;
          if (isStrike) t.strike = true;
          if (isUnderline) t.underline = true;
          if (listType) t.listType = listType;
          if (align) t.align = align;
          push(t);
          continue;
        }
        const t: TextStroke = {
          id,
          tool: 'text',
          color: inkColor,
          fontSize,
          text: body,
          anchorId: rawAnchor,
        };
        if (isBold) t.bold = true;
        if (isItalic) t.italic = true;
        if (isStrike) t.strike = true;
        if (isUnderline) t.underline = true;
        if (listType) t.listType = listType;
        if (align) t.align = align;
        push(t);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry — hit-test, bbox, normalize, translate

function pointSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** FigJam v3 — strokes whose `rotation` is honoured (see StrokeBase doc). */
export function canRotate(s: Stroke): boolean {
  if (s.tool === 'element') return false;
  if (s.tool === 'pen' || s.tool === 'arrow' || s.tool === 'section') return false;
  if (s.tool === 'text') return s.anchorId == null || s.anchorId === '';
  return true;
}

/** Normalize degrees into (-180, 180]; non-finite → 0. */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  // Quantize to 0.1° — keeps the serialized form short + float-stable.
  return Math.round(d * 10) / 10;
}

/** The stroke's effective rotation (0 for tools that ignore it). */
export function strokeRotation(s: Stroke): number {
  if (!s.rotation || !canRotate(s)) return 0;
  return normalizeRotation(s.rotation);
}

/** Rotate a point around a pivot by `deg` degrees clockwise. */
export function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  deg: number
): [number, number] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** The stroke's (unrotated) bbox center — the rotation pivot. */
export function strokeCenter(s: Stroke): [number, number] | null {
  const bb = strokeBBox(s);
  if (!bb) return null;
  return [bb.x + bb.w / 2, bb.y + bb.h / 2];
}

export function strokeHitTest(s: Stroke, wx: number, wy: number, tol: number): boolean {
  // FigJam v3 — rotated strokes hit-test in their LOCAL frame: inverse-rotate
  // the probe around the pivot, then run the axis-aligned math unchanged.
  const rot = strokeRotation(s);
  if (rot !== 0) {
    const c = strokeCenter(s);
    if (c) {
      const [ux, uy] = rotatePoint(wx, wy, c[0], c[1], -rot);
      wx = ux;
      wy = uy;
    }
  }
  if (s.tool === 'text') {
    // Anchored text isn't independently hit-testable (it inherits its host).
    // Standalone text (Phase 21) uses its synthetic bbox so the eraser can
    // reach it.
    if (s.anchorId != null && s.anchorId !== '') return false;
    const bb = strokeBBox(s);
    if (!bb) return false;
    return (
      wx >= bb.x - tol && wx <= bb.x + bb.w + tol && wy >= bb.y - tol && wy <= bb.y + bb.h + tol
    );
  }
  if (s.tool === 'element') {
    return defOf(s.el.type)?.hitTest(s.el, wx, wy, tol, WORLD_CTX) ?? false;
  }
  if (s.tool === 'section') {
    // FigJam — a section is grabbed by its BORDER or its label chip; the
    // interior stays click-through so content on the section selects normally.
    const t = Math.max(tol, 8);
    const xMin = Math.min(s.x, s.x + s.w);
    const xMax = Math.max(s.x, s.x + s.w);
    const yMin = Math.min(s.y, s.y + s.h);
    const yMax = Math.max(s.y, s.y + s.h);
    // Label chip above the top-left corner.
    const chipW = Math.max(56, s.label.length * SECTION_LABEL_FONT * 0.62 + 18);
    if (wx >= xMin && wx <= xMin + chipW && wy >= yMin - SECTION_LABEL_H - 6 && wy <= yMin) {
      return true;
    }
    if (wx < xMin - t || wx > xMax + t || wy < yMin - t || wy > yMax + t) return false;
    const onEdge =
      Math.abs(wx - xMin) <= t ||
      Math.abs(wx - xMax) <= t ||
      Math.abs(wy - yMin) <= t ||
      Math.abs(wy - yMax) <= t;
    return onEdge;
  }
  const t = Math.max(tol, 'width' in s ? s.width : 2);
  if (s.tool === 'sticky' || s.tool === 'image' || s.tool === 'link' || s.tool === 'mediaref') {
    // Sticky / image / link / mediaref are solid cards — filled-rect hit inside.
    const xMin = Math.min(s.x, s.x + s.w);
    const xMax = Math.max(s.x, s.x + s.w);
    const yMin = Math.min(s.y, s.y + s.h);
    const yMax = Math.max(s.y, s.y + s.h);
    return wx >= xMin - t && wx <= xMax + t && wy >= yMin - t && wy <= yMax + t;
  }
  if (s.tool === 'pen') {
    if (s.points.length === 1) {
      const p = s.points[0] as WorldPoint;
      return Math.hypot(wx - p[0], wy - p[1]) <= t;
    }
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1] as WorldPoint;
      const b = s.points[i] as WorldPoint;
      if (pointSegmentDist(wx, wy, a[0], a[1], b[0], b[1]) <= t) return true;
    }
    return false;
  }
  if (s.tool === 'arrow') {
    return pointSegmentDist(wx, wy, s.x1, s.y1, s.x2, s.y2) <= t;
  }
  if (s.tool === 'ellipse') {
    // Inside-ellipse hit when filled; on the perimeter otherwise.
    if (s.rx <= 0 || s.ry <= 0) return false;
    const nx = (wx - s.cx) / s.rx;
    const ny = (wy - s.cy) / s.ry;
    const d = nx * nx + ny * ny;
    if (s.fill) return d <= 1.0 + t / Math.max(s.rx, s.ry);
    // Stroke-only: hit if normalized distance is within a band around 1.
    const band = t / Math.max(s.rx, s.ry);
    const dist = Math.abs(Math.sqrt(d) - 1);
    return dist <= band;
  }
  if (s.tool === 'polygon') {
    const nx = Math.min(s.x, s.x + s.w);
    const ny = Math.min(s.y, s.y + s.h);
    const pts = polygonVertices(s.shape, nx, ny, Math.abs(s.w), Math.abs(s.h));
    // Filled → inside-hit; always allow an edge-proximity hit (covers the
    // stroke-only outline + a tolerance band on a filled shape).
    if (s.fill && pointInPolygon(wx, wy, pts)) return true;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as [number, number];
      const b = pts[(i + 1) % pts.length] as [number, number];
      if (pointSegmentDist(wx, wy, a[0], a[1], b[0], b[1]) <= t) return true;
    }
    return false;
  }
  // rect — inside when filled, edge-only otherwise.
  const x = s.x;
  const y = s.y;
  const x2 = x + s.w;
  const y2 = y + s.h;
  const xMin = Math.min(x, x2);
  const xMax = Math.max(x, x2);
  const yMin = Math.min(y, y2);
  const yMax = Math.max(y, y2);
  if (s.fill) {
    return wx >= xMin - t && wx <= xMax + t && wy >= yMin - t && wy <= yMax + t;
  }
  if (wx < xMin - t || wx > xMax + t) return false;
  if (wy < yMin - t || wy > yMax + t) return false;
  const onLeft = Math.abs(wx - x) <= t;
  const onRight = Math.abs(wx - x2) <= t;
  const onTop = Math.abs(wy - y) <= t;
  const onBottom = Math.abs(wy - y2) <= t;
  return onLeft || onRight || onTop || onBottom;
}

/** Flip a negative-extent box so x/y is the top-left and w/h are positive. */
export function normalizeBox<T extends { x: number; y: number; w: number; h: number }>(r: T): T {
  if (r.w >= 0 && r.h >= 0) return r;
  return {
    ...r,
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

/**
 * Phase 24 — draw-time resize modifiers (FigJam parity, mirror of the
 * `use-annotation-resize.tsx` set so create + resize feel identical):
 *   • `shift` — lock to 1:1 (square / circle); the larger drag axis sets the
 *               side, each axis keeps its own sign so the drag direction holds.
 *   • `alt`   — grow from the pointer-down point as CENTER (symmetric).
 * With neither held the box is `{ x: down, w: cursor − down }` — byte-identical
 * to the previous corner-drag math.
 */
export interface DrawMods {
  shift: boolean;
  alt: boolean;
}

/** Constrain a draw drag (`ax,ay` = pointer-down anchor; `wx,wy` = cursor). */
export function constrainDrawBox(
  ax: number,
  ay: number,
  wx: number,
  wy: number,
  mods: DrawMods
): { x: number; y: number; w: number; h: number } {
  let dx = wx - ax;
  let dy = wy - ay;
  if (mods.shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * side;
    dy = (dy < 0 ? -1 : 1) * side;
  }
  if (mods.alt) {
    // Anchor is the center → span ±|d| on each axis around it.
    return { x: ax - dx, y: ay - dy, w: 2 * dx, h: 2 * dy };
  }
  return { x: ax, y: ay, w: dx, h: dy };
}

/**
 * Apply the draw-time modifiers to the in-progress stroke. Shared by the
 * pointer-move handler and the live keydown/keyup re-apply, so holding Shift /
 * Alt updates the draft even without moving the cursor. `anchor` is the
 * pointer-down point; pen / text carry no box so they pass through unchanged.
 */
export function applyDrawModifiers(
  cur: Stroke,
  anchor: { x: number; y: number },
  wx: number,
  wy: number,
  mods: DrawMods
): Stroke {
  if (cur.tool === 'rect' || cur.tool === 'polygon' || cur.tool === 'section') {
    const b = constrainDrawBox(anchor.x, anchor.y, wx, wy, mods);
    return { ...cur, x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (cur.tool === 'ellipse') {
    const b = constrainDrawBox(anchor.x, anchor.y, wx, wy, mods);
    return {
      ...cur,
      cx: b.x + b.w / 2,
      cy: b.y + b.h / 2,
      rx: Math.abs(b.w) / 2,
      ry: Math.abs(b.h) / 2,
    };
  }
  if (cur.tool === 'sticky') {
    // Stickies are always 1:1 — force the square constraint; Alt still centers.
    const b = constrainDrawBox(anchor.x, anchor.y, wx, wy, { shift: true, alt: mods.alt });
    return { ...cur, x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (cur.tool === 'arrow') {
    let x2 = wx;
    let y2 = wy;
    if (mods.shift) {
      // Snap the shaft to the nearest 45° around the anchor (its midpoint
      // under Alt), keeping the cursor's distance.
      const dx = wx - anchor.x;
      const dy = wy - anchor.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.PI / 4;
      const ang = Math.round(Math.atan2(dy, dx) / step) * step;
      x2 = anchor.x + Math.cos(ang) * dist;
      y2 = anchor.y + Math.sin(ang) * dist;
    }
    if (mods.alt) {
      // Anchor is the midpoint → the start end mirrors the dragged end.
      return { ...cur, x1: 2 * anchor.x - x2, y1: 2 * anchor.y - y2, x2, y2 };
    }
    return { ...cur, x1: anchor.x, y1: anchor.y, x2, y2 };
  }
  return cur;
}

export function normalizeRect(r: RectStroke): RectStroke {
  return normalizeBox(r);
}

// Phase 21 — sticky shares rect's drag-to-create flip (x = min, w = abs(w)).
export function normalizeSticky(s: StickyStroke): StickyStroke {
  return normalizeBox(s);
}

export function isStrokeMeaningful(s: Stroke): boolean {
  if (s.tool === 'element') return defOf(s.el.type)?.meaningful(s.el) ?? false;
  if (s.tool === 'pen') return s.points.length >= 2;
  if (s.tool === 'rect') return Math.abs(s.w) >= 4 && Math.abs(s.h) >= 4;
  if (s.tool === 'polygon') return Math.abs(s.w) >= 4 && Math.abs(s.h) >= 4;
  if (s.tool === 'ellipse') return s.rx >= 2 && s.ry >= 2;
  if (s.tool === 'text') return s.text.trim().length > 0;
  // Sticky below a readable floor is discarded like a 2×2 rect.
  if (s.tool === 'sticky')
    return Math.abs(s.w) >= STICKY_MIN_SIZE && Math.abs(s.h) >= STICKY_MIN_SIZE;
  // Phase 23 — an image needs real extent; a link needs a non-empty URL.
  if (s.tool === 'image') return Math.abs(s.w) >= IMAGE_MIN_SIZE && Math.abs(s.h) >= IMAGE_MIN_SIZE;
  if (s.tool === 'link') return s.url.trim().length > 0;
  // A media-reference chip needs a non-empty assets/ src (its whole purpose).
  if (s.tool === 'mediaref') return s.src.trim().length > 0;
  if (s.tool === 'section')
    return Math.abs(s.w) >= SECTION_MIN_SIZE && Math.abs(s.h) >= SECTION_MIN_SIZE;
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 4;
}

const WORLD_CTX: GeomCtx = { origin: { x: 0, y: 0 }, resolve: () => null };

function elementBox(s: ElementStroke): { x: number; y: number; w: number; h: number } | null {
  return defOf(s.el.type)?.bounds(s.el, WORLD_CTX) ?? null;
}

export function strokeBBox(
  s: Stroke,
  anchors?: Map<string, AnchorHost>
): { x: number; y: number; w: number; h: number } | null {
  if (s.tool === 'element') return elementBox(s);
  if (s.tool === 'pen') {
    if (!s.points.length) return null;
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;
    for (const [px, py] of s.points) {
      if (px < xMin) xMin = px;
      if (px > xMax) xMax = px;
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
    return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
  }
  if (s.tool === 'rect' || s.tool === 'polygon') {
    return {
      x: Math.min(s.x, s.x + s.w),
      y: Math.min(s.y, s.y + s.h),
      w: Math.abs(s.w),
      h: Math.abs(s.h),
    };
  }
  if (s.tool === 'ellipse') {
    return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
  }
  if (s.tool === 'arrow') {
    return {
      x: Math.min(s.x1, s.x2),
      y: Math.min(s.y1, s.y2),
      w: Math.abs(s.x2 - s.x1),
      h: Math.abs(s.y2 - s.y1),
    };
  }
  if (
    s.tool === 'sticky' ||
    s.tool === 'image' ||
    s.tool === 'link' ||
    s.tool === 'mediaref' ||
    s.tool === 'section'
  ) {
    // Phase 23 — image + link + mediaref are rect-shaped cards, same bbox as a
    // sticky; FigJam v3 sections share it too.
    return {
      x: Math.min(s.x, s.x + s.w),
      y: Math.min(s.y, s.y + s.h),
      w: Math.abs(s.w),
      h: Math.abs(s.h),
    };
  }
  // text — anchored inherits its host's bbox; standalone (Phase 21) gets a
  // synthetic bbox from its world (x, y) so it's selectable and the context
  // toolbar can position against it.
  if (s.anchorId != null && s.anchorId !== '') {
    const host = anchors?.get(s.anchorId);
    return host ? strokeBBox(host) : null;
  }
  const tx = s.x ?? 0;
  const ty = s.y ?? 0;
  // Multi-line text (item 4a) — the bbox spans the longest line (width) and all
  // lines (height) so the selection halo / hit-test / eraser cover the whole
  // block, not just line one. List markers widen each line by 2–3 chars.
  const lines = splitTextLines(s.text);
  const markerPad = s.listType ? 3 : 0;
  const longest = lines.reduce((m, l) => Math.max(m, l.length + markerPad), 0);
  return {
    x: tx,
    y: ty,
    w: Math.max(8, longest * s.fontSize * 0.55),
    // Single-line keeps the legacy 1.2 height; multi-line grows by line count.
    h: lines.length <= 1 ? s.fontSize * 1.2 : lines.length * s.fontSize * TEXT_LINE_HEIGHT,
  };
}

export function translateOne(s: Stroke, dx: number, dy: number): Stroke {
  if (s.tool === 'element') {
    const def = defOf(s.el.type);
    return def ? { ...s, el: { ...s.el, ...def.translate(s.el, dx, dy) } } : s;
  }
  if (s.tool === 'pen') {
    return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as WorldPoint) };
  }
  if (s.tool === 'rect' || s.tool === 'polygon') return { ...s, x: s.x + dx, y: s.y + dy };
  if (s.tool === 'ellipse') return { ...s, cx: s.cx + dx, cy: s.cy + dy };
  if (s.tool === 'arrow')
    return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
  if (
    s.tool === 'sticky' ||
    s.tool === 'image' ||
    s.tool === 'link' ||
    s.tool === 'mediaref' ||
    s.tool === 'section'
  )
    return { ...s, x: s.x + dx, y: s.y + dy };
  // text — anchored inherits its host's bbox (moves with the host); standalone
  // (Phase 21) carries its own world (x, y) and translates directly.
  if (s.anchorId != null && s.anchorId !== '') return s;
  return { ...s, x: (s.x ?? 0) + dx, y: (s.y ?? 0) + dy };
}

/**
 * Reference-equal stroke comparison — true when the two arrays carry the same
 * stroke object references in the same order. Used by the annotation drag
 * onPointerUp to skip pushing an undo record when the gesture didn't actually
 * move anything (zero movement OR snapshot mapped through a no-op translate
 * back to the original references — `translateOne` short-circuits when dx=dy=0
 * because new objects are still created, so we compare references defensively).
 */
export function strokesShallowEqual(a: readonly Stroke[], b: readonly Stroke[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sanitizer — moved from api.ts (FigJam v3): the allowlist guards exactly the
// vocabulary this module serializes, and headless consumers (the `maude design
// annotate` write verb) need it without pulling the server modules.

/**
 * Elements the annotation tool legitimately emits (`strokesToSvg` in
 * annotations-layer.tsx). This is the WHOLE vocabulary — purely presentational.
 */
export const ANNOTATION_SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'rect',
  'ellipse',
  'line',
  'polyline',
  // Phase 24 — `polygon` (diamond / triangle shape primitives + closed arrowhead
  // outlines + diamond heads) and `circle` (circle arrowhead). Inert shape
  // elements with no script capability — same safety class as the rest.
  'polygon',
  'circle',
  'text',
  // Annotation polish (item 4a) — `tspan` carries one line of multi-line text
  // inside a `<text>` (SVG `<text>` ignores `\n`). Inert presentational element
  // with no script capability — same safety class as `text`. Only `x`/`dy`
  // (geometry) survive; the attribute denylist strips any on*/style/href.
  'tspan',
  // Phase 23 — `image` (dropped/pasted raster). The ONLY element allowed to keep
  // an href, and ONLY a relative assets/<sha8>.<ext> path (ASSET_IMAGE_HREF_RE) —
  // every external / data: / javascript: / `..` href is still stripped. <image>
  // is a passive include with no script capability. See DDR (Task 9).
  'image',
]);

/**
 * Phase 23 — the ONLY href shape allowed to survive on an `<image>`: a relative,
 * single-segment `assets/<name>.<ext>` path. Anchored (`^…$`), no scheme, no `/`
 * beyond the one `assets/` segment (blocks `assets/../../etc/passwd`), no query,
 * ext ∈ the four raster types the upload route accepts. Everything else —
 * external, `data:`, `javascript:`, `..`, or any href on a non-image element —
 * is stripped by Rule 3. Pairs with the asset-write caps (DDR Task 9).
 */
export const ASSET_IMAGE_HREF_RE = /^assets\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/;
// DDR-150 P4 — a media-reference chip's data-src: a relative assets/ path to a
// video/audio clip (no scheme, no traversal). Same shape as the image href gate.
export const ASSET_MEDIA_SRC_RE =
  /^assets\/[A-Za-z0-9._-]+\.(?:mp4|webm|mov|m4v|mp3|wav|m4a|aac|ogg)$/;

/**
 * A3 (DDR-060 F1 re-audit) — sanitize an annotation SVG before it is persisted /
 * synced / mirrored into the collab Y.Map. ALLOWLIST, not denylist (the F1
 * confirming pass showed a denylist loses the race: `<svg:script>` via namespace,
 * `javascript&#58;` via HTML entity, `<style>@import url()>`, CSS `url(javascript:)`
 * all slipped a tag-name denylist). Two rules, both keyed to the fixed legit
 * vocabulary so they're zero-regression on real annotations:
 *
 *   1. Element allowlist — drop the markup of any tag whose LOCAL name (namespace
 *      stripped, so `svg:script` → `script`) isn't in ANNOTATION_SVG_ELEMENTS.
 *      Dropped-tag text content survives as inert text (not in a script/style
 *      context), which is harmless.
 *   2. Attribute denylist on survivors — the legit vocabulary uses none of
 *      `on*=`, `style=`, or any `href`, so stripping them closes inline handlers,
 *      CSS `url(javascript:)`, and entity-encoded `xlink:href` in one pass.
 *
 * The current consumer (`svgToStrokes` → DOMParser image/svg+xml → structured
 * strokes → React) never raw-renders this string, so the live XSS risk is already
 * nil; this keeps "inert" TRUE for any future raw-render consumer and for the
 * synced file a peer / Claude-context ingests (defense-in-depth, DDR-054 §3).
 */
export function sanitizeAnnotationSvg(svg: string): string {
  // Phase 23 — <image> href handling. Rule 3 below strips EVERY href (that's the
  // zero-bypass invariant). To let a legit assets/ href survive WITHOUT
  // re-opening the denylist race, we (a) neutralize any input-supplied marker so
  // only this pre-pass can mint one, (b) on `<image>` ONLY, hoist a regex-valid
  // assets href into a sanitizer-inert `data-mdcc-asset` marker (an external /
  // data: / `..` / non-image href is left as a plain href → stripped by Rule 3),
  // then (c) after the three rules, restore the marker back to `href` — but ONLY
  // after RE-validating the value, so a forged marker can never smuggle a
  // scheme/traversal back in. The restored value is, by construction, a safe
  // same-origin path. See ASSET_IMAGE_HREF_RE + DDR (Task 9).
  const hoisted = svg
    .replace(/\sdata-mdcc-asset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<\s*(?:[\w-]+:)?image\b[^>]*>/gi, (tag) => {
      const m = tag.match(/(?:xlink:)?href\s*=\s*"([^"]*)"|(?:xlink:)?href\s*=\s*'([^']*)'/i);
      const val = m ? (m[1] ?? m[2] ?? '') : '';
      if (!val || !ASSET_IMAGE_HREF_RE.test(val)) return tag;
      return tag.replace(/(?:xlink:)?href\s*=\s*("[^"]*"|'[^']*')/i, `data-mdcc-asset="${val}"`);
    });
  const cleaned = hoisted
    // 1. Remove the CONTENT of executable / instruction-bearing elements (not
    //    just their tags) so an injected script body / `@import` / prompt-
    //    injection string can't survive as inert text a future raw-renderer or
    //    Claude-context read might act on. Namespace-tolerant (`svg:script`),
    //    non-greedy to the first matching dangerous close tag.
    .replace(
      /<\s*(?:[\w-]+:)?(?:script|style|foreignObject|title|desc)\b[\s\S]*?<\s*\/\s*(?:[\w-]+:)?(?:script|style|foreignObject|title|desc)\s*>/gi,
      ''
    )
    // 2. Element allowlist — drop the markup of any tag whose LOCAL name isn't
    //    in the fixed annotation vocabulary. `[^>]*` stops at the first `>`;
    //    annotation attrs never contain a literal `>`.
    .replace(/<\/?\s*([a-zA-Z][\w:-]*)\b[^>]*>/g, (match, rawName: string) => {
      const local = String(rawName).split(':').pop()?.toLowerCase() ?? '';
      return ANNOTATION_SVG_ELEMENTS.has(local) ? match : '';
    })
    // 3. Attribute denylist on the surviving allowlisted elements — the legit
    //    vocabulary uses no on*= / style= / *href=, so stripping them closes
    //    inline handlers, CSS url(javascript:), and entity-encoded hrefs.
    //    The leading boundary is a LOOKBEHIND on whitespace / quote / slash
    //    (not a consumed `\s`) so a handler glued to the previous attribute's
    //    closing quote — `<circle r="2"onload="…"/>`, which HTML/SVG parsers
    //    accept as a distinct attribute — is also stripped (Phase 24 security
    //    review, DDR-067). The non-consuming lookbehind leaves the preceding
    //    quote intact so the legit attribute it belonged to survives.
    .replace(
      /(?<=[\s"'/])(?:on[a-z]+|style|(?:[\w-]+:)?href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
      ''
    );
  // Post-pass — restore the validated assets href on <image>. Re-validate the
  // marker value (defense-in-depth: a forged data-mdcc-asset can only resolve to
  // a safe same-origin assets path; anything with a scheme/traversal is dropped).
  return cleaned.replace(/\sdata-mdcc-asset\s*=\s*"([^"]*)"/gi, (_whole, val: string) =>
    ASSET_IMAGE_HREF_RE.test(val) ? ` href="${val}"` : ''
  );
}
