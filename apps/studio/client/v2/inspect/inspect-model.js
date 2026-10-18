// client/v2/inspect/inspect-model.js — S3.11: the Inspect panel's rows, as data (04 Modes · md-inspect).
//
// Pure (no DOM, no React, no fetch). One element in — the selection payload the canvas posts, plus the
// `neighbour` it measured when the selection is an inspection — rows out. The words are CONTRACT's: values
// read as words and numbers ("Round", "Semibold"), a token reads by its name ("Ink"), never a raw
// `var(--ink)`; the raw CSS waits under Advanced.

import { modeShows } from '../../../bridge/mode-shows.ts';
import { kindChipOf } from '../inspector/kinds/index.js';
import { humanToken, titleOf } from '../inspector/model.js';

const px = (v) => {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
const WEIGHTS = {
  100: 'Thin',
  200: 'Extralight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extrabold',
  900: 'Black',
};
/** 600 → "Semibold"; a weight with no name stays a number. */
export const weightWord = (w) => WEIGHTS[Number(w)] ?? String(w);

const hex2 = (n) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** `rgb(…)`/`rgba(…)` → "#RRGGBB"; null when transparent; anything else is returned as it came. */
export function colourWord(value) {
  const v = String(value ?? '').trim();
  if (!v || v === 'transparent') return null;
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(v);
  if (!m) return v;
  const a = m[4] == null ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
  if (a === 0) return null;
  return `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
}

/** The token a CSS value names (`var(--ink)` → "Ink"), or null. */
const tokenOf = (authored) => {
  const m = /var\(\s*(--[a-z0-9-]+)/i.exec(String(authored ?? ''));
  return m ? humanToken(m[1]) : null;
};

function sizeRows(el, neighbour) {
  const c = el.computed || {};
  const w = el.worldW ?? el.geometry?.w ?? el.bounds?.w;
  const h = el.worldH ?? el.geometry?.h ?? el.bounds?.h;
  const rows = [];
  if (Number.isFinite(w) && Number.isFinite(h)) rows.push({ k: 'Size', v: `${w} × ${h}` });
  const pad = ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'].map((p) =>
    px(c[p])
  );
  if (pad.some((n) => n > 0)) {
    const [t, r, b, l] = pad;
    const v =
      t === r && r === b && b === l ? `${t}` : t === b && r === l ? `${t} · ${r}` : pad.join(' · ');
    rows.push({ k: 'Padding', v });
  }
  const radius = px(c['border-top-left-radius'] ?? c['border-radius']);
  const small = Math.min(Number.isFinite(w) ? w : Infinity, Number.isFinite(h) ? h : Infinity);
  rows.push({
    k: 'Corners',
    v: radius <= 0 ? 'Square' : radius >= small / 2 ? 'Round' : `${radius}`,
  });
  if (neighbour && Number.isFinite(neighbour.gap) && neighbour.name)
    rows.push({ k: `Gap to ${neighbour.name}`, v: String(neighbour.gap) });
  return rows;
}

function colourRows(el) {
  const c = el.computed || {};
  const a = el.authored || {};
  const rows = [];
  const fill = colourWord(c['background-color']);
  if (fill)
    rows.push({
      k: 'Fill',
      v: tokenOf(a['background-color'] ?? a.background) ?? fill,
      swatch: c['background-color'],
    });
  if (el.text) {
    const family = String(c['font-family'] ?? '')
      .split(',')[0]
      ?.replace(/^\s*["']|["']\s*$/g, '')
      .trim();
    const bits = [
      family,
      c['font-size'] ? String(px(c['font-size'])) : '',
      c['font-weight'] ? weightWord(c['font-weight']) : '',
    ].filter(Boolean);
    if (bits.length) rows.push({ k: 'Text', v: bits.join(' · ') });
    const ink = colourWord(c.color);
    if (ink) rows.push({ k: 'Text colour', v: tokenOf(a.color) ?? ink, swatch: c.color });
  }
  return rows;
}

const cssRows = (el) =>
  [...Object.entries(el.authored || {}), ...Object.entries(el.customStyles || {})].filter(
    ([k]) => !k.startsWith('data-cd-')
  );

/**
 * @param el the selection payload of ONE element (`select-set`, plus `neighbour` when the canvas measured one)
 * @param layersTree the canvas's layer tree, for the layer's own name
 * @returns {{ name: string, kind: string, size: Array<{k,v}>, colour: Array<{k,v,swatch?}>, css: Array<[string,string]> }}
 */
export function inspectRows(el, layersTree) {
  return {
    name: titleOf(el, layersTree),
    kind: kindChipOf(el),
    size: sizeRows(el, el.neighbour),
    colour: colourRows(el),
    css: cssRows(el),
  };
}

/** The panel appears for a selection in Preview or Viewing — the modes that read rather than edit. */
export function inspectOpensOnSelect({ mode, hasId }) {
  return !!hasId && modeShows(mode, 'inspect-panel');
}
