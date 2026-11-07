// generation/adapters/groq.ts — Groq Whisper speech-to-text via the OpenAI-
// compatible audio API (DDR-164, Task 2.6). Direct BYOK: the user's own Groq key
// → api.groq.com directly, no aggregator, no SDK (plain `fetch`). Transcription
// ONLY — Groq is the managed, fast cloud STT option the user can CHOOSE (vs
// local whisper.cpp or ElevenLabs Scribe); the engine is never auto-selected.
//
//   • Scribe-equivalent — POST /openai/v1/audio/transcriptions
//     (audio → verbose_json word timestamps → SRT via captions.ts)
//
// Groq's Whisper endpoint is OpenAI-shaped: `response_format=verbose_json` +
// `timestamp_granularities[]=word` returns a `words[]` array of `{word,start,
// end}` (seconds), which normalizes to CaptionWord[] before the SHARED
// captions.ts reflow — so Groq, ElevenLabs Scribe, and local whisper.cpp all
// produce identical subtitle line-length / timing rules (Task 2.6's single
// reflow point).
//
// Security mirrors the ElevenLabs adapter (F1/F2): the key rides ONLY in the
// `Authorization` header (never a query string → no redirect/log leak); the
// outbound base is https + host-allowlisted before the key-bearing request; and
// the response body is byte-capped before it is buffered (RAM-DoS guard).

import { wordsToSrt } from '../captions.ts';
import type {
  AdapterContext,
  GenAsset,
  GenRequest,
  GenResult,
  Job,
  ModelDescriptor,
  ProviderAdapter,
  ProviderDescriptor,
} from '../types.ts';

const DEFAULT_BASE = 'https://api.groq.com';
const API_BASE = process.env.MAUDE_GROQ_API_BASE ?? DEFAULT_BASE;
const ALLOWED_HOST = 'api.groq.com';
const ALLOW_CUSTOM_BASE = /^(1|true|on|yes)$/i.test(process.env.MAUDE_GEN_ALLOW_CUSTOM_BASE ?? '');

// Hard ceiling on a provider response before it is buffered (F1). A verbose_json
// transcript is text, so this is well below the audio-adapter cap.
const MAX_RESPONSE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAUDE_GROQ_MAX_RESPONSE_BYTES) || 32 * 1024 * 1024
);

/** Validate the outbound base ONCE (https + fixed host allowlist), F1/F2. */
function assertSafeBase(base: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error('Groq API base is not a valid URL');
  }
  if (u.protocol !== 'https:') throw new Error('Groq API base must be https');
  if (u.hostname !== ALLOWED_HOST && !ALLOW_CUSTOM_BASE) {
    throw new Error(
      `Groq API base host ${u.hostname} is not allowlisted (set MAUDE_GEN_ALLOW_CUSTOM_BASE=1 to override)`
    );
  }
}

/** Read a Response body into bytes with a hard cap (F1). */
async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Groq response too large (${declared} > ${maxBytes} bytes)`);
  }
  const body = res.body;
  if (!body) return new Uint8Array(await res.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Groq response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBytesCapped(res, maxBytes));
}

export const GROQ_DESCRIPTOR: ProviderDescriptor = {
  id: 'groq',
  label: 'Groq (Whisper STT)',
  kind: 'cloud',
  auth: 'api-key',
  keychainService: 'com.maude.app.groq',
  modalities: ['transcription'],
  keyUrl: 'https://console.groq.com/keys',
  notes:
    'Managed, fast cloud speech-to-text (Whisper large-v3) — an optional alternative to local whisper.cpp when you want no local install, billing your own Groq account. Word-level timestamps for subtitles.',
};

export const GROQ_MODELS: ModelDescriptor[] = [
  {
    id: 'whisper-large-v3-turbo',
    label: 'Whisper large-v3-turbo',
    modality: 'transcription',
    sync: true,
  },
  { id: 'whisper-large-v3', label: 'Whisper large-v3', modality: 'transcription', sync: true },
];

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

interface GroqWord {
  word?: string;
  start?: number;
  end?: number;
}
interface GroqVerbose {
  text?: string;
  words?: GroqWord[];
  segments?: { text?: string; start?: number; end?: number }[];
  error?: { message?: string } | string;
}

/** A sync Job wrapper — already resolved (mirrors the ElevenLabs adapter). */
function doneJob(id: string, result: Promise<GenResult>): Job {
  let settled: 'done' | 'failed' = 'done';
  const guarded = result.catch((err) => {
    settled = 'failed';
    throw err;
  });
  return {
    id,
    status: () => settled,
    async *events() {
      try {
        await guarded;
        yield { status: 'done' as const };
      } catch (err) {
        yield {
          status: 'failed' as const,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    result: () => guarded,
    cancel: () => {},
  };
}

/** Groq verbose_json → CaptionWord[]. Prefer per-word timings; fall back to
 *  per-segment timings when word granularity is absent (short clips / models). */
export function groqVerboseToWords(
  json: GroqVerbose
): { text: string; start: number; end: number }[] {
  const words = Array.isArray(json.words) ? json.words : [];
  if (words.length > 0) {
    return words
      .filter((w) => typeof w.word === 'string' && w.word.trim())
      .map((w) => ({
        text: String(w.word).trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0,
      }));
  }
  // No word granularity — split each segment's text across its span so the
  // shared reflow still has something to group (coarser, but never empty).
  const segs = Array.isArray(json.segments) ? json.segments : [];
  const out: { text: string; start: number; end: number }[] = [];
  for (const s of segs) {
    const text = typeof s.text === 'string' ? s.text.trim() : '';
    if (!text) continue;
    out.push({ text, start: Number(s.start) || 0, end: Number(s.end) || 0 });
  }
  return out;
}

export function createGroqAdapter(ctx: AdapterContext): ProviderAdapter {
  function requireKey(): string {
    if (!ctx.apiKey) throw new Error('no Groq key configured — add one in Settings');
    return ctx.apiKey;
  }

  async function runTranscription(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    if (!req.sourceAsset) throw new Error('transcription requires a sourceAsset (an audio/video)');
    if (!ctx.readSourceAsset) throw new Error('transcription requires source-asset access');
    const src = await ctx.readSourceAsset(req.sourceAsset);
    if (!src) throw new Error(`source asset not found or unreadable: ${req.sourceAsset}`);

    assertSafeBase(API_BASE);
    // Copy to a plain ArrayBuffer (a valid BlobPart; normalizes byteOffset).
    const buf = src.bytes.buffer.slice(
      src.bytes.byteOffset,
      src.bytes.byteOffset + src.bytes.byteLength
    ) as ArrayBuffer;
    const form = new FormData();
    form.append('file', new Blob([buf], { type: src.mime }), 'audio');
    form.append('model', str(req.model) ?? 'whisper-large-v3-turbo');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    if (str(req.params?.language as unknown)) form.append('language', String(req.params?.language));

    const res = await fetch(`${API_BASE}/openai/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${requireKey()}` }, // FormData sets its own boundary
      body: form,
      signal: ctx.signal ?? AbortSignal.timeout(300_000),
    });
    const text = await readTextCapped(res, MAX_RESPONSE_BYTES);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as GroqVerbose;
        const e = j.error;
        msg = (typeof e === 'string' ? e : e?.message) ?? msg;
      } catch {
        /* keep status */
      }
      throw new Error(`Groq Whisper error: ${msg}`);
    }
    const json = JSON.parse(text) as GroqVerbose;
    const words = groqVerboseToWords(json);
    const srt = wordsToSrt(words);
    const asset: GenAsset = {
      kind: 'transcription',
      mime: 'application/x-subrip',
      text: srt,
      words,
      // no per-word granularity -> groqVerboseToWords fell back to segments: say so
      wordTiming: Array.isArray(json.words) && json.words.length > 0 ? 'provider' : 'segment',
    };
    return { assets: [asset], usage: { ms: Date.now() - started }, raw: { text: json.text } };
  }

  return {
    descriptor: GROQ_DESCRIPTOR,
    async listModels() {
      return GROQ_MODELS;
    },
    async submit(req: GenRequest): Promise<Job> {
      const id = `gen_${crypto.randomUUID()}`;
      if (req.modality !== 'transcription')
        return doneJob(
          id,
          Promise.reject(new Error(`Groq only supports transcription (got ${req.modality})`))
        );
      return doneJob(id, runTranscription(req));
    },
  };
}
