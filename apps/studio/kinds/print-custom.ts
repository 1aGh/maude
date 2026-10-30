// apps/studio/kinds/print-custom.ts — S7.1: a custom print size (08 ak-picker-full "Custom size…").
//
// decision:maude/v2-S7-custom-print-sizeMm — a custom trim is stored as
//   print={{ paper: "<nearest-larger preset>", orientation, sizeMm: [w, h], bleedMm }}
// `sizeMm` present = custom trim, in mm, as drawn (width × height). Never `paper: "custom"`: v1's
// `resolvePrintArtboard` THROWS on an unknown paper id (print/units.ts), its inspector calls it on
// every print artboard, and the v1 Paper select has no such option. With the nearest-larger preset a
// v1 peer reads a print artboard it knows (R1–R3: the field is additive, display-ignorable — the
// artboard's own px width/height still carry the real size, which is what every overlay and both
// exporters measure — and no old field gets a new shape). Its prop reader drops the array
// (canvas-edit `objectExpressionToPlain` skips array values), so v1 keeps paper + bleed.
//
// The writer always states `bleedMm` explicitly: a preset of the inch family would otherwise give a
// v1 peer a different default bleed (0.125 in) than the custom size was drawn with.
//
// Pure. The v2 resolver is lenient like `resolveBleedMm`: a malformed `sizeMm` reads as absent.

import {
  type ArtboardPrintProp,
  CSS_DPI,
  getPaperPreset,
  type Orientation,
  PAPER_PRESETS,
  type PaperPreset,
  type PrintMargins,
  type ResolvedPrintArtboard,
  resolveBleedMm,
  resolveMarginsMm,
  resolveMmPx,
  resolvePrintArtboard,
  trimSizeMm,
} from '../print/units.ts';

/** Smallest / largest custom trim edge, mm (a business card is 55 mm; A0's long edge 1189 mm). */
export const MIN_CUSTOM_MM = 10;
export const MAX_CUSTOM_MM = 5000;
/** The bleed a custom size gets unless the picker says otherwise (EU default). */
export const DEFAULT_CUSTOM_BLEED_MM = 3;

export type SizeMm = [number, number];

export interface CustomPrintProp extends ArtboardPrintProp {
  sizeMm: SizeMm;
  bleedMm: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A `sizeMm` value as v2 reads it: two finite numbers in range, rounded to 0.01 mm; else null. */
export function readSizeMm(print: unknown): SizeMm | null {
  if (!print || typeof print !== 'object') return null;
  const v = (print as { sizeMm?: unknown }).sizeMm;
  if (!Array.isArray(v) || v.length !== 2) return null;
  const [w, h] = v;
  const ok = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= MIN_CUSTOM_MM && n <= MAX_CUSTOM_MM;
  return ok(w) && ok(h) ? [round2(w), round2(h)] : null;
}

/** True when the prop describes a custom trim (a readable `sizeMm`). */
export function isCustomPrint(print: unknown): boolean {
  return readSizeMm(print) !== null;
}

/**
 * The smallest preset whose trim holds `w × h` mm, with the orientation that makes it hold it.
 * Smallest = least trim area; a tie keeps PAPER_PRESETS order. When a preset holds the size either
 * way round, the orientation that matches the size's own shape wins. (A preset's "portrait" is its
 * table row as written — the business cards are wider than tall — so both ways are always tried.)
 * Larger than every preset → the largest preset, oriented like the size (the custom trim still wins
 * in v2).
 */
export function nearestLargerPreset(
  wMm: number,
  hMm: number
): {
  paper: string;
  orientation: Orientation;
} {
  const wide = wMm > hMm;
  const area = (p: PaperPreset) => {
    const t = trimSizeMm(p, 'portrait');
    return t.widthMm * t.heightMm;
  };
  // 0.01 mm tolerance: Letter is 215.9 mm, and a size typed from it must land on it.
  const holds = (p: PaperPreset, o: Orientation) => {
    const t = trimSizeMm(p, o);
    return t.widthMm + 0.01 >= wMm && t.heightMm + 0.01 >= hMm;
  };
  let best: { p: PaperPreset; o: Orientation } | null = null;
  let largest = PAPER_PRESETS[0] as PaperPreset;
  for (const p of PAPER_PRESETS) {
    if (area(p) > area(largest)) largest = p;
    const t = trimSizeMm(p, 'portrait');
    const natural: Orientation = t.widthMm > t.heightMm === wide ? 'portrait' : 'landscape';
    const other: Orientation = natural === 'portrait' ? 'landscape' : 'portrait';
    const o = holds(p, natural) ? natural : holds(p, other) ? other : null;
    if (o && (!best || area(p) < area(best.p))) best = { p, o };
  }
  if (best) return { paper: best.p.id, orientation: best.o };
  const t = trimSizeMm(largest, 'portrait');
  return {
    paper: largest.id,
    orientation: t.widthMm > t.heightMm === wide ? 'portrait' : 'landscape',
  };
}

/** The `print` prop the picker writes for a custom size. Throws on a size out of range. */
export function customPrintProp(
  sizeMm: SizeMm,
  opts: { bleedMm?: number; marginsMm?: Partial<PrintMargins> } = {}
): CustomPrintProp {
  const size = readSizeMm({ sizeMm });
  if (!size)
    throw new RangeError(`custom size must be ${MIN_CUSTOM_MM}–${MAX_CUSTOM_MM} mm a side`);
  const { paper, orientation } = nearestLargerPreset(size[0], size[1]);
  const bleedMm = resolveBleedMm({ paper, bleedMm: opts.bleedMm ?? DEFAULT_CUSTOM_BLEED_MM });
  return {
    paper,
    orientation,
    sizeMm: size,
    bleedMm,
    ...(opts.marginsMm ? { marginsMm: { ...opts.marginsMm } } : {}),
  };
}

/**
 * v2's resolver for any `print` prop: a custom trim (`sizeMm`) wins over the preset; otherwise this
 * is `resolvePrintArtboard`. Never throws on a custom prop, whatever its `paper` says.
 */
export function resolveCustomPrintArtboard(print: {
  paper: string;
  orientation?: Orientation;
  bleedMm?: number;
  marginsMm?: Partial<PrintMargins>;
  sizeMm?: unknown;
}): ResolvedPrintArtboard {
  const size = readSizeMm(print);
  if (!size) return resolvePrintArtboard(print);
  const bleedMm = resolveBleedMm({
    paper: print.paper,
    bleedMm: typeof print.bleedMm === 'number' ? print.bleedMm : DEFAULT_CUSTOM_BLEED_MM,
  });
  const bleedPx = resolveMmPx(bleedMm, CSS_DPI);
  const trimWidthPx = resolveMmPx(size[0], CSS_DPI);
  const trimHeightPx = resolveMmPx(size[1], CSS_DPI);
  const fallback = getPaperPreset(print.paper) ? null : nearestLargerPreset(size[0], size[1]);
  return {
    paper: fallback ? fallback.paper : print.paper,
    orientation:
      fallback?.orientation ??
      (print.orientation === 'landscape' || print.orientation === 'portrait'
        ? print.orientation
        : 'portrait'),
    trimWidthMm: size[0],
    trimHeightMm: size[1],
    bleedMm,
    widthPx: trimWidthPx + 2 * bleedPx,
    heightPx: trimHeightPx + 2 * bleedPx,
    trimWidthPx,
    trimHeightPx,
    bleedPx,
    marginsMm: resolveMarginsMm(print.marginsMm),
  };
}
