// apps/studio/kinds/physical.ts — S7.23: how big a print artboard is on paper.
//
// `artboardPhysicalSize(artboard) → { wMm, hMm } | null` is the one answer to "how many millimetres is this?" — the
// inspector's "105 × 148 mm", the size tag on a selected print artboard, and (S9) comments that point at paper. Only a
// print artboard has one; a web page, a fixed size and a video are pixels all the way down, so they answer null.
//
// The size is the TRIM (what the print shop cuts to), not the artboard: the artboard is trim + 2 × bleed in px
// (print/units.ts). A custom size (`print.sizeMm`, kinds/print-custom.ts) wins over the paper. Pure; never throws —
// a print prop naming an unknown paper reads as "no size", like every lenient reader here.
//
// decision:maude/v2-S7.23-physical-size-from-the-print-prop

import { getPaperPreset, MM_PER_INCH, type Orientation } from '../print/units.ts';
import { readSizeMm, resolveCustomPrintArtboard } from './print-custom.ts';

/** What an artboard says about itself: its kind and print prop, or the `data-dc-*` read-back a selection carries. */
export interface ArtboardLike {
  kind?: unknown;
  print?: unknown;
  attrs?: Record<string, string | undefined> | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function printOf(a: ArtboardLike): Record<string, unknown> | null {
  const raw = a.print ?? a.attrs?.['data-dc-print'];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return isRec(v) ? v : null;
    } catch {
      return null;
    }
  }
  return isRec(raw) ? raw : null;
}

const kindOf = (a: ArtboardLike): string => {
  const k = a.kind ?? a.attrs?.['data-dc-kind'];
  return typeof k === 'string' && k ? k : 'digital';
};

/** The trim of a print artboard in millimetres, orientation applied; null for any other kind or an unreadable prop. */
export function artboardPhysicalSize(
  artboard: ArtboardLike | null | undefined
): { wMm: number; hMm: number } | null {
  if (!artboard || kindOf(artboard) !== 'print') return null;
  const print = printOf(artboard);
  if (!print || typeof print.paper !== 'string') return null;
  try {
    const r = resolveCustomPrintArtboard({
      paper: print.paper,
      ...(print.orientation === 'landscape' || print.orientation === 'portrait'
        ? { orientation: print.orientation as Orientation }
        : {}),
      ...(typeof print.bleedMm === 'number' ? { bleedMm: print.bleedMm } : {}),
      ...(isRec(print.marginsMm) ? { marginsMm: print.marginsMm } : {}),
      sizeMm: print.sizeMm,
    });
    return { wMm: round2(r.trimWidthMm), hMm: round2(r.trimHeightMm) };
  } catch {
    return null;
  }
}

/** 105 → "105", 215.9 → "215.9", 8.5 → "8.5" (no trailing zeros). */
export const mmWord = (n: number): string => String(round2(n));

/**
 * The words for that size: "105 × 148 mm". A US paper keeps its own unit ("8.5 × 11 in") unless it is a custom size,
 * which is always millimetres. Empty string when the artboard has no paper size.
 */
export function physicalSizeWords(artboard: ArtboardLike | null | undefined): string {
  const mm = artboardPhysicalSize(artboard);
  if (!artboard || !mm) return '';
  const print = printOf(artboard);
  const paper = typeof print?.paper === 'string' ? getPaperPreset(print.paper) : undefined;
  if (paper?.unit === 'in' && !readSizeMm(print)) {
    return `${mmWord(mm.wMm / MM_PER_INCH)} × ${mmWord(mm.hMm / MM_PER_INCH)} in`;
  }
  return `${mmWord(mm.wMm)} × ${mmWord(mm.hMm)} mm`;
}
