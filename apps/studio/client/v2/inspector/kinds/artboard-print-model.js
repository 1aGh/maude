// client/v2/inspector/kinds/artboard-print-model.js — S7.23: the words and numbers of a print artboard's Advanced fold
// (08 ak-advanced, ak-print-letak). Pure: no DOM, no React.
//
//   printExactFacts   Exact size: artboard · trim · bleed · margin, in px and mm
//   RESOLUTION_FACTS  Resolution: 96 px per inch on the canvas; the PDF is 300 dpi with vector text
//   COLOUR_WORDS      Colour: "Designed in sRGB. RGB — the print shop converts to CMYK; …"
//   guideFacts        Guides: "2 · gutter 16 · margin 30" / "off"
//   codeOf            In code: the DCArtboard as the file carries it
//   advancedPrintFacts the short facts under the plain inspector: kind · paper · size · bleed
//
// Numbers come from print/units.ts and kinds/print-custom.ts — the same functions the overlay and both exporters read.

import { readSizeMm, resolveCustomPrintArtboard } from '../../../../kinds/print-custom.ts';
import { physicalSizeWords } from '../../../../kinds/physical.ts';
import { CSS_DPI, resolveMmPx } from '../../../../print/units.ts';

export const COLOUR_WORDS =
  'Designed in sRGB. RGB — the print shop converts to CMYK; if they ask for a profile, use theirs.';

/** Print PDF is 300 dpi with live text (Gate 0 C19 / CONTRACT §3); the canvas itself is CSS px at 96 per inch. */
export const RESOLUTION_FACTS = Object.freeze([
  ['canvas', `${CSS_DPI} px per inch`],
  ['print PDF', '300 dpi · vector text'],
]);

const px = (n) => `${Math.round(n)} px`;

/** @returns {import('../../../../print/units.ts').ResolvedPrintArtboard | null} */
export function resolvedPrint(print) {
  if (!print || typeof print.paper !== 'string') return null;
  try {
    return resolveCustomPrintArtboard(print);
  } catch {
    return null;
  }
}

/**
 * Exact size: the artboard in px (the bleed box), the trim in px and mm, the bleed and the safe margin in px.
 * @returns {Array<[string, string]>}
 */
export function printExactFacts(f, print) {
  const r = resolvedPrint(print);
  if (!r) return [];
  const margin = r.marginsMm;
  const same =
    margin.top === margin.right && margin.top === margin.bottom && margin.top === margin.left;
  const marginWords = same
    ? px(resolveMmPx(margin.top))
    : [margin.top, margin.right, margin.bottom, margin.left]
        .map((m) => px(resolveMmPx(m)))
        .join(' / ');
  const mm = `${r.trimWidthMm} × ${r.trimHeightMm} mm`;
  return [
    ['artboard', `${Math.round(f.w ?? r.widthPx)} × ${Math.round(f.h ?? r.heightPx)} px`],
    ['trim', `${r.trimWidthPx} × ${r.trimHeightPx} px · ${mm}`],
    ['bleed · margin', `${px(r.bleedPx)} · ${marginWords}`],
  ];
}

/** The short facts of the print inspector's fold (ak-print-letak): `kind print · paper a6 · portrait · size … · bleed …`. */
export function advancedPrintFacts(f, print) {
  const r = resolvedPrint(print);
  if (!r) return [['kind', 'print']];
  return [
    ['kind', 'print'],
    ['paper', readSizeMm(print) ? `custom · ${r.orientation}` : `${r.paper} · ${r.orientation}`],
    ['size', `${Math.round(f.w ?? r.widthPx)} × ${Math.round(f.h ?? r.heightPx)} px`],
    ['bleed', px(r.bleedPx)],
  ];
}

const def = (d) => `${d.count} · gutter ${d.gutter} · margin ${d.margin}`;

/** @returns {Array<[string, string]>} */
export function guideFacts(guides) {
  const g = guides && typeof guides === 'object' ? guides : {};
  return [
    ['columns', g.columns ? def(g.columns) : 'off'],
    ['rows', g.rows ? def(g.rows) : 'off'],
    ['grid', g.grid ? `${g.grid.size} px` : 'off'],
  ];
}

/** What "Add" gives a guide that is off: a start the person then edits in the file or asks AI to change. */
export const GUIDE_DEFAULTS = Object.freeze({
  columns: { count: 2, gutter: 16, margin: 30 },
  rows: { count: 4, gutter: 16, margin: 30 },
  grid: { size: 8 },
});

const lit = (v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{ ${Object.entries(v)
        .map(([k, x]) => `${k}: ${lit(x)}`)
        .join(', ')} }`
    : JSON.stringify(v);

/** The artboard as the file carries it (08: `<DCArtboard kind="print" print={{ paper: "a6", bleedMm: 3 }} …>`). */
export function codeOf(f, print, guides) {
  const lines = ['<DCArtboard kind="print"'];
  if (print) lines.push(`  print={${lit(print)}}`);
  lines.push(
    `  width={${Math.round(f.w ?? 0)}} height={${Math.round(f.h ?? 0)}}${f.fixed ? ' fixed' : ''}`
  );
  if (guides && Object.keys(guides).length) lines.push(`  guides={${lit(guides)}}`);
  lines[lines.length - 1] += '>';
  return lines.join('\n');
}

/** The size tag on a selected print artboard ("105 × 148 mm"). */
export const sizeTag = (el) => physicalSizeWords({ attrs: el?.attrs });
