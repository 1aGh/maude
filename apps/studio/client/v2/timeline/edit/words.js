// client/v2/timeline/edit/words.js — S7.9: what a gesture says before the pointer lets go (07 · ve-drop,
// ve-trim-split, ve-move-transition). Every line is CONTRACT §3–§4: a count with a noun that reads for 1 and for
// many, a time as m:ss, a length in seconds with one decimal, and the minus sign a designer would type (−, not -).

import { mss } from '../ruler.js';

const FPS = (fps) => Math.max(1, Math.round(fps || 30));

/** `2.4 s` for a number of frames. */
export function secondsText(frames, fps) {
  return `${(Math.max(0, frames) / FPS(fps)).toFixed(1)} s`;
}

/** `−0.6 s` / `+0.5 s`, and "no change" when the gesture ends where it began. */
export function signedSecondsText(deltaFrames, fps) {
  const d = Math.round(deltaFrames);
  if (d === 0) return 'no change';
  const s = (Math.abs(d) / FPS(fps)).toFixed(1);
  return `${d < 0 ? '−' : '+'}${s} s`;
}

/** The video's length as m:ss. */
export const videoText = (frames, fps) => `video ${mss(Math.max(0, frames) / FPS(fps))}`;

/**
 * The tip beside a trimmed edge: `Touchdown · 2.4 s` over `−0.6 s · video 0:14`.
 * @param {{ name: string, frames: number, deltaFrames: number, totalFrames: number, fps: number }} p
 */
export function trimTip({ name, frames, deltaFrames, totalFrames, fps }) {
  return {
    title: `${name} · ${secondsText(frames, fps)}`,
    dim: `${signedSecondsText(deltaFrames, fps)} · ${videoText(totalFrames, fps)}`,
  };
}

/** The toast after S: `Split Oslava at 0:10.` */
export function splitToastText(name, frame, fps) {
  return `Split ${name} at ${mss(Math.max(0, frame) / FPS(fps))}.`;
}

/**
 * The tip over a drop: `Drop 3 clips at 0:09` over `the video grows by 0:20`.
 * `atFrame: null` = the drop is over the artboard, where clips go to the end; `addedFrames: null` = the
 * footage's length is not known until it lands, so no number is invented.
 * @param {{ count: number, atFrame: number | null, addedFrames: number | null, fps: number }} p
 */
export function dropTip({ count, atFrame, addedFrames, fps }) {
  const n = Math.max(1, Math.round(count || 1));
  const where = atFrame == null ? 'the end' : mss(Math.max(0, atFrame) / FPS(fps));
  const noun = n === 1 ? 'clip' : 'clips';
  return {
    title: `Drop ${n} ${noun} at ${where}`,
    dim:
      addedFrames == null
        ? 'the video grows by what you drop'
        : `the video grows by ${mss(Math.max(0, addedFrames) / FPS(fps))}`,
  };
}

/** The line under a lifted beat: `Drop before Touchdown`, `Drop after Huddle`, or `Drop here` (it stayed). */
export function moveTip(landing, names) {
  if (!landing) return 'Drop here';
  const name = names[landing.refSlot];
  return `Drop ${landing.position} ${name ?? 'the next clip'}`;
}
