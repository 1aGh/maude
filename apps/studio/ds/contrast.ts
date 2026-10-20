// ds/contrast.ts — S10.7 (S10 Q10): the contrast pairs of a design system, as a RULE over registry names,
// plus the value resolver that reads `var()`, `color-mix()`, `oklch()`, `hsl()`, `rgb()` and hex, and
// "Dark follows" (the editor recomputes Dark when Light moves).
//
// PURE and node-free: the same file is bundled into the inspector (client/v2/ds/contrast.js) and run by
// `check-system` (S10.17). The maths is `draw/palette.ts` (WCAG relative luminance, OKLCH ↔ sRGB). Alpha is
// ignored: a translucent colour is judged as if opaque, which is the safe side for a swatch editor and is
// never used by a pair below.
//
// A pair is `fg` on `bg` and the bar it has to clear:
//   --fg-0..2 on --bg-0..4                          4.5
//   --fg-3 on --bg-0..4                             3   (quiet text)
//   --accent-fg on --accent                         4.5
//   --accent-on-soft on --accent-soft               4.5
//   --accent-text on --bg-0, --bg-1                 4.5
//   --status-X-fg on --status-X                     4.5
//   --status-X-text on --status-X-soft, --bg-0      4.5
// Only names the system really declares take part (`known`).

import {
  contrastRatio,
  type Oklch,
  oklchToHex,
  oklchToRgb,
  type Rgb,
  rgbToOklch,
  toHex,
} from '../draw/palette.ts';

export interface ContrastPair {
  fg: string;
  bg: string;
  /** the ratio it has to reach */
  need: number;
}

export interface PairResult extends ContrastPair {
  /** null when a side does not resolve to a plain colour (a gradient, a missing token, a cycle) */
  ratio: number | null;
  pass: boolean | null;
}

/** css name → its value text in ONE theme */
export type ThemeValues = Readonly<Record<string, string>>;

const AA = 4.5;
const QUIET = 3;
const STATUS = ['error', 'info', 'success', 'warn', 'warning'] as const;

/** Every pair the rule names, whatever the system declares. */
function rulePairs(): ContrastPair[] {
  const out: ContrastPair[] = [];
  for (const f of [0, 1, 2])
    for (const b of [0, 1, 2, 3, 4]) out.push({ fg: `--fg-${f}`, bg: `--bg-${b}`, need: AA });
  for (const b of [0, 1, 2, 3, 4]) out.push({ fg: '--fg-3', bg: `--bg-${b}`, need: QUIET });
  out.push({ fg: '--accent-fg', bg: '--accent', need: AA });
  out.push({ fg: '--accent-on-soft', bg: '--accent-soft', need: AA });
  out.push({ fg: '--accent-text', bg: '--bg-0', need: AA });
  out.push({ fg: '--accent-text', bg: '--bg-1', need: AA });
  for (const s of STATUS) {
    out.push({ fg: `--status-${s}-fg`, bg: `--status-${s}`, need: AA });
    out.push({ fg: `--status-${s}-text`, bg: `--status-${s}-soft`, need: AA });
    out.push({ fg: `--status-${s}-text`, bg: '--bg-0', need: AA });
  }
  return out;
}

const RULE = rulePairs();

/** The pairs among names the system declares (`known`), or every rule pair without `known`. */
export function allPairs(known?: ReadonlySet<string>): ContrastPair[] {
  return known ? RULE.filter((p) => known.has(p.fg) && known.has(p.bg)) : [...RULE];
}

/** The pairs `css` takes part in — as the text or as the surface it sits on. */
export function pairsOf(css: string, known?: ReadonlySet<string>): ContrastPair[] {
  return allPairs(known).filter((p) => p.fg === css || p.bg === css);
}

/* ---------------------------------------------------------------- resolving */

const NAMED: Record<string, Rgb> = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Split on top-level commas / spaces of a function body. */
function args(body: string, sep: ',' | ' '): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function inner(v: string, fn: string): string | null {
  const m = new RegExp(`^${fn}\\(([\\s\\S]*)\\)$`, 'i').exec(v.trim());
  return m ? m[1] : null;
}

const num = (s: string, pct = 1): number =>
  s.endsWith('%') ? (Number(s.slice(0, -1)) / 100) * pct : Number(s);

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function mixOklch(a: Rgb, b: Rgb, wa: number, space: string): Rgb {
  const wb = 1 - wa;
  if (space === 'srgb') {
    return {
      r: Math.round(a.r * wa + b.r * wb),
      g: Math.round(a.g * wa + b.g * wb),
      b: Math.round(a.b * wa + b.b * wb),
    };
  }
  const x = rgbToOklch(a);
  const y = rgbToOklch(b);
  if (space === 'oklab') {
    const ax = x.c * Math.cos((x.h * Math.PI) / 180);
    const ay = x.c * Math.sin((x.h * Math.PI) / 180);
    const bx = y.c * Math.cos((y.h * Math.PI) / 180);
    const by = y.c * Math.sin((y.h * Math.PI) / 180);
    const mx = ax * wa + bx * wb;
    const my = ay * wa + by * wb;
    return oklchToRgb({
      l: x.l * wa + y.l * wb,
      c: Math.hypot(mx, my),
      h: ((Math.atan2(my, mx) * 180) / Math.PI + 360) % 360,
    });
  }
  // oklch: the shorter hue arc; a grey side takes the other side's hue
  let hx = x.h;
  let hy = y.h;
  if (x.c < 0.004) hx = hy;
  if (y.c < 0.004) hy = hx;
  let d = hy - hx;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return oklchToRgb({
    l: x.l * wa + y.l * wb,
    c: x.c * wa + y.c * wb,
    h: (hx + d * wb + 360) % 360,
  });
}

/**
 * A CSS colour value → sRGB, or null when it is not one plain colour. `lookup` answers `var(--name)` with
 * that token's value text IN THE SAME THEME. Depth-limited, so an alias cycle ends as null.
 */
export function resolveColour(
  value: string | undefined | null,
  lookup: (css: string) => string | undefined,
  depth = 0
): Rgb | null {
  if (typeof value !== 'string' || depth > 8) return null;
  const v = value.trim();
  if (!v) return null;
  const low = v.toLowerCase();
  if (NAMED[low]) return NAMED[low];
  if (low === 'transparent' || low === 'currentcolor' || low === 'inherit') return null;
  if (v.startsWith('#')) {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  const va = inner(v, 'var');
  if (va !== null) {
    const [name, ...fallback] = args(va, ',');
    const hit = name ? lookup(name) : undefined;
    const got = hit !== undefined ? resolveColour(hit, lookup, depth + 1) : null;
    if (got) return got;
    return fallback.length ? resolveColour(fallback.join(','), lookup, depth + 1) : null;
  }
  const ok = inner(v, 'oklch');
  if (ok !== null) {
    const [l, c, h] = args(ok.split('/')[0], ' ');
    if (!l || !c || !h) return null;
    const o: Oklch = { l: num(l), c: num(c, 0.4), h: Number.parseFloat(h) };
    return [o.l, o.c, o.h].some(Number.isNaN) ? null : oklchToRgb(o);
  }
  const rgb = inner(v, 'rgba?');
  if (rgb !== null) {
    const parts = args(rgb.split('/')[0].replace(/,/g, ' '), ' ');
    if (parts.length < 3) return null;
    const ch = parts
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? (Number.parseFloat(p) / 100) * 255 : Number(p)));
    return ch.some(Number.isNaN)
      ? null
      : {
          r: clamp(Math.round(ch[0]), 0, 255),
          g: clamp(Math.round(ch[1]), 0, 255),
          b: clamp(Math.round(ch[2]), 0, 255),
        };
  }
  const hsl = inner(v, 'hsla?');
  if (hsl !== null) {
    const parts = args(hsl.split('/')[0].replace(/,/g, ' '), ' ');
    if (parts.length < 3) return null;
    const h = Number.parseFloat(parts[0]);
    const s = num(parts[1]);
    const l = num(parts[2]);
    return [h, s, l].some(Number.isNaN) ? null : hslToRgb(((h % 360) + 360) % 360, s, l);
  }
  const mix = inner(v, 'color-mix');
  if (mix !== null) {
    const [head, ...sides] = args(mix, ',');
    const sp = /^in\s+(srgb|oklab|oklch)/i.exec(head ?? '');
    if (!sp || sides.length !== 2) return null;
    const side = (s: string) => {
      const m = /^([\s\S]*?)(?:\s+([\d.]+)%)?$/.exec(s.trim());
      return { color: (m?.[1] ?? '').trim(), pct: m?.[2] !== undefined ? Number(m[2]) : null };
    };
    const [a, b] = [side(sides[0]), side(sides[1])];
    let pa = a.pct;
    let pb = b.pct;
    if (pa === null && pb === null) {
      pa = 50;
      pb = 50;
    } else if (pa === null) pa = 100 - (pb as number);
    else if (pb === null) pb = 100 - pa;
    const total = (pa as number) + (pb as number);
    if (!(total > 0)) return null;
    const ca = resolveColour(a.color, lookup, depth + 1);
    const cb = resolveColour(b.color, lookup, depth + 1);
    if (!ca || !cb) return null;
    return mixOklch(ca, cb, (pa as number) / total, sp[1].toLowerCase());
  }
  return null;
}

/* ------------------------------------------------------------------ pairs */

/** One pair, judged in one theme's values. */
export function judge(pair: ContrastPair, values: ThemeValues): PairResult {
  const lookup = (name: string) => values[name];
  const fg = resolveColour(values[pair.fg], lookup);
  const bg = resolveColour(values[pair.bg], lookup);
  if (!fg || !bg) return { ...pair, ratio: null, pass: null };
  const ratio = contrastRatio(fg, bg);
  return { ...pair, ratio, pass: ratio + 1e-9 >= pair.need };
}

/** The pairs `css` takes part in, judged in `values` (one theme's whole token → value map). */
export function contrastOf(css: string, values: ThemeValues): PairResult[] {
  const known = new Set(Object.keys(values));
  return pairsOf(css, known).map((p) => judge(p, values));
}

/** Every pair of the system in one theme — the matrix `check-system` (S10.17) prints. */
export function contrastMatrix(values: ThemeValues): PairResult[] {
  const known = new Set(Object.keys(values));
  return allPairs(known).map((p) => judge(p, values));
}

/** "5.6:1" — one decimal, never rounded up over the bar it missed (4.46 reads 4.4, not 4.5). */
export function ratioWords(ratio: number): string {
  return `${Math.floor(ratio * 10 + 1e-9) / 10}:1`;
}

/* ------------------------------------------------------------ the fix (S10.17) */

export interface ContrastFix {
  css: string;
  /** the value to write: the same colour, only its lightness moved */
  value: string;
  direction: 'lighten' | 'darken';
  /** the lowest ratio over the token's pairs once the value is in */
  ratio: number;
  /** the lightness before and after (OKLCH L, 0..1) */
  l: { from: number; to: number };
}

const L_STEP = 0.01;

/** `oklch(L C H)` written in a value, read as written (no gamut round trip), or null. */
function oklchOfText(text: string | undefined): Oklch | null {
  const body = text === undefined ? null : inner(text, 'oklch');
  if (body === null) return null;
  const [l, c, h] = args(body.split('/')[0], ' ');
  if (!l || !c || !h) return null;
  const o: Oklch = { l: num(l), c: num(c, 0.4), h: Number.parseFloat(h) };
  return [o.l, o.c, o.h].some(Number.isNaN) ? null : o;
}

/**
 * "Lighten to 4.5:1" (13 · ds-edge-contrast): the smallest change of OKLCH LIGHTNESS to `css` in one theme (`values`
 * is that theme's whole token → value map) that makes every pair it takes part in clear its bar — and keeps the pairs
 * that already did. Chroma and hue are not touched: an `oklch()` value is written back with its own C and H; a hex
 * or an alias comes back as the colour it resolves to, in the form it was written. One search, no loop: the value
 * it returns has been judged here, in the text that would be saved.
 *
 * null when nothing needs fixing, when the token is not one plain colour, or when no lightness satisfies every pair
 * (a text colour between a dark and a light surface) — then the person picks.
 */
export function fixContrast(css: string, values: ThemeValues): ContrastFix | null {
  const known = new Set(Object.keys(values));
  const pairs = pairsOf(css, known);
  if (!pairs.length) return null;
  const lookup = (name: string) => values[name];
  const cur = values[css];
  const rgb = resolveColour(cur, lookup);
  if (!rgb) return null;
  if (!pairs.some((p) => judge(p, values).pass === false)) return null;

  // an alias is fixed as the colour it names, written in that colour's own form
  let written = cur;
  for (let i = 0; i < 8 && written !== undefined; i++) {
    const va = inner(written, 'var');
    if (va === null) break;
    written = lookup(args(va, ',')[0] ?? '') ?? written;
    if (written === cur) break;
  }
  const direct = oklchOfText(written);
  const o: Oklch = direct ?? rgbToOklch(rgb);
  const asOklch = direct !== null;
  const write = (l: number): string =>
    asOklch ? oklchText({ l, c: o.c, h: o.h }) : oklchToHex({ l, c: o.c, h: o.h });
  const judged = (value: string) => pairs.map((p) => judge(p, { ...values, [css]: value }));

  let best: { value: string; steps: number; dir: 1 | -1; l: number } | null = null;
  for (const dir of [1, -1] as const) {
    for (let k = 1; k <= Math.round(1 / L_STEP); k++) {
      const l = o.l + dir * k * L_STEP;
      if (l < 0 || l > 1) break;
      const value = write(l);
      if (judged(value).every((r) => r.pass !== false)) {
        if (!best || k < best.steps) best = { value, steps: k, dir, l };
        break;
      }
    }
  }
  if (!best) return null;
  const after = judged(best.value);
  const ratios = after.map((r) => r.ratio).filter((r): r is number => r !== null);
  return {
    css,
    value: best.value,
    direction: best.dir === 1 ? 'lighten' : 'darken',
    ratio: ratios.length ? Math.min(...ratios) : 0,
    l: { from: o.l, to: best.l },
  };
}

/* ------------------------------------------------------------ dark follows */

const fmt = (n: number, d: number) => Number(n.toFixed(d)).toString();

/** `oklch(0.50 0.19 255)` in the house style: L two decimals, C three, H whole degrees. */
export function oklchText(o: Oklch): string {
  const l = clamp(o.l, 0, 1);
  const c = Math.max(0, o.c);
  return `oklch(${l.toFixed(2)} ${c.toFixed(3)} ${fmt(((o.h % 360) + 360) % 360, 0)})`;
}

/** A colour written the way `like` is written (oklch → oklch, hex → hex, anything else → hex). */
export function formatLike(rgb: Rgb, like: string | undefined | null): string {
  if (typeof like === 'string' && /^\s*oklch\(/i.test(like)) return oklchText(rgbToOklch(rgb));
  return toHex(rgb);
}

const noLookup = () => undefined;
const toOklch = (v: string | null | undefined): Oklch | null => {
  const rgb = resolveColour(v, noLookup);
  return rgb ? rgbToOklch(rgb) : null;
};
const hueGap = (a: number, b: number): number => {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/**
 * "Dark follows": the Dark value for a new Light value. With a Dark already there, the NEW pair keeps the
 * OLD pair's relation (lightness gap, chroma ratio, hue turn) — so a deeper azure in Light is a deeper azure
 * in Dark and a person's tuned pair keeps its character. Without one, a neutral is mirrored and a colour is
 * lifted one step. null when a side is not a plain colour (Dark is then left alone).
 */
export function followDark(
  prev: { light?: string | null; dark?: string | null },
  nextLight: string
): string | null {
  const next = toOklch(nextLight);
  if (!next) return null;
  const pl = toOklch(prev.light);
  const pd = toOklch(prev.dark);
  let out: Oklch;
  if (pl && pd) {
    out = {
      l: next.l + (pd.l - pl.l),
      c: pl.c > 0.005 ? next.c * (pd.c / pl.c) : next.c + (pd.c - pl.c),
      h: next.h + (pl.c > 0.005 && pd.c > 0.005 ? hueGap(pl.h, pd.h) : 0),
    };
  } else if (next.c < 0.03) {
    out = { l: 1 - next.l, c: next.c, h: next.h };
  } else {
    out = { l: next.l + 0.1, c: next.c * 0.92, h: next.h };
  }
  out = { l: clamp(out.l, 0.05, 0.98), c: clamp(out.c, 0, 0.4), h: out.h };
  const like = prev.dark ?? prev.light ?? nextLight;
  return /^\s*oklch\(/i.test(like) ? oklchText(out) : oklchToHex(out);
}
