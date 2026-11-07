// video/provider-transcript.ts — #128 §7: a cloud transcription engine (ElevenLabs Scribe, Groq
// Whisper) leaves the SAME word-timing sidecar the local whisper path does:
// `assets/<sha8>.transcript.json` (maude.transcript v1), written through the strict writer
// (`writeTranscriptSidecar`) — not a second words file. Input is the engines' common shape,
// `{ text, start, end }[]` in seconds (`GenWord`).

import {
  MAX_WORD_TEXT,
  round3,
  sidecarRelFor,
  type Transcript,
  type TranscriptWord,
} from './schema.ts';
import { speechRegionsFromWords } from './speech.ts';
import { writeTranscriptSidecar } from './words-run.ts';

export interface ProviderWord {
  text: string;
  start: number;
  end: number;
}

export interface ProviderEngine {
  /** a schema `ENGINE_IDS` member: `elevenlabs-scribe` | `groq-whisper` */
  id: string;
  /** `provider` (per word) or `segment` (the engine only timed whole lines) */
  timing: 'provider' | 'segment';
  model?: string;
}

export interface ProviderTranscriptOptions {
  lang?: string;
  now?: Date;
}

/** The sidecar engine id of a generation provider, or null for one that is not a transcriber. */
export function engineIdForProvider(provider: string): string | null {
  if (provider === 'elevenlabs') return 'elevenlabs-scribe';
  if (provider === 'groq') return 'groq-whisper';
  return null;
}

const MIN_WORD_SEC = 0.02;

/** Provider words -> a `Transcript` the strict writer accepts: sorted, blanks dropped, every word
 *  at least {MIN_WORD_SEC} long, ids `w0…`, speech regions from the words. */
export function providerWordsToTranscript(
  words: readonly ProviderWord[],
  asset: string,
  engine: ProviderEngine,
  opts: ProviderTranscriptOptions = {}
): Transcript {
  const clean = words
    .map((w) => ({
      text: String(w.text ?? '')
        .trim()
        .slice(0, MAX_WORD_TEXT),
      t0: Number.isFinite(w.start) ? Math.max(0, w.start) : 0,
      t1: Number.isFinite(w.end) ? Math.max(0, w.end) : 0,
    }))
    .filter((w) => w.text.length > 0)
    .map((w) => ({ ...w, t1: w.t1 > w.t0 ? w.t1 : w.t0 + MIN_WORD_SEC }))
    .sort((a, b) => a.t0 - b.t0);
  const list: TranscriptWord[] = clean.map((w, i) => ({
    id: `w${i}`,
    t0: round3(w.t0),
    t1: round3(Math.max(w.t1, w.t0 + MIN_WORD_SEC)),
    text: w.text,
  }));
  const durationSec = list.length ? round3(Math.max(...list.map((w) => w.t1))) : undefined;
  return {
    format: 'maude.transcript',
    v: 1,
    asset,
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(opts.lang && /^[a-z]{2,3}$/.test(opts.lang) ? { lang: opts.lang } : {}),
    engine: {
      id: engine.id,
      timing: engine.timing,
      ...(engine.model ? { model: engine.model.slice(0, 64) } : {}),
    },
    words: list,
    speech: {
      source: 'words',
      regions: speechRegionsFromWords(
        list,
        list.map(() => true),
        durationSec
      ),
    },
    createdAt: (opts.now ?? new Date()).toISOString(),
  };
}

/**
 * Write `assets/<sha8>.transcript.json` for a cloud engine's words. Returns the design-root
 * relative path, or null when there is nothing to write (no words, or `asset` cannot carry a
 * sidecar). A value the strict writer refuses throws (`SidecarWriteError`) — the caller decides
 * whether that may lose the SRT it already has.
 */
export function writeProviderTranscript(
  designRoot: string,
  asset: string,
  words: readonly ProviderWord[],
  engine: ProviderEngine,
  opts: ProviderTranscriptOptions = {}
): string | null {
  if (!sidecarRelFor(asset, 'transcript')) return null;
  const t = providerWordsToTranscript(words, asset, engine, opts);
  if (t.words.length === 0) return null;
  return writeTranscriptSidecar(designRoot, t);
}

/**
 * The transcription branch of the generate-jobs route: persist the words of a finished cloud job
 * next to its source. Never throws — the SRT the job already wrote is the paid-for result and must
 * not be lost to a sidecar refusal; the reason comes back instead so the route can log it.
 * `null` path + `skipped` = the engine returned no words (the caption path warns about that).
 */
export function persistCloudTranscript(
  designRoot: string,
  req: { provider: string; model?: string; sourceAsset: string; lang?: string },
  asset: { words?: readonly ProviderWord[]; wordTiming?: 'provider' | 'segment' }
): { path: string | null; skipped?: string } {
  const id = engineIdForProvider(req.provider);
  if (!id) return { path: null, skipped: `${req.provider} is not a transcription engine` };
  if (!asset.words || asset.words.length === 0)
    return { path: null, skipped: 'the engine returned no word timings' };
  try {
    const path = writeProviderTranscript(
      designRoot,
      req.sourceAsset,
      asset.words,
      { id, timing: asset.wordTiming ?? 'provider', ...(req.model ? { model: req.model } : {}) },
      { lang: req.lang }
    );
    return path ? { path } : { path: null, skipped: 'no usable words or no sidecar-able source' };
  } catch (err) {
    return { path: null, skipped: err instanceof Error ? err.message : String(err) };
  }
}
