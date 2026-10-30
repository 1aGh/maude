// Exp C — beat detection: ffmpeg-only vs a small JS onset detector.
// Synthetic tracks with exact beat truth (encoded to mp3), plus real ElevenLabs music with a prompted BPM.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { ffmpegOnly, fMeasure, jsBeats, tempoAcc } from './beats.mjs';
import { MEDIA, OUT, r2, r3 } from './lib.mjs';

const D = `${OUT}/expC`;
mkdirSync(D, { recursive: true });
const SR = 44100;
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

function synth({ name, bpm, sec = 40, intro = 0, pattern, drift = 0, swing = 0, half = false }) {
  const n = sec * SR;
  const L = new Float32Array(n);
  const beatTimes = [];
  // beat clock with optional slow drift (±drift fraction, sinusoidal)
  let t = intro;
  let k = 0;
  while (t < sec - 0.05) {
    beatTimes.push(t);
    const local = bpm * (1 + drift * Math.sin((2 * Math.PI * t) / 20));
    t += 60 / local;
    k++;
  }
  const add = (at, fn, dur) => {
    const s = Math.round(at * SR);
    for (let i = 0; i < dur * SR && s + i < n; i++) L[s + i] += fn(i / SR);
  };
  const kick = (x) => Math.sin(2 * Math.PI * (45 + 90 * Math.exp(-x * 30)) * x) * Math.exp(-x * 9) * 0.9;
  const snare = (x) => (rnd() * 0.5 + Math.sin(2 * Math.PI * 190 * x) * 0.4) * Math.exp(-x * 22) * 0.6;
  let hp = 0;
  const hat = (x) => { const v = rnd(); const o = v - hp; hp = v; return o * Math.exp(-x * 90) * 0.18; };
  const sub = (f) => (x) => Math.sin(2 * Math.PI * f * x) * Math.min(1, x * 50) * Math.exp(-x * 1.5) * 0.5;
  beatTimes.forEach((bt, i) => {
    const next = beatTimes[i + 1] ?? bt + 60 / bpm;
    const P = next - bt;
    const inBar = i % 4;
    pattern({ bt, P, inBar, i, add, kick, snare, hat, sub, swing, half });
  });
  // pad (chord) everywhere incl. intro, slow LFO — a non-percussive bed
  for (let i = 0; i < n; i++) {
    const x = i / SR;
    L[i] += 0.06 * (Math.sin(2 * Math.PI * 220 * x) + Math.sin(2 * Math.PI * 277.2 * x) + Math.sin(2 * Math.PI * 329.6 * x)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.1 * x));
    L[i] += 0.01 * rnd(); // noise floor
  }
  // cheap room: feedback delay 37 ms
  const dl = Math.round(0.037 * SR);
  for (let i = dl; i < n; i++) L[i] += 0.25 * L[i - dl];
  let mx = 0;
  for (const v of L) mx = Math.max(mx, Math.abs(v));
  for (let i = 0; i < n; i++) L[i] = (L[i] / mx) * 0.9;
  const raw = `${D}/${name}.f32`;
  writeFileSync(raw, Buffer.from(L.buffer));
  const mp3 = `${D}/${name}.mp3`;
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '192k', mp3]);
  return { mp3, beats: beatTimes, bpm, downbeats: beatTimes.filter((_, i) => i % 4 === 0) };
}

const fourFloor = ({ bt, P, inBar, add, kick, snare, hat }) => {
  add(bt, kick, 0.5);
  if (inBar % 2 === 1) add(bt, snare, 0.3);
  add(bt + P / 2, hat, 0.08);
};
const hiphop = ({ bt, P, inBar, add, kick, snare, hat, sub, swing }) => {
  if (inBar === 0) { add(bt, kick, 0.5); add(bt, sub(55), 0.8); }
  if (inBar === 1) add(bt + P / 2, kick, 0.5);
  if (inBar === 2) add(bt + P * 0.75, kick, 0.5);
  if (inBar % 2 === 1) add(bt, snare, 0.3);
  add(bt, hat, 0.06);
  add(bt + P * (0.5 + swing), hat, 0.06);
};
const trapHalf = ({ bt, P, inBar, i, add, kick, snare, hat, sub }) => {
  // half-time: snare only on beat 3 of the bar; kick on 1 and the "and" of 2; 16th hats with rolls
  if (inBar === 0) { add(bt, kick, 0.5); add(bt, sub(49), 1.2); }
  if (inBar === 1) add(bt + P / 2, kick, 0.5);
  if (inBar === 2) add(bt, snare, 0.35);
  for (let s = 0; s < 4; s++) add(bt + (s * P) / 4, hat, 0.04);
  if (i % 8 === 7) for (let s = 0; s < 6; s++) add(bt + (s * P) / 6, hat, 0.03);
};
const breakbeat = ({ bt, P, inBar, add, kick, snare, hat }) => {
  // DnB-ish: kick 1, snare 2, kick 3&, snare 4
  if (inBar === 0) add(bt, kick, 0.4);
  if (inBar === 1 || inBar === 3) add(bt, snare, 0.25);
  if (inBar === 2) add(bt + P / 2, kick, 0.4);
  add(bt, hat, 0.04); add(bt + P / 2, hat, 0.04);
};

const synthSet = [
  synth({ name: 's1-house-120', bpm: 120, pattern: fourFloor }),
  synth({ name: 's2-hiphop-92-swing', bpm: 92, pattern: hiphop, swing: 0.12 }),
  synth({ name: 's3-trap-halftime-140', bpm: 140, pattern: trapHalf }),
  synth({ name: 's4-intro8s-100', bpm: 100, intro: 8, pattern: fourFloor }),
  synth({ name: 's5-drift-128', bpm: 128, pattern: fourFloor, drift: 0.015 }),
  synth({ name: 's6-dnb-174', bpm: 174, pattern: breakbeat }),
  synth({ name: 's7-hiphop-84', bpm: 84, pattern: hiphop }),
  synth({ name: 's8-house-150', bpm: 150, pattern: fourFloor }),
];

const rows = [];
for (const s of synthSet) {
  const j = jsBeats(s.mp3);
  const f = ffmpegOnly(s.mp3);
  const fj = fMeasure(s.beats, j.beats), ff = fMeasure(s.beats, f.beats);
  const fd = fMeasure(s.downbeats, j.downbeats, 0.07);
  rows.push({
    track: s.mp3.split('/').pop(), trueBpm: s.bpm,
    jsBpm: r2(j.bpm), jsAcc1: tempoAcc(j.bpm, s.bpm).acc1, jsAcc2: tempoAcc(j.bpm, s.bpm).acc2, jsF: r3(fj.f), jsDownbeatF: r3(fd.f),
    ffBpm: f.bpm, ffAcc2: tempoAcc(f.bpm, s.bpm).acc2, ffF: r3(ff.f),
    jsMsPerMin: Math.round(((j.decodeMs + j.analyseMs) / j.durSec) * 60), ffMsPerMin: Math.round((f.ms / j.durSec) * 60),
  });
}
console.log('Synthetic (exact beat truth, ±70 ms)');
console.table(rows);
const mean = (k) => r3(rows.reduce((a, r) => a + r[k], 0) / rows.length);
console.log(`mean F: js ${mean('jsF')} · ffmpeg-only ${mean('ffF')} · js downbeat ${mean('jsDownbeatF')}; tempo acc1 js ${rows.filter((r) => r.jsAcc1).length}/${rows.length}, acc2 js ${rows.filter((r) => r.jsAcc2).length}/${rows.length}, ffmpeg acc2 ${rows.filter((r) => r.ffAcc2).length}/${rows.length}`);

// Real music — prompted / nominal BPM only (no beat truth): tempo + agreement between detectors
const real = [
  ['bed.mp3', 100, 'ElevenLabs Music, "around 100 BPM"'],
  ['all-2a886bcf.mp3', 120, 'ElevenLabs, "120 BPM" hype'],
  ['all-55986008.mp3', 140, 'ElevenLabs, "140 BPM" drift phonk'],
  ['all-9ec69178.mp3', 126, 'ElevenLabs, "126 BPM half-time" trap'],
  ['all-b4c3bb33.mp3', 126, 'ElevenLabs, "126 BPM half-time" trap'],
  ['all-bdbd77bb.mp3', 120, 'ElevenLabs, "exactly 120 BPM" hybrid'],
  ['all-46a07c5e.mp3', null, 'ElevenLabs, late-night jazz (no BPM)'],
  ['repo-music.mp3', null, 'repo .design/assets/music.mp3'],
  ['repo-5087c59a.mp3', null, 'repo .design/assets/5087c59a.mp3'],
];
const rrows = [];
for (const [f, nominal, what] of real) {
  const file = `${MEDIA}/music/${f}`;
  if (!existsSync(file)) continue;
  const j = jsBeats(file);
  const ff = ffmpegOnly(file);
  const agree = fMeasure(j.beats, ff.beats);
  // beat regularity of the tracked grid (std of inter-beat interval, ms)
  const ibi = j.beats.slice(1).map((t, i) => t - j.beats[i]);
  const m = ibi.reduce((a, b) => a + b, 0) / ibi.length;
  const sd = Math.sqrt(ibi.reduce((a, b) => a + (b - m) ** 2, 0) / ibi.length);
  rrows.push({ track: f, what, nominal, jsBpm: r2(j.bpm), jsAcc2: nominal ? tempoAcc(j.bpm, nominal).acc2 : '—', ffBpm: ff.bpm, ffAcc2: nominal ? tempoAcc(ff.bpm, nominal).acc2 : '—', agreeF: r3(agree.f), ibiSdMs: Math.round(sd * 1000), barConf: j.barConfidence, contrast: r2(j.contrast), sec: Math.round(j.durSec), jsMs: Math.round(j.decodeMs + j.analyseMs), ffMs: Math.round(ff.ms) });
}
console.log('Real music (no beat truth): tempo vs the prompt; agreement F between the two detectors');
console.table(rrows);
writeFileSync(`${D}/report.json`, JSON.stringify({ synth: rows, real: rrows }, null, 1));
