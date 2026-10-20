// client/v2/timeline/other-takes-model.js — S7.15 (07 · ve-ai-adjust): "Other takes". A clip's source usually holds
// more than one good moment; `assets/<sha8>.footage.json` lists them as `shots[]`. A take is another shot of the
// SAME source, swapped in at the SAME length — so nothing ripples and the cut stays on the beat. The swap is a
// person's ordinary edit (`video.take.swap`, edit-ops/clip/take-swap.ts); this file only decides what is offered.
//
// Pure. The inputs are numbers read from the clip and from the footage analysis; the words are built here.

import { clock } from './ai-edge-model.js';

/** A take must be at least as long as the clip; allow a hair for rounding at the frame. */
const EPS = 0.02;

export const TAKES_WORDS = Object.freeze({
  title: (name) => `Other takes · ${name}`,
  foot: 'Click a take to swap it in. Same length, same beat.',
  pick: 'AI’s pick',
  here: 'In the cut',
  readOnly: 'Ask the owner to change this.',
  none: 'This clip has no other takes.',
  unwatched: 'AI hasn’t watched this clip yet, so there are no takes to offer.',
  failed: 'Not swapped — the clip stays as it was.',
  swapped: 'Take swapped.',
});

const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const quality = (s) => (finite(s?.quality) ? s.quality : 0);
const secs = (n) => `${Math.round(n * 10) / 10} s`;

/**
 * The takes a clip can swap to.
 * @param {{
 *   shots: Array<{ start: number, end: number, quality?: number, usable?: boolean }> | null | undefined,
 *   lengthFrames: number,         // the clip's length on the timeline (frames)
 *   fps: number,
 *   rate?: number,                // playbackRate of the media (1)
 *   trimBeforeFrames?: number,    // where the clip's media starts now, in output frames (DDR-163)
 *   sourceSeconds?: number,       // the source's own length, when known
 * }} p
 * @returns {{ lenSec: number, takes: Array<{ srcStart: number, srcEnd: number, label: string, len: string,
 *   current: boolean, pick: boolean }>, canSwap: boolean }}
 */
export function takesOf({
  shots,
  lengthFrames,
  fps,
  rate = 1,
  trimBeforeFrames = 0,
  sourceSeconds,
}) {
  const f = finite(fps) && fps > 0 ? fps : 30;
  const r = finite(rate) && rate > 0 ? rate : 1;
  const lenSec = finite(lengthFrames) && lengthFrames > 0 ? (lengthFrames * r) / f : 0;
  if (!lenSec || !Array.isArray(shots)) return { lenSec, takes: [], canSwap: false };

  const at = finite(trimBeforeFrames) ? trimBeforeFrames / f : 0;
  const usable = shots.filter(
    (s) =>
      s && finite(s.start) && finite(s.end) && s.usable !== false && s.end - s.start >= lenSec - EPS
  );
  // AI's pick: the strongest usable shot (the director's own criterion), the earliest on a tie
  let best = null;
  for (const s of usable) if (!best || quality(s) > quality(best)) best = s;

  const fits = (start) => !finite(sourceSeconds) || start + lenSec <= sourceSeconds + EPS;
  const rows = usable
    .filter((s) => fits(s.start))
    .map((s) => {
      // the clip's own window when it sits inside this shot: the take it is already on
      const current = at >= s.start - EPS && at + lenSec <= s.end + EPS;
      const srcStart = current ? at : s.start;
      return {
        srcStart,
        srcEnd: srcStart + lenSec,
        label: `${clock(srcStart)}–${clock(srcStart + lenSec)}`,
        len: secs(lenSec),
        current,
        pick: s === best,
      };
    })
    .sort((a, b) => a.srcStart - b.srcStart);
  // two shots can both contain the clip's window; only the first is "in the cut"
  let seen = false;
  for (const t of rows) {
    if (!t.current) continue;
    if (seen) t.current = false;
    seen = true;
  }
  return { lenSec, takes: rows, canSwap: rows.some((t) => !t.current) };
}

/** The params of the swap, for `video.take.swap`. */
export function swapParams(take, sourceSeconds) {
  return {
    srcStart: Math.round(take.srcStart * 1000) / 1000,
    ...(finite(sourceSeconds) && sourceSeconds > 0 ? { sourceSeconds } : {}),
  };
}
