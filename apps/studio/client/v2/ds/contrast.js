// client/v2/ds/contrast.js — S10.7: "Contrast is checked in both modes as you drag" (13 · ds-edit-colour).
//
// The maths and the pairs rule are ds/contrast.ts (S10 Q10). This file turns a token's pairs, judged in the
// system's Light and Dark with the value being dragged in place of the saved one, into the one quiet line the
// inspector draws:
//
//   pass   "5.6:1 on white · 4.8:1 on the dark page"   one ratio per mode, with the surface it was judged on (the board's words)
//   fail   "3.1:1 on Pole and Hover"                   the two surfaces that fell short, in the mode being edited
//                                                      (" in Dark" only when it is the OTHER mode that falls short;
//                                                      nothing is blocked — S10.17 adds "Lighten to 4.5:1")
//
// Pure: it reads the model the studio sent (`GET /_api/ds/board`), nothing else.

import { contrastOf, ratioWords, resolveColour } from '../../../ds/contrast.ts';

/** css → value text in one theme: the files' value, a waiting edit over it, then the value being dragged. */
export function themeValues(model, theme, override = {}) {
  const out = {};
  for (const t of model?.tokens ?? []) {
    const pend = t.pending && !t.pending.trashTo ? t.pending.values?.[theme] : undefined;
    const v = pend ?? t.values?.[theme] ?? t.values?.[model.themes.default];
    if (typeof v === 'string') out[t.css] = v;
  }
  for (const [css, v] of Object.entries(override)) if (typeof v === 'string') out[css] = v;
  return out;
}

const labelsOf = (model) => new Map((model?.tokens ?? []).map((t) => [t.css, t.label]));

const joinWords = (names) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** A surface drawn as the board words it: white · the dark page · the page · or its own name. */
function surfaceWords(css, values, isDark, names) {
  const rgb = resolveColour(values[css], (c) => values[c]);
  if (rgb && rgb.r >= 250 && rgb.g >= 250 && rgb.b >= 250) return 'white';
  if (css === '--bg-0') return isDark ? 'the dark page' : 'the page';
  return names.get(css) ?? css;
}

/** What a colour token is for, in a few words — read from the pairs rule, so it never claims more than it checks. */
export function roleWords(css) {
  if (/^--fg-[23]$/.test(css)) return 'Text on surfaces — hints';
  if (/^--fg-\d$/.test(css) || css === '--accent-text' || /^--status-[a-z]+-text$/.test(css))
    return 'Text on surfaces';
  if (css === '--accent-fg') return 'Text on accent';
  if (css === '--accent-on-soft') return 'Text on the soft accent';
  const st = /^--status-([a-z]+)-fg$/.exec(css);
  if (st) return `Text on ${st[1]}`;
  if (/^--bg-\d$/.test(css)) return 'Surface';
  if (css === '--accent') return 'Fill behind accent text';
  if (css === '--accent-soft') return 'Soft fill behind accent text';
  const fill = /^--status-([a-z]+)$/.exec(css);
  if (fill) return `Fill behind ${fill[1]} text`;
  return null;
}

/**
 * @param {any} model  the board model
 * @param {string} css  the token being edited
 * @param {{ [theme: string]: string }} edited  the value in each theme being tried (themes it leaves out are saved ones)
 * @param {string} [editing]  the mode the picker is changing — a fail in it is not re-named ("in Dark")
 * @returns {null | { ok: boolean, line: string, fails: Array<{ theme: string, other: string, ratio: number, need: number }>,
 *   light: number | null, dark: number | null }}  null when the token takes part in no pair
 */
export function contrastLine(model, css, edited = {}, editing) {
  if (!model?.themes) return null;
  const { light, dark } = model.themes;
  const themes = [light, ...(dark ? [dark] : [])];
  const names = labelsOf(model);
  const worst = {};
  const worstOther = {};
  const fails = [];
  const values = {};
  let any = false;
  for (const theme of themes) {
    values[theme] = themeValues(model, theme, { [css]: edited[theme] });
    const rows = contrastOf(css, values[theme]);
    let low = null;
    for (const r of rows) {
      if (r.ratio === null) continue;
      any = true;
      const other = r.fg === css ? r.bg : r.fg;
      if (low === null || r.ratio < low) {
        low = r.ratio;
        worstOther[theme] = other;
      }
      if (r.pass === false) fails.push({ theme, other, ratio: r.ratio, need: r.need });
    }
    worst[theme] = low;
  }
  if (!any) return null;
  if (!fails.length) {
    const part = (theme) =>
      worst[theme] === null
        ? null
        : `${ratioWords(worst[theme])} on ${surfaceWords(worstOther[theme], values[theme], theme === dark, names)}`;
    const line = themes.map(part).filter(Boolean).join(' · ');
    return { ok: true, line, fails, light: worst[light], dark: dark ? worst[dark] : null };
  }
  // the lowest ratio leads; the (up to two) surfaces or texts it fell short on in that mode are named
  fails.sort((a, b) => a.ratio - b.ratio);
  const first = fails[0];
  const on = joinWords(
    [
      ...new Set(
        fails.filter((f) => f.theme === first.theme).map((f) => names.get(f.other) ?? f.other)
      ),
    ].slice(0, 2)
  );
  // a fail in the mode being edited is the obvious one; only the other mode is named
  const where =
    !dark || (editing !== undefined && editing === first.theme)
      ? ''
      : first.theme === dark
        ? ' in Dark'
        : ' in Light';
  return {
    ok: false,
    line: `${ratioWords(first.ratio)} on ${on}${where}`,
    fails,
    light: worst[light],
    dark: dark ? worst[dark] : null,
  };
}
