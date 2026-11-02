// Exp A2 — post-processing variants on cached whisper output:
//   T1     : -sow segment times (raw)
//   T1+E   : T1 snapped to the energy envelope (trim unvoiced head/tail of each word)
//   T2b    : DTW token times with the constant bias removed (bias learned on G2, applied to G1)
//   T2b+E  : T2b + energy snap
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { decodePcm, frameDb, median, MEDIA, pct, r3, regionsFromMask } from './lib.mjs';
import { align, norm, runWhisper, toWav, VO_TEXT, W } from './whisper-lib.mjs';

const SR = 16000;
function voicedMask(file) {
  const pcm = decodePcm(file, SR);
  const db = frameDb(pcm, SR);
  const max = Math.max(...db);
  return { mask: Array.from(db, (v) => v > max - 35), dur: pcm.length / SR };
}

/** Energy snap: shrink each word to its voiced frames; if none inside, keep it but clamp to 120 ms. */
export function energySnap(words, mask, hop = 0.01) {
  return words.map((w) => {
    let a = Math.floor(w.start / hop), b = Math.ceil(w.end / hop);
    // allow a small look-back for starts that are late (DTW bias residue)
    const a0 = Math.max(0, a - 5);
    let s = -1, e = -1;
    for (let i = a0; i < b; i++) if (mask[i]) { s = i; break; }
    for (let i = b - 1; i >= Math.max(a0, s); i--) if (mask[i]) { e = i + 1; break; }
    if (s < 0) return { ...w, end: Math.min(w.end, w.start + 0.12) };
    return { ...w, start: s * hop, end: Math.max(e * hop, s * hop + 0.06) };
  });
}

const shift = (words, d) => words.map((w) => ({ ...w, start: Math.max(0, w.start + d), end: Math.max(0.01, w.end + d) }));
const lexOnly = (words) => words.filter((w) => /[a-z0-9]/i.test(w.text));

// ---------- G2 rebuild truth (deterministic, cached aiff) ----------
const G2D = `${W}/say`;
function sayWord(word, i) {
  const aiff = `${G2D}/w${i}.aiff`;
  if (!existsSync(aiff)) spawnSync('say', ['-v', 'Samantha', '-o', aiff, word]);
  const pcm = decodePcm(aiff, SR);
  const db = frameDb(pcm, SR, 0.005);
  const max = Math.max(...db);
  let a = 0, b = db.length - 1;
  while (a < b && db[a] < max - 40) a++;
  while (b > a && db[b] < max - 40) b--;
  return (b + 1 - a) * 80 / SR;
}
let rng = 7;
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const truthById = {};
let wi = 0;
for (const [id, text] of Object.entries(VO_TEXT)) {
  const raw = text.replace(/[—…]/g, ',').split(/\s+/).filter(Boolean);
  const truth = [];
  let t = 0.3;
  for (const tok of raw) {
    const word = tok.replace(/[^A-Za-z0-9'’-]/g, '');
    if (!word) continue;
    const d = sayWord(word, wi++);
    truth.push({ text: word, start: t, end: t + d });
    t += d;
    const gap = /[.,:;!?]$/.test(tok) ? 0.3 : rand() * 0.04;
    t += Math.round(gap * SR) / SR;
  }
  truthById[id] = truth;
}

function g2Eval(variantFn) {
  const xs = [];
  for (const id of Object.keys(VO_TEXT)) {
    const wav = `${G2D}/${id}.wav`;
    const vm = voicedMask(wav);
    const words = variantFn(wav, `${G2D}/${id}`, vm);
    const truth = truthById[id];
    const ref = truth.map((w) => norm(w.text).join(''));
    const hyp = words.map((w) => norm(w.text).join(''));
    const a = align(ref, hyp);
    for (const [ri, hi] of a.pairs) xs.push({ ds: words[hi].start - truth[ri].start, de: words[hi].end - truth[ri].end });
  }
  const ds = xs.map((x) => Math.abs(x.ds)), de = xs.map((x) => Math.abs(x.de));
  return {
    n: xs.length,
    startMed: Math.round(median(ds) * 1000), startP90: Math.round(pct(ds, 90) * 1000),
    endMed: Math.round(median(de) * 1000), endP90: Math.round(pct(de, 90) * 1000),
    start100: r3(ds.filter((x) => x <= 0.1).length / ds.length),
    start200: r3(ds.filter((x) => x <= 0.2).length / ds.length),
    bias: Math.round(median(xs.map((x) => x.ds)) * 1000),
  };
}

// learn DTW bias on G2 (start bias), apply to both sets
const rawT2 = g2Eval((wav, base) => lexOnly(runWhisper(wav, 'T2', base).words));
const MULTI = `${process.env.HOME}/.cache/whisper-models/ggml-base.bin`;
const rawT3 = g2Eval((wav, base) => lexOnly(runWhisper(wav, 'T3', base, MULTI).words));
console.log('T3 multilingual base + dtw base, raw:', rawT3);
const B3 = rawT3.bias / 1000;
console.log('T3 bias-corrected + E:', g2Eval((wav, base, vm) => energySnap(shift(lexOnly(runWhisper(wav, 'T3', base, MULTI).words), -B3), vm.mask)));
console.log('T3 corrected with the base.en bias (167 ms) + E:', g2Eval((wav, base, vm) => energySnap(shift(lexOnly(runWhisper(wav, 'T3', base, MULTI).words), -0.167), vm.mask)));
process.exit(0);
const BIAS = rawT2.bias / 1000;
const variants = {
  T1: (wav, base) => lexOnly(runWhisper(wav, 'T1', base).words),
  'T1+E': (wav, base, vm) => energySnap(lexOnly(runWhisper(wav, 'T1', base).words), vm.mask),
  T2: (wav, base) => lexOnly(runWhisper(wav, 'T2', base).words),
  T2b: (wav, base) => shift(lexOnly(runWhisper(wav, 'T2', base).words), -BIAS),
  'T2b+E': (wav, base, vm) => energySnap(shift(lexOnly(runWhisper(wav, 'T2', base).words), -BIAS), vm.mask),
};
const g2 = {};
for (const [k, fn] of Object.entries(variants)) g2[k] = g2Eval(fn);
console.log(`G2 (say, exact boundaries) — DTW bias removed = ${Math.round(BIAS * 1000)} ms`);
console.table(g2);

// ---------- G1 ElevenLabs VO: pause agreement, straddles, voiced fraction ----------
function islandsAndPauses(mask) {
  const islands = regionsFromMask(mask, 0.01, 0.06, 0.04);
  const pauses = [];
  for (let i = 1; i < islands.length; i++) if (islands[i][0] - islands[i - 1][1] >= 0.15) pauses.push([islands[i - 1][1], islands[i][0]]);
  return pauses;
}
const g1 = {};
for (const [k, fn] of Object.entries(variants)) {
  const errs = [], voiced = [];
  let straddle = 0, pauses = 0;
  for (const id of Object.keys(VO_TEXT)) {
    const wav = `${W}/${id}.wav`;
    toWav(`${MEDIA}/vo/${id}.mp3`, wav);
    const vm = voicedMask(wav);
    const words = fn(wav, `${W}/${id}`, vm);
    const ps = islandsAndPauses(vm.mask);
    pauses += ps.length;
    for (const [s, e] of ps) {
      errs.push(Math.min(...words.map((w) => Math.abs(w.end - s))), Math.min(...words.map((w) => Math.abs(w.start - e))));
      if (words.some((w) => Math.min(w.end, e) - Math.max(w.start, s) > 0.1)) straddle++;
    }
    for (const w of words) {
      const a = Math.floor(w.start / 0.01), b = Math.max(a + 1, Math.ceil(w.end / 0.01));
      let v = 0;
      for (let i = a; i < b; i++) v += vm.mask[i] ? 1 : 0;
      voiced.push(v / (b - a));
    }
  }
  g1[k] = {
    pauses, pauseErrMed: Math.round(median(errs) * 1000), pauseErrP90: Math.round(pct(errs, 90) * 1000),
    straddlingPause: straddle, voicedMed: r3(median(voiced)), voicedP10: r3(pct(voiced, 10)),
  };
}
console.log('G1 (ElevenLabs VO) — boundary agreement with the energy envelope');
console.table(g1);
writeFileSync(`${W}/report-refine.json`, JSON.stringify({ bias: BIAS, g2, g1 }, null, 1));
