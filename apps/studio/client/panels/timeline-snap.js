// timeline-snap.js — DDR-150 P5/Polish (Task 15). Pure snap helpers for the
// Timeline clip drags (move `from` / trim duration). A dragged edge snaps to the
// nearest "meaningful" frame — a second tick, a neighbor clip's edge, or the
// playhead — within a pixel-derived threshold, UNLESS the user holds Alt (the
// override modifier). Pure + exported so the behavior is unit-tested without a
// DOM (timeline-snap.test.ts).

/**
 * The frames a dragged clip edge should snap to:
 *   • 0 and the comp end (totalFrames)
 *   • every whole-second tick (multiples of fps)
 *   • every OTHER clip's start + end (skip the clip being dragged)
 *   • the playhead
 *   • (S7.12) every beat of the music, when the caller passes `beats` (Snap to the beat on)
 * Deduped + clamped to [0, totalFrames]. `clips` is the parsed sequence list
 * ({ from, duration }); `movingIndex` is excluded so a clip never snaps to itself.
 */
export function computeSnapTargets({ fps, totalFrames, clips, movingIndex, playhead, beats }) {
  const targets = new Set([0, totalFrames]);
  const step = Math.max(1, Math.round(fps || 30));
  for (let f = 0; f <= totalFrames; f += step) targets.add(f);
  (clips || []).forEach((c, i) => {
    if (i === movingIndex) return;
    const from = Number.isFinite(c?.from) ? c.from : 0;
    const dur = Number.isFinite(c?.duration) ? c.duration : 0;
    targets.add(from);
    targets.add(from + dur);
  });
  if (Number.isFinite(playhead)) targets.add(playhead);
  // S7.12 — Snap to the beat: the music's beats (comp frames) when `artboardMeta.snap` is on (compBeats).
  for (const b of beats || []) if (Number.isFinite(b)) targets.add(Math.round(b));
  return [...targets].filter((t) => t >= 0 && t <= totalFrames).sort((a, b) => a - b);
}

/**
 * Snap `candidate` to the nearest target within `threshold` frames (ties go to
 * the closer, then the first). Returns `candidate` unchanged when nothing is in
 * range or `threshold <= 0` (the Alt-override path passes 0). Pure.
 */
export function snapFrame(candidate, targets, threshold) {
  if (!(threshold > 0)) return candidate;
  let best = candidate;
  let bestD = threshold + 1;
  for (const t of targets || []) {
    const d = Math.abs(candidate - t);
    if (d <= threshold && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Pixel snap radius → frames, given the row width + total frames. ~8px feels right. */
export function snapThresholdFrames(rowW, totalFrames, px = 8) {
  const w = Math.max(1, rowW || 1);
  return (px / w) * Math.max(1, totalFrames - 1);
}
