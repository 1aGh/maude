// client/v2/search/palette-icons.js — Phase 8 C10 (06 ad-search): every ⌘K row carries the glyph of WHAT it does,
// never a stand-in chevron in a tile. An action that names its own `icon` keeps it; a fold action (Copy code,
// Copy file path, Raw log, Logs…) that does not gets one read from its words, in the board's own mapping
// (06 SearchBoard: Copy code → duplicate, Copy file path → file, Copy export command → export, Copy transcript →
// comment, Copy logs → pulse). PURE: a name and a path in, a STICONS key out.

/** [pattern over "name — where", glyph]. First match wins; every glyph exists in STICONS. */
const BY_WORDS = [
  [/\blogs?\b|\bdiagnostics\b/i, 'sync'],
  [/\btranscript\b|\bchat\b|\bAI\b/, 'comment'],
  [/\bexport|\bhandoff\b|\bdownload\b/i, 'export'],
  [/\bfile path\b|\bfolder\b|\bfinder\b|\breveal\b|\btrash\b/i, 'folder'],
  [/\bhistory\b|\bversion/i, 'history'],
  [/\bcode\b|\bcss\b|\btokens?\b|\bselector\b|\belement id\b/i, 'code'],
  [/\bshare\b|\blink\b/i, 'link'],
  [/\bsettings?\b/i, 'sliders'],
  [/\bfile\b/i, 'file'],
];

/** The glyph for a row that did not name one. `group` is the palette group id; `fallback` its group default. */
export function glyphFor(
  { name = '', meta = '', where = '' } = {},
  group = 'actions',
  fallback = 'chevron'
) {
  if (group !== 'actions') return fallback;
  const words = `${name} ${meta} ${where}`;
  // "Copy …" is a copy first (06: Copy code / Copy element id → duplicate), unless it names a thing with its own glyph.
  if (/^copy\b/i.test(name) && !/\b(file path|folder|export|transcript|logs?|link)\b/i.test(name)) {
    return 'duplicate';
  }
  for (const [re, glyph] of BY_WORDS) if (re.test(words)) return glyph;
  return fallback;
}
