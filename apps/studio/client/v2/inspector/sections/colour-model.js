// client/v2/inspector/sections/colour-model.js — r4 #4 (Michal: "color picker bych udelal jak ma Figma"): the maths and
// the words behind the Figma-style colour popover. Pure — no DOM, no React, no fetch.
//
//   colours      parseRgba / rgbaCss / hex + HSV conversions; a colour may be a token (`var(--ink, #14181f)`), a
//                `color-mix(… N%, transparent)` or any CSS colour `rgbOf` reads
//   gradients    parseGradient / gradientCss: linear · radial · conic with stops as `{ color, pos }`; stop edits
//   the fill     kindOfFill / switchKind: the paint-kind tabs (Solid · Gradient · Image) say what the fill IS
//   the page     coloursInSource: the colours a canvas's own code uses ("On this page")

import { isCssColor } from '../../../../edit-ops/words-paint.ts';
import { rgbOf } from './colour-words.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const r2 = (n) => Math.round(n * 100) / 100;
const r1 = (n) => Math.round(n * 10) / 10;

/* ── colours ─────────────────────────────────────────────────────────────────────────────────────────────────── */

const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };

/** Split at top-level commas (or spaces), never inside `(…)`. */
export function splitTop(s, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(s)) {
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

const alphaOf = (raw) => {
  if (raw == null) return 1;
  const t = String(raw).trim();
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return 1;
  return clamp(t.endsWith('%') ? n / 100 : n, 0, 1);
};

/**
 * A CSS colour → `{ r, g, b, a }` (0–255, a 0–1), or null for anything this does not read. `vals` resolves tokens
 * (`var(--ink)` → the system's value); a token's own fallback is used when the system does not name it.
 */
export function parseRgba(css, vals = {}, depth = 0) {
  const t = String(css ?? '')
    .trim()
    .toLowerCase();
  if (!t || depth > 4) return null;
  if (NAMED[t]) return { r: NAMED[t][0], g: NAMED[t][1], b: NAMED[t][2], a: NAMED[t][3] };
  let m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*(.*?))?\s*\)$/.exec(t);
  if (m) {
    const named = vals[m[1]] ?? vals[m[1].toLowerCase()];
    return parseRgba(named ?? m[2], vals, depth + 1);
  }
  m = /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/.exec(t);
  if (m) {
    const base = parseRgba(m[1], vals, depth + 1);
    return base ? { ...base, a: r2(base.a * (Number.parseFloat(m[2]) / 100)) } : null;
  }
  m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const [r, g, b] = [0, 1, 2].map((i) => Number.parseInt(h[i] + h[i], 16));
      return { r, g, b, a: h.length === 4 ? r2(Number.parseInt(h[3] + h[3], 16) / 255) : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
      return { r, g, b, a: h.length === 8 ? r2(Number.parseInt(h.slice(6, 8), 16) / 255) : 1 };
    }
    return null;
  }
  m = /^(?:rgba?|oklch)\(\s*([^)]+)\)$/.exec(t);
  if (m) {
    const rgb = rgbOf(t);
    if (!rgb) return null;
    const inner = m[1];
    const slash = /\/\s*([\d.]+%?)\s*$/.exec(inner);
    const parts = inner
      .replace(/\/.*$/, '')
      .trim()
      .split(/[\s,]+/);
    const a = slash
      ? alphaOf(slash[1])
      : t.startsWith('rgb') && parts.length >= 4
        ? alphaOf(parts[3])
        : 1;
    return { r: rgb[0], g: rgb[1], b: rgb[2], a };
  }
  return null;
}

const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/** `{ r, g, b }` → `#rrggbb` (upper case, no `#`, is what the Hex field shows: see `hexDigits`). */
export const rgbToHex = ({ r, g, b }) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
export const hexDigits = (c) => rgbToHex(c).slice(1).toUpperCase();

/** `{ r, g, b, a }` → the CSS that says it: `#rrggbb`, or `rgba(r, g, b, a)` below full opacity. */
export function rgbaCss({ r, g, b, a = 1 }) {
  if (a >= 1) return rgbToHex({ r, g, b });
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${r2(clamp(a, 0, 1))})`;
}

/** What a person types in the Hex field → `{ r, g, b, a? }`, or null. `1E6BFF`, `#1e6bff`, `1e6`, `1E6BFF80` all work. */
export function parseHexInput(text) {
  const t = String(text ?? '')
    .trim()
    .replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return null;
  const c = parseRgba(`#${t}`);
  if (!c) return null;
  return t.length === 4 || t.length === 8 ? c : { r: c.r, g: c.g, b: c.b };
}

/* HSV: h 0–360, s and v 0–1 */
export function rgbToHsv({ r, g, b }) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [R, G, B] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor((((h % 360) + 360) % 360) / 60) % 6];
  return {
    r: Math.round((R + m) * 255),
    g: Math.round((G + m) * 255),
    b: Math.round((B + m) * 255),
  };
}

/** `{ r, g, b }` → `{ h, s, l }` (h 0–360, s and l 0–100) and back, for the HSL fields. */
export function rgbToHsl({ r, g, b }) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return { h: rgbToHsv({ r, g, b }).h, s: s * 100, l: l * 100 };
}
export function hslToRgb({ h, s, l }) {
  const S = s / 100;
  const L = l / 100;
  const v = L + S * Math.min(L, 1 - L);
  return hsvToRgb({ h, s: v ? 2 * (1 - L / v) : 0, v });
}

/** The colour halfway (or `t` of the way) between two CSS colours; the nearer one when either is not readable. */
export function lerpColour(a, b, t, vals = {}) {
  const A = parseRgba(a, vals);
  const B = parseRgba(b, vals);
  if (!A || !B) return t < 0.5 ? a : b;
  const mix = (x, y) => x + (y - x) * t;
  return rgbaCss({ r: mix(A.r, B.r), g: mix(A.g, B.g), b: mix(A.b, B.b), a: r2(mix(A.a, B.a)) });
}

/* ── gradients ───────────────────────────────────────────────────────────────────────────────────────────────── */

const SIDE = { top: 0, right: 90, bottom: 180, left: 270 };
const CORNER = { 'top right': 45, 'bottom right': 135, 'bottom left': 225, 'top left': 315 };
export const GRADIENT_TYPES = ['linear', 'radial', 'conic'];
export const GRADIENT_WORDS = { linear: 'Linear', radial: 'Radial', conic: 'Angular' };

const KEYWORDS = /^(?:to|from|at|circle|ellipse|closest|farthest|top|bottom|left|right|center)$/i;

function parseStop(raw) {
  const w = splitTop(raw, ' ');
  if (!w.length) return null;
  let pos = null;
  if (w.length >= 2) {
    const last = w[w.length - 1];
    if (!/^-?[\d.]+%$/.test(last)) {
      // `4px`, `0.25turn`, `red 10% 40%` — a stop this picker does not own
      if (/^-?[\d.]+[a-z]+$/i.test(last) || w.length > 2) return null;
    } else {
      pos = Number.parseFloat(last);
      w.pop();
      if (w.length >= 2 && /^-?[\d.]+%$/.test(w[w.length - 1])) return null; // two positions
    }
  }
  const color = w.join(' ');
  const word = /^[a-z]+$/i.test(color) && !KEYWORDS.test(color); // a named colour: `red`
  if (!color || (!color.includes('(') && !isCssColor(color) && !word)) return null;
  return { color, pos };
}

/** CSS gradient → `{ type, angle, shape, stops: [{ color, pos }] }` (pos a number 0–100), or null when it is not one this edits. */
export function parseGradient(css) {
  const m = /^(linear|radial|conic)-gradient\(([\s\S]*)\)$/i.exec(String(css ?? '').trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  const parts = splitTop(m[2], ',');
  if (parts.length < 2) return null;
  let angle = type === 'linear' ? 180 : 0;
  let shape = 'circle';
  let head = null;
  if (
    parseStop(parts[0]) === null ||
    /^(?:to |from |circle|ellipse|closest|farthest|at )/i.test(parts[0])
  )
    head = parts.shift();
  if (head) {
    if (type === 'linear') {
      const deg = /^(-?[\d.]+)deg$/i.exec(head);
      const to = /^to\s+(.+)$/i.exec(head);
      if (deg) angle = Number.parseFloat(deg[1]);
      else if (to) {
        const k = to[1].trim().toLowerCase().replace(/\s+/g, ' ');
        angle = SIDE[k] ?? CORNER[k] ?? CORNER[k.split(' ').reverse().join(' ')] ?? null;
        if (angle == null) return null;
      } else return null;
    } else if (type === 'conic') {
      const from = /^from\s+(-?[\d.]+)deg(?:\s+at\s+.+)?$/i.exec(head);
      if (!from) return null;
      angle = Number.parseFloat(from[1]);
    } else {
      shape = head;
    }
  }
  const raw = parts.map(parseStop);
  if (raw.some((s) => !s) || raw.length < 2) return null;
  const stops = raw.map((s) => ({ color: s.color, pos: s.pos }));
  // CSS: a missing first/last is 0/100; the ones between are spread evenly between the neighbours that are set
  if (stops[0].pos == null) stops[0].pos = 0;
  if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 100;
  let i = 0;
  while (i < stops.length) {
    if (stops[i].pos != null) {
      i += 1;
      continue;
    }
    const lo = i - 1;
    let hi = i;
    while (stops[hi].pos == null) hi += 1;
    for (let k = i; k < hi; k += 1)
      stops[k].pos = r1(stops[lo].pos + ((stops[hi].pos - stops[lo].pos) * (k - lo)) / (hi - lo));
    i = hi + 1;
  }
  return { type, angle, shape, stops };
}

/** The gradient model → CSS. Stops are written in position order. */
export function gradientCss(g) {
  const stops = [...g.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.color} ${r1(clamp(s.pos, 0, 100))}%`)
    .join(', ');
  const head =
    g.type === 'linear'
      ? `${r1(g.angle)}deg`
      : g.type === 'conic'
        ? `from ${r1(g.angle)}deg`
        : g.shape || 'circle';
  return `${g.type}-gradient(${head}, ${stops})`;
}

/** A fresh two-stop gradient from one colour to another. */
export const newGradient = (type, from, to) => ({
  type,
  angle: type === 'linear' ? 180 : 0,
  shape: 'circle',
  stops: [
    { color: from, pos: 0 },
    { color: to, pos: 100 },
  ],
});

/** Add a stop at `pos` (a number 0–100) with the colour the gradient has there; returns `{ g, index }` (the new stop's index in position order). */
export function addStop(g, pos, vals = {}) {
  const sorted = [...g.stops].sort((a, b) => a.pos - b.pos);
  const at = clamp(pos, 0, 100);
  let lo = sorted[0];
  let hi = sorted[sorted.length - 1];
  for (const s of sorted) {
    if (s.pos <= at) lo = s;
    if (s.pos >= at) {
      hi = s;
      break;
    }
  }
  const t = hi.pos === lo.pos ? 0 : (at - lo.pos) / (hi.pos - lo.pos);
  const stop = { color: lerpColour(lo.color, hi.color, t, vals), pos: r1(at) };
  const stops = [...sorted, stop].sort((a, b) => a.pos - b.pos);
  return { g: { ...g, stops }, index: stops.indexOf(stop) };
}

/** The middle of the widest gap between stops — where "+" puts a new one. */
export function widestGap(g) {
  const s = [...g.stops].sort((a, b) => a.pos - b.pos);
  let best = { at: 50, w: -1 };
  for (let i = 0; i < s.length - 1; i += 1) {
    const w = s[i + 1].pos - s[i].pos;
    if (w > best.w) best = { at: (s[i].pos + s[i + 1].pos) / 2, w };
  }
  return best.at;
}

/** Remove stop `index` (a gradient keeps at least two). */
export function removeStop(g, index) {
  if (g.stops.length <= 2) return g;
  return { ...g, stops: g.stops.filter((_, i) => i !== index) };
}
/** Replace stop `index`'s colour and/or position. */
export const setStop = (g, index, patch) => ({
  ...g,
  stops: g.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)),
});
/** Mirror the stops (the first becomes the last). */
export const reverseStops = (g) => ({
  ...g,
  stops: g.stops.map((s) => ({ ...s, pos: r1(100 - s.pos) })),
});

/* ── the fill's kind ─────────────────────────────────────────────────────────────────────────────────────────── */

/** What the fill IS: the top layer's kind, or a solid colour. */
export const kindOfFill = (fill) => fill?.layers?.[0]?.kind ?? 'solid';

const cssOfPaint = (c, vals) => {
  if (!c) return null;
  const p = parseRgba(c.paint && 'token' in c.paint ? `var(${c.paint.token})` : c.paint?.css, vals);
  return p ? rgbaCss({ ...p, a: r2(p.a * (c.opacity / 100)) }) : null;
};

/**
 * Switch the fill to another paint kind (the tabs). The colour carries across: a solid becomes a gradient from that
 * colour to `end`; a gradient becomes the solid of its first stop. An image has nothing to carry (it is chosen after).
 * Pure; returns the new `{ color, layers }`.
 * @param {{ color: object|null, layers: object[] }} fill
 * @param {'solid'|'gradient'} kind
 * @param {{ vals?: Record<string,string>, start: string, end: string, type?: string }} o
 */
export function switchKind(fill, kind, { vals = {}, start, end, type = 'linear' }) {
  const cur = kindOfFill(fill);
  if (cur === kind) return fill;
  if (kind === 'solid') {
    if (fill.color) return { color: fill.color, layers: [] };
    const g = cur === 'gradient' ? parseGradient(fill.layers[0].css) : null;
    const c = g ? [...g.stops].sort((a, b) => a.pos - b.pos)[0].color : start;
    return { color: { paint: { css: c }, opacity: 100 }, layers: [] };
  }
  const from = fill.color ? (cssOfPaint(fill.color, vals) ?? start) : start;
  return {
    color: null,
    layers: [{ kind: 'gradient', css: gradientCss(newGradient(type, from, end)) }],
  };
}

/* ── the page ────────────────────────────────────────────────────────────────────────────────────────────────── */

const SRC_COLOUR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])|\b(?:rgba?|hsla?|oklch)\(\s*[-\d.%\s,/]+\)/g;

/**
 * The colours a canvas's own code uses, most used first ("On this page"). The source is untrusted text: only strings
 * `isCssColor` accepts come out, so a swatch can never carry anything but a colour.
 */
export function coloursInSource(source, max = 24) {
  const seen = new Map();
  let order = 0;
  for (const raw of String(source ?? '').match(SRC_COLOUR_RE) ?? []) {
    const c = raw.replace(/\s+/g, ' ').trim();
    const key = c.toLowerCase();
    if (!isCssColor(c)) continue;
    const hit = seen.get(key);
    if (hit) hit.n += 1;
    else seen.set(key, { css: key.startsWith('#') ? key : c, n: 1, order: order++ });
  }
  return [...seen.values()]
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, max)
    .map((x) => x.css);
}
