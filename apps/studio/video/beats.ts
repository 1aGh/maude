// video/beats.ts — the in-house beat detector behind `maude design beats` (S7.3, V2-1.10 §5.6 "Beats").
//
//   decode 22.05 kHz mono → STFT (1024 window, 256 hop = 11.6 ms)
//   → onset envelope: log-magnitude spectral flux, half-wave, detrended over ±0.25 s, normalised
//   → tempo: autocorrelation over 60–200 BPM × a log-normal prior (centre 120, σ 0.7 octave), parabolic refine
//   → beats: Ellis dynamic programming, tightness 100 (`--bpm N` fixes the period and re-runs only this step)
//   → bar phase: the beat phase (of 4) carrying the most < 150 Hz flux.
//
// Pure TypeScript, no dependency, deterministic: the same samples always give the same bytes (no clock, no
// randomness, no host-dependent math beyond IEEE `Math.log/exp/cos/sin`). The decoders live elsewhere
// (`bin/beats.mjs` runs ffmpeg; `decode-webaudio.ts` is the headless-Chromium fallback) and both hand this
// module the SAME 22.05 kHz mono Float32 samples, which is what makes the two paths agree.

import { type BeatGrid, MAX_BEATS } from './schema.ts';

export const BEATS_SAMPLE_RATE = 22_050;
export const BEATS_WINDOW = 1024;
export const BEATS_HOP = 256;
/** Analysis ceiling. A longer file is analysed over its first 30 minutes (well under MAX_BEATS at 200 BPM). */
export const BEATS_MAX_ANALYSIS_SEC = 1800;

const SR = BEATS_SAMPLE_RATE;
const WIN = BEATS_WINDOW;
const HOP = BEATS_HOP;
const BINS = WIN / 2;
const HOP_SEC = HOP / SR;

const BPM_MIN = 60;
const BPM_MAX = 200;
const PRIOR_CENTRE_BPM = 120;
const PRIOR_SIGMA_OCT = 0.7;
const TIGHTNESS = 100;
const DETREND_HALF_SEC = 0.25;
/** Bins 1..6 are < 150 Hz at 21.5 Hz per bin. */
const LOW_BIN_MAX = 6;
/** The onset envelope peaks about one hop-and-a-half before the sound it describes (the window is centred
 *  and the log compression lets the first sliver of an attack count); calibrated on impulses + kicks
 *  (see beats.test.ts "envelope timing"). Added to every frame time so beats land on the hit. */
export const ONSET_LAG_SEC = 0.006;

export interface BeatsAnalysis {
  durationSec: number;
  bpm: number;
  bpmSource: 'detected' | 'set';
  tempoStrength: number;
  beats: number[];
  bar: { phase: 0 | 1 | 2 | 3; confidence: number };
}

export interface AnalyzeOptions {
  /** Fix the tempo (BPM): skips the autocorrelation, re-runs the DP at this period. */
  bpm?: number;
  /** Downbeat times (seconds) of a previous grid for the same asset. When given, the bar phase that
   *  puts the new downbeats on the old ones wins over the low-band vote ("`--bpm` keeps the phase"). */
  keepDownbeats?: readonly number[];
}

// ─── FFT ─────────────────────────────────────────────────────────────────────

const HANN = new Float64Array(WIN);
for (let i = 0; i < WIN; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN);
const COS = new Float64Array(WIN / 2);
const SIN = new Float64Array(WIN / 2);
for (let i = 0; i < WIN / 2; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / WIN);
  SIN[i] = -Math.sin((2 * Math.PI * i) / WIN);
}
const REV = new Uint16Array(WIN);
{
  const bits = Math.log2(WIN);
  for (let i = 0; i < WIN; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    REV[i] = r;
  }
}

/** In-place radix-2 complex FFT of length WIN. */
function fft(re: Float64Array, im: Float64Array): void {
  for (let i = 0; i < WIN; i++) {
    const j = REV[i] as number;
    if (j > i) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= WIN; size <<= 1) {
    const half = size >> 1;
    const step = WIN / size;
    for (let start = 0; start < WIN; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step] as number;
        const s = SIN[k * step] as number;
        const a = start + k;
        const b = a + half;
        const xr = (re[b] as number) * c - (im[b] as number) * s;
        const xi = (re[b] as number) * s + (im[b] as number) * c;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
      }
    }
  }
}

// ─── envelope ────────────────────────────────────────────────────────────────

interface Envelope {
  /** onset strength, detrended + normalised, one value per frame */
  env: Float64Array;
  /** low-band (< 150 Hz) half-wave flux, one value per frame */
  low: Float64Array;
}

/** Log-magnitude spectral flux of mono samples at 22.05 kHz. Frame t is centred on sample t * HOP. */
export function onsetEnvelope(x: Float32Array): Envelope {
  const frames = Math.max(0, Math.floor(x.length / HOP) + 1);
  const env = new Float64Array(frames);
  const low = new Float64Array(frames);
  if (frames < 3) return { env, low };

  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  let prev = new Float64Array(BINS);
  let cur = new Float64Array(BINS);
  const flux = new Float64Array(frames);
  const MAG = 1000 / (WIN / 4); // a full-scale sine's bin magnitude is WIN/4 with a Hann window
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - WIN / 2;
    for (let i = 0; i < WIN; i++) {
      const s = start + i;
      re[i] = s >= 0 && s < x.length ? (x[s] as number) * (HANN[i] as number) : 0;
      im[i] = 0;
    }
    fft(re, im);
    let f = 0;
    let lf = 0;
    for (let k = 1; k < BINS; k++) {
      const m = Math.sqrt((re[k] as number) ** 2 + (im[k] as number) ** 2);
      const l = Math.log(1 + m * MAG);
      cur[k] = l;
      const d = l - (prev[k] as number);
      if (t > 0 && d > 0) {
        f += d;
        if (k <= LOW_BIN_MAX) lf += d;
      }
    }
    flux[t] = f;
    low[t] = lf;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }

  // Detrend (subtract the local mean over ±0.25 s, half-wave rectify) and normalise by the RMS, so the DP's
  // tightness means the same on every track. The < 150 Hz flux is folded in with equal weight: log-spectral
  // flux sums over 512 bins and a quiet off-beat hat would otherwise outvote a kick on the beat, which is
  // how a four-on-the-floor loop gets tracked half a beat late.
  const full = detrendNormalise(flux);
  const bass = detrendNormalise(low);
  for (let t = 0; t < frames; t++) env[t] = (full[t] as number) + (bass[t] as number);
  return { env, low };
}

function detrendNormalise(series: Float64Array): Float64Array {
  const frames = series.length;
  const out = new Float64Array(frames);
  const half = Math.max(1, Math.round(DETREND_HALF_SEC / HOP_SEC));
  const cum = new Float64Array(frames + 1);
  for (let t = 0; t < frames; t++) cum[t + 1] = (cum[t] as number) + (series[t] as number);
  let sq = 0;
  for (let t = 0; t < frames; t++) {
    const a = Math.max(0, t - half);
    const b = Math.min(frames, t + half + 1);
    const mean = ((cum[b] as number) - (cum[a] as number)) / (b - a);
    const v = Math.max(0, (series[t] as number) - mean);
    out[t] = v;
    sq += v * v;
  }
  const rms = Math.sqrt(sq / frames);
  if (rms > 1e-9) for (let t = 0; t < frames; t++) out[t] = (out[t] as number) / rms;
  else out.fill(0);
  return out;
}

// ─── tempo ───────────────────────────────────────────────────────────────────

/** Unbiased autocovariance of the envelope (mean removed, so noise and a constant read as no pulse). */
function autocorrelate(env: Float64Array, maxLag: number): Float64Array {
  const n = env.length;
  let mean = 0;
  for (let t = 0; t < n; t++) mean += env[t] as number;
  mean /= n || 1;
  const out = new Float64Array(maxLag + 1);
  for (let l = 0; l <= maxLag && l < n; l++) {
    let s = 0;
    for (let t = 0; t + l < n; t++)
      s += ((env[t] as number) - mean) * ((env[t + l] as number) - mean);
    out[l] = s / (n - l);
  }
  return out;
}

const lagOfBpm = (bpm: number): number => 60 / (bpm * HOP_SEC);
const bpmOfLag = (lag: number): number => 60 / (lag * HOP_SEC);
const prior = (bpm: number): number =>
  Math.exp(-0.5 * (Math.log2(bpm / PRIOR_CENTRE_BPM) / PRIOR_SIGMA_OCT) ** 2);

interface Tempo {
  /** period in frames (float) */
  period: number;
  bpm: number;
  strength: number;
}

/** Strength of the pulse at a lag: the best normalised ACF value within ±1 frame. */
function strengthAt(acf: Float64Array, lag: number): number {
  const a0 = acf[0] as number;
  if (!(a0 > 1e-12)) return 0;
  let best = 0;
  for (let l = Math.floor(lag) - 1; l <= Math.ceil(lag) + 1; l++) {
    if (l >= 1 && l < acf.length) best = Math.max(best, (acf[l] as number) / a0);
  }
  return Math.min(1, Math.max(0, best));
}

function detectTempo(env: Float64Array): Tempo | null {
  const lagLo = Math.max(2, Math.floor(lagOfBpm(BPM_MAX)));
  const lagHi = Math.ceil(lagOfBpm(BPM_MIN));
  if (env.length < lagHi * 3) return null;
  const acf = autocorrelate(env, lagHi + 1);
  if (!((acf[0] as number) > 1e-12)) return null;

  let bestLag = -1;
  let bestScore = 0;
  for (let l = lagLo; l <= lagHi; l++) {
    const a = acf[l] as number;
    if (!(a > (acf[l - 1] as number) && a >= (acf[l + 1] as number))) continue;
    const score = a * prior(bpmOfLag(l));
    if (score > bestScore) {
      bestScore = score;
      bestLag = l;
    }
  }
  if (bestLag < 0) return null;
  // Parabolic refinement on the raw autocorrelation.
  const y0 = acf[bestLag - 1] as number;
  const y1 = acf[bestLag] as number;
  const y2 = acf[bestLag + 1] as number;
  const denom = y0 - 2 * y1 + y2;
  const shift = denom < -1e-12 ? (0.5 * (y0 - y2)) / denom : 0;
  const lag = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  return { period: lag, bpm: bpmOfLag(lag), strength: strengthAt(acf, lag) };
}

// ─── Ellis dynamic-programming beat tracker ──────────────────────────────────

/** Smooth the envelope with a Gaussian of σ = period/32 frames (Ellis' local score). */
function localScore(env: Float64Array, period: number): Float64Array {
  const sigma = Math.max(0.5, period / 32);
  const half = Math.ceil(sigma * 3);
  const w = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let i = -half; i <= half; i++) {
    const v = Math.exp(-0.5 * (i / sigma) ** 2);
    w[i + half] = v;
    sum += v;
  }
  const out = new Float64Array(env.length);
  for (let t = 0; t < env.length; t++) {
    let s = 0;
    for (let i = -half; i <= half; i++) {
      const j = t + i;
      if (j >= 0 && j < env.length) s += (w[i + half] as number) * (env[j] as number);
    }
    out[t] = s / sum;
  }
  return out;
}

/** Beat frames for a fixed period. Returns [] when nothing chains. */
function trackBeats(env: Float64Array, period: number): { frames: number[]; local: Float64Array } {
  const n = env.length;
  const local = localScore(env, period);
  const lo = Math.max(1, Math.round(period / 2));
  const hi = Math.max(lo + 1, Math.round(period * 2));
  const pen = new Float64Array(hi + 1);
  for (let d = lo; d <= hi; d++) pen[d] = TIGHTNESS * Math.log(d / period) ** 2;

  const cum = new Float64Array(n);
  const link = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0; // 0 = a chain may start here
    let bi = -1;
    for (let d = lo; d <= hi; d++) {
      const j = i - d;
      if (j < 0) break;
      const v = (cum[j] as number) - (pen[d] as number);
      if (v > best) {
        best = v;
        bi = j;
      }
    }
    cum[i] = (local[i] as number) + best;
    link[i] = bi;
  }

  // The last beat: the last local maximum of the cumulative score above half the median of the maxima.
  const maxima: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if ((cum[i] as number) > (cum[i - 1] as number) && (cum[i] as number) >= (cum[i + 1] as number))
      maxima.push(i);
  }
  if (maxima.length === 0) return { frames: [], local };
  const vals = maxima.map((i) => cum[i] as number).sort((a, b) => a - b);
  const thresh = 0.5 * (vals[Math.floor(vals.length / 2)] as number);
  let tail = -1;
  for (const i of maxima) if ((cum[i] as number) >= thresh) tail = i;
  if (tail < 0) return { frames: [], local };

  const frames: number[] = [];
  for (let i = tail; i >= 0; i = link[i] as number) frames.push(i);
  frames.reverse();

  // Trim the weak ends (a pad intro, a fade-out): drop edge beats whose local score sits under half the
  // RMS of the local score over all beats.
  if (frames.length > 2) {
    let ss = 0;
    for (const f of frames) ss += (local[f] as number) ** 2;
    const thr = 0.5 * Math.sqrt(ss / frames.length);
    let a = 0;
    let b = frames.length;
    while (a < b && (local[frames[a] as number] as number) <= thr) a++;
    while (b > a && (local[frames[b - 1] as number] as number) <= thr) b--;
    return { frames: frames.slice(a, b), local };
  }
  return { frames, local };
}

// ─── bar phase ───────────────────────────────────────────────────────────────

function barPhase(
  frames: readonly number[],
  times: readonly number[],
  low: Float64Array,
  keep: readonly number[] | undefined
): { phase: 0 | 1 | 2 | 3; confidence: number } {
  if (frames.length < 4) return { phase: 0, confidence: 0 };
  const sums = [0, 0, 0, 0];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i] as number;
    let v = 0;
    for (let k = f - 1; k <= f + 1; k++)
      if (k >= 0 && k < low.length) v = Math.max(v, low[k] as number);
    sums[i % 4] = (sums[i % 4] as number) + v;
  }
  const total = sums.reduce((a, b) => a + b, 0);
  let phase = 0;
  for (let p = 1; p < 4; p++) if ((sums[p] as number) > (sums[phase] as number)) phase = p;

  if (keep && keep.length > 0) {
    const beatLen =
      ((times[times.length - 1] as number) - (times[0] as number)) / (times.length - 1);
    const tol = beatLen * 0.5;
    let bestMatches = 0;
    let bestPhase = -1;
    for (let p = 0; p < 4; p++) {
      let matches = 0;
      for (let i = p; i < times.length; i += 4) {
        const t = times[i] as number;
        // keep[] is ascending; a linear scan is fine (a grid has a few thousand downbeats at most)
        let near = false;
        for (const k of keep) {
          if (k > t + tol) break;
          if (Math.abs(k - t) <= tol) {
            near = true;
            break;
          }
        }
        if (near) matches++;
      }
      if (matches > bestMatches) {
        bestMatches = matches;
        bestPhase = p;
      }
    }
    if (bestPhase >= 0) phase = bestPhase;
  }
  const confidence = total > 1e-9 ? Math.min(1, (sums[phase] as number) / total) : 0;
  return { phase: phase as 0 | 1 | 2 | 3, confidence };
}

// ─── public ──────────────────────────────────────────────────────────────────

const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Detect (or, with `opts.bpm`, re-track) the beats of 22.05 kHz mono samples. Pure and deterministic. */
export function analyzeBeats(samples: Float32Array, opts: AnalyzeOptions = {}): BeatsAnalysis {
  const durationSec = r3(samples.length / SR);
  const used =
    samples.length > BEATS_MAX_ANALYSIS_SEC * SR
      ? samples.subarray(0, BEATS_MAX_ANALYSIS_SEC * SR)
      : samples;
  const { env, low } = onsetEnvelope(used);

  const fixed = opts.bpm !== undefined && Number.isFinite(opts.bpm) && opts.bpm > 0;
  let period: number;
  let bpm: number;
  let strength: number;
  if (fixed) {
    bpm = opts.bpm as number;
    period = lagOfBpm(bpm);
    const lagMax = Math.ceil(period) + 2;
    strength = env.length > lagMax * 2 ? strengthAt(autocorrelate(env, lagMax), period) : 0;
  } else {
    const t = detectTempo(env);
    if (!t) {
      return {
        durationSec,
        bpm: PRIOR_CENTRE_BPM,
        bpmSource: 'detected',
        tempoStrength: 0,
        beats: [],
        bar: { phase: 0, confidence: 0 },
      };
    }
    ({ period, bpm, strength } = t);
  }

  const { frames } = period >= 2 ? trackBeats(env, period) : { frames: [] as number[] };
  const times: number[] = [];
  const keptFrames: number[] = [];
  for (const f of frames) {
    const t = r3(Math.max(0, f * HOP_SEC + ONSET_LAG_SEC));
    if (times.length > 0 && t <= (times[times.length - 1] as number)) continue;
    times.push(t);
    keptFrames.push(f);
    if (times.length >= MAX_BEATS) break;
  }
  const bar = barPhase(keptFrames, times, low, opts.keepDownbeats);
  return {
    durationSec,
    bpm: r2(Math.min(400, Math.max(20, bpm))),
    bpmSource: fixed ? 'set' : 'detected',
    tempoStrength: r3(strength),
    beats: times,
    bar: { phase: bar.phase, confidence: r3(bar.confidence) },
  };
}

/** The downbeat times of a grid: `beats[phase + 4k]`. */
export function downbeatsOf(grid: Pick<BeatGrid, 'beats' | 'bar'>): number[] {
  const out: number[] = [];
  for (let i = grid.bar.phase; i < grid.beats.length; i += 4) out.push(grid.beats[i] as number);
  return out;
}

/** Fold an analysis into a `maude.beats` v1 value ready for `serializeBeats`. */
export function beatGridFrom(
  asset: string,
  a: BeatsAnalysis,
  decode: 'ffmpeg' | 'chromium',
  createdAt: string
): BeatGrid {
  return {
    format: 'maude.beats',
    v: 1,
    asset,
    durationSec: a.durationSec,
    analyzer: { id: 'maude-beats', version: 1, decode },
    bpm: a.bpm,
    bpmSource: a.bpmSource,
    tempoStrength: a.tempoStrength,
    beats: a.beats,
    bar: { phase: a.bar.phase, confidence: a.bar.confidence },
    createdAt,
  };
}
