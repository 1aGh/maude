// Shared helpers for the V2-1.10 spike prototypes (scratch only).
import { spawnSync } from 'node:child_process';

export const HERE = new URL('.', import.meta.url).pathname;
export const MEDIA = `${HERE}media`;
export const OUT = `${HERE}out`;

/** Decode any media to mono float32 PCM at `sr` via ffmpeg. */
export function decodePcm(file, sr = 16000, extraAf = null) {
  const args = ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(sr)];
  if (extraAf) args.push('-af', extraAf);
  args.push('-f', 'f32le', '-');
  const r = spawnSync('ffmpeg', args, { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg decode failed: ${r.stderr}`);
  const buf = r.stdout;
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/** 10 ms frame RMS in dBFS. */
export function frameDb(pcm, sr, hopSec = 0.01) {
  const hop = Math.round(sr * hopSec);
  const n = Math.floor(pcm.length / hop);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) s += pcm[j] * pcm[j];
    out[i] = 10 * Math.log10(s / hop + 1e-12);
  }
  return out;
}

/** Regions [t0,t1] where cond(i) holds on a 10 ms grid; close gaps < gapSec, drop < minSec. */
export function regionsFromMask(mask, hopSec, gapSec, minSec) {
  const regs = [];
  let s = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i];
    if (on && s < 0) s = i;
    if (!on && s >= 0) {
      regs.push([s * hopSec, i * hopSec]);
      s = -1;
    }
  }
  const merged = [];
  for (const r of regs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < gapSec) last[1] = r[1];
    else merged.push([...r]);
  }
  return merged.filter((r) => r[1] - r[0] >= minSec);
}

/** Frame-level P/R/F1 of predicted vs reference regions on a 10 ms grid over [0,dur]. */
export function regionScore(ref, pred, dur, hop = 0.01) {
  const n = Math.ceil(dur / hop);
  const a = new Uint8Array(n);
  const b = new Uint8Array(n);
  for (const [s, e] of ref) for (let i = Math.floor(s / hop); i < Math.min(n, Math.ceil(e / hop)); i++) a[i] = 1;
  for (const [s, e] of pred) for (let i = Math.floor(s / hop); i < Math.min(n, Math.ceil(e / hop)); i++) b[i] = 1;
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] && b[i]) tp++;
    else if (b[i]) fp++;
    else if (a[i]) fn++;
  }
  const p = tp / (tp + fp || 1);
  const r = tp / (tp + fn || 1);
  return { precision: p, recall: r, f1: (2 * p * r) / (p + r || 1), fpSec: fp * hop, fnSec: fn * hop };
}

export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function pct(xs, p) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
export const r2 = (x) => Math.round(x * 100) / 100;
export const r3 = (x) => Math.round(x * 1000) / 1000;
