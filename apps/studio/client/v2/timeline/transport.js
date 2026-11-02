// client/v2/timeline/transport.js — S7.8: play, step and the loop band, as pure rules (07 · ve-play).
//
//   · tap Space plays the selected video in place, with sound; tap again pauses (`playPlan`);
//   · ← / → one frame, ⇧← / ⇧→ one second (`stepTarget`), clamped to the cut;
//   · I and O set the loop band's ends at the playhead (`setLoopIn` / `setLoopOut`), a band is `{ in, out }` in
//     frames with `out` exclusive; with Loop on, playback that reaches `out` jumps back to `in` (`loopJump`).
// The shell and the Timeline both call these, so a key and a button can never disagree.

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** The frame a step lands on. `dir` is -1 or 1; `shift` makes it a second. */
export function stepTarget({ frame, dir, shift = false, fps = 30, total }) {
  const by = shift ? Math.max(1, Math.round(fps)) : 1;
  const last = Math.max(0, Math.round(total ?? 1) - 1);
  return clamp(Math.round(frame) + (dir < 0 ? -by : by), 0, last);
}

/** I: the band starts at the playhead; an end that is missing or behind it becomes the end of the cut. */
export function setLoopIn(band, frame, total) {
  const last = Math.max(1, Math.round(total ?? 1));
  const inF = clamp(Math.round(frame), 0, last - 1);
  const out = band && band.out > inF ? band.out : last;
  return { in: inF, out };
}

/** O: the band ends at the playhead; a start that is missing or past it becomes the start of the cut. */
export function setLoopOut(band, frame, total) {
  const last = Math.max(1, Math.round(total ?? 1));
  const out = clamp(Math.round(frame), 1, last);
  const inF = band && band.in < out ? band.in : 0;
  return { in: inF, out };
}

/** A band worth drawing: at least a frame long. */
export const isBand = (b) => !!b && Number.isFinite(b.in) && Number.isFinite(b.out) && b.out > b.in;

/** The frame to seek to when playback has reached the end of the band, else null. */
export function loopJump(band, frame, looping) {
  if (!looping || !isBand(band)) return null;
  return frame >= band.out ? band.in : null;
}

/** Is `frame` inside the band (the lane tint's rule)? */
export const inBand = (band, frame) => isBand(band) && frame >= band.in && frame < band.out;

/**
 * What a play / pause toggle sends the canvas, in order, and the playing state it leaves. Sound is
 * synced first (the artboard has no chrome — the Timeline owns sound), then loop, then play. A playhead
 * parked at the very end starts again from the top, or from the band's start when there is one.
 */
export function playPlan({ playing, muted, loop, compId, frame, total, band }) {
  if (playing)
    return { playing: false, seekTo: null, messages: [{ dgn: 'timeline-pause', id: compId }] };
  const atEnd = Number.isFinite(total) && total > 0 && frame >= total - 1;
  const seekTo =
    isBand(band) && (frame < band.in || frame >= band.out) ? band.in : atEnd ? 0 : null;
  return {
    playing: true,
    seekTo,
    messages: [
      { dgn: 'timeline-mute', muted: !!muted, id: compId },
      { dgn: 'timeline-loop', loop: !!loop, id: compId },
      { dgn: 'timeline-play', id: compId },
    ],
  };
}
