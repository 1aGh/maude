// client/v2/export/preflight/safe-margin.js — S8.7: the sheet's words for "past the safe margin"
// (09 Export › ex-print-warn). The server measures (exporters/print-preflight.ts, from the canvas-rects
// geometry); this only says it. A warning informs — Export still exports.

export const SHOW_ON_CANVAS = 'Show on canvas';

const num = (n) => String(Math.round(n * 10) / 10);

/** What the person calls the element: its text in quotes, else its id as words, else its tag. */
export function elementName(f) {
  const label = String(f.label ?? '').trim();
  if (f.element && label === f.element) return `The ${label.replace(/[-_]+/g, ' ')}`;
  return label ? `“${label}”` : 'An element';
}

/** "The QR code is 2 mm from the cut — past the 5 mm safe margin. The trim may clip it." */
export function safeMarginLine(findings) {
  const first = findings[0];
  if (!first) return '';
  const base = `${elementName(first)} is ${num(first.mm)} mm from the cut — past the ${num(first.marginMm)} mm safe margin. The trim may clip it.`;
  const more = findings.length - 1;
  return more > 0 ? `${base} ${more} more ${more === 1 ? 'is' : 'are'} close to it too.` : base;
}
