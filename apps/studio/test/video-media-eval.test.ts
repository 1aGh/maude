// test/video-media-eval.test.ts — S7.2: the LOCAL eval of V2-1.10 §6.1–§6.2 against the §5.11 budgets.
//
// OFF by default. `MAUDE_MEDIA_EVAL=1 bun test test/video-media-eval.test.ts` runs the real
// pipeline — real whisper-cli, a real installed model, macOS `say`, ffmpeg — and fails if an
// accuracy or speed budget regresses. It skips (it does not fail) when any of those is missing, so
// turning the env var on in a machine without them is harmless. Not CI: whisper and `say` are not
// there, and headless timings swing with machine load.
//
// The truth is the spike's G2 corpus: each word of the 13 V5 showreel voice-over lines synthesised
// SEPARATELY with `say -v Samantha`, trimmed, and joined with 0–40 ms gaps (300 ms at punctuation),
// so every word boundary is exact. The pause check runs on the real ElevenLabs voice-over (G1).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWhisperCli } from '../bin/_transcribe-local.mjs';
import { resolveWhisperModel, WHISPER_MODELS } from '../generation/whisper-models.ts';
import { encodeWav, findFfmpeg } from '../video/decode.ts';
import { analyseSpeech, type SpeechAnalysis } from '../video/words-run.ts';
import { voicingFromPcm } from '../video/words-timing.ts';
import { regionScore } from './fixtures/video/synth.ts';

const SR = 16000;
const REPO = join(import.meta.dir, '..', '..', '..');

const VO_TEXT: Record<string, string> = {
  'vo-00': 'Every design tool pulls you out of your code… not this one.',
  'vo-10':
    'It opens like a real designer would — sharp questions, real research, and a moodboard that commits to a direction.',
  'vo-20':
    'Then a whole design system, built for you. Colour, type, space, motion, components — every token, in place.',
  'vo-40': 'Describe a screen. Watch it appear. Real components, real tokens, real code.',
  'vo-50':
    'A panel of critics grades it — accessibility, type, restraint — then fixes what it flags.',
  'vo-60':
    "Here's the part that lands: you don't prompt it. You point. You comment on a pixel. You draw on it. And it understands.",
  'vo-65':
    "And you're not the only cursor. Live, peer to peer, through a hub you run — no SaaS, no sign-up.",
  'vo-70': 'Logos, icons, diagrams — drawn by a geometry engine. Computed, never guessed.',
  'vo-80': 'Animate it once. Ship a single file — web and native, frame for frame.',
  'vo-92':
    'And it remembers everything. Every plan, every decision, the reason behind it. Close the laptop — tomorrow it picks up mid-thought.',
  'vo-94': "After that, it's a rhythm. Plan. Execute. Done.",
  'vo-96':
    'And nothing ships unchecked — security, code review, tests, five platforms — every time. Then it opens the PR.',
  'vo-99': 'maude. No telemetry. No sign-up. Your repo is the source of truth.',
};

const whisper = findWhisperCli();
const ffmpeg = findFfmpeg();
const hasSay = existsSync('/usr/bin/say');

/** An installed English model: Maude's managed cache first, then the spike's own folder. */
function findModel(): { path: string; id: string } | null {
  const managed = resolveWhisperModel('base.en');
  const candidates = [managed, join(homedir(), '.cache', 'whisper-models', 'ggml-base.en.bin')];
  for (const c of candidates) {
    if (!c || !existsSync(c)) continue;
    const file = c.split('/').pop();
    const id = WHISPER_MODELS.find((m) => m.file === file)?.id;
    if (id) return { path: c, id };
  }
  return null;
}
const model = findModel();

const ENABLED = process.env.MAUDE_MEDIA_EVAL === '1' && !!whisper && !!ffmpeg && hasSay && !!model;
if (process.env.MAUDE_MEDIA_EVAL === '1' && !ENABLED)
  console.warn(
    `[media-eval] skipped — needs whisper-cli (${!!whisper}), ffmpeg (${!!ffmpeg}), say (${hasSay}) and an installed model (${!!model})`
  );

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

interface SaidLine {
  wav: string;
  truth: Array<{ text: string; start: number; end: number }>;
  durationSec: number;
}

/** G2: one `say` per word, trimmed to its voiced part, joined with the spike's gaps. */
function buildSaidLine(dir: string, id: string, text: string, counter: { n: number }): SaidLine {
  let rng = 7 + counter.n;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648;
  };
  const chunks: Float32Array[] = [new Float32Array(Math.round(0.3 * SR))];
  const truth: SaidLine['truth'] = [];
  let t = 0.3;
  for (const tok of text.replace(/[—…]/g, ',').split(/\s+/).filter(Boolean)) {
    const word = tok.replace(/[^A-Za-z0-9'’-]/g, '');
    if (!word) continue;
    const aiff = join(dir, `w${counter.n++}.aiff`);
    spawnSync('say', ['-v', 'Samantha', '-o', aiff, word]);
    const raw = join(dir, 'w.f32');
    spawnSync(ffmpeg as string, [
      '-v',
      'error',
      '-y',
      '-i',
      aiff,
      '-ac',
      '1',
      '-ar',
      String(SR),
      '-f',
      'f32le',
      raw,
    ]);
    const b = readFileSync(raw);
    const all = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
    // trim to the voiced part (5 ms frames, 40 dB below the loudest)
    const hop = Math.round(SR * 0.005);
    const db: number[] = [];
    for (let i = 0; i + hop <= all.length; i += hop) {
      let s = 0;
      for (let j = i; j < i + hop; j++) s += all[j] * all[j];
      db.push(10 * Math.log10(s / hop + 1e-12));
    }
    const max = Math.max(...db);
    let a = 0;
    let z = db.length - 1;
    while (a < z && db[a] < max - 40) a++;
    while (z > a && db[z] < max - 40) z--;
    const pcm = all.slice(a * hop, (z + 1) * hop);
    truth.push({ text: word, start: t, end: t + pcm.length / SR });
    chunks.push(pcm);
    t += pcm.length / SR;
    const gap = /[.,:;!?]$/.test(tok) ? 0.3 : rand() * 0.04;
    const gapN = Math.round(gap * SR);
    chunks.push(new Float32Array(gapN));
    t += gapN / SR;
  }
  chunks.push(new Float32Array(Math.round(0.4 * SR)));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const pcm = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    pcm.set(c, o);
    o += c.length;
  }
  const wav = join(dir, `${id}.wav`);
  writeFileSync(wav, encodeWav(pcm, SR));
  return { wav, truth, durationSec: total / SR };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

describe.skipIf(!ENABLED)('MAUDE_MEDIA_EVAL — V2-1.10 §6.1–§6.2 against the §5.11 budgets', () => {
  test('G2 (exact boundaries): start p90 ≤ 150 ms, ≥ 95 % within 200 ms; ≤ 0.2 × real time; regions recall ≥ 0.95', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-eval-'));
    try {
      const counter = { n: 0 };
      const errs: number[] = [];
      let wall = 0;
      let audio = 0;
      let postMs = 0;
      const analyses: Array<{ a: SpeechAnalysis; line: SaidLine }> = [];
      for (const [id, text] of Object.entries(VO_TEXT)) {
        const line = buildSaidLine(dir, id, text, counter);
        const t0 = performance.now();
        const a = await analyseSpeech({
          input: line.wav,
          whisper: whisper as string,
          modelPath: (model as { path: string }).path,
          modelId: (model as { id: string }).id,
          lang: 'en',
        });
        wall += (performance.now() - t0) / 1000;
        audio += line.durationSec;
        analyses.push({ a, line });
        // match by order on normalised text (a missed word just drops out of the sample)
        const hyp = a.words.filter((w) => /[a-z0-9]/i.test(w.text));
        let h = 0;
        for (const w of line.truth) {
          while (h < hyp.length && norm(hyp[h].text) !== norm(w.text)) h++;
          if (h >= hyp.length) break;
          errs.push(Math.abs(hyp[h].t0 - w.start));
          h++;
        }
        postMs += (a.ms.post / line.durationSec) * 60; // per minute of audio
      }
      expect(errs.length).toBeGreaterThan(100);
      expect(pct(errs, 90)).toBeLessThanOrEqual(0.15);
      expect(errs.filter((e) => e <= 0.2).length / errs.length).toBeGreaterThanOrEqual(0.95);
      expect(wall / audio).toBeLessThanOrEqual(0.2);
      expect(postMs / analyses.length).toBeLessThanOrEqual(50);
      // regions recall against the exact word intervals
      for (const { a, line } of analyses) {
        const s = regionScore(
          line.truth.map((w) => [w.start, w.end] as [number, number]),
          a.regions,
          line.durationSec
        );
        expect(s.recall).toBeGreaterThanOrEqual(0.95);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);

  test('G1 (real ElevenLabs voice-over): ≤ 10 % of pauses ≥ 150 ms are bridged by a word', async () => {
    let pauses = 0;
    let bridged = 0;
    for (const id of Object.keys(VO_TEXT)) {
      const mp3 = join(
        REPO,
        'scripts',
        'video',
        'final',
        'public',
        'v5',
        'audio',
        'vo',
        '_trim',
        `${id}.mp3`
      );
      if (!existsSync(mp3)) continue;
      const a = await analyseSpeech({
        input: mp3,
        whisper: whisper as string,
        modelPath: (model as { path: string }).path,
        modelId: (model as { id: string }).id,
        lang: 'en',
      });
      const dir = mkdtempSync(join(tmpdir(), 'maude-eval-g1-'));
      try {
        const raw = join(dir, 'a.f32');
        spawnSync(ffmpeg as string, [
          '-v',
          'error',
          '-y',
          '-i',
          mp3,
          '-ac',
          '1',
          '-ar',
          String(SR),
          '-f',
          'f32le',
          raw,
        ]);
        const b = readFileSync(raw);
        const v = voicingFromPcm(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), SR);
        // pauses = gaps ≥ 150 ms between voiced runs
        let last = -1;
        const runs: Array<[number, number]> = [];
        for (let i = 0; i <= v.mask.length; i++) {
          const on = i < v.mask.length && v.mask[i] === 1;
          if (on && last < 0) last = i;
          if (!on && last >= 0) {
            runs.push([last * 0.01, i * 0.01]);
            last = -1;
          }
        }
        for (let i = 1; i < runs.length; i++) {
          const [p0, p1] = [runs[i - 1][1], runs[i][0]];
          if (p1 - p0 < 0.15) continue;
          pauses++;
          if (a.words.some((w) => w.t0 < p0 && w.t1 > (p0 + p1) / 2)) bridged++;
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(pauses).toBeGreaterThan(20);
    expect(bridged / pauses).toBeLessThanOrEqual(0.1);
  }, 600_000);
});

describe('MAUDE_MEDIA_EVAL gate', () => {
  test('is off unless MAUDE_MEDIA_EVAL=1 (the default run never needs whisper, say or a model)', () => {
    if (process.env.MAUDE_MEDIA_EVAL !== '1') expect(ENABLED).toBe(false);
    else expect(typeof ENABLED).toBe('boolean');
  });
});
