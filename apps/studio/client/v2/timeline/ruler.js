// client/v2/timeline/ruler.js — S7.8: the ruler's steps and words (07 · ve-play).
//
// The canvas draws m:ss ticks "auto-stepped 1/3/5/10/30/60 s by span" — the visible length decides the step,
// so a 15 s reel reads 0:00 · 0:03 · 0:06 …, a 0:30 recap 0:05 · 0:10 …, and a long cut 0:30 · 1:00. Zooming
// in past a second falls back to the frame ladder (`timeline-scale.js`), which stays the one source of the
// sub-second ticks. While the playhead is stepped by hand the time reads "0:07 + 2 frames", so the frame you
// are on is never a guess (07 · ve-play, the note: "the time shows the frame while you step").

import { tickStepFrames } from '../../panels/timeline-scale.js';

/** The steps a ruler may take, in seconds. */
export const RULER_STEPS_S = [1, 3, 5, 10, 30, 60];

/** The step the canvas picks for a visible span of `spanSec` seconds (≤ 12 s: 1 · ≤ 16: 3 · ≤ 32: 5 · ≤ 70: 10 · ≤ 5 min: 30 · more: 60). */
export function spanStepSeconds(spanSec) {
  const s = Number.isFinite(spanSec) ? spanSec : 0;
  if (s <= 12) return 1;
  if (s <= 16) return 3;
  if (s <= 32) return 5;
  if (s <= 70) return 10;
  if (s <= 300) return 30;
  return 60;
}

/**
 * The distance between two ruler ticks, in frames.
 * @param {{ pxPerFrame: number, fps: number, spanFrames: number, minPx?: number }} p
 */
export function rulerStepFrames({ pxPerFrame, fps, spanFrames, minPx = 56 }) {
  const f = Math.max(1, Math.round(fps || 30));
  const fine = tickStepFrames(pxPerFrame, f, minPx);
  if (fine < f) return fine; // zoomed in past a second: frame ticks
  let i = RULER_STEPS_S.indexOf(spanStepSeconds(spanFrames / f));
  // never closer than the labels can breathe
  while (i < RULER_STEPS_S.length - 1 && RULER_STEPS_S[i] * f * pxPerFrame < minPx) i++;
  return RULER_STEPS_S[i] * f;
}

/** `m:ss` for a whole number of seconds (the ruler's, the readout's). */
export function mss(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A tick label: whole seconds read `m:ss`, a sub-second tick reads its frame number. */
export function rulerLabel(frame, fps) {
  const f = Math.max(1, Math.round(fps || 30));
  return frame % f === 0 ? mss(frame / f) : `${frame}f`;
}

/**
 * The time readout. Normally `0:07`; while stepping by hand, `0:07 + 2 frames` (nothing added on a whole
 * second, "1 frame" in the singular).
 */
export function readoutLabel(frame, fps, stepping = false) {
  const f = Math.max(1, Math.round(fps || 30));
  const whole = Math.floor(Math.max(0, frame) / f);
  const extra = Math.max(0, Math.round(frame)) - whole * f;
  if (!stepping || extra === 0) return mss(whole);
  return `${mss(whole)} + ${extra} ${extra === 1 ? 'frame' : 'frames'}`;
}
