/**
 * @file edit-ops/words-paint.ts
 * @purpose S2.4 — the words → CSS writer for Fill · Corners · Border · Effects · Type, and the Mixed reducer.
 * Pure: no IO, no DOM, no React. Sits beside `words-css.ts` (Position · Size · Layout) and follows its rules:
 *
 *   fillToCss / fillFromCss         Fill Ink, + a gradient, + an image          background / background-color / -image
 *   cornersToCss / cornersFromCss   Corners Round, or each of ↖ ↗ ↘ ↙          border-radius (four values when unlinked)
 *   borderToCss / borderFromCss     Border Ink 1.5, Inside · Centre · Outside   see the table below
 *   strokeToCss / strokeFromCss     Stroke on lines and Pen paths               stroke / stroke-width
 *   elevationToCss / ...FromCss     Shadow Flat · <the system's own names>      box-shadow (shares the property with a ring)
 *   opacityToCss / typeToCss ...    Opacity, Size · weight, Colour              opacity / font-size, font-weight / color
 *   reduceMixed                     several objects: the shared value, or "Mixed" with the distinct ones
 *
 * Border position (CONTRACT: the object's size never changes by a border):
 *   Inside   box-shadow: inset 0 0 0 Wpx <colour>            (a file that already says `border: W solid C` keeps it: `via: 'border'`)
 *   Centre   outline: Wpx solid <colour>; outline-offset: -W/2px
 *   Outside  outline: Wpx solid <colour>
 * A border and a shadow share `box-shadow`; the writer composes them (`<ring>, <elevation>`) from the value that is there,
 * so choosing a shadow never drops the border and vice versa.
 *
 * Rules kept (as words-css): a token is written `var(--…)` and only with the name it was given — the writer never invents
 * or aliases a name; `data-cd-*` is never written; `toWords(applyPatch({}, toCss(x)))` deep-equals x (golden-tested).
 */

import {
  type CssPatch,
  type DsTokens,
  type Length,
  lengthFromCss,
  lengthToCss,
} from './words-css.ts';

/* ── small shared parsers ──────────────────────────────────────────────────────────────────────────────────────── */

/** Split at a separator, never inside `(…)`. */
function splitAt(s: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.trim()) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    const cut = depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch));
    if (cut) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const commas = (s: string) => splitAt(s, ',');
const words = (s: string) => splitAt(s, ' ');

const fmtNum = (n: number) => `${Math.round(n * 100) / 100}`;
const fmtPx = (n: number) => (Math.round(n * 100) / 100 === 0 ? '0' : `${fmtNum(n)}px`);

const VAR_RE = /^var\(\s*(--[a-z0-9-]+)\s*(?:,[^)]*)?\)$/i;
const COLOR_FN_RE =
  /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\(.*\))$/i;
const COLOR_WORDS = new Set(['transparent', 'currentcolor', 'white', 'black']);
const isColourToken = (s: string) =>
  VAR_RE.test(s) || COLOR_FN_RE.test(s) || COLOR_WORDS.has(s.toLowerCase());

/** Does the text read as one CSS colour? (a custom colour typed into the "A colour, no token…" field) */
export function isCssColor(s: string): boolean {
  const t = s.trim();
  return !!t && !/[;{}]/.test(t) && isColourToken(t) && !VAR_RE.test(t);
}

/* ── colours ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A colour as the inspector shows it: a token chip, or CSS a token does not name. */
export type Paint = { token: string } | { css: string };
export interface Colour {
  paint: Paint;
  /** 0–100. Below 100 it is written as `color-mix(in srgb, <paint> N%, transparent)`. */
  opacity: number;
}

const MIX_RE = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/i;

export function paintToCss(p: Paint): string {
  return 'token' in p ? `var(${p.token})` : p.css;
}
export function paintFromCss(raw: string): Paint {
  const s = raw.trim();
  const v = VAR_RE.exec(s);
  return v ? { token: v[1] } : { css: s };
}
export function colourToCss(c: Colour): string {
  const o = Math.max(0, Math.min(100, c.opacity));
  const base = paintToCss(c.paint);
  return o >= 100 ? base : `color-mix(in srgb, ${base} ${fmtNum(o)}%, transparent)`;
}
export function colourFromCss(raw: string): Colour {
  const s = raw.trim();
  const m = MIX_RE.exec(s);
  if (m) return { paint: paintFromCss(m[1]), opacity: Number.parseFloat(m[2]) };
  return { paint: paintFromCss(s), opacity: 100 };
}

/** The colour as one swatch needs it: the CSS to paint it with. */
export const swatchCss = (c: Colour | null) => (c ? colourToCss(c) : 'transparent');

/* ── fill ──────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type Layer = { kind: 'gradient'; css: string } | { kind: 'image'; url: string };
export interface FillWords {
  /** The solid colour under every layer; null = none. */
  color: Colour | null;
  /** Gradients and images, top first. */
  layers: Layer[];
}

const GRADIENT_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(.*\)$/i;
const URL_RE = /^url\(\s*(["']?)(.*?)\1\s*\)$/i;

/** An image fill's source: a path in the project, an https: address or an inline image. Never a script or a bare http:. */
export function imageUrlOk(u: string): boolean {
  const t = u.trim();
  if (!t || /["'()\\\s]/.test(t.replace(/^data:image\/[a-z+.-]+;base64,/i, ''))) return false;
  if (/^data:image\/[a-z+.-]+;base64,[a-z0-9+/=]+$/i.test(t)) return true;
  if (/^https:\/\/[^/]/i.test(t)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(t) && !t.startsWith('//');
}

// a bare word in a `background` shorthand is a colour name unless it is one of the layer keywords
const LAYER_KEYWORDS = new Set(
  'center top bottom left right cover contain no-repeat repeat repeat-x repeat-y space round fixed scroll local border-box padding-box content-box auto text none'.split(
    ' '
  )
);
const NAMED_COLOUR_RE = {
  test: (t: string) => /^[a-z]+$/i.test(t) && !LAYER_KEYWORDS.has(t.toLowerCase()),
};

/** One background layer (from the shorthand or `background-image`) into the layers/colour it carries. */
function takeLayer(raw: string, into: { color: string | null; layers: Layer[] }) {
  for (const t of words(raw)) {
    const url = URL_RE.exec(t);
    if (url) into.layers.push({ kind: 'image', url: url[2] });
    else if (GRADIENT_RE.test(t)) into.layers.push({ kind: 'gradient', css: t });
    else if (isColourToken(t) || NAMED_COLOUR_RE.test(t)) into.color = t;
  }
}

export function fillFromCss(css: Record<string, string>): FillWords {
  const acc: { color: string | null; layers: Layer[] } = { color: null, layers: [] };
  const sh = css.background?.trim();
  if (sh && !/^(none|initial|inherit|unset)$/i.test(sh)) {
    const parts = commas(sh);
    for (const p of parts) takeLayer(p, acc);
  }
  // longhands, when authored, replace what the shorthand said for their part
  const img = css['background-image']?.trim();
  if (img !== undefined && img !== '') {
    acc.layers = [];
    if (!/^none$/i.test(img))
      for (const p of commas(img)) takeLayer(p, { color: null, layers: acc.layers });
  }
  const bc = css['background-color']?.trim();
  if (bc !== undefined && bc !== '') acc.color = bc;
  const color =
    acc.color && !/^transparent$/i.test(acc.color) && !/^(initial|inherit|unset)$/i.test(acc.color)
      ? colourFromCss(acc.color)
      : null;
  return { color, layers: acc.layers };
}

const layerCss = (l: Layer) => (l.kind === 'image' ? `url("${l.url}")` : l.css);

export function fillToCss(f: FillWords): CssPatch {
  const colour = f.color ? colourToCss(f.color) : null;
  if (!f.layers.length) {
    return { background: colour, 'background-color': null, 'background-image': null };
  }
  const patch: CssPatch = {
    background: null,
    'background-color': colour,
    'background-image': f.layers.map(layerCss).join(', '),
  };
  if (f.layers.some((l) => l.kind === 'image')) {
    patch['background-size'] = 'cover';
    patch['background-position'] = 'center';
  }
  return patch;
}

/* ── corners ───────────────────────────────────────────────────────────────────────────────────────────────────── */

/** ↖ ↗ ↘ ↙ — CSS order. */
export interface CornerWords {
  tl: Length;
  tr: Length;
  br: Length;
  bl: Length;
  /** An elliptical `a / b` radius the corner controls cannot say; shown quietly until a corner is set. */
  exotic?: string;
}
export type Corner = 'tl' | 'tr' | 'br' | 'bl';
export const CORNERS: ReadonlyArray<Corner> = ['tl', 'tr', 'br', 'bl'];
const LONGHAND: Record<Corner, string> = {
  tl: 'border-top-left-radius',
  tr: 'border-top-right-radius',
  br: 'border-bottom-right-radius',
  bl: 'border-bottom-left-radius',
};

export function cornersFromCss(css: Record<string, string>, tokens?: DsTokens): CornerWords {
  const zero: Length = { px: 0 };
  let out: CornerWords = { tl: zero, tr: zero, br: zero, bl: zero };
  const raw = css['border-radius']?.trim();
  if (raw) {
    if (raw.includes('/')) {
      const whole = lengthFromCss(raw, tokens);
      out = { tl: whole, tr: whole, br: whole, bl: whole, exotic: raw };
    } else {
      const v = words(raw).map((x) => lengthFromCss(x, tokens));
      const [a, b = a, c = a, d = b] = v;
      if (a) out = { tl: a, tr: b, br: c, bl: d };
    }
  }
  for (const k of CORNERS) {
    const own = css[LONGHAND[k]]?.trim();
    if (own) out[k] = lengthFromCss(words(own)[0] ?? own, tokens);
  }
  return out;
}

const same = (a: Length, b: Length) => lengthToCss(a) === lengthToCss(b);
export const cornersLinked = (c: CornerWords) =>
  !c.exotic && same(c.tl, c.tr) && same(c.tl, c.br) && same(c.tl, c.bl);

export function cornersToCss(c: CornerWords): CssPatch {
  const none = Object.fromEntries(CORNERS.map((k) => [LONGHAND[k], null])) as CssPatch;
  const allZero = CORNERS.every((k) => lengthToCss(c[k]) === '0');
  if (allZero) return { 'border-radius': null, ...none };
  const value = cornersLinked(c)
    ? lengthToCss(c.tl)
    : [c.tl, c.tr, c.br, c.bl].map(lengthToCss).join(' ');
  return { 'border-radius': value, ...none };
}

/**
 * One corner on its own — for several objects whose other corners differ and must stay as they are. A longhand written
 * after the shorthand wins; `cornersToCss` (linking, or setting all four) clears the longhands again.
 */
export const cornerToCss = (k: Corner, len: Length): CssPatch => ({
  [LONGHAND[k]]: lengthToCss(len),
});

/** The system's own label for a token of a family: `--radius-md` is "MD", `--shadow-resting` is "Resting". */
export function systemName(token: string, family: string): string {
  const rest = token.replace(/^--/, '').replace(new RegExp(`^${family}-?`), '') || family;
  const w = rest.replace(/-/g, ' ');
  if (/^(?:xxs|xs|s|sm|m|md|l|lg|xl|xxl|\dxl)$/i.test(w)) return w.toUpperCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/* ── border and shadow share box-shadow ────────────────────────────────────────────────────────────────────────── */

const RING_RE = /^inset\s+0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+(\d*\.?\d+)(?:px)?\s+(.+)$/i;

/** `box-shadow` split into the border ring (`inset 0 0 0 W C`, first) and the rest (the elevation). */
function splitShadow(raw: string | undefined): {
  ring: { width: number; color: string } | null;
  rest: string[];
} {
  const layers = raw && !/^none$/i.test(raw.trim()) ? commas(raw) : [];
  const i = layers.findIndex((l) => RING_RE.test(l));
  if (i < 0) return { ring: null, rest: layers };
  const m = RING_RE.exec(layers[i]) as RegExpExecArray;
  return {
    ring: { width: Number.parseFloat(m[1]), color: m[2].trim() },
    rest: layers.filter((_, j) => j !== i),
  };
}
const joinShadow = (ring: string | null, rest: string[]): string | null => {
  const all = [...(ring ? [ring] : []), ...rest];
  return all.length ? all.join(', ') : null;
};

/* ── border ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export type BorderPosition = 'inside' | 'centre' | 'outside';
export interface BorderWords {
  color: Paint;
  /** px */
  width: number;
  position: BorderPosition;
  /** The file wrote a plain CSS `border` (reads as Inside); keep writing that until the position changes. */
  via?: 'border';
  /** Not solid (dashed, dotted): kept as it is. */
  style?: string;
}

const pxNum = (s: string | undefined): number | null => {
  const m = /^(-?\d*\.?\d+)(?:px)?$/i.exec((s ?? '').trim());
  return m ? Number.parseFloat(m[1]) : null;
};
const BORDER_STYLES = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
]);

function lineFromShorthand(raw: string): { width: number; style: string; color: Paint } | null {
  if (/^(none|0|initial|inherit|unset)$/i.test(raw.trim())) return null;
  let width: number | null = null;
  let style = 'solid';
  let color: Paint = { css: 'currentColor' };
  for (const t of words(raw)) {
    const n = pxNum(t);
    if (n !== null) width = n;
    else if (BORDER_STYLES.has(t.toLowerCase())) style = t.toLowerCase();
    else if (isColourToken(t)) color = paintFromCss(t);
  }
  return width && width > 0 ? { width, style, color } : null;
}

export function borderFromCss(css: Record<string, string>): BorderWords | null {
  let line = css.border ? lineFromShorthand(css.border) : null;
  if (!line && (css['border-width'] || css['border-color'] || css['border-style'])) {
    line = lineFromShorthand(
      [css['border-width'], css['border-style'] ?? 'solid', css['border-color']]
        .filter(Boolean)
        .join(' ')
    );
  }
  if (line) {
    return {
      color: line.color,
      width: line.width,
      position: 'inside',
      via: 'border',
      ...(line.style === 'solid' ? {} : { style: line.style }),
    };
  }
  const { ring } = splitShadow(css['box-shadow']);
  if (ring) return { color: paintFromCss(ring.color), width: ring.width, position: 'inside' };
  const out = css.outline ? lineFromShorthand(css.outline) : null;
  if (out) {
    const off = pxNum(css['outline-offset']) ?? 0;
    const centre = out.width > 0 && Math.abs(off + out.width / 2) < 0.01;
    return {
      color: out.color,
      width: out.width,
      position: centre ? 'centre' : 'outside',
      ...(out.style === 'solid' ? {} : { style: out.style }),
    };
  }
  return null;
}

const BORDER_KEYS = [
  'border',
  'border-width',
  'border-style',
  'border-color',
  'outline',
  'outline-offset',
];

/**
 * @param cur the element's current `box-shadow`, so the ring and the elevation are composed, not overwritten.
 * `b === null` removes the border (and only the border) from all three places.
 */
export function borderToCss(b: BorderWords | null, cur?: string): CssPatch {
  const { rest } = splitShadow(cur);
  const patch: CssPatch = Object.fromEntries(BORDER_KEYS.map((k) => [k, null]));
  if (!b) return { ...patch, 'box-shadow': joinShadow(null, rest) };
  const color = paintToCss(b.color);
  const style = b.style ?? 'solid';
  const w = fmtPx(b.width);
  if (b.position === 'inside' && b.via === 'border') {
    return { ...patch, border: `${w} ${style} ${color}`, 'box-shadow': joinShadow(null, rest) };
  }
  if (b.position === 'inside') {
    return { ...patch, 'box-shadow': joinShadow(`inset 0 0 0 ${w} ${color}`, rest) };
  }
  return {
    ...patch,
    outline: `${w} ${style} ${color}`,
    'outline-offset': b.position === 'centre' ? fmtPx(-b.width / 2) : null,
    'box-shadow': joinShadow(null, rest),
  };
}

/* ── stroke (lines and Pen paths call it Stroke) ───────────────────────────────────────────────────────────────── */

export interface StrokeWords {
  color: Paint;
  width: number;
}
export function strokeFromCss(css: Record<string, string>): StrokeWords | null {
  const s = css.stroke?.trim();
  if (!s || /^none$/i.test(s)) return null;
  return { color: paintFromCss(s), width: pxNum(css['stroke-width']) ?? 1 };
}
export function strokeToCss(s: StrokeWords | null): CssPatch {
  if (!s) return { stroke: null, 'stroke-width': null };
  return { stroke: paintToCss(s.color), 'stroke-width': fmtPx(s.width) };
}
const STROKE_TAGS = new Set(['line', 'path', 'polyline']);
/** Lines and Pen paths: the SVG elements whose outline is a stroke. */
export const isStrokeTag = (tag: string | undefined) => STROKE_TAGS.has((tag ?? '').toLowerCase());

/* ── effects: elevation and opacity ────────────────────────────────────────────────────────────────────────────── */

/** Flat, one of the system's own shadow tokens, or a shadow the words cannot name. */
export type Elevation = 'flat' | { token: string } | { css: string };

export function elevationFromCss(css: Record<string, string>): Elevation {
  const { rest } = splitShadow(css['box-shadow']);
  if (!rest.length) return 'flat';
  const one = rest.length === 1 ? VAR_RE.exec(rest[0]) : null;
  return one ? { token: one[1] } : { css: rest.join(', ') };
}

/** `box-shadow` for this elevation, keeping the border ring the element already has. */
export function elevationToCss(e: Elevation, cur?: string): CssPatch {
  const { ring } = splitShadow(cur);
  const ringCss = ring ? `inset 0 0 0 ${fmtPx(ring.width)} ${ring.color}` : null;
  const layer = e === 'flat' ? [] : 'token' in e ? [`var(${e.token})`] : commas(e.css);
  return { 'box-shadow': joinShadow(ringCss, layer) };
}

/** The Shadow segment: Flat, then the system's own `--shadow-*` names in the order it declares them. */
export function elevationOptions(
  shadowTokens: ReadonlyArray<string>
): Array<{ value: string; label: string }> {
  return [
    { value: 'flat', label: 'Flat' },
    ...shadowTokens.map((t) => ({ value: t, label: systemName(t, 'shadow') })),
  ];
}

export const opacityFromCss = (css: Record<string, string>): number => {
  const n = Number.parseFloat(css.opacity ?? '');
  return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(1, n)) * 1000) / 10 : 100;
};
export const opacityToCss = (percent: number): CssPatch => ({
  opacity: percent >= 100 ? null : fmtNum(Math.max(0, percent) / 100),
});

/* ── type (the text inside) ────────────────────────────────────────────────────────────────────────────────────── */

export interface TypeWords {
  size: Length | null;
  weight: number | null;
  color: Colour | null;
}
const WEIGHT_WORDS: Record<string, number> = { normal: 400, bold: 700 };

export function typeFromCss(css: Record<string, string>, tokens?: DsTokens): TypeWords {
  const w = (css['font-weight'] ?? '').trim().toLowerCase();
  const weight = WEIGHT_WORDS[w] ?? (/^\d{3}$/.test(w) ? Number.parseInt(w, 10) : null);
  return {
    size: css['font-size'] ? lengthFromCss(css['font-size'], tokens) : null,
    weight,
    color: css.color ? colourFromCss(css.color) : null,
  };
}
export function typeToCss(t: Partial<TypeWords>): CssPatch {
  const patch: CssPatch = {};
  if ('size' in t) patch['font-size'] = t.size ? lengthToCss(t.size) : null;
  if ('weight' in t) patch['font-weight'] = t.weight ? String(t.weight) : null;
  if ('color' in t) patch.color = t.color ? colourToCss(t.color) : null;
  return patch;
}

/* ── several objects: Mixed ────────────────────────────────────────────────────────────────────────────────────── */

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x
  );

export type Reduced<T> = { mixed: false; value: T } | { mixed: true; values: T[] };

/** What several objects share: the one value, or "Mixed" with the distinct values (in the order first seen). */
export function reduceMixed<T>(values: ReadonlyArray<T>): Reduced<T> {
  const seen = new Map<string, T>();
  for (const v of values) if (!seen.has(stable(v))) seen.set(stable(v), v);
  if (seen.size <= 1) return { mixed: false, value: values[0] as T };
  return { mixed: true, values: [...seen.values()] };
}
