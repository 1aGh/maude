/**
 * @file       figma/sanitize.ts — the content rules (DDR-216 D6a + D6b).
 * @scope      apps/studio/figma/sanitize.ts
 * @purpose    The ONE place Figma-derived strings are made safe to emit, and
 *             the ONE place imported nodes are made VISIBLE. Both translators
 *             (`to-strokes.ts`, `to-artboard.ts`) go through here — D6's
 *             "single writers" requirement is what makes the standing grep test
 *             ("no translator interpolates a node's `name`/`characters` into
 *             output itself") a real control rather than a hope.
 *
 * @invariant  TWO INDEPENDENT MECHANISMS, because Round 2 of the DDR-216 review
 *             broke a single one twice:
 *
 *             D6a — CHARACTER CLASSES. An escaper covers characters that could
 *             terminate a literal. It does NOT cover characters with NO GLYPH.
 *             A payload encoded in the Unicode Tags block (U+E0000–E007F) — a
 *             full ASCII alphabet that renders as literally nothing — passes
 *             opacity 1, fontSize 16, high contrast, non-zero area, the escaper
 *             AND `sanitizeAnnotationSvg`, and is reconstructed as plain text by
 *             a model reading the file. Same for zero-width characters and the
 *             Trojan-Source bidi technique (CVE-2021-42574), where the rendered
 *             order a human reviews differs from the source order.
 *
 *             D6b — VISIBILITY, BY NORMALIZATION NOT DETECTION. The first draft
 *             tried to DETECT invisible nodes (opacity / fontSize / ΔE / clip)
 *             and the review broke it four ways — occlusion by an opaque later
 *             sibling, ancestor clipping, opacity compounded down the tree, and
 *             blend mode over a matching background — none of which a per-node
 *             property check can see. The translator AUTHORS these nodes, so it
 *             can GUARANTEE visibility instead of proving invisibility: clamp
 *             the size, force the contrast, clamp the geometry. Hidden text
 *             becomes VISIBLE text, which is strictly better than dropping it.
 *
 * @invariant  Neither mechanism makes an instruction stop reading like an
 *             instruction. That is DDR-216 residual 1, named there, not a bug
 *             here. What these rules buy is that nothing an agent later reads
 *             is invisible to the human who imported it.
 *
 * @invariant  DEPENDENCY-FREE — pure string/number work.
 */

/** Every disposition this feature can report. A FIXED set: the per-import
 *  summary's "never silently dropped" promise is only true because a caller
 *  cannot invent a reason string (DDR-216 D5/D7).
 *
 *  A frozen ARRAY, with the type derived from it, rather than a bare union —
 *  because a union alone is a compile-time promise and this repo runs **no
 *  `tsc` gate** (CLAUDE.md states the omission deliberately: `quality` is
 *  lint/tests/build/parity/tarball/tokens/site-content, no typecheck). That gap
 *  is not hypothetical: `assets.ts` shipped `'asset-degraded'` — absent from the
 *  union — to `main`, onto the wire (`http.ts` `/_api/figma/import`), into verb
 *  stdout that an agent reads (D10), and into `FigmaImportPanel`. Found by the
 *  DDR-219 design-stage review, fixed here with `asset-degraded` admitted as the
 *  legitimate outcome it always was. See DDR-219 D9. */
export const DISPOSITIONS = Object.freeze([
  'imported',
  'hidden-chars-dropped',
  'hidden-node-skipped',
  'text-normalized',
  'geometry-clamped',
  'truncated-text',
  'truncated-attr',
  'unmappable-type',
  'unmappable-shape',
  /** A comment whose pinned node no longer exists in the file — no position to place it at. */
  'comment-target-deleted',
  'bind-degraded-to-bbox',
  'bind-dropped-self-connector',
  'asset-pending',
  'asset-skipped',
  'asset-cap-reached',
  /** A vector Figma declined to render as SVG, re-requested as PNG. */
  'asset-degraded',
  /**
   * The LOCAL `.fig` door (DDR-221) cannot produce this asset: a vector cluster
   * is rendered by Figma's servers and is simply absent from an export. The
   * archive carries image FILLS, never renders. Distinct from `asset-skipped`
   * ("we tried and it failed") — nothing was attempted and nothing could be.
   */
  'asset-unavailable-offline',
  'jsx-cap-reached',
  'value-rejected',
  /** A paint or effect CSS has no exact twin for (diamond gradient, a blend mode), drawn by the nearest one. */
  'paint-approximated',
  // ── The codegen route (DDR-219 D9). Three dispositions, one rule: what makes
  // them safe is that `detail` carries a BOUNDED token plus a count, never the
  // upstream family or utility name verbatim — `detail` is the one field on the
  // wire no sanitizer touches, and it reaches verb stdout (D10), the HTTP route
  // and the panel.
  /** A Tailwind utility the mapper does not know, or whose value failed its grammar. */
  'codegen-utility-unmapped',
  /** A font family that did not survive the copy — a CSS fallback is NOT a report. */
  'font-substituted',
  /** Dev Mode unreachable / no seat / wrong document. The COMMON case, not an error state. */
  'codegen-unavailable',
  /** The converter itself could not be LOADED. Contract: REFUSE, never "let a model do it". */
  'codegen-converter-unavailable',
  /**
   * The converter ran and REFUSED this frame — a parse error, an element outside
   * the allowlist, a construct it does not understand (DDR-219 D5 rule 4).
   *
   * Deliberately NOT folded into `codegen-unavailable`: "Figma was unreachable"
   * and "we looked at what Figma sent and would not emit it" are different
   * facts, and conflating outcomes is how this feature reported success three
   * times while losing content.
   */
  'codegen-frame-refused',
] as const);

export type Disposition = (typeof DISPOSITIONS)[number];

const DISPOSITION_SET: ReadonlySet<string> = new Set(DISPOSITIONS);

export function isDisposition(v: string): v is Disposition {
  return DISPOSITION_SET.has(v);
}

/** `detail` is a code-owned note, and the only field on the wire that no
 *  sanitizer touches — so it is the one place an upstream string would ride out
 *  to a model unescaped (DDR-219 D9). It is NOT charset-restricted to ASCII:
 *  real notes carry `—` and `→` legitimately. What distinguishes a code-owned
 *  note from interpolated node text is that it is SHORT and carries no
 *  zero-glyph payload, so those are what get asserted. Longest real note today
 *  is 36 chars. */
export const MAX_DETAIL_LEN = 64;

export interface ReportEntry {
  /** `^[0-9]+:[0-9]+$` — an identifier, never node text (DDR-216 D7). */
  nodeId: string;
  type: string;
  disposition: Disposition;
  /** A short code-owned note. NEVER node text, never an upstream string. */
  detail?: string;
}

/** Collects dispositions. One per node per outcome; text is never quoted in. */
export class ImportReport {
  readonly entries: ReportEntry[] = [];

  add(nodeId: string, type: string, disposition: Disposition, detail?: string): void {
    // The backstop the missing `tsc` gate cannot provide. A disposition outside
    // the set is a programming error, never bad input — so it throws rather than
    // degrading: silent acceptance is exactly how `asset-degraded` reached main.
    if (!DISPOSITION_SET.has(disposition)) {
      throw new Error(`ImportReport: unknown disposition ${JSON.stringify(disposition)}`);
    }
    if (detail !== undefined && !isCodeOwnedDetail(detail)) {
      throw new Error(
        `ImportReport: detail must be a short code-owned note (<=${MAX_DETAIL_LEN} chars, no zero-glyph); got ${detail.length} chars`
      );
    }
    this.entries.push(
      detail ? { nodeId, type, disposition, detail } : { nodeId, type, disposition }
    );
  }

  count(disposition: Disposition): number {
    return this.entries.filter((e) => e.disposition === disposition).length;
  }
}

/** True when `detail` looks like the code-owned note it is contracted to be. */
export function isCodeOwnedDetail(detail: string): boolean {
  return detail.length <= MAX_DETAIL_LEN && !ZERO_GLYPH_ONESHOT_RE.test(detail);
}

// ── D6a — character classes ─────────────────────────────────────────────────

/**
 * Characters with no glyph, or which reorder what a human sees relative to what
 * is stored. Enumerated as ranges rather than a "printable ASCII only" filter,
 * because unlike DDR-172's CSS values this text legitimately carries diacritics,
 * CJK and emoji — the fixture's own `Příliš žluťoučký` must survive intact.
 */
/**
 * Characters with no glyph, or which reorder what a human sees relative to what
 * is stored.
 *
 * POSITIVE-CATEGORY rule, not a hand-kept range list. The first version
 * enumerated ranges and was called "genuinely complete"; it was not — it missed
 * U+3164 HANGUL FILLER (Unicode category **Lo**, a LETTER, which is exactly why
 * whitespace/format filters keep it), U+FFA0, U+115F/U+1160, U+2800 BRAILLE
 * PATTERN BLANK, U+180E, U+061C ARABIC LETTER MARK (a Trojan-Source control the
 * paper lists), and U+FFF9–FFFB. Two of those are a binary alphabet; four are
 * base-4 (post-implementation review F10).
 *
 * So: reject every format/control/unassigned/private-use code point by CATEGORY
 * (`\p{Cf}\p{Cc}\p{Co}\p{Cn}`), plus an explicit list of code points that are
 * *letters or symbols* by category but render blank. A category rule cannot rot
 * the way an enumeration does.
 */
const ZERO_GLYPH_SOURCE = [
  // Format / control / private-use / unassigned — the categories that cover
  // every bidi control, every zero-width, the Tags block, and anything Unicode
  // adds later without this list needing an edit.
  '[\\p{Cf}\\p{Cc}\\p{Co}\\p{Cn}]',
  // Blank-rendering code points that are LETTERS or SYMBOLS by category, so no
  // category rule catches them. Listed one per alternative rather than as a
  // character class: `\u034F` is a COMBINING character, and a class mixing it
  // with base characters is the `noMisleadingCharacterClass` footgun.
  '\\u00AD', // soft hyphen
  '\\u034F', // combining grapheme joiner
  '\\u061C', // arabic letter mark (Trojan Source)
  '\\u115F', // hangul choseong filler
  '\\u1160', // hangul jungseong filler
  '\\u17B4', // khmer inherent AQ
  '\\u17B5', // khmer inherent AA
  '[\\u180B-\\u180E]', // mongolian selectors + vowel separator
  '\\u2800', // braille pattern blank
  '\\u3164', // HANGUL FILLER — category Lo, i.e. a LETTER
  '[\\uFE00-\\uFE0F]', // variation selectors
  '\\uFFA0', // halfwidth hangul filler
  '[\\uFFF9-\\uFFFB]', // interlinear annotation
  '[\\u{E0100}-\\u{E01EF}]', // variation selectors supplement
].join('|');

const ZERO_GLYPH_RE = new RegExp(ZERO_GLYPH_SOURCE, 'gu');

/** The same rule without `g`. `RegExp.prototype.test` on a GLOBAL regex advances
 *  `lastIndex` and so alternates true/false across calls on the same instance —
 *  a one-shot predicate must never share the `g` instance. */
const ZERO_GLYPH_ONESHOT_RE = new RegExp(ZERO_GLYPH_SOURCE, 'u');

/** Tab / newline / carriage return are legitimate content — never stripped. */
const KEEP_WHITESPACE_RE = /[\t\n\r]/;

export interface CleanTextResult {
  text: string;
  /** True when D6a removed something — the caller reports `hidden-chars-dropped`. */
  strippedHidden: boolean;
  /** True when the length cap bit — the caller reports `truncated-text`. */
  truncated: boolean;
}

/**
 * D6a: NFC-normalize, strip zero-glyph/bidi characters, collapse runs of
 * whitespace-ish control leftovers, and bound the length.
 *
 * `maxLen` is a per-sink capacity, not a security bound — the security bound is
 * the character classes. A sticky that would overflow its card is truncated and
 * REPORTED rather than silently overflowing (DDR-216 D5's bounded-degradation
 * class, which is why `truncated` comes back rather than being swallowed).
 */
export function cleanText(raw: string, maxLen: number): CleanTextResult {
  const normalized = raw.normalize('NFC');
  const stripped = normalized.replace(ZERO_GLYPH_RE, (ch) =>
    KEEP_WHITESPACE_RE.test(ch) ? ch : ''
  );
  const strippedHidden = stripped.length !== normalized.length;
  const truncated = stripped.length > maxLen;
  return { text: truncated ? stripped.slice(0, maxLen) : stripped, strippedHidden, truncated };
}

/**
 * Attribute values (`data-dc-element`, a section label chip, …) get a strict
 * ALLOWLIST charset rather than D6a's denylist: they are short, structural, and
 * never need the full Unicode range. Empty after sanitizing ⇒ the caller falls
 * back to a node-id-derived name (DDR-216 D6 sink table).
 */
export function attrValue(raw: string, maxLen = 64): string {
  return raw
    .normalize('NFC')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * A report token for `detail` — strict, and deliberately NOT `attrValue`.
 *
 * `attrValue` rewrites rejected characters to SPACES, which is right for a label
 * and wrong here: a class token like `ignore.all.prior.instructions.and` comes
 * back as that sentence, and `detail` reaches verb stdout (which D10 declares
 * entirely code-owned), the HTTP summary and the panel. Charset-bounding is a
 * markup control; it was never a semantic one (post-implementation review F3).
 *
 * So: a Tailwind FAMILY shape only — lowercase, digits, hyphens, NO SPACES ever
 * — and anything else collapses to a fixed word. `unrecognized x7` is less
 * informative than the raw token and cannot be read as an instruction, which is
 * the right trade for a field an agent reads.
 */
export function reportToken(raw: string): string {
  const head = /^[a-z][a-z0-9-]{0,23}/.exec(raw.trim().toLowerCase());
  return head ? head[0] : 'unrecognized';
}

/**
 * A JSX-safe identifier derived from a NODE ID — never from a Figma string.
 * `2:17` → `Node_2_17`. This is the whole identifier story: there is no Figma
 * text anywhere in the identifier space, which is why Round 1 and Round 2 both
 * failed to construct an identifier-space attack.
 */
export function identifierFromNodeId(nodeId: string): string {
  const safe = nodeId.replace(/[^0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `Node_${safe || '0'}`;
}

/**
 * Escape a string for emission as a JSX **text child** inside a `{'…'}` string
 * expression. Covers everything that could terminate the literal or the
 * expression — including U+2028/U+2029, which terminate a JS string literal in
 * some parsers and break tooling in others (Round 1 named both caveats; they are
 * written into the rule here rather than left to the caller).
 *
 * Text is NEVER emitted as an attribute, never as markup, never through
 * `dangerouslySetInnerHTML`.
 */
export function jsxStringLiteral(raw: string): string {
  const body = raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // Written as explicit escapes, never as literal characters in this source:
    // a literal U+2028 here is invisible in every editor and one careless
    // copy-paste away from silently vanishing from the rule.
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\{/g, '\\u007b')
    .replace(/\}/g, '\\u007d');
  return `'${body}'`;
}

// ── D6b — visibility, by normalization ──────────────────────────────────────

/** Below this a glyph is not readable at any sane zoom — clamp, don't drop. */
export const MIN_FONT_SIZE = 8;
/** WCAG-ish floor. Not an a11y claim — a "a human can see this exists" floor. */
export const MIN_CONTRAST_RATIO = 2.5;

function srgbChannel(c: number): number {
  const v = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return v;
}

/** WCAG relative luminance from 0..1 linear sRGB components. */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

export function contrastRatio(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number }
): number {
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export function rgb01ToHex(c: { r: number; g: number; b: number }): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

/**
 * D6b: force a foreground colour to be visible against its own resolved
 * background. Returns the original when it already clears the floor, otherwise
 * black or white — whichever wins — so white-on-white becomes black-on-white
 * rather than being dropped.
 */
export function ensureContrast(fgHex: string, bgHex: string): { hex: string; changed: boolean } {
  const fg = hexToRgb01(fgHex);
  const bg = hexToRgb01(bgHex);
  if (!fg || !bg) return { hex: fgHex, changed: false };
  if (contrastRatio(fg, bg) >= MIN_CONTRAST_RATIO) return { hex: fgHex, changed: false };
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 1, g: 1, b: 1 };
  const pick = contrastRatio(black, bg) >= contrastRatio(white, bg) ? black : white;
  return { hex: rgb01ToHex(pick), changed: true };
}

/** D6b: a readable size, always. */
export function ensureFontSize(size: number): { size: number; changed: boolean } {
  if (!Number.isFinite(size) || size < MIN_FONT_SIZE) {
    return { size: MIN_FONT_SIZE, changed: true };
  }
  return { size, changed: false };
}

/**
 * D6b: clamp a node's world position into the board's occupied bounds (padded),
 * so a stroke parked tens of thousands of units away — which on a real board
 * (measured span x −3 244…+11 037) looks like ordinary geometry, not an
 * anomaly — cannot hide off-screen.
 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clampIntoBounds(
  x: number,
  y: number,
  bounds: Bounds,
  pad = 2000
): { x: number; y: number; changed: boolean } {
  const cx = Math.max(bounds.minX - pad, Math.min(bounds.maxX + pad, x));
  const cy = Math.max(bounds.minY - pad, Math.min(bounds.maxY + pad, y));
  return { x: cx, y: cy, changed: cx !== x || cy !== y };
}
