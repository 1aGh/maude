// FROZEN: apps/studio/print/units.ts at tag v1.9.1, verbatim below this header. It is the v1 peer's
// print reader for test/print-custom-v1.test.ts. Never edit it to follow today's module.

// feature-2-print-artboards T1 — the single source for print unit conversion
// + paper presets.
//
// Authoring stays at CSS px @96dpi (DDR-027 — mm never enters JSX geometry).
// This module is the ONLY place mm/in ↔ px conversion happens: the on-canvas
// overlay (T3), the Inspector print knobs (T2), and both exporters (T4/T5)
// all import from here. Two mm→px sites would let the on-canvas bleed
// silently desync from the exported PDF — see the plan's T1 gotcha.

export const CSS_DPI = 96;
export const MM_PER_INCH = 25.4;
export const PT_PER_INCH = 72;

export function mmToPx(mm: number, dpi: number = CSS_DPI): number {
  return (mm * dpi) / MM_PER_INCH;
}

export function inToPx(inches: number, dpi: number = CSS_DPI): number {
  return inches * dpi;
}

export function pxToMm(px: number, dpi: number = CSS_DPI): number {
  return (px * MM_PER_INCH) / dpi;
}

export function pxToIn(px: number, dpi: number = CSS_DPI): number {
  return px / dpi;
}

/** px → pt (1pt = 1/72in) — the unit pdf-lib's PDFPage boxes expect. */
export function pxToPt(px: number, dpi: number = CSS_DPI): number {
  return (px / dpi) * PT_PER_INCH;
}

export function mmToPt(mm: number): number {
  return (mm / MM_PER_INCH) * PT_PER_INCH;
}

export type PaperUnit = 'mm' | 'in';
export type PaperCategory = 'iso' | 'us' | 'envelope' | 'card' | 'poster';

export interface PaperPreset {
  id: string;
  label: string;
  category: PaperCategory;
  unit: PaperUnit;
  /** Portrait width × height, in `unit`. */
  width: number;
  height: number;
}

export const PAPER_PRESETS: readonly PaperPreset[] = [
  // ISO A series (mm)
  { id: 'a6', label: 'A6', category: 'iso', unit: 'mm', width: 105, height: 148 },
  { id: 'a5', label: 'A5', category: 'iso', unit: 'mm', width: 148, height: 210 },
  { id: 'a4', label: 'A4', category: 'iso', unit: 'mm', width: 210, height: 297 },
  { id: 'a3', label: 'A3', category: 'iso', unit: 'mm', width: 297, height: 420 },
  { id: 'a2', label: 'A2', category: 'iso', unit: 'mm', width: 420, height: 594 },
  { id: 'a1', label: 'A1', category: 'iso', unit: 'mm', width: 594, height: 841 },
  { id: 'a0', label: 'A0', category: 'iso', unit: 'mm', width: 841, height: 1189 },
  // US (in)
  { id: 'letter', label: 'Letter', category: 'us', unit: 'in', width: 8.5, height: 11 },
  { id: 'legal', label: 'Legal', category: 'us', unit: 'in', width: 8.5, height: 14 },
  { id: 'tabloid', label: 'Tabloid', category: 'us', unit: 'in', width: 11, height: 17 },
  // Envelopes
  { id: 'dl', label: 'DL envelope', category: 'envelope', unit: 'mm', width: 110, height: 220 },
  { id: 'c5', label: 'C5 envelope', category: 'envelope', unit: 'mm', width: 162, height: 229 },
  // Business cards
  {
    id: 'card-eu',
    label: 'Business card (EU)',
    category: 'card',
    unit: 'mm',
    width: 85,
    height: 55,
  },
  {
    id: 'card-us',
    label: 'Business card (US)',
    category: 'card',
    unit: 'in',
    width: 3.5,
    height: 2,
  },
  // Posters
  {
    id: 'poster-18x24',
    label: 'Poster 18×24"',
    category: 'poster',
    unit: 'in',
    width: 18,
    height: 24,
  },
  {
    id: 'poster-24x36',
    label: 'Poster 24×36"',
    category: 'poster',
    unit: 'in',
    width: 24,
    height: 36,
  },
];

export function getPaperPreset(id: string): PaperPreset | undefined {
  return PAPER_PRESETS.find((p) => p.id === id);
}

export type Orientation = 'portrait' | 'landscape';

/** Trim size in mm, orientation-applied (swap width/height for landscape). */
export function trimSizeMm(
  preset: PaperPreset,
  orientation: Orientation
): { widthMm: number; heightMm: number } {
  const wMm = preset.unit === 'mm' ? preset.width : preset.width * MM_PER_INCH;
  const hMm = preset.unit === 'mm' ? preset.height : preset.height * MM_PER_INCH;
  return orientation === 'landscape'
    ? { widthMm: hMm, heightMm: wMm }
    : { widthMm: wMm, heightMm: hMm };
}

/** Default bleed (mm) by preset's unit family — 3mm EU (mm-unit presets), 0.125in (in-unit presets). */
export function defaultBleedMm(preset: PaperPreset): number {
  return preset.unit === 'mm' ? 3 : 0.125 * MM_PER_INCH;
}

export const DEFAULT_SAFE_MARGIN_MM = 5;

/** Generous but finite bound on bleed/margin mm values — guards a
 *  malicious/broken value (a hand-edited or hub-synced `print` prop is
 *  DDR-054 untrusted canvas content) from producing a negative trim box
 *  (rect.w - 2×bleedPx) or a degenerate PDF geometry. Enforced at WRITE
 *  time by `setArtboardPrintOp` (api.ts) AND at READ time by
 *  `resolveBleedMm`/`resolveMarginsMm` below — a `print` prop can also
 *  reach the exporter via disk/hub-sync without ever passing through the
 *  write-time validator, so the read side needs its own clamp. */
export const MAX_PRINT_MM = 200;

function clampMm(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(Math.max(v, 0), MAX_PRINT_MM);
}

/** Crop/registration mark geometry — length ~3.5mm, stroke offset from trim = bleed. */
export const MARK_LENGTH_MM = 3.5;
export const MARK_STROKE_MM = 0.25;

export interface PrintMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * The `print` JSX prop on `DCArtboard` (T2) — authoring-time intent, kept
 * alongside the resolved px `width`/`height` DDR-027 already requires (this
 * prop does NOT re-derive geometry at render time; the paper picker writes
 * both this prop and the resolved px size together, see resolvePrintArtboard).
 * Consumed by the Inspector's print picker (T2), the on-canvas overlay (T3),
 * and both exporters (T4/T5) — all via THIS module, never a local copy.
 */
export interface ArtboardPrintProp {
  /** Paper preset id — one of PAPER_PRESETS. */
  paper: string;
  orientation?: Orientation;
  /** Bleed extension, mm. Omitted ⇒ defaultBleedMm(preset). */
  bleedMm?: number;
  marginsMm?: Partial<PrintMargins>;
}

export interface ResolvedPrintArtboard {
  paper: string;
  orientation: Orientation;
  /** Trim (final cut) size, in mm. */
  trimWidthMm: number;
  trimHeightMm: number;
  /** Bleed extension, in mm (uniform on all 4 sides). */
  bleedMm: number;
  /** Artboard px size = trim + 2×bleed — the artboard IS the bleed box (Design Decision 1). */
  widthPx: number;
  heightPx: number;
  /** Trim box, in px, inset from the artboard edges by bleedPx on every side. */
  trimWidthPx: number;
  trimHeightPx: number;
  bleedPx: number;
  marginsMm: PrintMargins;
}

/**
 * Resolve a possibly-partial `marginsMm` override against the 5mm default —
 * the SAME resolution `resolvePrintArtboard` applies, factored out so the
 * on-canvas overlay (T3) and the PDF post-pass (T5) apply identical defaults
 * without re-deriving them from a full `resolvePrintArtboard` call (which
 * needs a paper size neither of those call sites actually has to hand — both
 * work from the artboard's own already-resolved px rect instead, per
 * DDR-027).
 */
export function resolveMarginsMm(marginsMm?: Partial<PrintMargins>): PrintMargins {
  const m = marginsMm ?? {};
  return {
    top: typeof m.top === 'number' ? clampMm(m.top) : DEFAULT_SAFE_MARGIN_MM,
    right: typeof m.right === 'number' ? clampMm(m.right) : DEFAULT_SAFE_MARGIN_MM,
    bottom: typeof m.bottom === 'number' ? clampMm(m.bottom) : DEFAULT_SAFE_MARGIN_MM,
    left: typeof m.left === 'number' ? clampMm(m.left) : DEFAULT_SAFE_MARGIN_MM,
  };
}

/**
 * Resolve an `ArtboardPrintProp`'s bleed to a concrete mm value — explicit
 * `bleedMm` wins, else the paper preset's unit-family default (3mm EU /
 * 0.125in US). Unknown paper id with no explicit bleedMm falls back to 3mm
 * rather than throwing — the overlay/exporter must never hard-fail a render
 * over a bad paper id (resolvePrintArtboard is the strict, throwing entry
 * point used at WRITE time; this one is the lenient, read-time counterpart).
 */
export function resolveBleedMm(print: { paper: string; bleedMm?: number }): number {
  if (typeof print.bleedMm === 'number') return clampMm(print.bleedMm);
  const preset = getPaperPreset(print.paper);
  return preset ? defaultBleedMm(preset) : 3;
}

/** mm → whole px, rounded — the ONE rounding rule bleed/trim/margin geometry
 *  uses everywhere (overlay, exporter, resolvePrintArtboard). */
export function resolveMmPx(mm: number, dpi: number = CSS_DPI): number {
  return Math.round(mmToPx(mm, dpi));
}

/**
 * Resolve a `print` prop's paper/orientation/bleed into concrete px geometry.
 * The artboard IS the bleed box: bleed lives INSIDE the artboard bounds so
 * background content can reach the cut edge under today's clip-at-artboard
 * -bounds rendering model (the alternative — artboard=trim, bleed outside —
 * can't render bleeding content at all).
 *
 * px values are rounded to the nearest integer (CSS `width`/`height` must be
 * whole px); overlay + exporter both re-derive px from the same mm fields
 * on this result rather than re-rounding independently, so trim/bleed/margin
 * geometry stays pixel-identical between what's drawn and what's exported.
 */
export function resolvePrintArtboard(args: {
  paper: string;
  orientation?: Orientation;
  bleedMm?: number;
  marginsMm?: Partial<PrintMargins>;
}): ResolvedPrintArtboard {
  const preset = getPaperPreset(args.paper);
  if (!preset) throw new Error(`unknown paper preset: ${args.paper}`);
  const orientation = args.orientation ?? 'portrait';
  const { widthMm: trimWidthMm, heightMm: trimHeightMm } = trimSizeMm(preset, orientation);
  const bleedMm = args.bleedMm ?? defaultBleedMm(preset);
  const marginsMm = resolveMarginsMm(args.marginsMm);
  const bleedPx = resolveMmPx(bleedMm);
  const trimWidthPx = resolveMmPx(trimWidthMm);
  const trimHeightPx = resolveMmPx(trimHeightMm);
  return {
    paper: preset.id,
    orientation,
    trimWidthMm,
    trimHeightMm,
    bleedMm,
    widthPx: trimWidthPx + 2 * bleedPx,
    heightPx: trimHeightPx + 2 * bleedPx,
    trimWidthPx,
    trimHeightPx,
    bleedPx,
    marginsMm,
  };
}
