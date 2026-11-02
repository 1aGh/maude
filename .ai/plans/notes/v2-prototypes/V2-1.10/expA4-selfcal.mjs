// Exp A4 — per-file DTW bias self-calibration (no per-model constant):
// bias = median(dtwStart(first word after a pause) − energy onset of that pause's end).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { decodePcm, frameDb, median, MEDIA, pct, r3, regionsFromMask } from './lib.mjs';
import { align, norm, runWhisper, toWav, VO_TEXT, W } from './whisper-lib.mjs';

const SR = 16000;
const MULTI = `${process.env.HOME}/.cache/whisper-models/ggml-base.bin`;
function vmask(file) {
  const pcm = decodePcm(file, SR);
  const db = frameDb(pcm, SR);
  const max = Math.max(...db);
  const mask = Array.from(db, (v) => v > max - 35);
  const islands = regionsFromMask(mask, 0.01, 0.06, 0.04);
  const onsets = [islands[0]?.[0] ?? 0];
  for (let i = 1; i < islands.length; i++) if (islands[i][0] - islands[i - 1][1] >= 0.15) onsets.push(islands[i][0]);
  const pauses = [];
  for (let i = 1; i < islands.length; i++) if (islands[i][0] - islands[i - 1][1] >= 0.15) pauses.push([islands[i - 1][1], islands[i][0]]);
  return { mask, onsets, pauses };
}
export function selfBias(words, onsets) {
  const d = [];
  for (const on of onsets) {
    const w = words.find((x) => x.start >= on - 0.1 && x.start <= on + 0.6);
    if (w) d.push(w.start - on);
  }
  return d.length >= 2 ? median(d) : 0;
}
function snap(words, mask, hop = 0.01) {
  return words.map((w) => {
    const a0 = Math.max(0, Math.floor(w.start / hop) - 5), b = Math.ceil(w.end / hop);
    let s = -1, e = -1;
    for (let i = a0; i < b; i++) if (mask[i]) { s = i; break; }
    for (let i = b - 1; i >= Math.max(a0, s); i--) if (mask[i]) { e = i + 1; break; }
    if (s < 0) return { ...w, end: Math.min(w.end, w.start + 0.12) };
    return { ...w, start: s * hop, end: Math.max(e * hop, s * hop + 0.06) };
  });
}
const lex = (ws) => ws.filter((w) => /[a-z0-9]/i.test(w.text));
const shift = (ws, d) => ws.map((w) => ({ ...w, start: Math.max(0, w.start - d), end: Math.max(0.01, w.end - d) }));

// G2 truth rebuild
const G2D = `${W}/say`;
function sayLen(word, i) {
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
const truth = {};
let wi = 0;
for (const [id, text] of Object.entries(VO_TEXT)) {
  const raw = text.replace(/[—…]/g, ',').split(/\s+/).filter(Boolean);
  const tr = [];
  let t = 0.3;
  for (const tok of raw) {
    const word = tok.replace(/[^A-Za-z0-9'’-]/g, '');
    if (!word) continue;
    const d = sayLen(word, wi++);
    tr.push({ text: word, start: t, end: t + d });
    t += d + Math.round((/[.,:;!?]$/.test(tok) ? 0.3 : rand() * 0.04) * SR) / SR;
  }
  truth[id] = tr;
}

for (const [label, cfg, model] of [['base.en + dtw', 'T2', undefined], ['base (multilingual) + dtw', 'T3', MULTI]]) {
  const xs = [], biases = [];
  for (const id of Object.keys(VO_TEXT)) {
    const wav = `${G2D}/${id}.wav`;
    const vm = vmask(wav);
    let ws = lex(runWhisper(wav, cfg, `${G2D}/${id}`, model).words);
    const b = selfBias(ws, vm.onsets);
    biases.push(b);
    ws = snap(shift(ws, b), vm.mask);
    const a = align(truth[id].map((w) => norm(w.text).join('')), ws.map((w) => norm(w.text).join('')));
    for (const [ri, hi] of a.pairs) xs.push({ ds: ws[hi].start - truth[id][ri].start, de: ws[hi].end - truth[id][ri].end });
  }
  const ds = xs.map((x) => Math.abs(x.ds)), de = xs.map((x) => Math.abs(x.de));
  console.log(`G2 ${label} self-calibrated+E: n=${xs.length} start med ${Math.round(median(ds) * 1000)} p90 ${Math.round(pct(ds, 90) * 1000)} | end med ${Math.round(median(de) * 1000)} p90 ${Math.round(pct(de, 90) * 1000)} | ≤100ms ${r3(ds.filter((x) => x <= 0.1).length / ds.length)} ≤200ms ${r3(ds.filter((x) => x <= 0.2).length / ds.length)} | per-file bias ms ${biases.map((b) => Math.round(b * 1000)).join(',')}`);
  // G1 natural VO pause agreement
  const errs = [];
  let straddle = 0, pauses = 0;
  for (const id of Object.keys(VO_TEXT)) {
    const wav = `${W}/${id}.wav`;
    toWav(`${MEDIA}/vo/${id}.mp3`, wav);
    const vm = vmask(wav);
    let ws = lex(runWhisper(wav, cfg, `${W}/${id}`, model).words);
    ws = snap(shift(ws, selfBias(ws, vm.onsets)), vm.mask);
    for (const [s, e] of vm.pauses) {
      pauses++;
      errs.push(Math.min(...ws.map((w) => Math.abs(w.end - s))), Math.min(...ws.map((w) => Math.abs(w.start - e))));
      if (ws.some((w) => Math.min(w.end, e) - Math.max(w.start, s) > 0.1)) straddle++;
    }
  }
  console.log(`G1 ${label} self-calibrated+E: pauses ${pauses} boundary err med ${Math.round(median(errs) * 1000)} p90 ${Math.round(pct(errs, 90) * 1000)} straddling ${straddle}`);
}
