// Exp A3 — multilingual base model: DTW bias on English G2, Czech agreement vs a Scribe SRT,
// and hallucination on real Alligators clips whose analyst notes say "ambient shouts only".
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { decodePcm, frameDb, median, MEDIA, OUT, pct, r3 } from './lib.mjs';
import { align, norm } from './whisper-lib.mjs';

const MODEL = `${process.env.HOME}/.cache/whisper-models/ggml-base.bin`;
const D = `${OUT}/expA3`;
mkdirSync(D, { recursive: true });

function wavOf(src, name) {
  const wav = `${D}/${name}.wav`;
  if (!existsSync(wav)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  return wav;
}
function whisper(wav, name, lang, dtw) {
  const of = `${D}/${name}.${lang}.${dtw ? 'dtw' : 'seg'}`;
  const args = ['-m', MODEL, '-f', wav, '-of', of, '-ojf', '-ml', '1', '-sow', '-l', lang];
  if (dtw) args.push('-dtw', 'base', '-nfa');
  const t0 = performance.now();
  if (!existsSync(`${of}.json`)) {
    const r = spawnSync('whisper-cli', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error(String(r.stderr));
  }
  const wall = (performance.now() - t0) / 1000;
  const doc = JSON.parse(readFileSync(`${of}.json`, 'utf8'));
  const words = [];
  for (const s of doc.transcription || []) {
    const text = (s.text || '').trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const tt = (s.tokens || []).filter((t) => !/^\[_/.test(t.text));
    const first = tt.find((t) => t.t_dtw >= 0);
    words.push({ text, start: dtw && first ? first.t_dtw / 100 : s.offsets.from / 1000, end: s.offsets.to / 1000, p: Math.min(...tt.map((t) => t.p ?? 1)) });
  }
  return { words, wall };
}
const normCs = (s) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

// 1) Czech speech vs the cloud Scribe SRT that already sits next to it (agreement, not ground truth)
const srt = readFileSync(`${MEDIA}/music/47d9b6d1.srt`, 'utf8');
const scribeText = srt.split(/\n/).filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l)).join(' ');
const csWav = wavOf(`${MEDIA}/music/all-47d9b6d1.mp3`, 'cs-47d9b6d1');
for (const dtw of [false, true]) {
  const { words, wall } = whisper(csWav, 'cs-47d9b6d1', 'cs', dtw);
  const a = align(normCs(scribeText), normCs(words.map((w) => w.text).join(' ')));
  console.log(`Czech 47d9b6d1 (21 s) base -l cs ${dtw ? 'DTW' : 'seg'}: WER vs Scribe = ${r3(a.wer)} (${a.errors}/${normCs(scribeText).length}), wall ${r3(wall)} s`);
  if (dtw) console.log('  whisper:', words.map((w) => w.text).join(' '));
}
console.log('  scribe :', scribeText);

// 2) Hallucination on ambient-only clips (footage-analyst said: shouts, no dialogue)
const ambient = ['124847ce', '2e3b6e7f', '5b8ee6dc', '7fad5cf2', 'b1061669', 'b2996668', 'c43b76df', '25c450fb', '3f5fd5f3', 'e43ac47e', 'd4a5b800', '381b5d7c'];
let totalSec = 0, totalWords = 0, lowP = 0;
const rows = [];
for (const id of ambient) {
  const wav = wavOf(`${MEDIA}/clips/${id}.mp4`, id);
  const pcm = decodePcm(wav, 16000);
  const dur = pcm.length / 16000;
  const { words } = whisper(wav, id, 'cs', false);
  totalSec += dur; totalWords += words.length;
  lowP += words.filter((w) => w.p < 0.5).length;
  const note = (() => { try { return JSON.parse(readFileSync(`${MEDIA}/clips/${id}.footage.json`, 'utf8')).speech ?? ''; } catch { return ''; } })();
  rows.push({ id, sec: r3(dur), words: words.length, minP: r3(Math.min(1, ...words.map((w) => w.p))), text: words.map((w) => w.text).join(' ').slice(0, 60), analyst: String(note).slice(0, 50) });
}
console.table(rows);
console.log(`ambient clips: ${totalWords} words over ${Math.round(totalSec)} s; ${lowP} words with min token p < 0.5`);
