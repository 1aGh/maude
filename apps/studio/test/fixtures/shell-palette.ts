// The shell ladder's colours as RGB, for contrast tests (P8 C0: one generated ladder, 1-tokens-shell.css).
// Follows `var(--x)` inside the theme block and composites an alpha colour over a ground (the maude-v2
// borders, --accent-soft / --accent-muted and --selection are translucent).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { oklchToRgb, parseOklch, type Rgb } from '../../draw/palette';

const CSS = readFileSync(
  join(import.meta.dir, '..', '..', 'client', 'styles', '1-tokens-shell.css'),
  'utf8'
);

function block(theme: 'light' | 'dark'): string {
  const opener = `.maude[data-theme="${theme}"] {`;
  const at = CSS.indexOf(opener);
  if (at < 0) throw new Error(`1-tokens-shell.css: no ${opener}`);
  return CSS.slice(at + opener.length, CSS.indexOf('\n  }', at));
}

/** The declared value of `name` in the theme block, following var() references. */
export function shellValue(theme: 'light' | 'dark', name: string, depth = 0): string {
  const m = block(theme).match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`${theme}: ${name} is not declared`);
  const v = m[1].trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  return ref && depth < 8 ? shellValue(theme, ref[1], depth + 1) : v;
}

/** `name` as an opaque RGB colour; a translucent value is composited over `ground` (default --bg-1). */
export function shellColor(theme: 'light' | 'dark', name: string, ground = '--bg-1'): Rgb {
  const v = shellValue(theme, name);
  const rgb = oklchToRgb(parseOklch(v));
  const alpha = /\/\s*([\d.]+)(%?)\s*\)$/.exec(v);
  if (!alpha) return rgb;
  const a = alpha[2] ? Number(alpha[1]) / 100 : Number(alpha[1]);
  const g = shellColor(theme, ground);
  return {
    r: rgb.r * a + g.r * (1 - a),
    g: rgb.g * a + g.g * (1 - a),
    b: rgb.b * a + g.b * (1 - a),
  };
}
