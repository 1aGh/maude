// client/v2/export/sections/video-model.js — S8.6: the video part of the Export sheet, as pure functions.
//
// What the sheet shows for a video artboard — the formats (the artboard and its linked formats, each with
// a tick), the picture size, the sound file, captions, the C22 warning — and what each choice does to the
// spec. No React, no fetch: a test drives it directly. The numbers (length, cap) come from the SERVER's
// estimate (`est.video`); the sheet only says them. What may be exported is decided there, not here.

import { videoExportContent } from '../video-content.js';

export const TEMPORAL = new Set(['mp4', 'webm', 'gif', 'audio']);
/** Past this many frames a video warns (2 min at 30 fps; the server's DEFAULT_MAX_FRAMES). */
export const WARN_FRAMES = 3600;

/** The estimate's video rows, kept by artboard in the order first seen — unticking one must not drop it from the list. */
export function mergeRows(prev, next) {
  if (!Array.isArray(next) || next.length === 0) return prev;
  const byId = new Map(prev.map((r) => [r.artboard, r]));
  let changed = false;
  for (const r of next) {
    const old = byId.get(r.artboard);
    if (!old || JSON.stringify(old) !== JSON.stringify(r)) {
      byId.set(r.artboard, r);
      changed = true;
    }
  }
  return changed ? [...byId.values()] : prev;
}

/**
 * The formats on offer. A Selection: the selected artboards and the formats around them. This canvas (07
 * ve-export, S7.19): every format of the canvas, once the estimate has said that some video has more than one.
 * The other scopes export everything they reach, so there is nothing to tick. `base` = the selected artboard
 * ids; `rows` = what the estimate knows.
 */
export function formatsFor({ scope, canvas, base, rows }) {
  if (scope === 'selection') return videoExportContent(canvas, base, rows).formats;
  if (scope === 'canvas' && rows.some((r) => Array.isArray(r.formats) && r.formats.length > 1))
    return videoExportContent(canvas, [], rows).formats;
  return [];
}

/** Does the cut have speech to caption? (S7.19: the estimate's rows say; none = no.) */
export const captionsFor = (canvas, base, rows) =>
  videoExportContent(canvas, base, rows).captions.available === true;

/**
 * S7.19 — the artboard's own stored ceiling (`artboardMeta[id].maxFrames`, set by Timeline › Allow longer) starts the
 * sheet with Allow longer ON. The server's rule is unchanged (S8.6: stored is a ceiling, not a switch — `capFor`);
 * this is only the sheet's default, and the person can turn it off.
 */
export const allowLongerDefault = (canvas, ids, rows) =>
  videoExportContent(canvas, ids, rows).maxFrames !== null;

/** A tick the person set wins; else the format's own default. */
export function tickedIds(formats, overrides = {}) {
  return formats.filter((f) => overrides[f.artboardId] ?? f.ticked).map((f) => f.artboardId);
}

/** Flip one tick. The last ticked format cannot be unticked — there would be nothing to export. */
export function toggleTick(formats, overrides = {}, id) {
  const on = tickedIds(formats, overrides);
  const next = !on.includes(id);
  if (!next && on.length <= 1) return overrides;
  return { ...overrides, [id]: next };
}

/** What the spec builder needs: the ids to export and whether a linked format is among them. */
export function videoCtx(formats, overrides = {}) {
  const ids = tickedIds(formats, overrides);
  const linked = formats.some((f) => f.linked && ids.includes(f.artboardId));
  return { ids, linked };
}

/**
 * S7.19 — a canvas export with some of its formats unticked is, for the server, a selection of the ticked ones
 * (the same canvas, `selection.artboards`): the sheet still says "This canvas".
 */
export const isPartial = (scope, formats, ids) =>
  scope === 'canvas' && formats.length > 0 && ids.length < formats.length;

/** The rows the export reaches: the ticked ones for a Selection, else everything the estimate lists. */
export function reached(rows, ids, scope) {
  if (scope !== 'selection' || ids.length === 0) return rows;
  return rows.filter((r) => ids.includes(r.artboard));
}

/** The pixel size a quality makes of a row: "1080 × 1920" at 1080p, "2160 × 3840" at 4K. */
export function sizeWords(row, scale) {
  if (!row?.w || !row?.h) return '';
  return `${Math.round(row.w * scale)} × ${Math.round(row.h * scale)}`;
}

/**
 * The scale the picked quality asks the engine for. 1080p and 4K are NAMES of a size — the shorter side is 1080 or
 * 2160 px — so a 1080 × 1920 Reel is ×1 / ×2 and a 480 × 270 comp is ×4 (the spec allows up to 4; past it the
 * quality cannot be reached and the chip is switched off, see `qualityReaches`). `shortSide` = the artboard's own
 * shorter side.
 */
export const QUALITY_SIDE = { '1080p': 1080, '4k': 2160 };
const SCALE_MIN = 0.25;
const SCALE_MAX = 4;
export function scaleOf(vq, shortSide = null) {
  const edge = QUALITY_SIDE[vq] ?? QUALITY_SIDE['1080p'];
  if (!(shortSide > 0)) return vq === '4k' ? 2 : 1;
  const k = Math.round((edge / shortSide) * 1000) / 1000;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, k));
}
/** Does this quality make a different picture from the one below it? (A comp too small for 4K clamps to the same size.) */
export const qualityReaches = (vq, shortSide) =>
  vq !== '4k' || scaleOf('4k', shortSide) > scaleOf('1080p', shortSide);

/**
 * The C22 state of the rows this export reaches: nothing to say, a warning with a way out, a note that the
 * longer limit is on, or a warning that even the longer limit is passed (the server will refuse).
 */
export function lengthState(rows, allowLonger) {
  const long = rows.filter((r) => typeof r.frames === 'number' && r.frames > WARN_FRAMES);
  if (long.length === 0) return { kind: 'ok' };
  const worst = long.reduce((a, b) => (b.frames > a.frames ? b : a));
  if (!allowLonger) return { kind: 'warn', row: worst };
  const past = long.find((r) => r.over);
  if (past) return { kind: 'past', row: past };
  return { kind: 'longer', row: worst };
}

/** How many files the export makes: one per ticked video (Sound only is one file per video too). */
export const fileCount = (ids, rows) => Math.max(1, ids.length || rows.length);
