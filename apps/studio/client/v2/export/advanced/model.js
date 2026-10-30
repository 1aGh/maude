// client/v2/export/advanced/model.js — S8.3: Export › Advanced as spec fields (09 ex-advanced).
//
// The fold holds every knob the old dialog had, plus the ones it hid: exact scale or dpi, colour
// profile, JPG quality, background, the print and video settings, where it renders, a file-name
// pattern with a live preview. `state.adv` holds only what the person TOUCHED (null = the sheet's own
// choice stands); `applyAdvanced` lays it over the spec, so an Advanced change reaches the spec and an
// untouched fold changes nothing. PURE: no React, no fetch.

import { DEFAULT_NAME_TEMPLATE, renderStem } from '../../../../exporters/file-names.ts';
import { kindLabel, orderKinds } from '../sections/batch-model.js';

export { DEFAULT_NAME_TEMPLATE };

// ── ranges and choices (the spec's own bounds — exporters/spec-v2.ts) ──────────────────────────────
export const SCALE_RANGE = [0.25, 4];
export const DPI_RANGE = [72, 600];
export const DPI_PRESETS = [150, 300, 600];
export const JPG_RANGE = [1, 100];
export const JPG_DEFAULT = 85;
export const FPS_CHOICES = [24, 25, 30, 50, 60];
export const GIF_COLOURS = [256, 128, 64, 32, 16];
export const VIDEO_QUALITY = [
  ['draft', 'Draft'],
  ['standard', 'Standard'],
  ['high', 'High'],
];
export const BACKGROUNDS = [
  ['artboard', 'As on the artboard'],
  ['transparent', 'Transparent'],
  ['white', 'White'],
];
export const LANES = [
  ['auto', 'Suggest each time'],
  ['cloud', 'Always the cloud'],
  ['this-mac', 'Always this Mac'],
];
export const COLOR_PROFILES = [
  ['srgb', 'sRGB'],
  ['display-p3', 'Display P3'],
];
export const TOKENS = [
  '{project}',
  '{folder}',
  '{canvas}',
  '{artboard}',
  '{kind}',
  '{size}',
  '{scale}',
  '{date}',
];

export const inRange = (n, [lo, hi]) =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;

// ── which part shows ─────────────────────────────────────────────────────────────────────────────
const IMAGE = new Set(['png', 'jpg']);
const VIDEO = new Set(['mp4', 'webm', 'gif']);

/** The formats a spec makes: each kind's own in a batch, else the one. */
export function specFormats(spec) {
  const byKind = Object.values(spec.byKind ?? {}).map((e) => e.format);
  return new Set(byKind.length ? byKind : [spec.format]);
}

/**
 * "Advanced shows only the part for what's selected": an image, a print PDF, a video — and where it
 * renders, which a video needs and a workspace without the render service always owes an answer for.
 * `kinds`: the kinds the estimate says the spec reaches.
 */
export function advancedParts({ formats, kinds, exportLane = 'local' }) {
  const f = [...formats];
  const image = f.some((x) => IMAGE.has(x));
  const print = f.includes('pdf') && kinds.has('print');
  const video = f.some((x) => VIDEO.has(x));
  // S8.6 — Sound only renders the video first, so where it renders is still a question
  const sound = f.includes('audio');
  return { image, print, video, render: video || sound || exportLane !== 'local' };
}

// ── what a touched field says about the spec ─────────────────────────────────────────────────────
/** The options the fold sets for one format. */
export function overridesFor(format, adv) {
  const o = {};
  if (IMAGE.has(format)) {
    if (adv.sizeBy === 'dpi' && adv.dpi != null) o.size = { dpi: adv.dpi };
    else if (adv.sizeBy !== 'dpi' && adv.scale != null) o.size = { scale: adv.scale };
    if (adv.colorProfile && adv.colorProfile !== 'srgb') o.colorProfile = adv.colorProfile;
    if (adv.background && adv.background !== 'artboard') o.background = adv.background;
    if (format === 'jpg' && adv.jpgQuality != null && adv.jpgQuality !== JPG_DEFAULT)
      o.jpgQuality = adv.jpgQuality;
  }
  if (format === 'pdf') {
    if (adv.printDpi != null) o.size = { dpi: adv.printDpi };
    const print = {};
    if (adv.bleed != null) print.bleed = adv.bleed;
    if (adv.crop != null) print.marks = adv.crop ? 'crop' : 'none';
    // S8.7 — Add the back (page 2), registration marks, and what happens to the text
    if (adv.back != null) print.back = adv.back;
    if (adv.registration != null) print.registration = adv.registration;
    if (adv.text != null && adv.text !== 'keep') print.text = adv.text;
    if (Object.keys(print).length) o.print = print;
  }
  if (VIDEO.has(format)) {
    const video = {};
    if (adv.fps != null) video.fps = adv.fps;
    if (adv.vquality != null) video.quality = adv.vquality;
    if (adv.gifColors != null) video.gifColors = adv.gifColors;
    if (Object.keys(video).length) o.video = video;
  }
  return o;
}

/** `base` options with `over` laid on top, one level into `print` / `video` / `size`. */
function merge(base, over) {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] =
      v && typeof v === 'object' && out[k] && typeof out[k] === 'object' && k !== 'size'
        ? { ...out[k], ...v }
        : v;
  }
  return out;
}

/**
 * The spec with the fold's touched fields laid over it. Returns a new spec; `state.adv` absent or
 * empty returns the spec as it was.
 */
export function applyAdvanced(spec, adv) {
  if (!adv) return spec;
  const next = { ...spec };
  if (spec.byKind) {
    next.byKind = {};
    for (const [kind, entry] of Object.entries(spec.byKind)) {
      const over = overridesFor(entry.format, adv);
      const options = merge(entry.options, over);
      next.byKind[kind] = {
        format: entry.format,
        ...(Object.keys(options).length ? { options } : {}),
      };
    }
  } else {
    const over = overridesFor(spec.format, adv);
    if (Object.keys(over).length) next.options = merge(spec.options, over);
  }
  const global = {};
  if (adv.lane && adv.lane !== 'auto') global.lane = adv.lane;
  const name = typeof adv.nameTemplate === 'string' ? adv.nameTemplate.trim() : '';
  if (name && name !== DEFAULT_NAME_TEMPLATE) global.nameTemplate = name;
  if (adv.folders === 'per-canvas' && spec.scope !== 'selection') global.folders = 'per-canvas'; // 09 ex-batch › Folders; 'one' is the default and sends nothing
  if (Object.keys(global).length) next.options = { ...(next.options ?? {}), ...global };
  return next;
}

// ── file names: the live preview ─────────────────────────────────────────────────────────────────
const EXT = { audio: 'm4a', canva: 'zip' };
const SAMPLE_SIZE = {
  digital: [1080, 1350],
  fixed: [1080, 1350],
  web: [1440, 900],
  video: [1920, 1080],
};

/**
 * Up to three example file names for the template, one per kind the spec reaches, made by the SAME
 * `renderStem` the server names real files with. The artboard names are the selected one when there is
 * one, else the kind's own ("Fixed size 1"): the preview shows the pattern, not the files.
 * facts: { project, canvas (designRoot-relative), label, date }
 */
export function nameSamples(spec, template, kinds, facts = {}) {
  const ks = orderKinds(kinds.length ? kinds : ['digital']).slice(0, 3);
  const t = template && template.trim() ? template : DEFAULT_NAME_TEMPLATE;
  return ks.map((kind) => {
    const entry = spec.byKind?.[kind];
    const format = entry?.format ?? spec.format;
    const size = entry?.options?.size ?? spec.options?.size;
    const [w, h] = SAMPLE_SIZE[kind] ?? [null, null];
    const stem = renderStem(t, {
      project: facts.project || 'Project',
      canvas: facts.canvas ?? null,
      artboard: ks.length === 1 && facts.label ? facts.label : `${kindLabel(kind)} 1`,
      kind,
      w,
      h,
      paper: kind === 'print' ? 'A5' : null,
      size,
      date: facts.date ?? new Date(),
    });
    return `${stem}.${EXT[format] ?? format}`;
  });
}

// ── where it renders ─────────────────────────────────────────────────────────────────────────────
/** The Status line of the render service for a workspace's export lane. */
export function renderStatus(exportLane) {
  if (exportLane === 'remote') return { ok: true, word: 'Ready' };
  if (exportLane === 'none') return { ok: false, word: 'Not set up here' };
  return { ok: true, word: 'This Mac renders — no service needed' };
}
