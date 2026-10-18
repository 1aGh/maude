// apps/studio/video/words-run.ts — S7.2: the words pipeline end to end (V2-1.10 §5.6 "Words").
//
//   decode → whisper.cpp (private temp dir) → parse → lag calibration + energy snap + loops →
//   speech regions → a `Transcript` the strict writer accepts.
//
// Shared by `maude design transcribe-local` (auto tier) and the local-whisper path of
// `maude design transcribe` (prompt tier), so the two can never write different files.
//
// Never downloads anything: the caller hands in the whisper binary and an INSTALLED model path.
// Every child gets an args array (no shell), and whisper writes into a fresh 0700 temp dir — never
// beside the source, so no bare `assets/<sha8>.json` is left behind (it is default-closed on the
// file plane, and the word timings in it never reached a peer — §2).

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type DecodeOptions, decodeAudio, encodeWav } from './decode.ts';
import {
  SIDECAR_ASSET_RE,
  serializeTranscript,
  sidecarRelFor,
  type Transcript,
  type TranscriptWord,
} from './schema.ts';
import { energySpeechRegions, type Region, speechRegionsFromWords } from './speech.ts';
import { parseWhisperFull } from './whisper-parse.ts';
import { timeWords, voicingFromPcm } from './words-timing.ts';

/** whisper's own JSON for a 2 h file is a few MB; this is a ceiling, not an expectation. */
const MAX_WHISPER_JSON_BYTES = 128 * 1024 * 1024;

/** `-dtw` takes a model PRESET name, not a file; the registry ids that have one. */
const DTW_PRESETS: Record<string, string> = {
  tiny: 'tiny',
  'tiny.en': 'tiny.en',
  base: 'base',
  'base.en': 'base.en',
  small: 'small',
  'small.en': 'small.en',
  medium: 'medium',
  'medium.en': 'medium.en',
  'large-v3-turbo': 'large.v3.turbo',
};
export const dtwPresetFor = (modelId: string | null | undefined): string | null =>
  (modelId && DTW_PRESETS[modelId]) || null;

/** ISO 639-1/-3 letters only — the value goes into an args array, but it also goes into a file. */
export const isLangCode = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z]{2,3}$/.test(s);

export class WhisperRunError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'WhisperRunError';
    this.status = status;
  }
}

export interface SpeechAnalysis {
  words: TranscriptWord[];
  regions: Region[];
  source: 'words' | 'energy';
  engine: Transcript['engine'];
  lang?: string;
  durationSec: number;
  via: 'wav' | 'ffmpeg' | 'chromium';
  /** where the time went, ms: whisper.cpp itself, and the post-processing (§5.11: ≤ 50 ms per minute) */
  ms: { whisper: number; post: number };
}

export interface AnalyseOptions {
  /** absolute path of the source media */
  input: string;
  /** the whisper.cpp binary (required unless `speechOnly`) */
  whisper?: string;
  /** an INSTALLED ggml model file (required unless `speechOnly`) */
  modelPath?: string;
  /** the registry id of that model ("base.en", …) — selects the `-dtw` preset; null = no DTW */
  modelId?: string | null;
  lang?: string;
  speechOnly?: boolean;
  decode?: DecodeOptions;
  log?: (line: string) => void;
}

/** Decode, transcribe and time one source. Throws `DecodeError` / `WhisperRunError`. */
export async function analyseSpeech(o: AnalyseOptions): Promise<SpeechAnalysis> {
  const log = o.log ?? (() => {});
  const audio = await decodeAudio(o.input, o.decode);
  const durationSec = Math.round((audio.pcm.length / audio.sampleRate) * 1000) / 1000;

  if (o.speechOnly) {
    return {
      words: [],
      regions: energySpeechRegions(audio.pcm, audio.sampleRate),
      source: 'energy',
      engine: { id: 'energy', timing: 'none' },
      durationSec,
      via: audio.via,
      ms: { whisper: 0, post: 0 },
    };
  }
  if (!o.whisper || !o.modelPath) throw new WhisperRunError('no speech engine', null);

  const dir = mkdtempSync(join(tmpdir(), 'maude-words-'));
  try {
    const wav = join(dir, 'audio.wav');
    writeFileSync(wav, encodeWav(audio.pcm, audio.sampleRate));
    const outBase = join(dir, 'out');
    const dtw = dtwPresetFor(o.modelId);
    // -nfa is load-bearing: with flash attention on, whisper.cpp 1.9.2 returns t_dtw = -1 for every
    // token. -sow = one entry per WORD; -ml 1 = no multi-word lines.
    const args = [
      '-m',
      o.modelPath,
      '-f',
      wav,
      '-of',
      outBase,
      '-ojf',
      '-ml',
      '1',
      '-sow',
      ...(dtw ? ['-dtw', dtw, '-nfa'] : []),
      ...(isLangCode(o.lang) ? ['-l', o.lang] : []),
    ];
    log(`running whisper.cpp${o.modelId ? ` (${o.modelId})` : ''}…`);
    const w0 = performance.now();
    const run = spawnSync(o.whisper, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    if (run.error)
      throw new WhisperRunError(`could not start whisper.cpp: ${run.error.message}`, null);
    if (run.status !== 0)
      throw new WhisperRunError(`whisper.cpp exited ${run.status ?? '?'}`, run.status);
    const json = `${outBase}.json`;
    if (!existsSync(json)) throw new WhisperRunError('whisper.cpp wrote no JSON', run.status);
    if (statSync(json).size > MAX_WHISPER_JSON_BYTES)
      throw new WhisperRunError('whisper.cpp wrote an implausibly large JSON', run.status);

    const whisperMs = performance.now() - w0;
    const p0 = performance.now();
    const parsed = parseWhisperFull(readFileSync(json, 'utf8'));
    const voicing = voicingFromPcm(audio.pcm, audio.sampleRate);
    const timed = timeWords(parsed.words, parsed.timing, voicing);
    const lang = isLangCode(parsed.lang) ? parsed.lang : isLangCode(o.lang) ? o.lang : undefined;
    const dtwUsed = parsed.timing === 'dtw';
    const regions = speechRegionsFromWords(timed.words, timed.voiced, durationSec);
    return {
      words: timed.words,
      regions,
      source: 'words',
      engine: {
        id: 'whisper.cpp',
        ...(o.modelId ? { model: o.modelId } : {}),
        timing: dtwUsed ? 'dtw+energy' : 'segment',
        ...(dtwUsed ? { lagMs: timed.lagMs } : {}),
      },
      ...(lang ? { lang } : {}),
      durationSec,
      via: audio.via,
      ms: { whisper: Math.round(whisperMs), post: Math.round(performance.now() - p0) },
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An analysis → the sidecar value for `asset` ("assets/<base>.<ext>"). */
export function toTranscript(a: SpeechAnalysis, asset: string, now: Date = new Date()): Transcript {
  return {
    format: 'maude.transcript',
    v: 1,
    asset,
    durationSec: a.durationSec,
    ...(a.lang ? { lang: a.lang } : {}),
    engine: a.engine,
    words: a.words,
    speech: { source: a.source, regions: a.regions },
    createdAt: now.toISOString(),
  };
}

/** Is `asset` a name a sidecar can follow ("assets/<base>.<ext>", no ".." or separators beyond)? */
export const isSidecarableAsset = (asset: string): boolean => SIDECAR_ASSET_RE.test(asset);

/**
 * Write `assets/<base>.transcript.json` through the STRICT writer (a value that fails validation is
 * refused, never fixed up) and atomically (temp file in the same dir, then rename). Returns the
 * design-root-relative path. A re-run replaces the file (new ids; comp fixes are keyed by source
 * time, so they survive — §5.1).
 */
export function writeTranscriptSidecar(designRoot: string, t: Transcript): string {
  const rel = sidecarRelFor(t.asset, 'transcript');
  if (!rel) throw new Error(`not a sidecar-able asset: ${t.asset}`);
  const bytes = serializeTranscript(t, rel);
  const abs = join(designRoot, rel);
  const tmp = join(dirname(abs), `.${process.pid}-${Date.now()}.transcript.tmp`);
  writeFileSync(tmp, bytes);
  renameSync(tmp, abs);
  return rel;
}
