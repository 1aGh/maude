// _brand-fonts.mjs — DDR-173 Decision 1: the curated font allowlist and its classifier, moved
// verbatim out of _import-brand.mjs (S8.18) so pure callers — the website reader and the studio's
// brand sheet — can match a font name without pulling happy-dom in. _import-brand.mjs re-exports
// both, so every existing import keeps working.

// ============================================================================
// Decision 1 — font-family classification: exact match against a curated
// allowlist of real, known font names. The RAW extracted string is NEVER
// forwarded — only the matched entry from this list, or a fixed generic
// keyword. A value that doesn't exact-match is discarded, never guessed.
// ============================================================================

export const FONT_ALLOWLIST = [
  // System / web-safe
  'Arial',
  'Helvetica',
  'Helvetica Neue',
  'Times New Roman',
  'Times',
  'Georgia',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Courier New',
  'Courier',
  'Impact',
  'Comic Sans MS',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Palatino',
  'Garamond',
  'Book Antiqua',
  'Segoe UI',
  'Calibri',
  'Cambria',
  'Candara',
  'Consolas',
  'Constantia',
  'Corbel',
  'Franklin Gothic Medium',
  // Common web fonts (Google Fonts + popular type foundries)
  'Inter',
  'Inter Tight',
  'Roboto',
  'Roboto Mono',
  'Roboto Condensed',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Source Sans Pro',
  'Source Serif Pro',
  'Source Code Pro',
  'Nunito',
  'Nunito Sans',
  'Raleway',
  'Ubuntu',
  'Playfair Display',
  'Merriweather',
  'PT Sans',
  'PT Serif',
  'Work Sans',
  'DM Sans',
  'DM Serif Display',
  'Space Grotesk',
  'Space Mono',
  'IBM Plex Sans',
  'IBM Plex Serif',
  'IBM Plex Mono',
  'JetBrains Mono',
  'Fira Sans',
  'Fira Code',
  'Fira Mono',
  'Noto Sans',
  'Noto Serif',
  'Oswald',
  'Bebas Neue',
  'Archivo',
  'Archivo Black',
  'Manrope',
  'Karla',
  'Rubik',
  'Barlow',
  'Cabin',
  'Quicksand',
  'Josefin Sans',
  'Libre Franklin',
  'Libre Baskerville',
  'Crimson Text',
  'EB Garamond',
  'Cormorant',
  'Cormorant Garamond',
  'Lora',
  'Bitter',
  'Zilla Slab',
  'Domine',
  'Spectral',
  'Alegreya',
  'Vollkorn',
  'Geist',
  'Geist Mono',
  'SF Mono',
  'SF Pro',
  'SF Pro Display',
  'SF Pro Text',
  'Menlo',
  'Monaco',
  'Cooper Black',
  'Futura',
  'Gotham',
  'Din',
  'DIN Next',
  'Avenir',
  'Avenir Next',
  'Proxima Nova',
  'Circular',
  'Neue Haas Grotesk',
].map((n) => Object.freeze(n));

const FONT_GENERIC_KEYWORDS = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-monospace',
  'ui-sans-serif',
  'ui-serif',
  'cursive',
  'fantasy',
]);

const FONT_ALLOWLIST_LOWER = new Map(FONT_ALLOWLIST.map((n) => [n.toLowerCase(), n]));

/**
 * Decision 1 — classify a font-family LIST value (comma-separated, as found
 * in an SVG `font-family` attribute — no CSS quoting assumed). Returns ONLY
 * entries that exact-match (case-insensitive, plain ASCII lowercase — never
 * a locale-sensitive fold) the curated allowlist or a fixed generic keyword;
 * unmatched entries are dropped silently (never fuzzy-matched, never
 * forwarded raw). Grammar gate runs first: any entry containing a
 * non-printable-ASCII character is rejected before the match ever runs.
 */
export function classifyFontFamilyList(rawValue) {
  if (typeof rawValue !== 'string') return [];
  const entries = rawValue.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
  const matched = [];
  for (const entry of entries) {
    if (!/^[\x20-\x7E]*$/.test(entry) || entry.length === 0 || entry.length > 64) continue;
    const lower = entry.toLowerCase();
    if (FONT_GENERIC_KEYWORDS.has(lower)) {
      matched.push(lower);
      continue;
    }
    const canonical = FONT_ALLOWLIST_LOWER.get(lower);
    if (canonical) matched.push(canonical);
  }
  return matched;
}
