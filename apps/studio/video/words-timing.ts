// apps/studio/video/words-timing.ts — S7.2, V2-1.10 §5.6 steps 4–6.
//
// Raw whisper words (video/whisper-parse.ts) → the transcript's words:
//   4. LAG CALIBRATION. The DTW clock runs late by a per-model, per-file lag (base.en 130–220 ms,
//      base 100–330 ms — §6.1), so a table would be wrong. The lag is measured on this file: for each
//      energy onset after a pause ≥ 150 ms, the first word starting within [−0.1, +0.6] s of it;
//      lag = the median of (word start − onset) when there are ≥ 2 such words, else 0. Subtracted
//      from every word.
//   5. ENERGY SNAP. Each word shrinks to its first and last voiced frame (looking back up to 50 ms;
//      at least 60 ms). A word with no voiced frame keeps its start and is capped at 120 ms. That is
//      what stops a word bridging a pause (51 of 51 pauses bridged raw → 4 of 51, §6.1).
//   6. LOOPS. A run of ≥ 3 identical consecutive words (case- and punctuation-folded) is flagged
//      `loop` — the whisper repetition failure on noise; ducking and captions leave them out (Q1).
//
// Pure: PCM or a dB array in, words out. The numbers are the defaults the tests pin.
// Timing is a function of the audio, never of the clock — same input, same output.

import { MAX_WORD_TEXT, round3, type TranscriptWord } from './schema.ts';
import type { RawWord } from './whisper-parse.ts';

/** The energy grid: 10 ms frames. */
export const HOP_SEC = 0.01;
/** A frame is voiced when it is within 35 dB of the loudest frame … */
export const VOICED_BELOW_MAX_DB = 35;
/** … and above this absolute floor, so a silent file is not "voiced" relative to itself. */
export const SILENCE_FLOOR_DB = -80;
/** Energy islands: gaps shorter than this are closed, islands shorter than this are dropped. */
export const CLOSE_GAP_SEC = 0.06;
export const MIN_ISLAND_SEC = 0.04;
/** A pause that makes the next voiced island an onset the DTW lag is measured on. */
export const ONSET_PAUSE_SEC = 0.15;
/** The window (relative to an onset) a word start must fall in to be matched to it. */
export const ONSET_WINDOW_SEC: readonly [number, number] = [-0.1, 0.6];
/** The snap looks back this far for a word's first voiced frame; a snapped word is at least this long. */
export const SNAP_LOOKBACK_SEC = 0.05;
export const MIN_WORD_SEC = 0.06;
/** A word with no voiced frame is held to this. */
export const UNVOICED_WORD_SEC = 0.12;
/** A run of this many identical consecutive words is a loop. */
export const LOOP_RUN = 3;

/** Voicing of one audio file on the 10 ms grid. */
export interface Voicing {
  /** 1 = voiced frame */
  mask: Uint8Array;
  /** seconds: the first voiced island, then every island that follows a pause ≥ 150 ms */
  onsets: number[];
  hop: number;
  durationSec: number;
}

/** 10 ms frame RMS in dBFS. */
export function frameDb(pcm: Float32Array, sampleRate: number, hopSec = HOP_SEC): Float32Array {
  const hop = Math.max(1, Math.round(sampleRate * hopSec));
  const n = Math.floor(pcm.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += pcm[j] * pcm[j];
    out[i] = 10 * Math.log10(s / hop + 1e-12);
  }
  return out;
}

/** Regions [t0, t1] where the mask is on; gaps < gapSec closed, regions < minSec dropped. */
export function regionsFromMask(
  mask: ArrayLike<number>,
  hopSec: number,
  gapSec: number,
  minSec: number
): Array<[number, number]> {
  const regs: Array<[number, number]> = [];
  let s = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i] !== 0;
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      regs.push([s * hopSec, i * hopSec]);
      s = -1;
    }
  }
  const merged: Array<[number, number]> = [];
  for (const r of regs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < gapSec) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter((r) => r[1] - r[0] >= minSec);
}

/** Voicing from a per-frame dB array (10 ms frames). */
export function voicingFromDb(db: ArrayLike<number>, hop = HOP_SEC): Voicing {
  let max = -Infinity;
  for (let i = 0; i < db.length; i++) if (db[i] > max) max = db[i];
  const threshold = Math.max(max - VOICED_BELOW_MAX_DB, SILENCE_FLOOR_DB);
  const mask = new Uint8Array(db.length);
  for (let i = 0; i < db.length; i++) mask[i] = db[i] > threshold ? 1 : 0;
  const islands = regionsFromMask(mask, hop, CLOSE_GAP_SEC, MIN_ISLAND_SEC);
  const onsets: number[] = islands.length ? [islands[0][0]] : [];
  for (let i = 1; i < islands.length; i++)
    if (islands[i][0] - islands[i - 1][1] >= ONSET_PAUSE_SEC) onsets.push(islands[i][0]);
  return { mask, onsets, hop, durationSec: db.length * hop };
}

export function voicingFromPcm(pcm: Float32Array, sampleRate: number): Voicing {
  return voicingFromDb(frameDb(pcm, sampleRate), HOP_SEC);
}

export function median(xs: number[]): number {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** The per-file DTW lag in seconds (step 4): 0 unless ≥ 2 onsets each have a word near them. */
export function measureLag(words: readonly RawWord[], onsets: readonly number[]): number {
  const diffs: number[] = [];
  const [lo, hi] = ONSET_WINDOW_SEC;
  for (const on of onsets) {
    const w = words.find((x) => x.start >= on + lo && x.start <= on + hi);
    if (w) diffs.push(w.start - on);
  }
  return diffs.length >= 2 ? median(diffs) : 0;
}

const FOLD = /[^\p{L}\p{N}]+/gu;
const fold = (t: string): string => t.toLowerCase().replace(FOLD, '');

/** Marks every word of a run of ≥ 3 identical consecutive words (case- and punctuation-folded). */
export function flagLoops(texts: readonly string[]): boolean[] {
  const out = new Array<boolean>(texts.length).fill(false);
  let i = 0;
  while (i < texts.length) {
    let j = i + 1;
    const f = fold(texts[i]);
    while (j < texts.length && f !== '' && fold(texts[j]) === f) j++;
    if (f !== '' && j - i >= LOOP_RUN) for (let k = i; k < j; k++) out[k] = true;
    i = j;
  }
  return out;
}

/** Text within the schema's word cap, never cutting a surrogate pair. */
export function capText(text: string): string {
  if (text.length <= MAX_WORD_TEXT) return text;
  let cut = MAX_WORD_TEXT;
  const c = text.charCodeAt(cut - 1);
  if (c >= 0xd800 && c <= 0xdbff) cut -= 1;
  return text.slice(0, cut);
}

export interface TimedWords {
  words: TranscriptWord[];
  /** parallel to `words`: the word has at least one voiced frame (speech regions need it) */
  voiced: boolean[];
  /** the DTW lag that was removed, ms (0 when none was measured or the clock is "segment") */
  lagMs: number;
}

/**
 * Raw words → the transcript's words. `timing: 'dtw'` calibrates the lag and snaps to the energy;
 * `'segment'` (no DTW clock in the file) leaves the segment times as whisper gave them — they are
 * not DTW times, so there is no DTW lag to remove, and the file says so (`timing: "segment"`).
 * `voicing` null = no audio to measure against: nothing is snapped and every word counts as voiced.
 */
export function timeWords(
  raw: readonly RawWord[],
  timing: 'dtw' | 'segment',
  voicing: Voicing | null
): TimedWords {
  const loops = flagLoops(raw.map((w) => w.text));
  const calibrate = timing === 'dtw' && voicing !== null;
  const lag = calibrate ? measureLag(raw, voicing.onsets) : 0;
  const hop = voicing?.hop ?? HOP_SEC;

  const words: TranscriptWord[] = [];
  const voiced: boolean[] = [];
  let prev0 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const s0 = Math.max(0, w.start - lag);
    const e0 = Math.max(s0 + 0.05, w.end - lag);
    let start = s0;
    let end = e0;
    let isVoiced = true;
    if (voicing) {
      const a0 = Math.max(0, Math.floor(s0 / hop) - Math.round(SNAP_LOOKBACK_SEC / hop));
      const b = Math.min(voicing.mask.length, Math.ceil(e0 / hop));
      let first = -1;
      let last = -1;
      for (let k = a0; k < b; k++)
        if (voicing.mask[k]) {
          first = k;
          break;
        }
      for (let k = b - 1; k >= Math.max(a0, first); k--)
        if (voicing.mask[k]) {
          last = k + 1;
          break;
        }
      isVoiced = first >= 0;
      if (calibrate) {
        if (first < 0) end = Math.min(e0, s0 + UNVOICED_WORD_SEC);
        else {
          start = first * hop;
          end = Math.max(last * hop, start + MIN_WORD_SEC);
        }
      }
    }
    start = Math.max(start, prev0); // one clock, sorted: a snap never reorders words
    prev0 = start;
    const t0 = round3(start);
    const t1 = Math.max(round3(end), round3(t0 + 0.001));
    const word: TranscriptWord = { id: `w${i}`, t0, t1, text: capText(w.text) };
    if (w.p !== undefined) word.p = Math.round(w.p * 100) / 100;
    if (loops[i]) word.flags = ['loop'];
    words.push(word);
    voiced.push(isVoiced);
  }
  return { words, voiced, lagMs: Math.round(lag * 1000) };
}
