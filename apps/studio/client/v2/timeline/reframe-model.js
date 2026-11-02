// client/v2/timeline/reframe-model.js — S7.13 (07 · ve-reframe): "Each format frames each clip its own way."
//
// The Re-frame island shows the clip's WHOLE source picture with the window one format cuts out of it, and the person drags
// that window. What it writes is a focus keyframe — `[sourceSec, x, y]`, x and y the window's centre as fractions of the
// source frame — on the clip's `<Reframe>` (`video.reframe`): for "This format" into `formats["W:H"]`, for "All formats"
// into the shared `focus`. The time is SOURCE time, not comp time (V2-1.10 §5.3), so a trim or a move of the clip leaves
// every keyframe on the same moment of the footage. B3 fallback: no subject tracking — the centre and your own keyframes.
//
// Pure: the numbers and the words. The geometry is the renderer's own (video/framing.ts), so the island shows the window the
// export will cut.

import { aspectKey, focusAt, reframeWindow, sourceSecond } from '../../../video/framing.ts';

export { aspectKey };

/** Words for the format seg: the picture's own aspect as the canvas names it ("Reels 9:16", "16:9", "1:1"). */
export function formatLabel(row) {
  return row?.current && row?.name ? row.name : (row?.aspect ?? row?.name ?? '');
}

/** The format seg's options, one per linked artboard (document order); a format twice would be one window. */
export function formatOptions(formats) {
  const seen = new Set();
  const out = [];
  for (const f of formats ?? []) {
    if (!f?.aspect || !f.w || !f.h || seen.has(f.aspect)) continue;
    seen.add(f.aspect);
    out.push({ aspect: f.aspect, label: formatLabel(f), w: f.w, h: f.h, artboardId: f.artboardId });
  }
  return out;
}

/** The format the island opens on: the selected video's own, else the first linked one. */
export const defaultFormat = (options, currentArtboardId) =>
  (options.find((o) => o.artboardId === currentArtboardId) ?? options[0] ?? null)?.aspect ?? null;

/**
 * The source second the playhead is on, for a clip: its own frame (clamped into the clip) through the trim and the
 * speed. THE conversion that keeps a keyframe on its moment of footage when the clip is trimmed or moved.
 * @param {number} frame the comp's playhead frame
 * @param {{ from?: number|null, duration?: number|null, mediaProps?: { trimBefore?: number|null, playbackRate?: number|null }|null }} seq
 */
export function playheadSourceSec(frame, seq, fps) {
  const f = Math.max(1, Math.round(fps) || 30);
  const from = seq?.from ?? 0;
  const dur = Math.max(1, seq?.duration ?? 1);
  const own = Math.min(Math.max(0, Math.round(frame) - from), dur);
  const rate = seq?.mediaProps?.playbackRate > 0 ? seq.mediaProps.playbackRate : 1;
  const t = sourceSecond(own, seq?.mediaProps?.trimBefore ?? 0, rate, f);
  return Math.round(t * 1000) / 1000;
}

/** A keyframe's time is held to a thousandth of a second, so a second drag on the same frame REPLACES the first. */
export const roundSec = (t) => Math.round(Math.max(0, t) * 1000) / 1000;

/**
 * The window a format cuts, as fractions of the source frame (what the island draws over the picture).
 * @param {readonly [number, number]} focus x, y fractions
 * @param {{ w: number, h: number }} src the source picture, px
 * @param {{ w: number, h: number }} out the format, px
 */
export function windowFractions(focus, src, out, zoom = 1) {
  const w = reframeWindow(focus, src, out, zoom);
  return { left: w.x / src.w, top: w.y / src.h, width: w.w / src.w, height: w.h / src.h };
}

/** The range of centres a window of this size can take without leaving the picture (fractions). */
export function focusRange(src, out, zoom = 1) {
  const win = windowFractions([0.5, 0.5], src, out, zoom);
  return {
    x: [win.width / 2, 1 - win.width / 2],
    y: [win.height / 2, 1 - win.height / 2],
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * The focus after dragging the window by (dx, dy) screen px over a picture drawn `box` px wide and tall. A window as
 * wide as the picture cannot move that way, so its range collapses to the centre. Rounded to four places: the file
 * keeps what the eye can tell apart, not a float's tail.
 */
export function dragFocus(start, dx, dy, box, src, out, zoom = 1) {
  const range = focusRange(src, out, zoom);
  const nx = start[0] + (box.w > 0 ? dx / box.w : 0);
  const ny = start[1] + (box.h > 0 ? dy / box.h : 0);
  return [r4(clamp(nx, range.x[0], range.x[1])), r4(clamp(ny, range.y[0], range.y[1]))];
}

/** Keyframes with `[t, x, y]` set: replaces a key at the same (rounded) time, keeps the list sorted. */
export function upsertKey(keys, t, x, y) {
  const at = roundSec(t);
  const rest = (keys ?? []).filter((k) => roundSec(k[0]) !== at);
  return [...rest, [at, x, y]].sort((a, b) => a[0] - b[0]);
}

/** The keyframes the island edits for a scope: "This format" → that format's own; "All formats" → the shared ones. */
export function keysFor(reframe, scope, aspect) {
  if (scope === 'all') return reframe?.focus ?? [];
  return reframe?.formats?.[aspect] ?? [];
}

/**
 * Where the window sits at source second `t` for what the island is showing. "This format" shows that format's own
 * window (its keyframes, else the shared ones, else the centre — the renderer's rule); "All formats" shows the shared
 * ones, which is what every format without keys of its own gets.
 */
export function focusShown(reframe, scope, aspect, t, out) {
  const own = scope === 'all' ? undefined : reframe?.formats;
  return focusAt(t, reframe?.focus, own, out);
}

/** The `video.reframe` params for dropping the window at `focus` on source second `t`. */
export function dropParams(reframe, scope, aspect, t, focus) {
  const keys = upsertKey(keysFor(reframe, scope, aspect), t, focus[0], focus[1]);
  return scope === 'all' ? { focus: keys } : { focus: keys, format: aspect };
}

/** Reset: the centre again — every keyframe of this scope goes. (B3: no `<Reframe>` left to say anything.) */
export function resetParams(scope, aspect) {
  return scope === 'all' ? { focus: null } : { focus: null, format: aspect };
}

/** Has anything been framed in this scope? (Reset is only offered then.) */
export const isFramed = (reframe, scope, aspect) => keysFor(reframe, scope, aspect).length > 0;

/** "No keyframes yet — centred" / "1 keyframe" / "3 keyframes". */
export function keyframeWords(n) {
  if (!n) return 'Centred. Drag the window to frame it.';
  return n === 1 ? '1 keyframe' : `${n} keyframes`;
}

/** The window's tag on the picture ("Reels 9:16"). */
export const windowTag = (option) => option?.label ?? '';
