// beats.mjs — prototype of `maude design beats`: ffmpeg decodes, plain JS analyses.
// No dependencies. Two detectors:
//   ffmpegOnly(file): onset envelope from ffmpeg filters (lowpass + astats RMS per 256-sample window),
//                     adaptive-threshold peak picking, tempo = inter-onset histogram. Beats = picked onsets.
//   jsBeats(file):    spectral-flux onset envelope (STFT 1024/hop 256 @ 22.05 kHz, log magnitude),
//                     tempo by autocorrelation with a log-normal prior (Ellis 2007), dynamic-programming
//                     beat tracking (Ellis 2007), bar phase = strongest low-band phase of 4.
import { spawnSync } from 'node:child_process';
import { decodePcm } from './lib.mjs';

const SR = 22050;
const HOP = 256;
const WIN = 1024;
const FPS = SR / HOP; // ≈ 86.13 envelope frames per second

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Spectral flux (all bins) + low-band flux (< 150 Hz) per hop. */
export function onsetEnvelope(pcm) {
  const nF = Math.max(0, Math.floor((pcm.length - WIN) / HOP));
  const flux = new Float32Array(nF), low = new Float32Array(nF);
  const hann = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN));
  let prev = new Float32Array(WIN / 2);
  const lowBins = Math.ceil((150 / SR) * WIN);
  const re = new Float64Array(WIN), im = new Float64Array(WIN);
  for (let f = 0; f < nF; f++) {
    for (let i = 0; i < WIN; i++) { re[i] = pcm[f * HOP + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    const mag = new Float32Array(WIN / 2);
    let s = 0, sl = 0;
    for (let k = 1; k < WIN / 2; k++) {
      mag[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) { s += d; if (k <= lowBins) sl += d; }
    }
    flux[f] = s; low[f] = sl; prev = mag;
  }
  // remove slow trend (local mean over ~0.5 s), half-wave, normalise
  const out = new Float32Array(nF);
  const w = Math.round(FPS * 0.25);
  let acc = 0;
  for (let i = 0; i < nF + w; i++) {
    if (i < nF) acc += flux[i];
    if (i - 2 * w - 1 >= 0) acc -= flux[i - 2 * w - 1];
    const c = i - w;
    if (c >= 0 && c < nF) { const span = Math.min(nF, c + w + 1) - Math.max(0, c - w); out[c] = Math.max(0, flux[c] - acc / span); }
  }
  let sd = 0;
  for (const v of out) sd += v * v;
  sd = Math.sqrt(sd / Math.max(1, nF)) || 1;
  for (let i = 0; i < nF; i++) out[i] /= sd;
  return { env: out, low };
}

/** Tempo by autocorrelation of the envelope, weighted by a log-normal prior centred on 120 BPM. */
export const TEMPO_PRIOR_SD = Number(process.env.PRIOR_SD ?? 0.9);
export function tempoOf(env, lo = 60, hi = 200) {
  const minLag = Math.floor((60 / hi) * FPS), maxLag = Math.ceil((60 / lo) * FPS);
  let best = 0, bestLag = minLag;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    s /= env.length - lag;
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / TEMPO_PRIOR_SD) ** 2);
    scores.push({ lag, s, w: s * prior });
    if (s * prior > best) { best = s * prior; bestLag = lag; }
  }
  // parabolic refinement
  const i = scores.findIndex((x) => x.lag === bestLag);
  let lag = bestLag;
  if (i > 0 && i < scores.length - 1) {
    const a = scores[i - 1].w, b = scores[i].w, c = scores[i + 1].w;
    const d = a - 2 * b + c;
    if (d < 0) lag += (0.5 * (a - c)) / d;
  }
  return { bpm: (60 * FPS) / lag, period: lag, strength: best };
}

/** Ellis 2007 dynamic-programming beat tracker. */
export function trackBeats(env, period, tightness = 100) {
  const n = env.length;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0, arg = -1;
    const a = Math.max(0, Math.round(i - 2 * period)), b = Math.round(i - period / 2);
    for (let j = a; j <= b; j++) {
      const v = score[j] - tightness * Math.log((i - j) / period) ** 2;
      if (arg < 0 || v > best) { best = v; arg = j; }
    }
    score[i] = env[i] + (arg >= 0 ? Math.max(0, best) : 0);
    back[i] = arg >= 0 && best > 0 ? arg : -1;
  }
  // start from the best score in the last period
  let i = n - 1, best = -Infinity;
  for (let k = Math.max(0, n - Math.round(period)); k < n; k++) if (score[k] > best) { best = score[k]; i = k; }
  const beats = [];
  while (i >= 0) { beats.push(i); i = back[i]; }
  return beats.reverse().map((f) => (f * HOP + WIN / 2) / SR);
}

/** Bar phase: which of 4 beat phases carries the most low-band onset energy → downbeats. */
export function barPhase(beats, low) {
  const sums = [0, 0, 0, 0];
  beats.forEach((t, k) => {
    const f = Math.round((t * SR - WIN / 2) / HOP);
    let m = 0;
    for (let d = -2; d <= 2; d++) m = Math.max(m, low[f + d] ?? 0);
    sums[k % 4] += m;
  });
  const phase = sums.indexOf(Math.max(...sums));
  const total = sums.reduce((a, b) => a + b, 0) || 1;
  return { phase, confidence: Math.round((sums[phase] / total) * 100) / 100 };
}

export function jsBeats(file) {
  const t0 = performance.now();
  const pcm = decodePcm(file, SR);
  const tDecode = performance.now();
  const { env, low } = onsetEnvelope(pcm);
  const tempo = tempoOf(env);
  const beats = trackBeats(env, tempo.period);
  const bar = barPhase(beats, low);
  const t1 = performance.now();
  // confidence: mean envelope at beats vs overall mean (onset contrast)
  let at = 0;
  for (const t of beats) at += env[Math.round((t * SR - WIN / 2) / HOP)] ?? 0;
  const mean = env.reduce((a, b) => a + b, 0) / env.length;
  return { bpm: tempo.bpm, beats, downbeats: beats.filter((_, k) => k % 4 === bar.phase), barConfidence: bar.confidence, contrast: at / beats.length / (mean || 1), decodeMs: tDecode - t0, analyseMs: t1 - tDecode, durSec: pcm.length / SR };
}

/** ffmpeg-only: RMS per 256 samples in the kick band and full band → positive-diff peaks. */
export function ffmpegOnly(file) {
  const t0 = performance.now();
  const levels = (af) => {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-af', `aformat=sample_rates=${SR}:channel_layouts=mono,${af}asetnsamples=n=${HOP}:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const out = [];
    for (const line of r.stdout.split('\n')) {
      const m = line.match(/RMS_level=(-?[\d.]+|-inf)/);
      if (m) out.push(m[1] === '-inf' ? -120 : Number(m[1]));
    }
    return out;
  };
  const lo = levels('lowpass=f=150,');
  const fu = levels('');
  const n = Math.min(lo.length, fu.length);
  const od = new Float32Array(n);
  for (let i = 1; i < n; i++) od[i] = Math.max(0, lo[i] - lo[i - 1]) + 0.5 * Math.max(0, fu[i] - fu[i - 1]);
  // adaptive threshold: local median + k·mean over ±0.3 s, min gap 0.1 s
  const w = Math.round(0.3 * FPS);
  const onsets = [];
  let last = -1e9;
  for (let i = 1; i < n - 1; i++) {
    if (!(od[i] >= od[i - 1] && od[i] > od[i + 1])) continue;
    const seg = Array.from(od.slice(Math.max(0, i - w), Math.min(n, i + w + 1))).sort((a, b) => a - b);
    const thr = seg[seg.length >> 1] + 0.6 * (seg.reduce((a, b) => a + b, 0) / seg.length) + 1.0;
    if (od[i] > thr && i - last > 0.1 * FPS) { onsets.push((i * HOP) / SR); last = i; }
  }
  // tempo: histogram of inter-onset intervals folded into 60–200 BPM
  const hist = new Map();
  for (let a = 0; a < onsets.length; a++) for (let b = a + 1; b < Math.min(onsets.length, a + 5); b++) {
    let bpm = 60 / (onsets[b] - onsets[a]);
    while (bpm < 60) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    const k = Math.round(bpm);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let bpm = 0, best = 0;
  for (const [k, v] of hist) {
    const s = v + 0.5 * ((hist.get(k - 1) ?? 0) + (hist.get(k + 1) ?? 0));
    if (s > best) { best = s; bpm = k; }
  }
  return { bpm, beats: onsets, ms: performance.now() - t0 };
}

/** MIREX beat F-measure, ±tol seconds. */
export function fMeasure(ref, est, tol = 0.07) {
  const used = new Uint8Array(est.length);
  let tp = 0;
  for (const r of ref) {
    let bi = -1, bd = tol;
    est.forEach((e, i) => { const d = Math.abs(e - r); if (!used[i] && d <= bd) { bd = d; bi = i; } });
    if (bi >= 0) { used[bi] = 1; tp++; }
  }
  const p = tp / (est.length || 1), rc = tp / (ref.length || 1);
  return { f: (2 * p * rc) / (p + rc || 1), p, r: rc };
}
export function tempoAcc(est, ref) {
  const ok = (x) => Math.abs(x - ref) / ref <= 0.04;
  return { acc1: ok(est), acc2: [1, 2, 0.5, 3, 1 / 3].some((m) => ok(est / m)) };
}
