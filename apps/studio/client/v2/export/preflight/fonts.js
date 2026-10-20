// client/v2/export/preflight/fonts.js — S8.7: the sheet's words for fonts that will not embed
// (09 Export › ex-print-warn). A warning, never a block: the text prints as shapes with the same look; a
// print shop's preflight may still ask. Text as outlines (Advanced › Print PDF) makes every font safe,
// and then there is nothing to warn about.

export const OUTLINES_ON = 'Text is turned into shapes, so no font needs to embed.';

const list = (names) =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

const unique = (names) => [...new Set(names)];

/**
 * @param fonts     the preflight reply's `fonts`
 * @param outlined  Text as outlines is on
 * @returns the one line, or '' when every font embeds (or the text becomes shapes anyway)
 */
export function fontLine(fonts, outlined = false) {
  if (outlined) return '';
  const bad = unique(fonts.filter((f) => !f.embeddable).map((f) => f.family));
  if (bad.length === 0) return '';
  const good = unique(fonts.filter((f) => f.embeddable).map((f) => f.family));
  const main = `${list(bad)} can’t be embedded — the text prints as shapes (same look).`;
  return good.length ? `${main} ${list(good)} ${good.length === 1 ? 'embeds' : 'embed'}.` : main;
}
