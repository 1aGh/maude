// test/fixtures/video/synth.ts — deterministic synthetic speech for the S7.2 tests (and the offline
// half of the MAUDE_MEDIA_EVAL checks). No whisper, no `say`: the TRUTH is built here — a voiced
// noise burst per word on a quiet floor — and the "whisper" words are the truth shifted by a DTW lag
// with jitter. Everything is seeded; same call, same bytes.

import type { RawWord } from '../../../video/whisper-parse.ts';

export const SR = 16000;

export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface Truth {
  start: number;
  end: number;
}

/** 48 words: 0.2–0.45 s each, 0–40 ms between most, a 250–500 ms pause after every 5th. */
export function truthLine(seed = 7): { truth: Truth[]; pauses: Array<[number, number]> } {
  const r = lcg(seed);
  const truth: Truth[] = [];
  const pauses: Array<[number, number]> = [];
  let t = 0.4;
  for (let i = 0; i < 48; i++) {
    const dur = 0.2 + r() * 0.25;
    truth.push({ start: t, end: t + dur });
    t += dur;
    const gap = i % 5 === 4 ? 0.25 + r() * 0.25 : r() * 0.04;
    if (gap >= 0.15) pauses.push([t, t + gap]);
    t += gap;
  }
  return { truth, pauses };
}

/** Mono PCM: a −70 dB floor, plus a voiced noise burst inside every truth interval. */
export function synth(truth: Truth[], totalSec: number, seed = 3, sr = SR): Float32Array {
  const r = lcg(seed);
  const pcm = new Float32Array(Math.round(totalSec * sr));
  for (let i = 0; i < pcm.length; i++) pcm[i] = (r() - 0.5) * 0.001;
  for (const w of truth) {
    const a = Math.round(w.start * sr);
    const b = Math.round(w.end * sr);
    for (let i = a; i < b && i < pcm.length; i++) pcm[i] += (r() - 0.5) * 0.4;
  }
  return pcm;
}

/**
 * What whisper gives (parse + DTW): the start is the DTW time (truth + a constant lag + jitter);
 * the end is the next DTW start, capped by the SEGMENT end — which is on the segment clock (no lag)
 * and, with `-sow`, runs up to the next word, bridging every pause (V2-1.10 §6.1).
 */
export function dtwWords(truth: Truth[], lag: number, seed = 11): RawWord[] {
  const r = lcg(seed);
  const starts = truth.map((w) => w.start + lag + (r() - 0.5) * 0.06);
  return truth.map((w, i) => {
    const segTo = (truth[i + 1]?.start ?? w.end) + (r() - 0.5) * 0.04;
    const end = Math.min(
      starts[i + 1] ?? starts[i] + 0.4,
      starts[i] + 1.2,
      Math.max(segTo, starts[i] + 0.1)
    );
    return { text: `word${i}`, start: starts[i], end, p: 0.9, dtw: true };
  });
}

/** Frame-level recall/precision of predicted regions against reference regions on a 10 ms grid. */
export function regionScore(
  ref: Array<[number, number]>,
  pred: Array<[number, number]>,
  durationSec: number,
  hop = 0.01
): { recall: number; precision: number; falseSec: number } {
  const n = Math.ceil(durationSec / hop);
  const a = new Uint8Array(n);
  const b = new Uint8Array(n);
  for (const [s, e] of ref)
    for (let i = Math.floor(s / hop); i < Math.min(n, Math.ceil(e / hop)); i++) a[i] = 1;
  for (const [s, e] of pred)
    for (let i = Math.floor(s / hop); i < Math.min(n, Math.ceil(e / hop)); i++) b[i] = 1;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) tp++;
    else if (b[i]) fp++;
    else if (a[i]) fn++;
  }
  return { recall: tp / (tp + fn || 1), precision: tp / (tp + fp || 1), falseSec: fp * hop };
}
