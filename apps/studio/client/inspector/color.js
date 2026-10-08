// inspector/color.js — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

export let _cssColorCtx = null;

// Normalize any CSS color string to #rrggbb for the native color input via a
// throwaway canvas fillStyle round-trip (parses rgb/hsl/named). Unparseable
// values (some oklch) fall back to '' → picker defaults to #000000; the swatch
// still shows the true color string regardless.
export function cssColorToHex(c) {
  if (!c) return '';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  try {
    if (!_cssColorCtx) _cssColorCtx = document.createElement('canvas').getContext('2d');
    if (!_cssColorCtx) return '';
    _cssColorCtx.fillStyle = '#000000';
    _cssColorCtx.fillStyle = c;
    const v = _cssColorCtx.fillStyle;
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    }
  } catch {
    /* canvas unavailable */
  }
  return '';
}

// ---- Colour math for the HSV picker (#6 — Figma-style colour control) ----
export const clamp01 = (n) => Math.min(1, Math.max(0, n));

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

export function rgbToHsv({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// Round bare px to whole numbers for the placeholder hint; pass other values through.
export function cssHint(v) {
  if (!v) return '';
  const m = /^(-?\d*\.?\d+)px$/.exec(v);
  return m ? `${Math.round(Number.parseFloat(m[1]))}px` : v;
}

// Split "16px" → { n:"16", unit:"px" }; "auto"→{n:"",unit:"auto"}; var()/raw → {n:raw,unit:""}.
export function cssSplitUnit(v) {
  if (!v) return { n: '', unit: 'px' };
  const t = v.trim();
  const m = /^(-?\d*\.?\d+)\s*(px|rem|em|%|vw|vh)?$/.exec(t);
  if (m) return { n: m[1], unit: m[2] || 'px' };
  if (t === 'auto') return { n: '', unit: 'auto' };
  return { n: t, unit: '' };
}
