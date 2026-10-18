// _brand-colours.mjs — S8.18: a brand's colours, named and given a role ("Coral → Accent").
//
// Pure (no node:*, no DOM): the import route, `maude design import-brand --url` and the studio's
// brand sheet (client/v2/import) all import it, so the sheet, the agent and the CLI agree on which
// colour is the accent. Input values are already grammar-checked colours (DDR-173 Decision 1);
// output values are ALWAYS `#rrggbb` and names come from Maude's own list below — nothing a logo or
// a website wrote crosses this function as text.

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` → `#rrggbb`, or null. A fully
 *  transparent colour is null (it is not a brand colour). */
export function toHex(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const [r, g, b, a] = [...m[1]].map((c) => c + c);
    if (a === '00') return null;
    return `#${r}${g}${b}`;
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) return m[2] === '00' ? null : `#${m[1]}`;
  m =
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/.exec(
      v
    );
  if (m) {
    const ch = [m[1], m[2], m[3]].map(Number);
    if (ch.some((n) => n > 255)) return null;
    if (m[4] !== undefined && Number.parseFloat(m[4]) === 0) return null;
    return `#${ch.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** `#rrggbb` → OKLCH `{ L, C, h }` (L 0..1, h degrees). */
export function oklch(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = lin(((n >> 16) & 255) / 255);
  const g = lin(((n >> 8) & 255) / 255);
  const b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { L, C, h: h < 0 ? h + 360 : h, A, B };
}

function distance(x, y) {
  const p = oklch(x);
  const q = oklch(y);
  return Math.hypot(p.L - q.L, p.A - q.A, p.B - q.B);
}

/** Maude's own colour words. A brand colour is called by the nearest one. */
export const COLOUR_NAMES = Object.freeze([
  ['Coral', '#ff7f50'],
  ['Ink', '#1b1f2a'],
  ['Paper', '#f7f4ee'],
  ['Sky', '#7ec8e3'],
  ['Navy', '#1f2f5c'],
  ['Forest', '#2e5e3e'],
  ['Mint', '#a8e6cf'],
  ['Sand', '#d8c3a5'],
  ['Plum', '#6b3f6e'],
  ['Rose', '#e8a0a8'],
  ['Gold', '#d4a017'],
  ['Teal', '#2a9d8f'],
  ['Slate', '#6b7a8f'],
  ['Stone', '#a8a29e'],
  ['Cream', '#fff8e7'],
  ['Charcoal', '#36393f'],
  ['Lime', '#a3d65c'],
  ['Ocean', '#1f6f9f'],
  ['Berry', '#a23b5b'],
  ['Rust', '#b5502b'],
  ['Lilac', '#b9a6e0'],
  ['Olive', '#7a7a3a'],
  ['Snow', '#ffffff'],
  ['Night', '#0b0b0e'],
  ['Cherry', '#d7263d'],
  ['Tangerine', '#f28c28'],
  ['Lemon', '#f6d743'],
  ['Cobalt', '#2f6fed'],
  ['Violet', '#6c4ad8'],
  ['Fuchsia', '#f25c9a'],
  ['Leaf', '#3bb273'],
  ['Cocoa', '#6f4e37'],
  ['Mist', '#9ca3af'],
]);

export function colourName(hex) {
  let best = COLOUR_NAMES[0];
  let bestD = Number.POSITIVE_INFINITY;
  for (const entry of COLOUR_NAMES) {
    const d = distance(hex, entry[1]);
    if (d < bestD) {
      bestD = d;
      best = entry;
    }
  }
  return best[0];
}

export const ROLES = Object.freeze(['accent', 'text', 'background', 'second', 'none']);
export const ROLE_LABEL = Object.freeze({
  accent: 'Accent',
  text: 'Text',
  background: 'Background',
  second: 'Second colour',
  none: 'Not used',
});

const SAME = 0.04; // OKLab distance under which two colours are one
const MAX = 8;

/**
 * Merge the logo's colours (first — they are the brand) with the website's, drop near-duplicates,
 * name each, and give each a role. `logo`: colour strings in order. `site`: `{ value, count?,
 * hint? }` (hint 'accent' = the site called it primary/accent/brand or theme-color).
 * @returns `[{ value: '#rrggbb', name, role, from: 'logo'|'site' }]`
 */
export function brandColours({ logo = [], site = [], max = MAX } = {}) {
  const out = [];
  const add = (raw, from, hint) => {
    const value = toHex(raw);
    if (!value || out.length >= max) return;
    const twin = out.find((c) => distance(c.value, value) < SAME);
    if (twin) {
      if (hint === 'accent') twin.hint = 'accent';
      return;
    }
    out.push({ value, from, hint: hint ?? null });
  };
  for (const v of logo) add(v, 'logo');
  const ranked = [...site].sort(
    (a, b) =>
      Number(b.hint === 'accent') - Number(a.hint === 'accent') || (b.count ?? 0) - (a.count ?? 0)
  );
  for (const s of ranked) add(s?.value, 'site', s?.hint);

  const info = out.map((c) => ({ c, ...oklch(c.value) }));
  const taken = new Set();
  const pick = (role, list) => {
    const hit = list.find((x) => !taken.has(x.c));
    if (!hit) return;
    taken.add(hit.c);
    hit.c.role = role;
  };
  pick(
    'background',
    info.filter((x) => x.L >= 0.9 && x.C < 0.08).sort((a, b) => b.L - a.L)
  );
  pick(
    'text',
    info.filter((x) => x.L <= 0.4 && x.C < 0.12).sort((a, b) => a.L - b.L)
  );
  const chromatic = info.filter((x) => x.C >= 0.05).sort((a, b) => b.C - a.C);
  pick('accent', [...chromatic.filter((x) => x.c.hint === 'accent'), ...chromatic]);
  pick('second', chromatic);

  const used = new Map();
  return out.map((c) => {
    const base = colourName(c.value);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return {
      value: c.value,
      name: n === 1 ? base : `${base} ${n}`,
      role: c.role ?? 'none',
      from: c.from,
    };
  });
}

/** One colour per role at most: changing a role takes it from whichever colour had it. */
export function setRole(colours, index, role) {
  if (!ROLES.includes(role)) return colours;
  return colours.map((c, i) => {
    if (i === index) return { ...c, role };
    if (role !== 'none' && c.role === role) return { ...c, role: 'none' };
    return c;
  });
}
