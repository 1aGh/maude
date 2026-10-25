// client/v2/inspector/kinds/artboard-kinds-model.js — S7.21: the words and facts of the per-kind artboard inspectors
// (08 Artboard Kinds: ak-web-hug, ak-web-widths, ak-social, ak-video, ak-mixed-select). Pure: no DOM, no React.
//
//   webHeightNote        "1573 now — grows as you add."
//   widthWord            1440 → "Desktop", 1300 → "1300 px"
//   addedWidthsWords     the toast after "Add a width": "Tablet and Mobile are beside Desktop. Their layout reflowed to fit."
//   ADD_PAIR             the one choice that adds Tablet AND Mobile (one write, one ⌘Z)
//   lengthWords          450 frames at 30 fps → "0:15"
//   posterFrame          the frame the poster is: the stored one, or 35 % of the length (V2-1.10 §5.5)
//   advancedFacts        the read-only lines of Advanced: `kind web · width 1440px · height auto …`
//   multiKindModel       what two or more boards of DIFFERENT kinds still share (ak-mixed-select)
//
// Words are CONTRACT §3 / the 08 canvas, verbatim.

import { WIDTH_PRESETS } from '../../../../editing/artboard-resize.ts';
import { DEFAULT_POSTER_FRACTION } from '../../../../kinds/meta.ts';
import { KIND_WORD } from '../../../../kinds/presets.ts';

const PRESET_WORD = new Map(WIDTH_PRESETS.map((p) => [p.w, p.label]));

/** 1440 → "Desktop"; a width that is no preset reads as itself ("1300 px"). */
export const widthWord = (w) => PRESET_WORD.get(w) ?? `${w} px`;

/** "1573 now — grows as you add." (08 ak-web-hug) */
export const webHeightNote = (h) => `${Math.round(h)} now — grows as you add.`;

/** The pair "Add a width" can add in one gesture. */
export const ADD_PAIR = Object.freeze({
  value: 'tablet+mobile',
  widths: Object.freeze([834, 390]),
});

/** Does the "Tablet and Mobile" choice make sense here? Only for a page wider than the Tablet it would add. */
export const canAddPair = (facts) => Number.isFinite(facts.w) && facts.w > ADD_PAIR.widths[0];

const join = (words) =>
  words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;

/**
 * The toast after copies at other widths landed. `sourceWord` is how the page names itself ("Desktop"); an
 * artboard whose width is no preset passes its own name.
 */
export function addedWidthsWords(widths, sourceWord) {
  const names = widths.map(widthWord);
  const one = names.length === 1;
  return `${join(names)} ${one ? 'is' : 'are'} beside ${sourceWord}. ${one ? 'Its' : 'Their'} layout reflowed to fit.`;
}

const mss = (sec) => {
  const s = Math.max(0, Math.floor(sec + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A video's length, "0:15"; "—" until the comp has announced itself. */
export function lengthWords(durationInFrames, fps) {
  if (!Number.isFinite(durationInFrames) || !(fps > 0)) return '—';
  return mss(durationInFrames / fps);
}

/** The poster frame: the one the meta stores, else 35 % of the length (today's `VideoComp` default). */
export function posterFrame(stored, durationInFrames) {
  if (Number.isInteger(stored) && stored >= 0) return stored;
  if (!Number.isFinite(durationInFrames)) return null;
  return Math.max(
    0,
    Math.min(durationInFrames - 1, Math.floor(durationInFrames * DEFAULT_POSTER_FRACTION))
  );
}

/** The poster as a time, "0:04"; "—" when the length is not known yet. */
export function posterWords(frame, fps) {
  return frame === null || !(fps > 0) ? '—' : mss(frame / fps);
}

function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The sound row's name: the file a music clip plays, without its folder or extension. */
export function soundName(mediaSrc) {
  const base = String(mediaSrc ?? '')
    .split('/')
    .pop()
    ?.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return base ? decodeSafe(base) : '';
}

/**
 * The read-only lines Advanced holds for an artboard of this kind (08: `kind web · width 1440px · height auto …`).
 * Every number the designer rows round off is here exactly.
 * @returns {Array<[string, string]>}
 */
export function advancedFacts(f, video) {
  const w = f.w != null ? `${Math.round(f.w)}px` : '—';
  const h = f.h != null ? Math.round(f.h) : null;
  const rows = [['kind', f.kind]];
  if (f.kind === 'web') {
    // a hugging page's height is whatever its content makes it: "now" is the measured number, not a promise
    rows.push(['width', w], ['height', f.fixed ? `${h}px · fixed` : `auto · now ${h}px`]);
    if (f.layout)
      rows.push([
        'display',
        f.layout === 'grid' ? 'grid' : `flex · ${f.layout === 'flex-row' ? 'row' : 'column'}`,
      ]);
  } else if (f.kind === 'video') {
    rows.push(['width', w], ['height', h != null ? `${h}px` : '—']);
    rows.push(['fps', video?.fps ? String(video.fps) : '—']);
    rows.push(['durationInFrames', video?.durationInFrames ? String(video.durationInFrames) : '—']);
    rows.push(['codec', 'h264']);
    if (video?.poster != null) rows.push(['poster', `frame ${video.poster}`]);
    // S7.13 — the cut this video shares with its other formats, and where each keeps its own framing
    if (video?.linkedTo) rows.push(['linkedTo', video.linkedTo], ['framing', 'per format']);
  } else {
    rows.push(['width', w], ['height', h != null ? `${h}px${f.fixed ? ' · fixed' : ''}` : '—']);
  }
  return rows;
}

/** The kinds a selection holds, each once, in the order they first appear: `['digital', 'print']`. */
export function kindsOfSelection(selection) {
  const list = Array.isArray(selection) ? selection : selection ? [selection] : [];
  return [...new Set(list.map((el) => el?.attrs?.['data-dc-kind'] || 'digital'))];
}

/** What two or more boards say in the inspector (ak-mixed-select when their kinds differ). */
export function multiKindModel(selection) {
  const kinds = kindsOfSelection(selection);
  return {
    count: Array.isArray(selection) ? selection.length : 1,
    kinds: kinds.map((k) => ({ kind: k, word: KIND_WORD[k] ?? KIND_WORD.digital })),
    mixed: kinds.length > 1,
    chip: kinds.length > 1 ? `${kinds.length} kinds` : null,
    note: 'Size and paper differ. Select one to change it.',
  };
}

/**
 * Which align verbs already hold for these boards (08 ak-mixed-select draws "Left" and "Top" pressed): every board
 * shares the same left edge / centre / right edge, and the same top / middle / bottom. Read from the boards' world
 * geometry; `''` where they share none (or the geometry is unknown).
 * @returns {{ h: string, v: string }} `align.left|hcentre|right` and `align.top|vmiddle|bottom`, or ''
 */
export function heldAlignment(selection) {
  const list = (Array.isArray(selection) ? selection : [])
    .map((el) => el?.geometry)
    .filter(Boolean);
  const out = { h: '', v: '' };
  if (list.length < 2) return out;
  const same = (xs) => xs.every((n) => Number.isFinite(n) && Math.abs(n - xs[0]) < 0.5);
  if (same(list.map((g) => g.x))) out.h = 'align.left';
  else if (same(list.map((g) => g.x + g.w / 2))) out.h = 'align.hcentre';
  else if (same(list.map((g) => g.x + g.w))) out.h = 'align.right';
  if (same(list.map((g) => g.y))) out.v = 'align.top';
  else if (same(list.map((g) => g.y + g.h / 2))) out.v = 'align.vmiddle';
  else if (same(list.map((g) => g.y + g.h))) out.v = 'align.bottom';
  return out;
}
