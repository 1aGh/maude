// Exp B — speech regions for music ducking ("Lower under speech").
// Stems are built from the real V5 assets at the real build-audio.sh offsets, so the truth is exact.
//   S0 = VO only · S1 = VO + SFX (clip audio with sound effects) · M = S1 + music bed at 0.16 (a pre-mixed video)
//   A  = 12 real Alligators clips back to back (ambient shouts, no dialogue per the footage analyst)
// Detectors: D1 transcript words (proposed words pipeline) → merged regions; D2 ffmpeg silencedetect (band-limited).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePcm, frameDb, MEDIA, OUT, r2, r3, regionScore, regionsFromMask } from './lib.mjs';
import { speechRegions, transcribeWords } from './words-pipeline.mjs';

const D = `${OUT}/expB`;
mkdirSync(D, { recursive: true });
const SR = 16000;
const VO = [['vo-00', 400], ['vo-10', 5700], ['vo-20', 14070], ['vo-40', 23070], ['vo-50', 30000], ['vo-60', 36970], ['vo-65', 47570], ['vo-70', 55070], ['vo-80', 63030], ['vo-92', 76330], ['vo-94', 84600], ['vo-96', 88800], ['vo-99', 98530]];
const SFX = [['power-on', 300, 0.3], ['scan-sweep', 6000, 0.28], ['vortex', 20300, 0.3], ['success', 34500, 0.3], ['connect', 48000, 0.28], ['draw-stroke', 56500, 0.3], ['boot-playful', 63100, 0.32], ['type-clicks', 70500, 0.28], ['success', 94200, 0.3], ['whoosh', 44000, 0.3], ['ui-pop', 66000, 0.3]];
const TOTAL = 106;

function place(list, dir, gain = 1) {
  const out = new Float32Array(TOTAL * SR);
  for (const [f, ms, g] of list) {
    const pcm = decodePcm(`${MEDIA}/${dir}/${f}.mp3`, SR);
    const o = Math.round((ms / 1000) * SR);
    for (let i = 0; i < pcm.length && o + i < out.length; i++) out[o + i] += pcm[i] * (g ?? gain);
  }
  return out;
}
function writeWav(pcm, name) {
  const raw = `${D}/${name}.f32`;
  writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const wav = `${D}/${name}.wav`;
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-c:a', 'pcm_s16le', wav]);
  return wav;
}
// truth: voiced islands of each VO alone (energy > max-35 dB), gaps < 300 ms closed, offset
const truth = [];
for (const [f, ms] of VO) {
  const pcm = decodePcm(`${MEDIA}/vo/${f}.mp3`, SR);
  const db = frameDb(pcm, SR);
  const max = Math.max(...db);
  for (const [s, e] of regionsFromMask(Array.from(db, (v) => v > max - 35), 0.01, 0.3, 0.05)) truth.push([s + ms / 1000, e + ms / 1000]);
}
const s0 = place(VO, 'vo');
const sfx = place(SFX, 'sfx');
const s1 = s0.map((v, i) => v + sfx[i]);
const bed = decodePcm(`${MEDIA}/music/bed.mp3`, SR);
const m = s1.map((v, i) => v + 0.16 * (bed[i] ?? 0));
const wavs = { S0: writeWav(s0, 'S0'), S1: writeWav(s1, 'S1'), M: writeWav(m, 'M') };
// ambient real clips back to back
const amb = ['124847ce', '2e3b6e7f', '5b8ee6dc', '7fad5cf2', 'b1061669', 'b2996668', 'c43b76df', '25c450fb', '3f5fd5f3', 'e43ac47e', 'd4a5b800', '381b5d7c'];
const ambList = `${D}/amb.txt`;
writeFileSync(ambList, amb.map((id) => `file '${MEDIA}/clips/${id}.mp4'`).join('\n'));
const ambWav = `${D}/A.wav`;
if (!existsSync(ambWav)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', ambList, '-vn', '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_s16le', ambWav]);
wavs.A = ambWav;

const wordsCache = {};
function d1Transcript(wav, name) {
  const t0 = performance.now();
  const r = transcribeWords(wav, `${D}/${name}`, { model: 'base.en', lang: 'en' });
  wordsCache[name] = r.words;
  return { regs: speechRegions(r.words), wall: (performance.now() - t0) / 1000 };
}
function d3Gated(wav, name) {
  // energy regions (silencedetect -35 dB) kept only where a confident, voiced word lies inside
  const t0 = performance.now();
  const e = d2Silence(wav, -35).regs;
  const ws = (wordsCache[name] ?? transcribeWords(wav, `${D}/${name}`).words).filter((w) => w.p >= 0.5 && w.voiced);
  const regs = e.filter(([a, b]) => ws.some((w) => w.start < b && w.end > a));
  return { regs, wall: (performance.now() - t0) / 1000 };
}
function d2Silence(wav, noiseDb) {
  const t0 = performance.now();
  const r = spawnSync('ffmpeg', ['-v', 'info', '-i', wav, '-af', `highpass=f=150,lowpass=f=4000,silencedetect=noise=${noiseDb}dB:d=0.35`, '-f', 'null', '-'], { encoding: 'utf8' });
  const wall = (performance.now() - t0) / 1000;
  const dur = decodePcm(wav, 8000).length / 8000;
  const sil = [];
  let cur = null;
  for (const line of r.stderr.split('\n')) {
    const a = line.match(/silence_start: ([\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) cur = Number(a[1]);
    if (b && cur != null) { sil.push([cur, Number(b[1])]); cur = null; }
  }
  if (cur != null) sil.push([cur, dur]);
  const regs = [];
  let t = 0;
  for (const [s, e] of sil) { if (s - t > 0.05) regs.push([Math.max(0, t - 0.1), s + 0.1]); t = e; }
  if (dur - t > 0.05) regs.push([t - 0.1, dur]);
  return { regs, wall };
}
const rows = [];
for (const [stem, wav] of Object.entries(wavs)) {
  const dur = decodePcm(wav, 8000).length / 8000;
  const ref = stem === 'A' ? [] : truth;
  const dets = { 'D1 words': d1Transcript(wav, stem), 'D2 silencedetect -35dB': d2Silence(wav, -35), 'D2 silencedetect -25dB': d2Silence(wav, -25), 'D3 energy∩words': d3Gated(wav, stem) };
  for (const [name, { regs, wall }] of Object.entries(dets)) {
    const sc = regionScore(ref, regs, dur);
    rows.push({ stem, detector: name, regions: regs.length, speechSec: r2(regs.reduce((s, [a, b]) => s + b - a, 0)), truthSec: r2(ref.reduce((s, [a, b]) => s + b - a, 0)), recall: r3(sc.recall), precision: stem === 'A' ? '—' : r3(sc.precision), falseDuckSec: r2(sc.fpSec), missedSec: r2(sc.fnSec), wallSec: r3(wall), duckTogglesPerMin: r2((regs.length * 2) / (dur / 60)) });
  }
}
console.table(rows);
writeFileSync(`${D}/report.json`, JSON.stringify(rows, null, 1));
