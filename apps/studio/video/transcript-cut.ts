// video/transcript-cut.ts — `transcriptCut` (V2-1.10 §5.6 "Edit-by-transcript cut"), moved out of
// derive.ts (which re-exports it, so every caller keeps its import) so the `cut-words` verb reaches
// it without the canvas parser's import closure (S7.6c; DDR-177 helper deps). Pure: no IO.

import type { Transcript, TranscriptWord } from './schema.ts';

const MIN_GAP_SEC = 0.06;
const SNAP_SEC = 0.05;
const ENERGY_FRAME_SEC = 0.01;
const VOICED_DB = -35;

/** The quietest 10 ms frame within ±50 ms of `t`, the one nearest `t` on a tie. Index, not seconds. */
function quietestFrame(energy: Float32Array, t: number): number {
  const centre = Math.floor(t / ENERGY_FRAME_SEC + 1e-6);
  const reach = Math.round(SNAP_SEC / ENERGY_FRAME_SEC);
  let best = Math.min(Math.max(centre, 0), energy.length - 1);
  for (let d = 0; d <= reach; d++) {
    for (const i of d === 0 ? [centre] : [centre - d, centre + d]) {
      if (i < 0 || i >= energy.length) continue;
      if ((energy[i] as number) < (energy[best] as number)) best = i;
    }
  }
  return best;
}

export interface TranscriptCut {
  srcStart: number;
  srcEnd: number;
  /** false when either edge is not in silence — the panel says "Cut inside a phrase — play it back to check." */
  inPause: boolean;
}

/**
 * The source range that removes the named words. An edge with a gap of ≥ 60 ms to its neighbour is
 * cut at the gap's midpoint; otherwise at the quietest 10 ms frame within ±50 ms of the word edge
 * (the word edge itself when no energy is given). `energy` is one value per 10 ms of the source
 * (linear level); a frame is voiced above max − 35 dB. With `opts.fps` both edges are quantised to
 * output frames.
 */
export function transcriptCut(
  t: Transcript,
  wordIds: readonly string[],
  energy?: Float32Array,
  opts: { fps?: number } = {}
): TranscriptCut {
  const ids = new Set(wordIds);
  const words = t.words;
  let first = -1;
  let last = -1;
  words.forEach((w, i) => {
    if (!ids.has(w.id)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) throw new Error('transcriptCut: none of the words are in the transcript');
  const a = (words[first] as TranscriptWord).t0;
  const b = (words[last] as TranscriptWord).t1;
  const prevEnd = first > 0 ? (words[first - 1] as TranscriptWord).t1 : 0;
  const nextStart =
    last < words.length - 1 ? (words[last + 1] as TranscriptWord).t0 : (t.durationSec ?? b + 0.12);

  const edge = (word: number, other: number, midpointOk: boolean) => {
    if (midpointOk) return { at: (word + other) / 2, pause: true };
    if (!energy || energy.length === 0) return { at: word, pause: false };
    const i = quietestFrame(energy, word);
    return { at: i * ENERGY_FRAME_SEC, pause: false };
  };
  const s = edge(a, prevEnd, a - prevEnd >= MIN_GAP_SEC - 1e-9);
  const e = edge(b, nextStart, nextStart - b >= MIN_GAP_SEC - 1e-9);
  let srcStart = s.at;
  let srcEnd = e.at;
  if (opts.fps && opts.fps > 0) {
    srcStart = Math.round(srcStart * opts.fps) / opts.fps;
    srcEnd = Math.round(srcEnd * opts.fps) / opts.fps;
  }

  let inPause: boolean;
  if (energy && energy.length > 0) {
    let max = 0;
    for (const v of energy) if (v > max) max = v;
    const floor = max * 10 ** (VOICED_DB / 20);
    const silent = (sec: number) => {
      const i = Math.min(energy.length - 1, Math.max(0, Math.floor(sec / ENERGY_FRAME_SEC + 1e-6)));
      return (energy[i] as number) <= floor;
    };
    inPause = silent(srcStart) && silent(srcEnd);
  } else {
    inPause = s.pause && e.pause;
  }
  return { srcStart, srcEnd, inPause };
}
