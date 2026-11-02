// Exp A — word timings from whisper.cpp (the `maude design transcribe` local engine).
// G1: ElevenLabs VO (known text)         → WER, fragmentation, pause-boundary agreement, voiced fraction
// G2: `say` per-word concatenation        → exact word-boundary ground truth → start/end error
// Configs: T0 = today's verb flags (-oj -ml 1); T1 = + -sow; T2 = -ojf -ml 1 -sow -dtw base.en -nfa
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePcm, frameDb, median, MEDIA, OUT, pct, r3, regionsFromMask } from './lib.mjs';

const MODEL_EN = `${process.env.HOME}/.cache/whisper-models/ggml-base.en.bin`;
export const W = `${OUT}/expA`;
mkdirSync(W, { recursive: true });

export const VO_TEXT = {
  'vo-00': 'Every design tool pulls you out of your code… not this one.',
  'vo-10': 'It opens like a real designer would — sharp questions, real research, and a moodboard that commits to a direction.',
  'vo-20': 'Then a whole design system, built for you. Colour, type, space, motion, components — every token, in place.',
  'vo-40': 'Describe a screen. Watch it appear. Real components, real tokens, real code.',
  'vo-50': 'A panel of critics grades it — accessibility, type, restraint — then fixes what it flags.',
  'vo-60': "Here's the part that lands: you don't prompt it. You point. You comment on a pixel. You draw on it. And it understands.",
  'vo-65': "And you're not the only cursor. Live, peer to peer, through a hub you run — no SaaS, no sign-up.",
  'vo-70': 'Logos, icons, diagrams — drawn by a geometry engine. Computed, never guessed.',
  'vo-80': 'Animate it once. Ship a single file — web and native, frame for frame.',
  'vo-92': 'And it remembers everything. Every plan, every decision, the reason behind it. Close the laptop — tomorrow it picks up mid-thought.',
  'vo-94': "After that, it's a rhythm. Plan. Execute. Done.",
  'vo-96': 'And nothing ships unchecked — security, code review, tests, five platforms — every time. Then it opens the PR.',
  'vo-99': 'maude. No telemetry. No sign-up. Your repo is the source of truth.',
};

export const norm = (s) =>
  s
    .toLowerCase()
    .replace(/colour/g, 'color')
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Levenshtein alignment on token arrays → { wer, pairs:[[refIdx, hypIdx]] } */
export function align(ref, hyp) {
  const n = ref.length, m = hyp.length;
  const d = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const pairs = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === hyp[j - 1] && d[i][j] === d[i - 1][j - 1]) { pairs.push([i - 1, j - 1]); i--; j--; }
    else if (d[i][j] === d[i - 1][j - 1] + 1) { i--; j--; }
    else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  return { wer: d[n][m] / Math.max(1, n), errors: d[n][m], pairs: pairs.reverse() };
}

export function toWav(src, dst) {
  if (!existsSync(dst)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst]);
}

const CONFIGS = {
  T0: ['-oj', '-ml', '1'],
  T1: ['-oj', '-ml', '1', '-sow'],
  T2: ['-ojf', '-ml', '1', '-sow', '-dtw', 'base.en', '-nfa'],
  T3: ['-ojf', '-ml', '1', '-sow', '-dtw', 'base', '-nfa', '-l', 'en'],
};

/** Run whisper with a config → words [{text,start,end,p?}] + wall seconds. */
export function runWhisper(wav, cfg, base, model = MODEL_EN, extra = []) {
  const of = `${base}.${cfg}`;
  const t0 = performance.now();
  const cached = existsSync(`${of}.json`) && process.env.NO_CACHE !== '1';
  const r = cached ? { status: 0 } : spawnSync('whisper-cli', ['-m', model, '-f', wav, '-of', of, ...CONFIGS[cfg], ...extra], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wall = (performance.now() - t0) / 1000;
  if (r.status !== 0) throw new Error(`whisper failed ${r.stderr}`);
  const doc = JSON.parse(readFileSync(`${of}.json`, 'utf8'));
  const segs = doc.transcription || [];
  let words = [];
  if (cfg === 'T2' || cfg === 'T3') {
    // word start = t_dtw of its first text token; end = t_dtw of the next token in the stream
    const toks = [];
    for (const s of segs) {
      const text = (s.text || '').trim();
      if (!text) continue;
      const tt = (s.tokens || []).filter((t) => !/^\[_/.test(t.text));
      toks.push({ text, toks: tt, segFrom: s.offsets.from / 1000, segTo: s.offsets.to / 1000, p: Math.min(...tt.map((t) => t.p ?? 1)) });
    }
    for (let k = 0; k < toks.length; k++) {
      const w = toks[k];
      const first = w.toks.find((t) => t.t_dtw >= 0);
      const start = first ? first.t_dtw / 100 : w.segFrom;
      // end: last token of this word with a dtw time that is a punctuation, else next word's start
      const nxt = toks[k + 1]?.toks.find((t) => t.t_dtw >= 0);
      const punct = [...w.toks].reverse().find((t) => /^[.,!?;:]$/.test(t.text.trim()) && t.t_dtw >= 0);
      let end = punct ? punct.t_dtw / 100 : nxt ? nxt.t_dtw / 100 : w.segTo;
      if (end <= start) end = start + 0.05;
      words.push({ text: w.text, start, end, p: w.p });
    }
  } else {
    for (const s of segs) {
      const text = (s.text || '').trim();
      if (!text) continue; // exactly whisperJsonToWords: keeps punctuation-only + subword pieces
      words.push({ text, start: s.offsets.from / 1000, end: s.offsets.to / 1000 });
    }
  }
  return { words, wall };
}

