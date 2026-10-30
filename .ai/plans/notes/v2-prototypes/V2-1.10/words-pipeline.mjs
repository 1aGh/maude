// The proposed words pipeline (prototype of `maude design transcribe-local --words`):
// whisper.cpp -ojf -ml 1 -sow -dtw <model> -nfa → word = first-token DTW time → per-file bias
// self-calibration against energy onsets after pauses → energy snap (trim unvoiced head/tail)
// → drop non-speech tags ([MUSIC], *noise*) → confidence kept per word.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { decodePcm, frameDb, median, regionsFromMask } from './lib.mjs';

const SR = 16000;
export const MODELS = {
  'base.en': { file: `${process.env.HOME}/.cache/whisper-models/ggml-base.en.bin`, dtw: 'base.en' },
  base: { file: `${process.env.HOME}/.cache/whisper-models/ggml-base.bin`, dtw: 'base' },
};

export function voiced(wav) {
  const pcm = decodePcm(wav, SR);
  const db = frameDb(pcm, SR);
  const max = Math.max(...db);
  const mask = Array.from(db, (v) => v > max - 35);
  const islands = regionsFromMask(mask, 0.01, 0.06, 0.04);
  const onsets = islands.length ? [islands[0][0]] : [];
  for (let i = 1; i < islands.length; i++) if (islands[i][0] - islands[i - 1][1] >= 0.15) onsets.push(islands[i][0]);
  return { mask, onsets, dur: pcm.length / SR };
}

export function transcribeWords(wav, outBase, { model = 'base.en', lang = 'en' } = {}) {
  const M = MODELS[model];
  const of = `${outBase}.wp-${model}-${lang}`;
  const t0 = performance.now();
  if (!existsSync(`${of}.json`) || process.env.NO_CACHE === '1') {
    const r = spawnSync('whisper-cli', ['-m', M.file, '-f', wav, '-of', of, '-ojf', '-ml', '1', '-sow', '-dtw', M.dtw, '-nfa', '-l', lang], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error(String(r.stderr));
  }
  const whisperSec = (performance.now() - t0) / 1000;
  const t1 = performance.now();
  const doc = JSON.parse(readFileSync(`${of}.json`, 'utf8'));
  const raw = [];
  for (const s of doc.transcription || []) {
    const text = (s.text || '').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (/^[\[(*♪]/.test(text)) continue; // non-speech tags whisper emits on noise/music
    const tt = (s.tokens || []).filter((t) => !/^\[_/.test(t.text));
    const first = tt.find((t) => t.t_dtw >= 0);
    raw.push({ text, start: first ? first.t_dtw / 100 : s.offsets.from / 1000, segTo: s.offsets.to / 1000, p: Math.min(...tt.map((t) => t.p ?? 1)) });
  }
  const v = voiced(wav);
  // end = next word start, capped by the segment end and 1.2 s
  for (let i = 0; i < raw.length; i++) raw[i].end = Math.min(raw[i + 1]?.start ?? raw[i].segTo, raw[i].start + 1.2, Math.max(raw[i].segTo, raw[i].start + 0.1));
  // per-file DTW bias: median(start of first word after each pause − that pause's energy onset)
  const d = [];
  for (const on of v.onsets) {
    const w = raw.find((x) => x.start >= on - 0.1 && x.start <= on + 0.6);
    if (w) d.push(w.start - on);
  }
  const bias = d.length >= 2 ? median(d) : 0;
  const words = raw.map((w, i) => {
    const s0 = Math.max(0, w.start - bias), e0 = Math.max(s0 + 0.05, w.end - bias);
    const a0 = Math.max(0, Math.floor(s0 / 0.01) - 5), b = Math.ceil(e0 / 0.01);
    let s = -1, e = -1;
    for (let k = a0; k < b; k++) if (v.mask[k]) { s = k; break; }
    for (let k = b - 1; k >= Math.max(a0, s); k--) if (v.mask[k]) { e = k + 1; break; }
    const start = s < 0 ? s0 : s * 0.01;
    const end = s < 0 ? Math.min(e0, s0 + 0.12) : Math.max(e * 0.01, start + 0.06);
    return { id: `w${i}`, text: w.text, start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, p: Math.round(w.p * 100) / 100, voiced: s >= 0 };
  });
  return { words, bias, whisperSec, postSec: (performance.now() - t1) / 1000, dur: v.dur };
}

/** Speech regions for ducking: confident, voiced words merged across gaps < gapSec, padded. */
export function speechRegions(words, { minP = 0.5, gapSec = 0.5, pad = 0.12 } = {}) {
  const regs = [];
  for (const w of words) {
    if (w.p < minP || !w.voiced) continue;
    const s = Math.max(0, w.start - pad), e = w.end + pad;
    const last = regs[regs.length - 1];
    if (last && s - last[1] < gapSec) last[1] = Math.max(last[1], e);
    else regs.push([s, e]);
  }
  return regs;
}
