/**
 * @file       figma/codegen-fonts.ts — font resolution + honest reporting (plan T18, DDR-219 D9).
 * @scope      apps/studio/figma/codegen-fonts.ts
 * @purpose    Turn a Figma font family into something the PROJECT can actually
 *             render, and say so every single time that is not what was asked
 *             for.
 *
 * @rationale  Measured on the dogfood machine 2026-08-11: Inter installed;
 *             **Nunito, SF Pro, Hanken Grotesk and General Sans absent** — while
 *             the DS declares `--font-body: 'Hanken Grotesk','Inter',…` and
 *             loads no webfont at all (no `@font-face`, no import). Copying the
 *             family name through therefore lands on a serif fallback that
 *             *looks fine* and is not the design. Silent visual drift is exactly
 *             the failure mode this import has already shipped three times
 *             (dropped loose content, stripped `href`, zero-height arrows) —
 *             each time reporting success.
 *
 * @invariant  A CSS FALLBACK IS NOT A REPORT. `font-family: 'SF Pro', sans-serif`
 *             degrades silently by design; that is what a fallback IS. So every
 *             substitution emits a `font-substituted` disposition, and the
 *             per-import summary names it.
 *
 * @invariant  THE FIGMA FAMILY NEVER REACHES THE ARTIFACT. `style-map.ts` states
 *             the same rule for the tree lane ("FONT FAMILY IS DELIBERATELY NOT
 *             CARRIED") because a family value is free text from the document
 *             that reaches a live stylesheet. This lane resolves to a DS token
 *             or to a system stack — never to the requested literal.
 *
 * @invariant  THE REPORTED NAME IS BOUNDED, NOT VERBATIM (DDR-219 D9). `detail`
 *             is the one field on the wire no sanitizer touches, and it reaches
 *             verb stdout (which D10 declares entirely code-owned), the HTTP
 *             route and the panel. So the family travels as
 *             `attrValue(name, 32)` — charset-allowlisted and length-capped —
 *             never as the raw string.
 *
 * @invariant  DEPENDENCY-FREE — pure string work over an injected token list.
 */

import { attrValue, type ImportReport } from './sanitize.ts';

/** How much of a family name may appear in a report entry (D9). */
export const MAX_FAMILY_DETAIL = 32;

/**
 * Figma writes a family as `Family:Style` inside a Tailwind arbitrary value —
 * `SF_Pro:Bold`, `Inter:Regular`, `SF_Pro_Display:Semibold`. The style half is a
 * WEIGHT, not part of the family, and passing it through produces a family name
 * no font on earth answers to.
 */
export function splitFamilyAndStyle(raw: string): { family: string; style: string | null } {
  const colon = raw.indexOf(':');
  if (colon < 0) return { family: raw.trim(), style: null };
  return { family: raw.slice(0, colon).trim(), style: raw.slice(colon + 1).trim() || null };
}

/** Figma's style words → a numeric CSS weight. Anything unrecognised is ignored
 *  rather than guessed — a wrong weight is a visible defect with no report. */
const STYLE_WEIGHTS: ReadonlyMap<string, number> = new Map([
  ['thin', 100],
  ['extralight', 200],
  ['ultralight', 200],
  ['light', 300],
  ['regular', 400],
  ['normal', 400],
  ['book', 400],
  ['medium', 500],
  ['semibold', 600],
  ['demibold', 600],
  ['bold', 700],
  ['extrabold', 800],
  ['heavy', 800],
  ['black', 900],
]);

export function styleToWeight(style: string | null): number | null {
  if (!style) return null;
  return STYLE_WEIGHTS.get(style.toLowerCase().replace(/[^a-z]/g, '')) ?? null;
}

/**
 * Families that are genuinely present on essentially every target, so resolving
 * to them is not a substitution anyone needs telling about. Deliberately tiny:
 * the honest default when we do not know is "this WAS substituted".
 */
const UBIQUITOUS: ReadonlySet<string> = new Set(['inter', 'arial', 'helvetica', 'georgia']);

/**
 * The stack a substituted family lands on. Not a serif — the measured failure
 * was a design landing on a serif fallback, so the replacement is explicitly the
 * neutral UI stack the rest of Maude uses.
 */
export const SYSTEM_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface FontToken {
  /** e.g. `--font-body`. */
  name: string;
  /** The declared stack, lowercased, for family matching. */
  value: string;
}

export interface FontResolution {
  /** What to emit as `fontFamily`. Never the requested literal. */
  css: string;
  /** True when the emitted family is not the requested one. */
  substituted: boolean;
  /** Bounded requested family, for the report. Empty when unprintable. */
  requested: string;
  /** Which DS token matched, when one did. */
  token?: string;
}

/**
 * Resolve a requested family against the project's own type tokens first, then
 * against the ubiquitous set, then to the system stack.
 *
 * DS token first is not only a fidelity choice — it is the editability one. An
 * imported frame that inherits the project's type stack looks like it belongs to
 * the project, which is the same reasoning `style-map.ts` gives for not carrying
 * the family at all in the tree lane.
 */
export function resolveFontFamily(
  rawFamily: string,
  tokens: readonly FontToken[] = []
): FontResolution {
  const { family } = splitFamilyAndStyle(rawFamily);
  const requested = attrValue(family, MAX_FAMILY_DETAIL);
  const needle = family.toLowerCase().replace(/['"]/g, '').trim();

  if (needle.length === 0) {
    return { css: SYSTEM_STACK, substituted: true, requested };
  }

  // A DS token whose declared stack NAMES this family is not a substitution —
  // it is the same typeface, reached through the project's own variable.
  for (const t of tokens) {
    if (t.value.includes(needle)) {
      return { css: `var(${t.name})`, substituted: false, requested, token: t.name };
    }
  }
  if (UBIQUITOUS.has(needle)) {
    return { css: `${quoteFamily(family)}, ${SYSTEM_STACK}`, substituted: false, requested };
  }
  // Nothing matched. Prefer the project's body token over a bare system stack —
  // an imported frame in the project's own typeface beats one in the OS default.
  const body = tokens.find((t) => /body|sans|text|base/.test(t.name));
  if (body) return { css: `var(${body.name})`, substituted: true, requested, token: body.name };
  return { css: SYSTEM_STACK, substituted: true, requested };
}

// ── The tree lane (#155 §3, D8) ─────────────────────────────────────────────
//
// `resolveFontFamily` above serves the codegen lane, which may quote a
// ubiquitous family. The tree lane (`style-map.ts`) is stricter: the document's
// family name NEVER reaches the stylesheet. It is classified against a closed
// allowlist into sans / serif / mono and mapped onto the DS stack of that class.

export type FontClass = 'sans' | 'serif' | 'mono';

/** Fixed fallbacks when the DS has no stack of the class — code-owned constants, never document text. */
export const SERIF_STACK = "Georgia, 'Times New Roman', Times, serif";
export const MONO_STACK =
  "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const FALLBACK_STACK: Record<FontClass, string> = Object.assign(Object.create(null), {
  sans: SYSTEM_STACK,
  serif: SERIF_STACK,
  mono: MONO_STACK,
});

const MONO_RE =
  /\bmono\b|monospace|\bcode\b|courier|consolas|menlo|monaco|jetbrains|inconsolata|iosevka|\bhack\b|\bterminal\b/;
const SERIF_RE =
  /\bserif\b|georgia|times|garamond|playfair|merriweather|\blora\b|baskerville|crimson|cormorant|bodoni|didot|palatino|cambria|charter|fraunces|spectral|newsreader|\bcaslon\b|domine|literata|gelasio/;

/** Which DS stack a requested family belongs on. Sans is the default: when unsure, the neutral UI face. */
export function classifyFamily(rawFamily: string): FontClass {
  const f = splitFamilyAndStyle(rawFamily).family.toLowerCase().replace(/[_-]+/g, ' ');
  if (MONO_RE.test(f)) return 'mono';
  if (/\bsans\b/.test(f)) return 'sans';
  if (SERIF_RE.test(f)) return 'serif';
  return 'sans';
}

const CLASS_TOKEN: Record<FontClass, RegExp> = Object.assign(Object.create(null), {
  mono: /mono|code/,
  serif: /serif/,
  sans: /sans|body|text|base|ui/,
});

/** A token's declared families, quotes and case stripped, for an exact-name match. */
function declaredFamilies(value: string): string[] {
  return value
    .split(',')
    .map((x) => x.replace(/['"]/g, '').trim().toLowerCase())
    .filter(Boolean);
}

export function resolveDsFontStack(
  rawFamily: string,
  tokens: readonly FontToken[] = []
): FontResolution & { fontClass: FontClass } {
  const { family } = splitFamilyAndStyle(rawFamily);
  const requested = attrValue(family, MAX_FAMILY_DETAIL);
  const needle = family.toLowerCase().replace(/['"]/g, '').trim();
  const fontClass = classifyFamily(family);

  // The DS declares this very family: same typeface, reached through its variable.
  if (needle.length > 0) {
    for (const t of tokens) {
      if (declaredFamilies(t.value).includes(needle)) {
        return { css: `var(${t.name})`, substituted: false, requested, token: t.name, fontClass };
      }
    }
  }
  // Otherwise the DS stack of the same CLASS: a serif heading stays a serif.
  const pattern = CLASS_TOKEN[fontClass];
  const byClass = tokens.find((t) => {
    if (!pattern.test(t.name)) return false;
    if (fontClass === 'sans') return !/mono|code|serif/.test(t.name);
    return true;
  });
  if (byClass) {
    return {
      css: `var(${byClass.name})`,
      substituted: true,
      requested,
      token: byClass.name,
      fontClass,
    };
  }
  return { css: FALLBACK_STACK[fontClass], substituted: true, requested, fontClass };
}

/** True for exactly what `resolveDsFontStack` can return — a DS variable or one of the fixed stacks. */
export function isDsFontValue(v: string): boolean {
  return (
    /^var\(--[a-z0-9-]{1,64}\)$/.test(v) ||
    v === SYSTEM_STACK ||
    v === SERIF_STACK ||
    v === MONO_STACK
  );
}

/**
 * Quote a family name for a CSS value position. Charset-allowlisted first, so a
 * family carrying a quote, a semicolon or a brace cannot terminate the
 * declaration — the same reason DDR-172 Decision 4 has a font grammar at all.
 */
export function quoteFamily(family: string): string {
  const safe = family
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .slice(0, 48);
  return safe.length > 0 ? `'${safe}'` : SYSTEM_STACK;
}

/**
 * Record substitutions ONCE PER FAMILY, with a count — not once per element.
 *
 * A screen using SF Pro on 40 nodes is ONE substitution a human needs to know
 * about; forty identical entries would bury the other dispositions and blow the
 * summary's 200-line cap for no information. The count is what makes the single
 * entry honest.
 */
export class FontSubstitutions {
  private readonly counts = new Map<string, number>();

  note(resolution: FontResolution): void {
    if (!resolution.substituted) return;
    const key = resolution.requested || 'unnamed';
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Fold another tally in, so a canvas of many frames reports each family once. */
  absorb(other: FontSubstitutions): void {
    for (const [family, n] of other.counts) {
      this.counts.set(family, (this.counts.get(family) ?? 0) + n);
    }
  }

  get size(): number {
    return this.counts.size;
  }

  /**
   * Flush into the import report. `nodeId` is the FRAME's id — the substitution
   * is a property of the import, not of one element, and `detail` is bounded to
   * `<= MAX_DETAIL_LEN` by `ImportReport.add` throwing if it is not.
   */
  flush(report: ImportReport, nodeId: string): void {
    for (const [family, n] of [...this.counts].sort((a, b) => a[0].localeCompare(b[0]))) {
      report.add(nodeId, 'FONT', 'font-substituted', `${family} x${n}`.slice(0, 63));
    }
  }
}
