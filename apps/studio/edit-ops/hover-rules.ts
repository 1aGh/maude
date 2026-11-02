// edit-ops/hover-rules.ts — S2.5: the On hover format (client/v2/contracts/S2-hover-format.md).
//
// Pure leaf (no React, no DOM, no node:*): the inspector (vocabulary, reader, writer), canvas-lib (injects
// HOVER_RULES once) and handoff / the HTML export (hoverCssForSource) all read this one file.
//
// `data-hover="<preset>"` is design, so it sits OUTSIDE the canvas-only `data-cd-*` namespace: every exporter strips
// that prefix and must leave this attribute alone.

export const HOVER_ATTR = 'data-hover';

/** The closed vocabulary, in the order the inspector lists it. */
export const HOVER_PRESETS = Object.freeze([
  'lift-resting',
  'lift-floating',
  'lift-sheet',
  'darken',
  'underline',
] as const);

export type HoverPreset = (typeof HOVER_PRESETS)[number];

const LABELS: Record<HoverPreset, string> = {
  'lift-resting': 'Lift to Resting',
  'lift-floating': 'Lift to Floating',
  'lift-sheet': 'Lift to Sheet',
  darken: 'Darken',
  underline: 'Underline',
};

export const isHoverPreset = (v: unknown): v is HoverPreset =>
  typeof v === 'string' && (HOVER_PRESETS as readonly string[]).includes(v);

/** The words the inspector shows: "Lift to Floating", "None" for no hover, the raw value for one it does not know. */
export function hoverLabel(preset: string | null | undefined): string {
  if (preset == null || preset === '') return 'None';
  return isHoverPreset(preset) ? LABELS[preset] : preset;
}

/** What the selection payload says (`attrs['data-hover']`). `known: false` = a value outside the vocabulary. */
export function hoverOf(attrs: Record<string, string> | null | undefined): {
  preset: string | null;
  known: boolean;
} {
  const v = attrs?.[HOVER_ATTR];
  if (v == null || v === '') return { preset: null, known: true };
  return { preset: v, known: isHoverPreset(v) };
}

/** The `/_api/edit-attr` payload (minus canvas + id) for a pick; null = None (the attribute is removed). */
export function hoverWrite(
  preset: string | null
): { attr: 'data-hover'; value: HoverPreset } | { attr: 'data-hover'; reset: true } {
  if (preset == null) return { attr: HOVER_ATTR, reset: true };
  if (!isHoverPreset(preset)) throw new Error(`unknown hover preset "${preset}"`);
  return { attr: HOVER_ATTR, value: preset };
}

const SHADOW_FALLBACK: Record<'lift-resting' | 'lift-floating' | 'lift-sheet', string> = {
  'lift-resting': '0 1px 3px color-mix(in srgb, currentColor 18%, transparent)',
  'lift-floating': '0 8px 24px color-mix(in srgb, currentColor 18%, transparent)',
  'lift-sheet': '0 24px 60px color-mix(in srgb, currentColor 24%, transparent)',
};

const RULE: Record<HoverPreset, string> = {
  'lift-resting': `box-shadow: var(--shadow-resting, ${SHADOW_FALLBACK['lift-resting']}) !important;`,
  'lift-floating': `box-shadow: var(--shadow-floating, ${SHADOW_FALLBACK['lift-floating']}) !important;`,
  'lift-sheet': `box-shadow: var(--shadow-sheet, ${SHADOW_FALLBACK['lift-sheet']}) !important;`,
  darken: 'filter: brightness(0.94) !important;',
  underline: 'text-decoration: underline !important;',
};

const BASE =
  '[data-hover] { transition: box-shadow var(--dur-fast, 120ms) ease, filter var(--dur-fast, 120ms) ease; }';
const REDUCED = '@media (prefers-reduced-motion: reduce) { [data-hover] { transition: none; } }';
const ruleFor = (p: HoverPreset) => `[data-hover="${p}"]:hover { ${RULE[p]} }`;

/** The fixed rule set canvas-lib injects once. `!important` beats the inline box-shadow Effects writes. */
export const HOVER_RULES = [BASE, ...HOVER_PRESETS.map(ruleFor), REDUCED].join('\n');

/**
 * The `:hover` CSS an export writes beside its markup: the rules for the presets this source uses, once each, in
 * vocabulary order. '' when it uses none (nothing to add). A value outside the vocabulary matches no rule.
 */
export function hoverCssForSource(source: string): string {
  const used = new Set<string>();
  for (const m of source.matchAll(
    /\bdata-hover\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\})/g
  )) {
    used.add(m[1] ?? m[2] ?? m[3] ?? '');
  }
  const presets = HOVER_PRESETS.filter((p) => used.has(p));
  if (!presets.length) return '';
  return [BASE, ...presets.map(ruleFor), REDUCED].join('\n');
}
