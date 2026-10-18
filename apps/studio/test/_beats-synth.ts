// Deterministic synthetic music for the beat-detector tests (V2-1.10 §6.3's generator, in-test): drums on an
// exact grid, a sustained bass + pad under them, a noise floor and a room echo. No randomness beyond a
// seeded LCG, so every run renders the same bytes. Truth = the quarter-note grid.

export const SYNTH_SR = 22_050;

export type Pattern = 'house' | 'hiphop' | 'halftime' | 'dnb';

export interface Track {
  name: string;
  bpm: number;
  pattern: Pattern;
  /** offset of the off-beat 8th as a fraction of a beat (0.5 = straight; > 0.5 = swung late) */
  swing?: number;
  /** seconds of pad + bass only before the drums start */
  introSec?: number;
  /** linear tempo ramp: ±drift over the track (0.015 = ±1.5 %) */
  drift?: number;
  durationSec: number;
}

export interface Rendered {
  samples: Float32Array;
  /** the quarter-note grid (seconds), only where the drums play */
  truth: number[];
  /** the beats numbered 1 in each bar (kick accent), seconds */
  downbeats: number[];
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000 - 0.5;
  };
}

export function render(track: Track): Rendered {
  const rand = lcg(0x9e3779b1 ^ Math.round(track.bpm * 100));
  const n = Math.round(track.durationSec * SYNTH_SR);
  const out = new Float32Array(n);
  const intro = track.introSec ?? 0;
  const swing = track.swing ?? 0.5;
  const base = 60 / track.bpm;

  // beat grid
  const beats: number[] = [];
  let t = intro;
  while (t < track.durationSec - 0.4) {
    beats.push(t);
    const ramp = track.drift ? 1 + track.drift * (2 * (t / track.durationSec) - 1) : 1;
    t += base * ramp;
  }

  const addKick = (at: number, amp: number) => {
    const s0 = Math.round(at * SYNTH_SR);
    const len = Math.round(0.35 * SYNTH_SR);
    let phase = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const tt = i / SYNTH_SR;
      const f = 45 + 110 * Math.exp(-tt / 0.03);
      phase += (2 * Math.PI * f) / SYNTH_SR;
      out[s0 + i] +=
        amp * Math.exp(-tt / 0.11) * Math.sin(phase) + (i < 40 ? amp * 0.3 * rand() : 0);
    }
  };
  const addSnare = (at: number, amp: number) => {
    const s0 = Math.round(at * SYNTH_SR);
    const len = Math.round(0.25 * SYNTH_SR);
    for (let i = 0; i < len && s0 + i < n; i++) {
      const tt = i / SYNTH_SR;
      out[s0 + i] +=
        amp * Math.exp(-tt / 0.07) * (rand() * 1.6 + 0.5 * Math.sin(2 * Math.PI * 190 * tt));
    }
  };
  const addHat = (at: number, amp: number) => {
    const s0 = Math.round(at * SYNTH_SR);
    const len = Math.round(0.06 * SYNTH_SR);
    let prev = 0;
    for (let i = 0; i < len && s0 + i < n; i++) {
      const tt = i / SYNTH_SR;
      const x = rand();
      out[s0 + i] += amp * Math.exp(-tt / 0.018) * (x - prev);
      prev = x;
    }
  };

  const downbeats: number[] = [];
  for (let b = 0; b < beats.length; b++) {
    const at = beats[b] as number;
    const next = (beats[b + 1] as number | undefined) ?? at + base;
    const len = next - at;
    const pos = b % 4;
    if (pos === 0) downbeats.push(at);
    const off = at + len * swing;
    switch (track.pattern) {
      case 'house':
        addKick(at, pos === 0 ? 0.95 : 0.7);
        addHat(off, 0.5);
        if (pos === 1 || pos === 3) addSnare(at, 0.3);
        break;
      case 'hiphop':
        if (pos === 0) addKick(at, 0.95);
        if (pos === 1 || pos === 3) addSnare(at, 0.45);
        if (pos === 1) addKick(off, 0.6);
        addHat(at, 0.3);
        addHat(off, 0.4);
        break;
      case 'halftime':
        // half-time: the kick on 1, the snare only on 3, hats at 16ths with a roll
        if (pos === 0) addKick(at, 0.95);
        if (pos === 2) addSnare(at, 0.5);
        if (pos === 3) addKick(at + len * 0.5, 0.5);
        for (let q = 0; q < 4; q++) addHat(at + (len * q) / 4, q === 0 ? 0.35 : 0.22);
        break;
      case 'dnb':
        if (pos === 0 || pos === 2) addKick(at, 0.9);
        if (pos === 1 || pos === 3) addSnare(at, 0.5);
        addHat(off, 0.35);
        break;
    }
  }

  // sustained bass + pad (the energy a flux detector has to see past), then the noise floor
  for (let i = 0; i < n; i++) {
    const tt = i / SYNTH_SR;
    const bass =
      0.12 * Math.sin(2 * Math.PI * 55 * tt) * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.11 * tt));
    const pad =
      0.05 *
      (Math.sin(2 * Math.PI * 220 * tt) +
        Math.sin(2 * Math.PI * 277.2 * tt) +
        Math.sin(2 * Math.PI * 329.6 * tt));
    out[i] += bass + pad + 0.004 * rand();
  }
  // room echo
  const echo = Math.round(0.12 * SYNTH_SR);
  for (let i = n - 1; i >= echo; i--) out[i] += 0.22 * (out[i - echo] as number);
  // keep inside [-1, 1]
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i] as number));
  if (peak > 0.95) for (let i = 0; i < n; i++) out[i] = (out[i] as number) * (0.95 / peak);

  return { samples: out, truth: beats, downbeats };
}

/** Standard beat F-measure: each estimate may match one truth beat within the tolerance. */
export function fMeasure(est: readonly number[], truth: readonly number[], tol = 0.07): number {
  if (est.length === 0 || truth.length === 0) return 0;
  const used = new Set<number>();
  let hit = 0;
  for (const e of est) {
    let best = -1;
    let bd = tol;
    for (let i = 0; i < truth.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs((truth[i] as number) - e);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      hit++;
    }
  }
  const p = hit / est.length;
  const r = hit / truth.length;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
}

/** A 16-bit PCM mono WAV (the bytes a real decoder would hand back exactly). */
export function wavBytes(samples: Float32Array, sampleRate = SYNTH_SR): Uint8Array {
  const data = samples.length * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] as number));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return new Uint8Array(buf);
}

/**
 * The "ffmpeg filters only" baseline of V2-1.10 §3/§6.3: a 10 ms RMS envelope (astats), peak picking,
 * an inter-onset histogram → one period, a grid anchored on the first peak. It exists so the comparison
 * "the in-house detector is clearly better" stays measurable in CI.
 */
export function ffmpegOnlyBaseline(x: Float32Array, durationSec: number): number[] {
  const hop = Math.round(0.01 * SYNTH_SR);
  const frames = Math.floor(x.length / hop);
  const rms = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < hop; i++) s += (x[f * hop + i] as number) ** 2;
    rms[f] = Math.sqrt(s / hop);
  }
  let mean = 0;
  for (const v of rms) mean += v;
  mean /= frames;
  const peaks: number[] = [];
  for (let f = 2; f < frames - 2; f++) {
    const v = rms[f] as number;
    if (v > mean * 1.5 && v > (rms[f - 1] as number) && v >= (rms[f + 1] as number)) {
      if (peaks.length === 0 || f - (peaks[peaks.length - 1] as number) >= 8) peaks.push(f);
    }
  }
  if (peaks.length < 3) return [];
  // inter-onset histogram, 20 ms bins
  const hist = new Map<number, number>();
  for (let i = 1; i < peaks.length; i++) {
    const ioi = ((peaks[i] as number) - (peaks[i - 1] as number)) * 0.01;
    if (ioi < 0.25 || ioi > 1.0) continue;
    const bin = Math.round(ioi / 0.02);
    hist.set(bin, (hist.get(bin) ?? 0) + 1);
  }
  let bestBin = 0;
  let bestCount = 0;
  for (const [bin, count] of hist) {
    if (count > bestCount) {
      bestCount = count;
      bestBin = bin;
    }
  }
  if (bestBin === 0) return [];
  const period = bestBin * 0.02;
  const out: number[] = [];
  for (let t = (peaks[0] as number) * 0.01; t < durationSec; t += period) out.push(t);
  return out;
}
