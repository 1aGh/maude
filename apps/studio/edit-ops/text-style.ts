// edit-ops/text-style.ts — S2.12: the words of a text style, as pure functions (the inspector and the
// server writers share them; no source parser here, so the canvas and the shell bundles can import it).
//
// A STYLE is a type role of the design system: `components.json` `typeRoles` maps `heading` → `t-heading`,
// and an element wears it as a plain class (`className="t-heading card"`). A style owns seven properties
// (`TYPE_PROPS`); writing one of them inline on the element is an OVERRIDE ("Changed here"), and Reset
// takes the inline declarations out again. Detach inlines the style's values and drops the class, so the
// text looks the same and stops following the system.

import type { CssPatch } from './words-css.ts';

/** What a style owns. Colour, alignment and size boxes are the element's own and never part of it. */
export const TYPE_PROPS = [
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-transform',
  'font-style',
] as const;
export type TypeProp = (typeof TYPE_PROPS)[number];
export const isTypeProp = (p: unknown): p is TypeProp =>
  typeof p === 'string' && (TYPE_PROPS as readonly string[]).includes(p);

/** `.t-<role>` — the class contract of a design system's type roles (V2-1.13 §5.3.11). */
export const ROLE_CLASS_RE = /^t-[a-z][a-z0-9-]*$/;

const classes = (className: string | null | undefined): string[] =>
  (className ?? '').split(/\s+/).filter(Boolean);

/** The role classes an element wears (normally one). */
export const roleClassesOf = (className: string | null | undefined): string[] =>
  classes(className).filter((c) => ROLE_CLASS_RE.test(c));

/** The class list with every role class replaced by `role`; the other classes keep their order. */
export function withRoleClass(className: string | null | undefined, role: string): string {
  return [...classes(className).filter((c) => !ROLE_CLASS_RE.test(c)), role].join(' ');
}

/** The class list with the role classes taken out. */
export const withoutRoleClasses = (className: string | null | undefined): string =>
  classes(className)
    .filter((c) => !ROLE_CLASS_RE.test(c))
    .join(' ');

/** A style's name in the picker: the role key as words — `body-sm` → "Body sm"; a system that names its roles
 *  differently (Plakát) names them in its own `components.json`. */
export function roleName(roleOrClass: string): string {
  const key = roleOrClass.replace(/^t-/, '');
  const spaced = key.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const PROP_WORD: Readonly<Record<TypeProp, string>> = Object.freeze({
  'font-family': 'font',
  'font-size': 'size',
  'font-weight': 'weight',
  'line-height': 'line height',
  'letter-spacing': 'letter spacing',
  'text-transform': 'case',
  'font-style': 'italic',
});
/** The first word capitalised, the others as they are — "Size", "Line height". */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Size differs from Plakát." · "Size and weight differ from Plakát." · "Size, weight and case differ …". */
export function differsLine(styleName: string, props: readonly string[]): string {
  const words = TYPE_PROPS.filter((p) => props.includes(p)).map((p) => PROP_WORD[p]);
  if (words.length === 0) return '';
  const head =
    words.length === 1
      ? cap(words[0] as string)
      : `${cap(words.slice(0, -1).join(', '))} and ${words[words.length - 1]}`;
  return `${head} ${words.length === 1 ? 'differs' : 'differ'} from ${styleName}.`;
}

// ── Case ────────────────────────────────────────────────────────────────────────────────

export type TextCase = 'typed' | 'upper';
export const caseFromCss = (value: string | undefined | null): TextCase =>
  (value ?? '').trim().toLowerCase() === 'uppercase' ? 'upper' : 'typed';

// ── Resizing ────────────────────────────────────────────────────────────────────────────
// Width: the box grows with the line (one line, no wrapping box). Height: the width is fixed, the height
// follows the text. Fixed: both are fixed and the text can overflow.

export type Resizing = 'width' | 'height' | 'fixed';
export function resizingFromCss(css: Record<string, string>): Resizing {
  const w = (css.width ?? '').trim();
  const h = (css.height ?? '').trim();
  const autoHeight = h === '' || h === 'auto';
  if (autoHeight && (w === 'max-content' || w === 'fit-content')) return 'width';
  return autoHeight ? 'height' : 'fixed';
}

/** The declarations a mode writes. `box` is the element's world size now (it fixes a width/height). */
export function resizingToCss(mode: Resizing, box: { w: number; h: number }): CssPatch {
  const px = (n: number) => `${Math.max(1, Math.round(n))}px`;
  if (mode === 'width') return { width: 'max-content', height: null };
  if (mode === 'height') return { width: px(box.w), height: null };
  return { width: px(box.w), height: px(box.h) };
}

// ── Language ────────────────────────────────────────────────────────────────────────────

/** Each language's own name, as the picker shows it. Only Čeština changes the copy (ties, quotes). */
export const LANGUAGES = Object.freeze([
  { tag: 'cs', label: 'Čeština' },
  { tag: 'en', label: 'English' },
  { tag: 'sk', label: 'Slovenčina' },
  { tag: 'de', label: 'Deutsch' },
  { tag: 'pl', label: 'Polski' },
]);

/** The picker entry a `lang` value belongs to (`cs-CZ` → cs), or null. */
export const languageOf = (lang: string | null | undefined): (typeof LANGUAGES)[number] | null =>
  LANGUAGES.find((l) => (lang ?? '').toLowerCase().split('-')[0] === l.tag) ?? null;

/** The line under Language for Čeština (14 Editing, ed-text-edit). */
export const CZECH_LINE =
  'Čeština: one-letter words stay with the next word (the ties under “v” and “s”), „quotes“ turn Czech.';

// ── what the canvas tells the inspector about a text object ─────────────────────────────

/**
 * Measured in the canvas (editing/type-role.ts) and carried on the selection: the style the element
 * wears, what that style computes to, and which of its properties the element overrides.
 */
export interface TextInfo {
  /** `t-heading`, or null: the text has no style */
  role: string | null;
  /** the style's computed values for `TYPE_PROPS` (a probe element wearing only the class) */
  values: Record<string, string>;
  /** the `TYPE_PROPS` whose computed value here differs from `values` */
  differs: string[];
  /** the language in force: this element's `lang` or the nearest ancestor's */
  lang: string;
  /** the element's computed `text-transform` is uppercase */
  upper: boolean;
}
