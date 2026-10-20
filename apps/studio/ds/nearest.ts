// ds/nearest.ts — S10.17: the nearest colour still in the system, by OKLab distance.
//
// Two askers, one measure:
//   - a token going to the trash (13 · ds-edge-trash): the closest colour that is still in the system, so the canvases
//     that used it switch to it and nothing breaks. Judged in EVERY mode the system has — a grey that is close in
//     Light and far in Dark is not close.
//   - a colour somebody picked by hand (13 · ds-edge-suggest): the closest system colour, in the default mode, offered
//     as one quiet question.
//
// PURE and node-free (it is bundled into the sheet and run on the server): values resolve through the contrast
// resolver (`var()`, `color-mix()`, `oklch()`, hex …); the maths is OKLab on sRGB.

import { rgbToOklch } from '../draw/palette.ts';
import { resolveColour } from './contrast.ts';

/** The part of a board token this module reads (a `BoardToken` fits). */
export interface NearestToken {
  css: string;
  kind: string;
  group: string;
  /** theme → the CSS value text */
  values: Readonly<Record<string, string>>;
  pending?: { trashTo: string | null; added: boolean } | null;
  /** a tombstone (already in the trash) */
  trashed?: boolean;
}

export interface NearestThemes {
  default: string;
  all: readonly string[];
}

export interface Nearest {
  css: string;
  /** OKLab distance, mean over the modes compared (0 = the same colour) */
  deltaE: number;
  /** the same colour to the eye (within one step of 8-bit sRGB): nothing to suggest, it IS a system colour */
  exact: boolean;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function oklab(c: Rgb): { l: number; a: number; b: number } {
  const o = rgbToOklch(c);
  const h = (o.h * Math.PI) / 180;
  return { l: o.l, a: o.c * Math.cos(h), b: o.c * Math.sin(h) };
}

/** OKLab distance between two sRGB colours. */
export function deltaE(a: Rgb, b: Rgb): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

const sameRgb = (a: Rgb, b: Rgb) =>
  Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1;

/** A token's value in one theme (its own, else the default mode's), resolved against the whole system. */
function colourIn(tokens: readonly NearestToken[], themes: NearestThemes) {
  const byName = new Map(tokens.map((t) => [t.css, t]));
  const text = (t: NearestToken | undefined, theme: string) =>
    t?.values[theme] ?? t?.values[themes.default];
  return (css: string, theme: string): Rgb | null => {
    const look = (name: string) => text(byName.get(name), theme);
    return resolveColour(text(byName.get(css), theme), look);
  };
}

/** Does a value text point back at `css` (a candidate that is an alias of the colour being replaced)? */
const pointsAt = (value: string | undefined, css: string) =>
  typeof value === 'string' &&
  new RegExp(`var\\(\\s*${css.replace(/[-]/g, '\\-')}\\s*[,)]`).test(value);

/** In the system for real: a colour, not in the trash, not on its way there, not only proposed. */
function standing(t: NearestToken): boolean {
  return t.kind === 'color' && !t.trashed && !t.pending?.trashTo && !t.pending?.added;
}

function rank(
  scored: { css: string; group: string; score: number; exact: boolean }[],
  group: string | null
): Nearest | null {
  if (!scored.length) return null;
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      Number(b.group === group) - Number(a.group === group) ||
      a.css.localeCompare(b.css)
  );
  const best = scored[0];
  return { css: best.css, deltaE: best.score, exact: best.exact };
}

/**
 * The colour that should take over from `css` when it goes to the trash. null when `css` is not a colour of the
 * system or nothing else is left to follow. The token's own group comes first ("the closest LINE colour"); a token
 * alone in its group is matched against the whole system.
 */
export function nearestForToken(
  css: string,
  tokens: readonly NearestToken[],
  themes: NearestThemes
): Nearest | null {
  const target = tokens.find((t) => t.css === css);
  if (target?.kind !== 'color') return null;
  const at = colourIn(tokens, themes);
  const modes = themes.all.filter((m) => target.values[m] !== undefined);
  if (!modes.length) modes.push(themes.default);
  const scored: { css: string; group: string; score: number; exact: boolean }[] = [];
  for (const cand of tokens) {
    if (cand.css === css || !standing(cand)) continue;
    if (Object.values(cand.values).some((v) => pointsAt(v, css))) continue;
    let sum = 0;
    let n = 0;
    let exact = true;
    for (const m of modes) {
      const a = at(css, m);
      const b = at(cand.css, m);
      if (!a || !b) continue;
      sum += deltaE(a, b);
      n++;
      if (!sameRgb(a, b)) exact = false;
    }
    if (!n) continue;
    scored.push({ css: cand.css, group: cand.group, score: sum / n, exact });
  }
  // "the closest LINE colour": a colour of the token's own group stands in when the group has another; only a
  // token alone in its group looks across the whole system
  const kin = scored.filter((x) => x.group === target.group);
  return rank(kin.length ? kin : scored, target.group);
}

/**
 * The system colour closest to a hand-picked `value` (any CSS colour), in the default mode. null when the value is
 * not one plain colour or the system has no colours.
 */
export function nearestForValue(
  value: string,
  tokens: readonly NearestToken[],
  themes: NearestThemes
): Nearest | null {
  const mine = resolveColour(value, () => undefined);
  if (!mine) return null;
  const at = colourIn(tokens, themes);
  const scored: { css: string; group: string; score: number; exact: boolean }[] = [];
  for (const cand of tokens) {
    if (!standing(cand)) continue;
    const c = at(cand.css, themes.default);
    if (!c) continue;
    scored.push({
      css: cand.css,
      group: cand.group,
      score: deltaE(mine, c),
      exact: sameRgb(mine, c),
    });
  }
  return rank(scored, null);
}
