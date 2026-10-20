// client/v2/ds/contrast.js — S10.7: "Contrast is checked in both modes as you drag" (13 · ds-edit-colour).
//
// The maths and the pairs rule are ds/contrast.ts (S10 Q10). This file turns a token's pairs, judged in the
// system's Light and Dark with the value being dragged in place of the saved one, into the one quiet line the
// inspector draws:
//
//   pass   "Light 5.6:1 · Dark 4.8:1"
//   fail   "3.1:1 on Pole and Hover in Dark"      (nothing is blocked — S10.17 adds "Lighten to 4.5:1")
//
// Pure: it reads the model the studio sent (`GET /_api/ds/board`), nothing else.

import { contrastOf, ratioWords } from '../../../ds/contrast.ts';

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

/**
 * @param {any} model  the board model
 * @param {string} css  the token being edited
 * @param {{ [theme: string]: string }} edited  the value in each theme being tried (themes it leaves out are saved ones)
 * @returns {null | { ok: boolean, line: string, fails: Array<{ theme: string, other: string, ratio: number, need: number }>,
 *   light: number | null, dark: number | null }}  null when the token takes part in no pair
 */
export function contrastLine(model, css, edited = {}) {
  if (!model?.themes) return null;
  const { light, dark } = model.themes;
  const themes = [light, ...(dark ? [dark] : [])];
  const names = labelsOf(model);
  const worst = {};
  const fails = [];
  let any = false;
  for (const theme of themes) {
    const rows = contrastOf(css, themeValues(model, theme, { [css]: edited[theme] }));
    let low = null;
    for (const r of rows) {
      if (r.ratio === null) continue;
      any = true;
      if (low === null || r.ratio < low) low = r.ratio;
      if (r.pass === false) {
        const other = r.fg === css ? r.bg : r.fg;
        fails.push({ theme, other, ratio: r.ratio, need: r.need });
      }
    }
    worst[theme] = low;
  }
  if (!any) return null;
  if (!fails.length) {
    const part = (label, v) => (v === null ? null : `${label} ${ratioWords(v)}`);
    const line = [part('Light', worst[light]), dark ? part('Dark', worst[dark]) : null]
      .filter(Boolean)
      .join(' · ');
    return { ok: true, line, fails, light: worst[light], dark: dark ? worst[dark] : null };
  }
  // the lowest ratio leads; the surfaces (or texts) it fell short on are named
  fails.sort((a, b) => a.ratio - b.ratio);
  const first = fails[0];
  const on = joinWords(
    [
      ...new Set(
        fails.filter((f) => f.theme === first.theme).map((f) => names.get(f.other) ?? f.other)
      ),
    ].slice(0, 3)
  );
  const inThemes = [...new Set(fails.map((f) => f.theme))];
  const where = !dark
    ? ''
    : inThemes.length === themes.length
      ? ' in Light and Dark'
      : inThemes[0] === dark
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
