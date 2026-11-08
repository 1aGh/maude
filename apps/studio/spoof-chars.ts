// V2-8.9 defender L4 — the one set of characters that let a name reorder or hide the text around
// it: line / paragraph separators (U+2028/2029), bidi embeddings and overrides (U+202A–202E),
// bidi isolates (U+2066–2069) and Unicode tag characters (U+E0000–E007F, invisible). A person's
// name for a thing (an export file, a design system) never needs one; every list that shows the
// name would otherwise draw what the planter wanted. Shared by exporters/file-names.ts and
// ds/rename.ts so the two cannot drift.

/** Regex character-class body for the set; use with the `u` flag. */
export const SPOOF_CHARS_CLASS =
  '\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\u{e0000}-\\u{e007f}';

const SPOOF_CHARS_RE = new RegExp(`[${SPOOF_CHARS_CLASS}]`, 'gu');

/** The text with every spoofing character removed. */
export function stripSpoofChars(s: string): string {
  return s.replace(SPOOF_CHARS_RE, '');
}

/** Invisible formatting characters a name never needs either: soft hyphen, Arabic letter mark, Mongolian vowel
 *  separator, zero-width space / non-joiner / joiner, LRM / RLM, word joiner + invisible operators, BOM. */
const INVISIBLE_CHARS_RE = /[\u00ad\u061c\u180e\u200b-\u200f\u2060-\u2064\ufeff]/gu;

/** A person's name with every spoofing AND invisible character removed (burndown L4: "Added by"). */
export function stripNameSpoofChars(s: string): string {
  return stripSpoofChars(s).replace(INVISIBLE_CHARS_RE, '');
}
