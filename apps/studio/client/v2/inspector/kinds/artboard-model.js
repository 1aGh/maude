// client/v2/inspector/kinds/artboard-model.js — S2.8: the artboard inspector's pure parts (no DOM, no React).
//
//   artboardFacts      what the artboard says about itself, read off its selection payload (`data-dc-*` read-back)
//   presetOptions      the Preset row's choices for this kind of artboard: screens, breakpoints, or paper
//   presetValue        which of them the artboard is right now ('' = Custom)
//   KIND_OPTIONS       the Kind row, in the chip's words
//   LAYOUT_OPTIONS     the Layout row's "Content" choices
//   artboardLength     a Length (token / px) ↔ what DCArtboard's padding / gap props carry
//
// The server writes through the existing /_api/set-artboard-* + the `artboard.resize` edit-op; this file only
// decides what to show and what to send.

import { PAPER_PRESETS } from '../../../../print/units.ts';
import { WIDTH_PRESETS } from '../../../../editing/artboard-resize.ts';
import { PRESET_GROUPS } from '../../../../kinds/presets.ts';

/** Kind row: the chip's words (C16), the value DCArtboard's `kind` takes. `digital` is the implicit default. */
export const KIND_OPTIONS = Object.freeze([
  { value: 'web', label: 'Web page' },
  { value: 'digital', label: 'Fixed size' },
  { value: 'print', label: 'Print' },
  { value: 'video', label: 'Video' },
]);

/** Layout › Content: how the artboard lays out what is inside it. */
export const LAYOUT_OPTIONS = Object.freeze([
  { value: '', label: 'Page flow' },
  { value: 'flex-col', label: 'Top to bottom' },
  { value: 'flex-row', label: 'Left to right' },
  { value: 'grid', label: 'Grid' },
]);

/** The theme pins, in the words of the artboard menu's Theme submenu. */
export const THEME_OPTIONS = Object.freeze([
  { value: 'follow', label: 'Follow chrome' },
  { value: 'ds', label: 'DS default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]);

const num = (v) => (Number.isFinite(v) ? v : null);

/** @returns {{ id: string | null, w: number | null, h: number | null, kind: string, fixed: boolean, bg: string,
 *   padding: string, gap: string, layout: string, print: any, theme: string }} */
export function artboardFacts(el) {
  const attrs = el?.attrs || {};
  let print = null;
  try {
    print = attrs['data-dc-print'] ? JSON.parse(attrs['data-dc-print']) : null;
  } catch {
    /* a malformed attribute reads as absent */
  }
  const m = /^\[data-dc-screen="([^"]+)"\]$/.exec(el?.selector || '');
  return {
    id: el?.artboardId || (m ? m[1] : null),
    // world px, zoom-independent; the screen rect only when a payload predates the field
    w: num(el?.worldW) ?? num(el?.bounds?.w),
    h: num(el?.worldH) ?? num(el?.bounds?.h),
    kind: attrs['data-dc-kind'] || 'digital',
    fixed: attrs['data-dc-fixed'] === 'true',
    bg: attrs['data-dc-bg'] ?? '',
    padding: attrs['data-dc-padding'] ?? '',
    gap: attrs['data-dc-gap'] ?? '',
    layout: attrs['data-dc-layout'] ?? '',
    print,
    theme: attrs['data-dc-theme-pin'] || 'follow',
  };
}

/** The catalogue's rows (S7.20) for these groups, as the Size select's options. */
function catalogueOptions(groups, labelOf) {
  return PRESET_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) =>
    g.presets.map((p) => ({
      value: p.id,
      label: labelOf(p),
      width: p.widthPx,
      height: p.heightPx,
    }))
  );
}

/**
 * The Size / Width row's choices for this kind. A web artboard hugs its height, so its presets are breakpoints (a
 * width); a fixed-size one reads the App + Social half of the ONE catalogue (S7.20, `kinds/presets.ts`: "Story 9:16
 * (still)", "Desktop"); a video the Video half ("Reels 9:16"); print the paper ladder.
 * @returns {Array<{ value: string, label: string, width: number, height?: number, paper?: string }>}
 */
export function presetOptions(kind) {
  if (kind === 'print') return paperOptions();
  if (kind === 'video') return catalogueOptions(['video'], (p) => p.label);
  if (kind === 'web')
    return [...WIDTH_PRESETS]
      .sort((a, b) => b.w - a.w)
      .map((p) => ({ value: `screen:${p.w}`, label: `${p.label} · ${p.w}`, width: p.w }));
  // S7.25: a fixed size also lists the papers — picking one is Change kind (a dialog, then a copy), never a quiet resize
  return [
    ...catalogueOptions(['app', 'social'], (p) => p.name),
    ...paperOptions().map((o) => ({ ...o, convert: true })),
  ];
}

/** The paper ladder as Size options (the Print inspector's Paper, and a fixed size's Change kind choices). */
function paperOptions() {
  return PAPER_PRESETS.map((p) => ({
    value: `paper:${p.id}`,
    label: `${p.label} · ${p.width} × ${p.height} ${p.unit}`,
    width: 0,
    paper: p.id,
  }));
}

/** "post" for a size from the Social group, "artboard" for any other: the word Change kind's toast calls the original. */
export function sourceWord(facts) {
  const hit = PRESET_GROUPS.filter((g) => g.id === 'social')
    .flatMap((g) => g.presets)
    .some((p) => p.widthPx === facts.w && p.heightPx === facts.h);
  return hit ? 'post' : 'artboard';
}

/** The preset the artboard is, as an option value; '' = Custom. */
export function presetValue(facts) {
  if (facts.kind === 'print') return facts.print?.paper ? `paper:${facts.print.paper}` : '';
  const hit = presetOptions(facts.kind).find(
    (o) => o.width === facts.w && (o.height == null || o.height === facts.h)
  );
  return hit?.value ?? '';
}

/** The widths "Add a width" offers: every preset width this artboard is not already. */
export function otherWidths(facts) {
  return WIDTH_PRESETS.filter((p) => p.w !== facts.w).sort((a, b) => b.w - a.w);
}

/** What the Height row says: "Fits content" (hug) or "Fixed". */
export const heightMode = (facts) => (facts.fixed ? 'fixed' : 'hug');

/** DCArtboard `padding` / `gap` prop text → the Length LengthControl draws. */
export function artboardLength(raw, tokens) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const v = /^var\(\s*(--[\w-]+)\s*\)$/.exec(s);
  if (v) {
    const stop = (tokens?.space || []).find((t) => t.name === v[1]);
    return { token: v[1], px: stop ? stop.px : null };
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? { px: n } : { css: s };
}

/** A Length → the value set-artboard-style takes: a `var(--token)` string, a px number, or null (cleared). */
export function artboardLengthPatch(l) {
  if (!l) return null;
  if ('token' in l) return `var(${l.token})`;
  if ('px' in l) return l.px > 0 ? l.px : null;
  return null; // CSS the prop cannot carry is not written
}
