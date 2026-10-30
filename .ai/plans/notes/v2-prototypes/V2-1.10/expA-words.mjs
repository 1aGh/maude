// Exp A — word timings from whisper.cpp (the `maude design transcribe` local engine).
// G1: ElevenLabs VO (known text)         → WER, fragmentation, pause-boundary agreement, voiced fraction
// G2: `say` per-word concatenation        → exact word-boundary ground truth → start/end error
// Configs: T0 = today's verb flags (-oj -ml 1); T1 = + -sow; T2 = -ojf -ml 1 -sow -dtw base.en -nfa
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodePcm, frameDb, median, MEDIA, OUT, pct, r3, regionsFromMask } from './lib.mjs';

const MODEL_EN = `${process.env.HOME}/.cache/whisper-models/ggml-base.en.bin`;
const W = `${OUT}/expA`;
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

function toWav(src, dst) {
  if (!existsSync(dst)) spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', dst]);
}

const CONFIGS = {
  T0: ['-oj', '-ml', '1'],
  T1: ['-oj', '-ml', '1', '-sow'],
  T2: ['-ojf', '-ml', '1', '-sow', '-dtw', 'base.en', '-nfa'],
};

/** Run whisper with a config → words [{text,start,end,p?}] + wall seconds. */
export function runWhisper(wav, cfg, base, model = MODEL_EN, extra = []) {
  const of = `${base}.${cfg}`;
  const t0 = performance.now();
  const r = spawnSync('whisper-cli', ['-m', model, '-f', wav, '-of', of, ...CONFIGS[cfg], ...extra], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wall = (performance.now() - t0) / 1000;
  if (r.status !== 0) throw new Error(`whisper failed ${r.stderr}`);
  const doc = JSON.parse(readFileSync(`${of}.json`, 'utf8'));
  const segs = doc.transcription || [];
  let words = [];
  if (cfg === 'T2') {
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

/** Speech islands from the clean signal (energy > max-35 dB), and the pauses between them. */
function speechMap(file) {
  const pcm = decodePcm(file, 16000);
  const db = frameDb(pcm, 16000);
  const max = Math.max(...db);
  const mask = Array.from(db, (v) => v > max - 35);
  const islands = regionsFromMask(mask, 0.01, 0.06, 0.04);
  const pauses = [];
  for (let i = 1; i < islands.length; i++) if (islands[i][0] - islands[i - 1][1] >= 0.15) pauses.push([islands[i - 1][1], islands[i][0]]);
  return { mask, islands, pauses, dur: pcm.length / 16000 };
}

function voicedFraction(words, mask) {
  const fr = [];
  for (const w of words) {
    const a = Math.floor(w.start / 0.01), b = Math.max(a + 1, Math.ceil(w.end / 0.01));
    let v = 0;
    for (let i = a; i < b; i++) v += mask[i] ? 1 : 0;
    fr.push(v / (b - a));
  }
  return fr;
}

/** For each pause, error of the nearest word end to pause start and nearest word start to pause end. */
function pauseAgreement(words, pauses) {
  const errs = [];
  let straddle = 0;
  for (const [ps, pe] of pauses) {
    const endErr = Math.min(...words.map((w) => Math.abs(w.end - ps)));
    const startErr = Math.min(...words.map((w) => Math.abs(w.start - pe)));
    errs.push(endErr, startErr);
    // a word that covers > 100 ms of the pause is a visible caption error (highlight lingers in silence)
    if (words.some((w) => Math.min(w.end, pe) - Math.max(w.start, ps) > 0.1)) straddle++;
  }
  return { errs, straddle };
}

// ---------------- G1: ElevenLabs VO ----------------
const g1 = {};
for (const cfg of Object.keys(CONFIGS)) g1[cfg] = { errors: 0, ref: 0, items: 0, pieces: 0, pauseErr: [], straddle: 0, pauses: 0, voiced: [], wall: 0, audio: 0, onset: [], offset: [] };
for (const [id, text] of Object.entries(VO_TEXT)) {
  const src = `${MEDIA}/vo/${id}.mp3`;
  const wav = `${W}/${id}.wav`;
  toWav(src, wav);
  const sm = speechMap(wav);
  const ref = norm(text);
  for (const cfg of Object.keys(CONFIGS)) {
    const { words, wall } = runWhisper(wav, cfg, `${W}/${id}`);
    const hyp = norm(words.map((w) => w.text).join(' '));
    const a = align(ref, hyp);
    const G = g1[cfg];
    G.errors += a.errors; G.ref += ref.length; G.items += words.length;
    // "pieces": items that are not a whole word (punctuation-only or no leading space in the raw token stream)
    G.pieces += words.filter((w) => /^[^a-z0-9]+$/i.test(w.text)).length;
    const lex = words.filter((w) => /[a-z0-9]/i.test(w.text));
    const pa = pauseAgreement(lex, sm.pauses);
    G.pauseErr.push(...pa.errs); G.straddle += pa.straddle; G.pauses += sm.pauses.length;
    G.voiced.push(...voicedFraction(lex, sm.mask));
    G.wall += wall; G.audio += sm.dur;
    if (lex.length) { G.onset.push(Math.abs(lex[0].start - sm.islands[0][0])); G.offset.push(Math.abs(lex[lex.length - 1].end - sm.islands[sm.islands.length - 1][1])); }
    if (id === 'vo-65') writeFileSync(`${W}/vo-65.${cfg}.words.json`, JSON.stringify(words, null, 1));
  }
}
const g1Report = {};
for (const [cfg, G] of Object.entries(g1)) {
  g1Report[cfg] = {
    WER: r3(G.errors / G.ref),
    refWords: G.ref,
    outputItems: G.items,
    itemsPerRefWord: r3(G.items / G.ref),
    punctOnlyItems: G.pieces,
    pauses: G.pauses,
    pauseBoundaryErrMedianMs: Math.round(median(G.pauseErr) * 1000),
    pauseBoundaryErrP90Ms: Math.round(pct(G.pauseErr, 90) * 1000),
    wordsStraddlingPause: G.straddle,
    voicedFractionMedian: r3(median(G.voiced)),
    voicedFractionP10: r3(pct(G.voiced, 10)),
    onsetErrMedianMs: Math.round(median(G.onset) * 1000),
    offsetErrMedianMs: Math.round(median(G.offset) * 1000),
    realtimeFactor: r3(G.wall / G.audio),
    audioSec: Math.round(G.audio),
  };
}
console.log('G1 ElevenLabs VO (13 unique lines, English, base.en)');
console.table(g1Report);

// ---------------- G2: say per-word concatenation (exact boundaries) ----------------
const G2D = `${W}/say`;
mkdirSync(G2D, { recursive: true });
const SR = 16000;
function sayWord(word, i) {
  const aiff = `${G2D}/w${i}.aiff`;
  if (!existsSync(aiff)) spawnSync('say', ['-v', 'Samantha', '-o', aiff, word]);
  const pcm = decodePcm(aiff, SR);
  const db = frameDb(pcm, SR, 0.005);
  const max = Math.max(...db);
  let a = 0, b = db.length - 1;
  while (a < b && db[a] < max - 40) a++;
  while (b > a && db[b] < max - 40) b--;
  return pcm.slice(a * 80, (b + 1) * 80);
}
let rng = 7;
const rand = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
const g2 = { T0: [], T1: [], T2: [] };
const g2wer = { T0: [0, 0], T1: [0, 0], T2: [0, 0] };
let wi = 0;
for (const [id, text] of Object.entries(VO_TEXT)) {
  const raw = text.replace(/[—…]/g, ',').split(/\s+/).filter(Boolean);
  const chunks = [];
  const truth = [];
  let t = 0.3;
  chunks.push(new Float32Array(Math.round(0.3 * SR)));
  for (const tok of raw) {
    const word = tok.replace(/[^A-Za-z0-9'’-]/g, '');
    if (!word) continue;
    const pcm = sayWord(word, wi++);
    truth.push({ text: word, start: t, end: t + pcm.length / SR });
    chunks.push(pcm);
    t += pcm.length / SR;
    const gap = /[.,:;!?]$/.test(tok) ? 0.3 : rand() * 0.04; // connected speech, 0–40 ms joins; 300 ms at punctuation
    chunks.push(new Float32Array(Math.round(gap * SR)));
    t += Math.round(gap * SR) / SR;
  }
  chunks.push(new Float32Array(Math.round(0.4 * SR)));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const pcmFile = `${G2D}/${id}.f32`;
  writeFileSync(pcmFile, Buffer.from(all.buffer));
  const wav = `${G2D}/${id}.wav`;
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', pcmFile, '-c:a', 'pcm_s16le', wav]);
  const ref = truth.map((w) => norm(w.text).join(''));
  for (const cfg of Object.keys(CONFIGS)) {
    const { words } = runWhisper(wav, cfg, `${G2D}/${id}`);
    const lex = words.filter((w) => /[a-z0-9]/i.test(w.text));
    const hyp = lex.map((w) => norm(w.text).join(''));
    const a = align(ref, hyp);
    g2wer[cfg][0] += a.errors; g2wer[cfg][1] += ref.length;
    for (const [ri, hi] of a.pairs) g2[cfg].push({ ds: lex[hi].start - truth[ri].start, de: lex[hi].end - truth[ri].end });
  }
}
const g2Report = {};
for (const [cfg, xs] of Object.entries(g2)) {
  const ds = xs.map((x) => Math.abs(x.ds)), de = xs.map((x) => Math.abs(x.de));
  g2Report[cfg] = {
    matchedWords: xs.length,
    WER: r3(g2wer[cfg][0] / g2wer[cfg][1]),
    startErrMedianMs: Math.round(median(ds) * 1000),
    startErrP90Ms: Math.round(pct(ds, 90) * 1000),
    endErrMedianMs: Math.round(median(de) * 1000),
    endErrP90Ms: Math.round(pct(de, 90) * 1000),
    startWithin100ms: r3(ds.filter((x) => x <= 0.1).length / ds.length),
    startWithin200ms: r3(ds.filter((x) => x <= 0.2).length / ds.length),
    signedStartBiasMs: Math.round(median(xs.map((x) => x.ds)) * 1000),
  };
}
console.log('G2 say-concatenated speech, exact word boundaries (base.en)');
console.table(g2Report);
writeFileSync(`${W}/report.json`, JSON.stringify({ g1: g1Report, g2: g2Report }, null, 1));
