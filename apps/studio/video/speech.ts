// apps/studio/video/speech.ts — S7.2, V2-1.10 §5.6 step 7 and the `--speech-only` fallback.
//
// Speech regions are what ducking and "find speech" read from `<sha8>.transcript.json`:
//   - FROM WORDS (the default): words with p ≥ 0.35 that have a voiced frame and are not
//     loop-flagged, padded 0.12 s, merged across gaps < 0.8 s. Computed on a clip's OWN audio, never
//     on a mix (energy cannot tell a crowd from a voice, and fails as soon as there is music under
//     the speech: false speech 34–97 s of 113 s, against 0–1.4 s for words — §6.2). A loop-flagged
//     word is left out until a person confirms it (Q1).
//   - FROM ENERGY (the labelled fallback, `speech.source: "energy"`): band-limited 150 Hz – 4 kHz
//     energy, −35 dBFS, a silence shorter than 0.35 s does not end a region.
//
// Pure. Regions are source seconds, 3 decimals, sorted and disjoint (the strict writer checks).

import { round3, type TranscriptWord } from './schema.ts';
import { frameDb, HOP_SEC } from './words-timing.ts';

export const SPEECH_MIN_P = 0.35;
export const SPEECH_PAD_SEC = 0.12;
export const SPEECH_MERGE_GAP_SEC = 0.8;
export const ENERGY_BAND_HZ: readonly [number, number] = [150, 4000];
export const ENERGY_THRESHOLD_DB = -35;
export const ENERGY_SILENCE_SEC = 0.35;
/** An energy burst shorter than this (a click, a cough) is not speech. */
export const ENERGY_MIN_REGION_SEC = 0.1;

export type Region = [number, number];

/** Words → speech regions (default sources). `voiced[i]` is whether word i has a voiced frame. */
export function speechRegionsFromWords(
  words: readonly TranscriptWord[],
  voiced: readonly boolean[],
  durationSec?: number
): Region[] {
  const out: Region[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!voiced[i]) continue;
    if (w.flags?.includes('loop')) continue;
    if (w.p !== undefined && w.p < SPEECH_MIN_P) continue;
    const s = Math.max(0, w.t0 - SPEECH_PAD_SEC);
    const e = w.t1 + SPEECH_PAD_SEC;
    const last = out[out.length - 1];
    if (last && s - last[1] < SPEECH_MERGE_GAP_SEC) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out.map(([s, e]) => [
    round3(s),
    round3(durationSec !== undefined ? Math.min(e, durationSec) : e),
  ]);
}

export function speechSeconds(regions: readonly Region[]): number {
  let s = 0;
  for (const [a, b] of regions) s += b - a;
  return round3(s);
}

// ── the energy fallback ────────────────────────────────────────────────────────────────────────

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ cookbook, Q = 1/√2 (Butterworth). */
function biquad(kind: 'hp' | 'lp', fc: number, sr: number): Biquad {
  const w0 = (2 * Math.PI * fc) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b =
    kind === 'hp'
      ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2]
      : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function run(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** 150 Hz – 4 kHz, 4th order each side (two cascaded Butterworth biquads). */
export function bandLimit(pcm: Float32Array, sampleRate: number): Float32Array {
  const hp = biquad('hp', ENERGY_BAND_HZ[0], sampleRate);
  const lp = biquad('lp', Math.min(ENERGY_BAND_HZ[1], sampleRate / 2 - 100), sampleRate);
  return run(run(run(run(pcm, hp), hp), lp), lp);
}

/** `--speech-only`: regions from band-limited energy. Labelled `source: "energy"` by the caller. */
export function energySpeechRegions(pcm: Float32Array, sampleRate: number): Region[] {
  const db = frameDb(bandLimit(pcm, sampleRate), sampleRate, HOP_SEC);
  const closeFrames = Math.round(ENERGY_SILENCE_SEC / HOP_SEC);
  const minFrames = Math.round(ENERGY_MIN_REGION_SEC / HOP_SEC);
  const regs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const on = i < db.length && db[i] > ENERGY_THRESHOLD_DB;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      regs.push([start, i]);
      start = -1;
    }
  }
  const merged: Array<[number, number]> = [];
  for (const r of regs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < closeFrames) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged
    .filter(([a, b]) => b - a >= minFrames)
    .map(([a, b]) => [round3(a * HOP_SEC), round3(b * HOP_SEC)] as Region);
}
