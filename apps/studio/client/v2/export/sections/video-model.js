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
 * The formats on offer: only for a Selection (the other scopes export every video artboard they reach,
 * so there is nothing to tick). `base` = the selected artboard ids; `rows` = what the estimate knows.
 */
export function formatsFor({ scope, canvas, base, rows }) {
  if (scope !== 'selection') return [];
  return videoExportContent(canvas, base, rows).formats;
}

/** Does the comp have speech to caption? (S7's selector says; the fallback says no.) */
export const captionsFor = (canvas, base, rows) =>
  videoExportContent(canvas, base, rows).captions.available === true;

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

/** The rows the export reaches: the ticked ones for a Selection, else everything the estimate lists. */
export function reached(rows, ids, scope) {
  if (scope !== 'selection' || ids.length === 0) return rows;
  return rows.filter((r) => ids.includes(r.artboard));
}

/** The pixel size of a quality for a row: "1080 × 1920" at 1080p, twice that at 4K. */
export function sizeWords(row, scale) {
  if (!row?.w || !row?.h) return '';
  return `${row.w * scale} × ${row.h * scale}`;
}

/** The scale the picked quality asks the engine for. */
export const scaleOf = (vq) => (vq === '4k' ? 2 : 1);

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
