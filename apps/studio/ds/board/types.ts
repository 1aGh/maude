// `@maude/ds/board` — the model the Design system canvas renders from (S10.6, V2-1.6 §5.2).
//
// PURE: no node imports, no registry — this file is bundled into the canvas next to the React
// components. The server half (`build-model.ts`) reads the working files + `dsPending` + the
// usage cache and produces a `BoardModel`; the generated `@maude/ds/board` module inlines it, so
// the canvas origin needs no route (DDR-054: nothing privileged is reachable from the canvas).

import type { MasterState, StateRule } from './component-states.ts';

export type SectionKind =
  | 'brand'
  | 'colour'
  | 'type'
  | 'space'
  | 'motion'
  | 'components'
  | 'patterns';

/** The seven sections, in board order, with the artboard ids and sizes of 13's `SECS`. */
export const SECTIONS: ReadonlyArray<{
  kind: SectionKind;
  id: string;
  label: string;
  /** where the section sits on a new board (13's SECS), design px */
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  { kind: 'brand', id: 'ds-brand', label: 'Brand', x: 0, y: 0, w: 560, h: 620 },
  { kind: 'colour', id: 'ds-colour', label: 'Colour', x: 608, y: 0, w: 1000, h: 620 },
  { kind: 'type', id: 'ds-type', label: 'Type', x: 1656, y: 0, w: 600, h: 620 },
  { kind: 'space', id: 'ds-space', label: 'Space & shape', x: 0, y: 700, w: 680, h: 560 },
  { kind: 'motion', id: 'ds-motion', label: 'Motion', x: 728, y: 700, w: 440, h: 560 },
  {
    kind: 'components',
    id: 'ds-components',
    label: 'Components',
    x: 1216,
    y: 700,
    w: 1040,
    h: 560,
  },
  { kind: 'patterns', id: 'ds-patterns', label: 'Patterns', x: 0, y: 1340, w: 2256, h: 440 },
];

export type TokenKind =
  | 'color'
  | 'font'
  | 'weight'
  | 'length'
  | 'duration'
  | 'easing'
  | 'shadow'
  | 'number'
  | 'other';

/** What a pending (not yet published) edit says about one token. Values are per theme. */
export interface PendingView {
  values: Record<string, string>;
  /** the token is on its way to the Trash; canvases will follow this one */
  trashTo: string | null;
  /** a token the edit adds */
  added: boolean;
  by: string | null;
  /** the entry's `at` — what an editor sends back as `expect` so a second editor re-reads (S10.7) */
  at: string | null;
  /** theme → the colour's own name the edit gives it */
  valueNames: Record<string, string>;
  /** the edit says whether Dark follows Light (null = it says nothing) */
  darkFollows: boolean | null;
}

export interface BoardToken {
  /** the CSS custom-property name: the identity */
  css: string;
  section: SectionKind;
  /** the registry group, or the slot kind, or `x` / `own` */
  group: string;
  kind: TokenKind;
  /** the designer's name for it; falls back to the humanised CSS name */
  label: string;
  /** theme → the colour's own name ("Azure") */
  valueNames: Record<string, string>;
  locked: boolean;
  /** `tokens.json` `darkFollows`: false = the person set Dark by hand; null = never said (it follows) */
  darkFollows: boolean | null;
  /** theme → the CSS value text, as the files declare it */
  values: Record<string, string>;
  /** canvases that use it; null when the usage index has not run */
  used: number | null;
  pending: PendingView | null;
}

export interface BoardComponent {
  name: string;
  label: string;
  className: string | null;
  /** variant name → its modifier class (null = the base class alone) */
  variants: Array<{ name: string; class: string | null }>;
  sizes: Array<{ name: string; class: string | null }>;
  /** canvases that use it; null when the usage index has not run */
  used: number | null;
  pending: boolean;
  specimen: string | null;
  /** S10.10: the states the system's CSS styles for it (hover, active, focus, disabled) */
  states: MasterState[];
  /** S10.10: the master's own Corners / Fill / Text / Height in `.<class>`, as the file says them */
  look: Record<string, string>;
  /** S10.10: its waiting edits, as the declarations that will be written */
  patches: ComponentPatch[];
}

/** A waiting edit of a master: one declaration in one rule of `preview/_components.css`. */
export interface ComponentPatch {
  selector: string;
  prop: string;
  value: string;
}

export interface BoardLogo {
  file: string;
  /** an `image/svg+xml` data URI (≤ 24 KB, rendered through <img> so it can run nothing) */
  src: string | null;
}

export interface BoardTypeRole {
  role: string;
  class: string;
}

/** S10.16b: one AI direction of a system being made — a draft revision, as the `ds-dir-*` tile draws it. */
export interface BoardDirection {
  /** `a` · `b` · `c` — the artboard is `ds-dir-<direction>` */
  direction: string;
  label: string;
  /** the colours' own names and the headline face: "cool white · azure · System sans" */
  mood: string;
  /** the working files are exactly this direction (it was picked with Use) */
  picked: boolean;
  /** theme → the few tokens a tile draws → their plain CSS value */
  vars: Record<string, Record<string, string>>;
}

export interface BoardModel {
  format: 'maude.ds-board';
  v: 1;
  system: string;
  /** the display name: tokens.json label, else the system's name */
  label: string;
  rootClass: string | null;
  themes: { all: string[]; default: string; light: string; dark: string | null };
  converted: boolean;
  tokens: BoardToken[];
  typeRoles: BoardTypeRole[];
  components: BoardComponent[];
  /** S10.10: every state rule of every master, ready to draw (component-states.ts) */
  stateRules: StateRule[];
  logos: BoardLogo[];
  /** `dsPending` entries: tokens + component patches */
  pendingCount: number;
  /** canvases that follow the system; null when the usage index has not run */
  canvases: number | null;
  /** S10.16b: the system is still being made (`head.json` head = base = null): empty sections are outlines */
  making?: boolean;
  /** S10.16b: the directions the AI drafted, for the `ds-dir-*` artboards */
  directions?: BoardDirection[];
}

export type BoardMode = 'light' | 'dark';

/** Which of the system's own themes the Light | Dark switch shows. */
export function themeFor(model: BoardModel, mode: BoardMode): string {
  return mode === 'dark' ? (model.themes.dark ?? model.themes.light) : model.themes.light;
}

/** The theme names → Light and Dark: a theme literally called light/dark wins, else the default
 *  is Light and the first other theme is Dark. */
export function modesOf(
  themes: string[],
  themeDefault: string
): { light: string; dark: string | null } {
  const has = (n: string) => themes.find((t) => t.toLowerCase() === n);
  const named = has('dark');
  const light = has('light') ?? themes.find((t) => t !== named) ?? themeDefault;
  const dark = named ?? themes.find((t) => t !== light) ?? null;
  return { light, dark: dark === light ? null : dark };
}

/** "--accent-hover" → "Accent hover" (the fallback name for a token nobody labelled). */
export function humanize(css: string): string {
  const words = css.replace(/^--/, '').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : css;
}

export const usedWords = (n: number | null): string | null =>
  n === null ? null : n === 0 ? 'Not used yet' : `Used in ${n} ${n === 1 ? 'canvas' : 'canvases'}`;

const hasControl = (s: string): boolean => {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 0x20) return true;
  return false;
};

/** A value is safe to write into a `<style>` declaration: one value, no way out of it. */
export function safeCssValue(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (!t || t.length > 240) return false;
  if (/[;{}<>\\@]|\/\*|\*\//.test(t) || hasControl(t)) return false;
  if (/url\s*\(|image-set\s*\(|expression\s*\(|javascript:/i.test(t)) return false;
  let depth = 0;
  for (const ch of t) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

export const safeCssName = (n: string): boolean => /^--[A-Za-z0-9_-]{1,128}$/.test(n);

const ident = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '');

/**
 * The board's own `<style>`, scoped by `.ds-board[data-ds-board="<system>"]` and the section's
 * (or a swatch half's) `[data-ds-mode]`: every token's value for that theme, with a pending edit
 * taking the place of the file's value — so the canvas shows the system "as edited".
 *
 * It also makes the board own its theme. The shell re-themes any `[data-theme]` / rootClass
 * wrapper under an artboard to follow the app's chrome (canvas-shell `artboardScopeSelector`,
 * specificity 0,2,0); these rules are 0,3,0, so Light | Dark on the board is the system's own
 * and the app's theme never repaints it.
 *
 * A pending entry is data written by people and agents (DDR-172 D8): anything that is not a
 * plain value is dropped, and only registry-shaped names are written.
 */
export function boardThemeCss(model: BoardModel): string {
  const scope = `.ds-board[data-ds-board="${ident(model.system)}"]`;
  const blocks: string[] = [];
  for (const theme of model.themes.all) {
    const decls: string[] = [];
    for (const t of model.tokens) {
      if (!safeCssName(t.css)) continue;
      const pend = t.pending && !t.pending.trashTo ? t.pending.values[theme] : undefined;
      const value = safeCssValue(pend) ? pend : t.values[theme];
      if (safeCssValue(value)) decls.push(`${t.css}:${value.trim()}`);
    }
    if (!decls.length) continue;
    const m = `[data-ds-mode="${ident(theme)}"]`;
    blocks.push(`${scope}${m},${scope} ${m}{${decls.join(';')}}`);
  }
  return blocks.join('\n');
}

/** A selector a waiting edit may name: classes, descendants and pseudo-classes — nothing that can end a rule. */
export const safeSelector = (s: unknown): s is string =>
  typeof s === 'string' && /^[.\w\s>+~:[\]="'*-]{1,240}$/.test(s);
const PROP = /^[a-z][a-z-]{0,48}$/;

/**
 * The components section's own `<style>` (S10.10), in the same scope as `boardThemeCss`:
 *  · each state rule of a master, with the state swapped for `.ds-force-<state>`, so a hover or a disabled button
 *    can be drawn without a pointer;
 *  · each waiting edit of a master, over the file's rule — the board shows the master "as edited" before Update.
 * Both come from files and `dsPending` (data written by people and agents): selectors and values are re-checked
 * here, anything else is dropped.
 */
export function boardComponentsCss(model: BoardModel): string {
  const scope = `.ds-board[data-ds-board="${ident(model.system)}"]`;
  const out: string[] = [];
  for (const r of model.stateRules ?? []) {
    const sels = r.selector.split(',').filter(safeSelector);
    const decls = r.decls.filter(([p, v]) => PROP.test(p) && safeCssValue(v));
    if (sels.length && decls.length) {
      const head = sels.map((x) => `${scope} ${x.trim()}`).join(',');
      out.push(`${head}{${decls.map(([p, v]) => `${p}:${v.trim()}`).join(';')}}`);
    }
  }
  for (const c of model.components) {
    for (const p of c.patches ?? []) {
      if (!safeSelector(p.selector) || !PROP.test(p.prop) || !safeCssValue(p.value)) continue;
      out.push(`${scope} ${p.selector.trim()}{${p.prop}:${p.value.trim()}}`);
    }
  }
  return out.join('\n');
}

/**
 * Tokens the studio says changed outside the app (S10.11, 13 · ds-truth-outside) or sit in two places
 * (13 · ds-truth-conflict). They arrive from the shell as the dgn message `ds-marks`; the board only flags them.
 */
export interface BoardMarks {
  outside: string[];
  conflicts: string[];
}

export const NO_MARKS: BoardMarks = Object.freeze({ outside: [], conflicts: [] }) as BoardMarks;

/** A message from the shell → clean marks: registry-shaped names only, capped; anything else is dropped. */
export function cleanMarks(raw: unknown): BoardMarks {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const names = (v: unknown): string[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === 'string' && safeCssName(x)))].slice(
          0,
          200
        )
      : [];
  return { outside: names(r.outside), conflicts: names(r.conflicts) };
}

/**
 * The flags, as CSS scoped to the system's board: a ring and a small word on each marked token
 * ("Changed outside", "2 versions"). Only names that pass `safeCssName` reach a selector.
 */
export function marksCss(model: BoardModel, marks: BoardMarks): string {
  const scope = `.ds-board[data-ds-board="${ident(model.system)}"]`;
  const rule = (css: string, word: string, warn: boolean): string => {
    const sel = `${scope} [data-ds-token="${css}"]`;
    const bg = warn ? 'var(--status-warn,#b7791f)' : 'var(--accent,Highlight)';
    return [
      `${sel}{position:relative;outline:1.5px solid ${bg};outline-offset:3px;border-radius:var(--radius-sm,6px)}`,
      `${sel}::after{content:"${word}";position:absolute;${warn ? 'right:0' : 'left:0'};top:-19px;padding:0 6px;border-radius:999px;background:${bg};color:var(--accent-fg,#fff);font-size:10px;line-height:15px;font-weight:600;white-space:nowrap;pointer-events:none}`,
    ].join('\n');
  };
  const conflict = new Set(marks.conflicts);
  return [
    ...marks.outside.filter((c) => !conflict.has(c)).map((c) => rule(c, 'Changed outside', false)),
    ...marks.conflicts.map((c) => rule(c, '2 versions', true)),
  ].join('\n');
}
