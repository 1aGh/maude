/**
 * @file edit-ops/words-css.ts
 * @purpose S2.3 — the words → CSS writer, and its reverse (V2-1.9 reuses `toWords`). Pure: no IO, no DOM, no React.
 *
 * The inspector speaks designer words (Hug · Fill · Fixed 148, Gap Space 8, Spacing Space between, Padding H 24 · V 10,
 * Clip content, Constraints Right · Top …). The file speaks CSS. This module is the one table between them, shared
 * by the inspector (client) and the server, written once (14 Editing, ed-inspector, "The words, and what they write").
 *
 *   toCss(words, ctx)            -> CssPatch   { prop: value | null }   null = remove the declaration
 *   toWords(css, ctx)            -> Words                                the authored declarations, read back
 *   toWords(applyPatch({}, toCss(x))) deep-equals x                      the table is a bijection (golden-tested)
 *
 * Rules the writer keeps (contract S2-slices §3a "Words → CSS"):
 *   · tokens are written `var(--…)` and only with the names the system declares — the Tier-1 names (V2-1.13). It never
 *     invents or aliases a name: a token word carries the name it was given, a number stays a number;
 *   · `data-cd-*` is never written (canvas-only);
 *   · a number that is not a token reads as `{ px }` ("V 10 · not a token"); `nearestSpace()` is what **Bind** picks.
 */

import { isMainAxis, type ParentLayout, type SizeAxis } from '../sizing-mode.ts';

/* ── the vocabulary ────────────────────────────────────────────────────────────────────────────────────────────── */

/** One stop of the system's space ladder: `--space-5` is 24 px. */
export interface SpaceStop {
  name: string;
  px: number;
}
export interface DsTokens {
  space?: ReadonlyArray<SpaceStop>;
}

/** A length as the inspector shows it: a token chip, a plain number, or CSS it cannot say in words (calc, %, em …). */
export type Length = { token: string; px: number | null } | { px: number } | { css: string };

export type AxisSize = { mode: 'hug' } | { mode: 'fill' } | { mode: 'fixed'; px: number | null };
export interface SizeWords {
  width: AxisSize;
  height: AxisSize;
  /** Clip content → `overflow: hidden`. */
  clip: boolean;
}

export type Direction = 'row' | 'column' | 'grid' | 'free';
export type Pos3 = 'start' | 'center' | 'end';
export interface LayoutWords {
  direction: Direction;
  /** null = no gap written. */
  gap: Length | null;
  /** Packed or Space between (decision Q7: one property, two entry points). */
  spacing: 'packed' | 'between';
  /** Per side; an unwritten side reads as `{ px: 0 }`. */
  padding: { top: Length; right: Length; bottom: Length; left: Length };
  /**
   * The 3×3 pad: where the content sits inside the frame. `cross` may also be `stretch` (the CSS default, shown on
   * the centre cell but never written by the pad). With Space between the main axis is the spacing's, so it is
   * canonically `start`. Only row and column carry it.
   */
  align: { h: Pos3 | 'stretch'; v: Pos3 | 'stretch' } | null;
}

export type PinH = 'left' | 'right' | 'both' | 'center' | 'scale';
export type PinV = 'top' | 'bottom' | 'both' | 'center' | 'scale';
export interface PositionWords {
  /** Where it sits inside its frame, world px; null when the file does not say and nothing was measured. */
  x: number | null;
  y: number | null;
  rotation: number;
  /** null when nothing is pinned (the object is not placed freely). */
  constraints: { h: PinH; v: PinV } | null;
}

export interface Words {
  size?: SizeWords;
  layout?: LayoutWords;
  position?: PositionWords;
}

/** `{ prop: value }` to write; `null` removes the declaration. */
export type CssPatch = Record<string, string | null>;

/**
 * What the writer needs to know that the words do not say.
 * `parent` — the parent's layout (Fill is a different declaration in a flex row, a flex column and a block);
 * `inline` — keep `inline-flex` / `inline-grid` when the direction changes (the canvas's Button is inline-flex);
 * `transform` — the current `transform`, so a rotation keeps the rest of it;
 * `geometry` — world px of the object inside its offset parent: what a constraint is converted from.
 */
export interface Ctx {
  parent?: ParentLayout;
  tokens?: DsTokens;
  inline?: boolean;
  transform?: string;
  geometry?: Geometry | null;
}
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  parentW: number;
  parentH: number;
}

/* ── lengths ───────────────────────────────────────────────────────────────────────────────────────────────────── */

const VAR_RE = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i;
const NUM_RE = /^(-?\d*\.?\d+)(?:px)?$/i;

const stopPx = (name: string, tokens?: DsTokens): number | null =>
  tokens?.space?.find((s) => s.name === name)?.px ?? null;

export function lengthFromCss(raw: string, tokens?: DsTokens): Length {
  const s = raw.trim();
  const v = VAR_RE.exec(s);
  if (v) return { token: v[1], px: stopPx(v[1], tokens) };
  const n = NUM_RE.exec(s);
  if (n) return { px: Number.parseFloat(n[1]) };
  return { css: s };
}

const fmtPx = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? '0' : `${r}px`;
};

export function lengthToCss(l: Length): string {
  if ('token' in l) return `var(${l.token})`;
  if ('px' in l) return fmtPx(l.px);
  return l.css;
}

/** A length's px when it is known (a token is resolved against the system); null for `calc()`, `%`, `em`. */
export const lengthPx = (l: Length | null): number | null =>
  !l ? null : 'token' in l ? l.px : 'px' in l ? l.px : null;

/** **Bind**: the stop nearest to a plain number. A tie goes to the smaller stop. */
export function nearestSpace(px: number, tokens?: DsTokens): SpaceStop | null {
  let best: SpaceStop | null = null;
  for (const s of tokens?.space ?? []) {
    if (!best) {
      best = s;
      continue;
    }
    const d = Math.abs(s.px - px);
    const bd = Math.abs(best.px - px);
    if (d < bd || (d === bd && s.px < best.px)) best = s;
  }
  return best;
}

/** The chip's name: `--space-5` at 24 px is "Space 24" (a space step reads by its size); other tokens read by name. */
export function tokenLabel(name: string, px?: number | null): string {
  const m = /^--space-\d+$/.exec(name);
  if (m && px != null) return `Space ${Math.round(px * 100) / 100}`;
  const words = name.replace(/^--/, '').replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Whitespace-separated, but never inside `(…)`. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/* ── size ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

const HUG = new Set(['fit-content', 'max-content', 'min-content']);
const FILL = new Set(['100%', 'fill', '-webkit-fill-available', 'stretch']);
const isFlexParent = (p?: ParentLayout) => {
  const d = (p?.display || '').trim();
  return d === 'flex' || d === 'inline-flex';
};

/** The fill-only declarations a Hug or Fixed axis must not leave behind. */
function fillProps(axis: SizeAxis, parent?: ParentLayout): string[] {
  if (!isFlexParent(parent)) return [];
  return isMainAxis(axis, parent) ? ['flex', 'flex-grow', 'flex-basis'] : ['align-self'];
}

export function axisToCss(axis: SizeAxis, w: AxisSize, parent?: ParentLayout): CssPatch {
  const reset = Object.fromEntries(fillProps(axis, parent).map((p) => [p, null])) as CssPatch;
  if (w.mode === 'hug') return { ...reset, [axis]: 'fit-content' };
  if (w.mode === 'fixed') return { ...reset, [axis]: fmtPx(w.px ?? 0) };
  // fill — which declaration depends on the parent: a flex row/column fills one axis by growing, the other by
  // stretching; a block or grid parent by 100 %.
  if (isFlexParent(parent)) {
    return isMainAxis(axis, parent)
      ? { flex: '1', [axis]: null }
      : { 'align-self': 'stretch', [axis]: null };
  }
  return { [axis]: '100%' };
}

export function axisFromCss(
  axis: SizeAxis,
  css: Record<string, string>,
  parent?: ParentLayout
): AxisSize {
  const a = (css[axis] || '').trim().toLowerCase();
  if (HUG.has(a)) return { mode: 'hug' };
  if (FILL.has(a)) return { mode: 'fill' };
  if (isFlexParent(parent)) {
    if (isMainAxis(axis, parent)) {
      const grow = Number.parseFloat(css['flex-grow'] || splitTop(css.flex || '')[0] || '0');
      if (grow >= 1) return { mode: 'fill' };
    } else if ((css['align-self'] || '').trim() === 'stretch') return { mode: 'fill' };
  }
  const n = NUM_RE.exec(a);
  return { mode: 'fixed', px: n ? Number.parseFloat(n[1]) : null };
}

export function sizeToCss(s: SizeWords, parent?: ParentLayout): CssPatch {
  return {
    ...axisToCss('width', s.width, parent),
    ...axisToCss('height', s.height, parent),
    overflow: s.clip ? 'hidden' : null,
  };
}

export function sizeFromCss(css: Record<string, string>, parent?: ParentLayout): SizeWords {
  const o = (css.overflow || '').trim();
  return {
    width: axisFromCss('width', css, parent),
    height: axisFromCss('height', css, parent),
    clip: o === 'hidden' || o === 'clip',
  };
}

/* ── layout ────────────────────────────────────────────────────────────────────────────────────────────────────── */

const POS_TO_CSS: Record<Pos3, string> = { start: 'flex-start', center: 'center', end: 'flex-end' };
const posFromCss = (v: string | undefined, fallback: Pos3 | 'stretch'): Pos3 | 'stretch' => {
  const s = (v || '').trim();
  if (s === 'flex-start' || s === 'start' || s === 'left') return 'start';
  if (s === 'center') return 'center';
  if (s === 'flex-end' || s === 'end' || s === 'right') return 'end';
  if (s === 'stretch') return 'stretch';
  return fallback;
};

const PAD_LONG = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const;
const FLEX_ONLY = ['flex-direction', 'flex-wrap', 'justify-content', 'align-items'] as const;
const nulls = (props: readonly string[]): CssPatch =>
  Object.fromEntries(props.map((p) => [p, null])) as CssPatch;

export function paddingToCss(p: LayoutWords['padding']): CssPatch {
  const [t, r, b, l] = [p.top, p.right, p.bottom, p.left].map(lengthToCss);
  const allZero = [t, r, b, l].every((x) => x === '0');
  if (allZero) return { padding: null, ...nulls(PAD_LONG) };
  let value: string;
  if (t === r && r === b && b === l) value = t;
  else if (t === b && r === l) value = `${t} ${r}`;
  else if (r === l) value = `${t} ${r} ${b}`;
  else value = `${t} ${r} ${b} ${l}`;
  return { padding: value, ...nulls(PAD_LONG) };
}

export function paddingFromCss(
  css: Record<string, string>,
  tokens?: DsTokens
): LayoutWords['padding'] {
  const side = (v: string | undefined) => lengthFromCss(v ?? '0', tokens);
  let [t, r, b, l]: Array<string | undefined> = [undefined, undefined, undefined, undefined];
  const parts = splitTop(css.padding || '');
  if (parts.length === 1) [t, r, b, l] = [parts[0], parts[0], parts[0], parts[0]];
  else if (parts.length === 2) [t, r, b, l] = [parts[0], parts[1], parts[0], parts[1]];
  else if (parts.length === 3) [t, r, b, l] = [parts[0], parts[1], parts[2], parts[1]];
  else if (parts.length >= 4) [t, r, b, l] = parts;
  return {
    top: side(css['padding-top'] ?? t),
    right: side(css['padding-right'] ?? r),
    bottom: side(css['padding-bottom'] ?? b),
    left: side(css['padding-left'] ?? l),
  };
}

export function layoutToCss(w: LayoutWords, ctx: Ctx = {}): CssPatch {
  const inline = ctx.inline ? 'inline-' : '';
  const patch: CssPatch = {};
  if (w.direction === 'row' || w.direction === 'column') {
    patch.display = `${inline}flex`;
    patch['flex-direction'] = w.direction === 'column' ? 'column' : null;
  } else if (w.direction === 'grid') {
    patch.display = `${inline}grid`;
    Object.assign(patch, nulls(FLEX_ONLY));
  } else {
    patch.display = 'block';
    Object.assign(patch, nulls(FLEX_ONLY));
  }
  patch.gap = w.gap ? lengthToCss(w.gap) : null;
  if (w.direction === 'row' || w.direction === 'column') {
    const a = w.align ?? { h: 'stretch', v: 'stretch' };
    const [main, cross] = w.direction === 'row' ? [a.h, a.v] : [a.v, a.h];
    patch['justify-content'] =
      w.spacing === 'between'
        ? 'space-between'
        : main === 'start' || main === 'stretch'
          ? null
          : POS_TO_CSS[main];
    patch['align-items'] = cross === 'stretch' ? null : POS_TO_CSS[cross];
  }
  return { ...patch, ...paddingToCss(w.padding) };
}

export function layoutFromCss(css: Record<string, string>, ctx: Ctx = {}): LayoutWords {
  const display = (css.display || '').trim();
  const flex = display === 'flex' || display === 'inline-flex';
  const grid = display === 'grid' || display === 'inline-grid';
  const column = (css['flex-direction'] || '').trim().startsWith('column');
  const direction: Direction = flex ? (column ? 'column' : 'row') : grid ? 'grid' : 'free';
  const gapParts = splitTop(css.gap || '');
  // `gap: 8px 16px` (row, column) is two values; the pad has one, so an uneven pair reads as the row value's number
  const gap = gapParts.length ? lengthFromCss(gapParts[0], ctx.tokens) : null;
  const jc = (css['justify-content'] || '').trim();
  const spacing = jc === 'space-between' ? 'between' : 'packed';
  let align: LayoutWords['align'] = null;
  if (flex) {
    const main = spacing === 'between' ? 'start' : posFromCss(jc, 'start');
    const cross = posFromCss(css['align-items'], 'stretch');
    align = direction === 'row' ? { h: main, v: cross } : { h: cross, v: main };
  }
  return { direction, gap, spacing, padding: paddingFromCss(css, ctx.tokens), align };
}

/* ── position ──────────────────────────────────────────────────────────────────────────────────────────────────── */

const ROTATE_RE = /rotate\(\s*(-?\d*\.?\d+)(deg|turn|rad|grad)?\s*\)/i;

export function rotationOf(transform: string | undefined): number {
  const m = ROTATE_RE.exec(transform || '');
  if (!m) return 0;
  const n = Number.parseFloat(m[1]);
  const unit = (m[2] || 'deg').toLowerCase();
  const deg =
    unit === 'turn'
      ? n * 360
      : unit === 'rad'
        ? (n * 180) / Math.PI
        : unit === 'grad'
          ? n * 0.9
          : n;
  return Math.round(deg * 100) / 100;
}

/** The `transform` value with its rotation set to `deg` and everything else kept; null when nothing is left. */
export function withRotation(transform: string | undefined, deg: number): string | null {
  const rest = (transform || '')
    .replace(new RegExp(ROTATE_RE.source, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
  const r = Math.round(deg * 100) / 100;
  const parts = [rest, r === 0 ? '' : `rotate(${r}deg)`].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

const HALF_RE = /^calc\(\s*50%\s*([+-])\s*(-?\d*\.?\d+)px\s*\)$/i;

/** Constraints → the declarations that pin the object. `geometry` is the object where it is now, in world px. */
export function constraintsToCss(c: { h: PinH; v: PinV }, g: Geometry): CssPatch {
  const axis = (
    pin: PinH | PinV,
    near: 'left' | 'top',
    far: 'right' | 'bottom',
    size: 'width' | 'height',
    pos: number,
    len: number,
    parent: number
  ): CssPatch => {
    const farD = parent - pos - len;
    if (pin === 'left' || pin === 'top') return { [near]: fmtPx(pos), [far]: null };
    if (pin === 'right' || pin === 'bottom') return { [far]: fmtPx(farD), [near]: null };
    if (pin === 'both') return { [near]: fmtPx(pos), [far]: fmtPx(farD), [size]: null };
    if (pin === 'center') {
      const off = Math.round((pos - parent / 2) * 100) / 100;
      return { [near]: `calc(50% ${off < 0 ? '-' : '+'} ${Math.abs(off)}px)`, [far]: null };
    }
    const pct = (n: number) => `${Math.round((n / (parent || 1)) * 10000) / 100}%`;
    return { [near]: pct(pos), [far]: null, [size]: pct(len) };
  };
  return {
    ...axis(c.h, 'left', 'right', 'width', g.x, g.w, g.parentW),
    ...axis(c.v, 'top', 'bottom', 'height', g.y, g.h, g.parentH),
  };
}

export function constraintsFromCss(css: Record<string, string>): { h: PinH; v: PinV } | null {
  const pin = (
    near: string,
    far: string,
    size: string,
    a: PinH | PinV,
    b: PinH | PinV
  ): PinH | PinV | null => {
    const n = (css[near] || '').trim();
    const f = (css[far] || '').trim();
    if (!n && !f) return null;
    if (n && f) return 'both';
    if (f) return b;
    if (HALF_RE.test(n)) return 'center';
    if (n.endsWith('%') && (css[size] || '').trim().endsWith('%')) return 'scale';
    return a;
  };
  const h = pin('left', 'right', 'width', 'left', 'right') as PinH | null;
  const v = pin('top', 'bottom', 'height', 'top', 'bottom') as PinV | null;
  if (!h && !v) return null;
  return { h: h ?? 'left', v: v ?? 'top' };
}

export function positionToCss(p: PositionWords, ctx: Ctx = {}): CssPatch {
  const patch: CssPatch = { transform: withRotation(ctx.transform, p.rotation) };
  const g = ctx.geometry;
  if (p.constraints && g) {
    // X and Y are where it sits; the constraint decides which edge's distance carries that
    Object.assign(patch, constraintsToCss(p.constraints, { ...g, x: p.x ?? g.x, y: p.y ?? g.y }));
  } else {
    // pinned to the top-left (the default): X and Y are `left` and `top`
    if (p.x != null) patch.left = fmtPx(p.x);
    if (p.y != null) patch.top = fmtPx(p.y);
  }
  return patch;
}

export function positionFromCss(css: Record<string, string>, ctx: Ctx = {}): PositionWords {
  const g = ctx.geometry;
  const px = (v: string | undefined) => {
    const n = NUM_RE.exec((v || '').trim());
    return n ? Number.parseFloat(n[1]) : null;
  };
  return {
    // measured where it is, when the canvas reports it; else the number the file carries
    x: g ? g.x : px(css.left),
    y: g ? g.y : px(css.top),
    rotation: rotationOf(css.transform),
    constraints: constraintsFromCss(css),
  };
}

/* ── the two entry points ──────────────────────────────────────────────────────────────────────────────────────── */

/** The declarations to write for these words. Only the groups given are touched. */
export function toCss(words: Words, ctx: Ctx = {}): CssPatch {
  return {
    ...(words.size ? sizeToCss(words.size, ctx.parent) : {}),
    ...(words.layout ? layoutToCss(words.layout, ctx) : {}),
    ...(words.position ? positionToCss(words.position, ctx) : {}),
  };
}

/** The words an element's authored declarations say. All three groups. */
export function toWords(css: Record<string, string>, ctx: Ctx = {}): Required<Words> {
  return {
    size: sizeFromCss(css, ctx.parent),
    layout: layoutFromCss(css, ctx),
    position: positionFromCss(css, ctx),
  };
}

/** A patch applied to a declaration map (the shape `authored` has): `null` removes. */
export function applyPatch(css: Record<string, string>, patch: CssPatch): Record<string, string> {
  const out = { ...css };
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) delete out[k];
    else out[k] = v;
  }
  return out;
}

/** The patch reduced to what actually changes against `css` — no write for a value already there. */
export function diffPatch(css: Record<string, string>, patch: CssPatch): CssPatch {
  const out: CssPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v == null ? k in css : (css[k] ?? '').trim() !== v) out[k] = v;
  }
  return out;
}
