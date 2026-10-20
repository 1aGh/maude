// client/v2/export/sections/print-copy.js — S8.7: the words of the Print section (09 Export › ex-print,
// ex-print-warn; CONTRACT §3–§4). Kept beside the section, not in export-copy.js, so the print and video
// slices never edit the same lines.

export const PRINT_FORMATS = [
  ['print-pdf', 'Print PDF'],
  ['pdf', 'PDF'],
  ['png', 'PNG'],
];

export const PRINT_ROW = 'Print';
export const BLEED_LABEL = 'Bleed';
export const CROP_LABEL = 'Crop marks';
export const CROP_SUB = 'where to cut — outside the bleed';
export const BACK_SUB = 'page 2 — the back of this artboard';
export const COLOUR_ROW = 'Colour';
/** The one colour line. Print is RGB; the shop converts (09 ex-print). */
export const COLOUR_LINE = 'RGB — the print shop converts to CMYK.';

export const bleedSub = (mm) =>
  mm > 0 ? `colour runs ${Math.round(mm * 10) / 10} mm past the cut` : 'colour runs past the cut';

export const backLabel = (back) => `Add “${back.label ?? back.id}”`;

/** "Page 1 of 2 · A6 · 105 × 148 mm" (the preview's caption). */
export function pageCaption({ page, pages, paper }) {
  const [w, h] = paper.trimMm.map((n) => Math.round(n * 10) / 10);
  const name = paper.name ? `${paper.name} · ` : '';
  return `Page ${page + 1} of ${pages} · ${name}${w} × ${h} mm`;
}

export const LEGEND = {
  bleed: (mm) => `Bleed ${Math.round(mm * 10) / 10} mm`,
  cut: 'Cut',
  safe: (mm) => `Safe ${Math.round(mm * 10) / 10} mm`,
};
