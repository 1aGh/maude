// client/v2/timeline/zoom.js — S7.16: what a 40-clip video does when it is zoomed out (07 · ve-long).
//
// The zoom itself is the Timeline's (fit-to-width as the floor, ⌘+ / ⌘− and the slider, 0 = fit; `timeline.zoom-in`,
// `timeline.zoom-out`, `timeline.zoom-fit` in the registry). What a long video adds is words: a block too narrow to
// read hides its name, and the name comes back on hover with where the clip is from and how long it is —
// "Akce 22 · caaftv-td-run · 0:09". The ruler's own step (1 / 3 / 5 / 10 / 30 / 60 s) is ruler.js.
//
// PURE: numbers and words in, words out.

import { mss } from './ruler.js';

/** A block narrower than this (px) draws no name — there is no room to read one. */
export const NAME_MIN_PX = 72;

/** Does a block of this width have room for its name? */
export const nameVisible = (widthPx) => Number.isFinite(widthPx) && widthPx >= NAME_MIN_PX;

/** `caaftv-td-run.mp4` → `caaftv-td-run` (the file a clip plays, without the extension). */
const stem = (src) =>
  String(src ?? '')
    .replace(/[?#].*$/, '')
    .split('/')
    .pop()
    ?.replace(/\.[A-Za-z0-9]{1,5}$/, '') || '';

/**
 * The hover line of a clip: its name, the file it plays when that is a different word, and its length.
 * @param {{ name: string, src?: string|null, frames: number, fps: number }} c
 */
export function clipTip({ name, src, frames, fps }) {
  const f = Math.max(1, Math.round(fps) || 30);
  const file = stem(src);
  const parts = [name];
  if (file && file.toLowerCase() !== String(name).toLowerCase()) parts.push(file);
  parts.push(mss(Math.max(0, frames) / f));
  return parts.join(' · ');
}
