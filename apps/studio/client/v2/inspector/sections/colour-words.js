// client/v2/inspector/sections/colour-words.js — V2-8.5 C2 (04 modes R7, 14 R4): a colour is said in WORDS.
//
// A fill the file wrote as `var(--ink)` reads "Ink" (color-control.jsx). A fill the browser only RESOLVED — what the
// canvas reports for an object with no authored colour — used to read `rgb(255, 255, 255)`: a code word, on a board that
// draws "Page 100 %" and "Ink 1.5". This turns that value into a name: the design system's own colour token when one has
// the same colour, else a plain colour word. Pure — no DOM, no fetch.

import { tokenLabel } from '../../../../edit-ops/words-css.ts';

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** `oklch(L C h)` (L as 0–1 or a %, h in degrees) → sRGB 0–255, or null. */
function fromOklch(body) {
  const m = body
    .replace(/\/.*$/, '')
    .trim()
    .split(/[\s,]+/);
  if (m.length < 3) return null;
  let L = Number.parseFloat(m[0]);
  if (m[0].endsWith('%')) L /= 100;
  const C = Number.parseFloat(m[1]);
  const h = (Number.parseFloat(m[2]) * Math.PI) / 180;
  if (![L, C, h].every(Number.isFinite)) return null;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = clamp01(v);
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  });
}

/** A CSS colour → `[r, g, b]` (0–255), or null for anything this does not read (var(), gradients, color-mix…). */
export function rgbOf(css) {
  const t = String(css ?? '')
    .trim()
    .toLowerCase();
  if (!t) return null;
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4)
      return [0, 1, 2].map((i) => Number.parseInt(h[i] + h[i], 16));
    if (h.length === 6 || h.length === 8)
      return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
    return null;
  }
  m = /^rgba?\(\s*([^)]+)\)$/.exec(t);
  if (m) {
    const parts = m[1]
      .replace(/\/.*$/, '')
      .trim()
      .split(/[\s,]+/)
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? (Number.parseFloat(p) * 255) / 100 : Number.parseFloat(p)));
    return parts.length === 3 && parts.every(Number.isFinite)
      ? parts.map((v) => Math.round(v))
      : null;
  }
  m = /^oklch\(\s*([^)]+)\)$/.exec(t);
  if (m) return fromOklch(m[1]);
  return null;
}

/** Is it fully transparent? (`transparent`, `rgba(0,0,0,0)`). */
export const isClear = (css) => {
  const t = String(css ?? '')
    .trim()
    .toLowerCase();
  return (
    t === 'transparent' || /^rgba\([^)]*,\s*0\s*\)$/.test(t) || /\/\s*0(?:\.0+)?\s*\)$/.test(t)
  );
};

const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 2);

/** A plain word for a colour no token has: White · Black · Grey, or its hue with Light / Dark. */
export function plainColourWord([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  if (max - min < 14) return l > 0.94 ? 'White' : l < 0.15 ? 'Black' : 'Grey';
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const word =
    h < 15 || h >= 345
      ? 'Red'
      : h < 45
        ? 'Orange'
        : h < 70
          ? 'Yellow'
          : h < 165
            ? 'Green'
            : h < 200
              ? 'Teal'
              : h < 255
                ? 'Blue'
                : h < 290
                  ? 'Purple'
                  : 'Pink';
  return l > 0.82 ? `Light ${word.toLowerCase()}` : l < 0.28 ? `Dark ${word.toLowerCase()}` : word;
}

/**
 * The words for a CSS colour: the design system's colour token that has this colour ("Ink", "Page"), else a plain word
 * ("White", "Dark green"). null when the value is not a colour this reads — the caller then shows it as written.
 * @param {string} css
 * @param {string[]} colors the system's colour token names (`--ink`)
 * @param {Record<string, string>} vals every token's resolved value
 */
export function colourWords(css, colors = [], vals = {}) {
  if (isClear(css)) return 'None';
  const rgb = rgbOf(css);
  if (!rgb) return null;
  for (const name of colors) {
    const t = rgbOf(vals[name]);
    if (t && near(rgb, t)) return tokenLabel(name);
  }
  return plainColourWord(rgb);
}
