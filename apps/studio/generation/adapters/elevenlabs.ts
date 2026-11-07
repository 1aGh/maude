// generation/adapters/elevenlabs.ts — ElevenLabs audio stack via the REST API
// (DDR-164, Phase 2). Direct BYOK: the user's own ElevenLabs key →
// api.elevenlabs.io directly, no aggregator, no SDK (plain `fetch`). ONE key
// covers the whole audio stack:
//
//   • Music   — POST /v1/music                  (prompt → mp3)
//   • SFX     — POST /v1/sound-generation        (prompt → mp3)
//   • TTS     — POST /v1/text-to-speech/{voice}  (text + voice_id → mp3)
//   • Scribe  — POST /v1/speech-to-text          (audio → word-timestamps → SRT)
//
// The audio verbs return binary mp3 in ONE round trip → an already-`done` Job
// (callers never branch on sync/async), localized into assets/<sha8>.mp3.
// Scribe returns word-level timings that captions.ts turns into an SRT the EDL
// caption track consumes.
//
// Security mirrors the Gemini adapter (F1/F2): the key is sent ONLY in the
// `xi-api-key` header (never a query string → no redirect/log leak); the outbound
// base is https + host-allowlisted before the key-bearing request; and every
// response body is byte-capped before it is buffered (RAM-DoS guard).

import { wordsToSrt } from '../captions.ts';
import type {
  AdapterContext,
  GenAsset,
  GenRequest,
  GenResult,
  HistoryAudioItem,
  Job,
  ModelDescriptor,
  ProviderAdapter,
  ProviderDescriptor,
} from '../types.ts';

const DEFAULT_BASE = 'https://api.elevenlabs.io';
const API_BASE = process.env.MAUDE_ELEVENLABS_API_BASE ?? DEFAULT_BASE;
const ALLOWED_HOST = 'api.elevenlabs.io';
const ALLOW_CUSTOM_BASE = /^(1|true|on|yes)$/i.test(process.env.MAUDE_GEN_ALLOW_CUSTOM_BASE ?? '');

// Hard ceiling on a provider response before it is buffered (F1 — the same guard
// the Gemini adapter added). Audio is heavier than a JSON image, so the cap is
// higher; still bounded against a wedged/hostile upstream.
const MAX_RESPONSE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAUDE_ELEVENLABS_MAX_RESPONSE_BYTES) || 128 * 1024 * 1024
);

/** Validate the outbound base ONCE (https + fixed host allowlist), F1/F2. */
function assertSafeBase(base: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error('ElevenLabs API base is not a valid URL');
  }
  if (u.protocol !== 'https:') throw new Error('ElevenLabs API base must be https');
  if (u.hostname !== ALLOWED_HOST && !ALLOW_CUSTOM_BASE) {
    throw new Error(
      `ElevenLabs API base host ${u.hostname} is not allowlisted (set MAUDE_GEN_ALLOW_CUSTOM_BASE=1 to override)`
    );
  }
}

/** Read a Response body into bytes with a hard cap (F1). */
async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`ElevenLabs response too large (${declared} > ${maxBytes} bytes)`);
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
        throw new Error(`ElevenLabs response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Read a capped body as text (for the JSON STT response + error messages). */
async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBytesCapped(res, maxBytes));
}

export const ELEVENLABS_DESCRIPTOR: ProviderDescriptor = {
  id: 'elevenlabs',
  label: 'ElevenLabs (audio)',
  kind: 'cloud',
  auth: 'api-key',
  keychainService: 'com.maude.app.elevenlabs',
  modalities: ['audio', 'transcription'],
  keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
  notes:
    'Music, sound effects, text-to-speech, and Scribe speech-to-text — one key for the whole stack, billing your own ElevenLabs account. Music carries commercial-rights tiers (check your plan) and rejects prompts naming artists, songs, or lyrics. Voice cloning requires the voice owner’s consent.',
};

export const ELEVENLABS_MODELS: ModelDescriptor[] = [
  { id: 'eleven_music', label: 'Music', modality: 'audio', costNote: 'per second', sync: true },
  { id: 'eleven_text_to_sound_v2', label: 'Sound effects', modality: 'audio', sync: true },
  {
    id: 'eleven_v3',
    label: 'Text to speech (v3)',
    modality: 'audio',
    costNote: 'per character',
    sync: true,
  },
  {
    id: 'eleven_multilingual_v2',
    label: 'Text to speech (multilingual v2)',
    modality: 'audio',
    sync: true,
  },
  { id: 'scribe_v1', label: 'Scribe (speech-to-text)', modality: 'transcription', sync: true },
];

/** Which audio verb a request wants — from params.audioKind, else inferred. */
type AudioKind = 'music' | 'sfx' | 'tts';
function resolveAudioKind(req: GenRequest): AudioKind {
  const explicit = req.params?.audioKind;
  if (explicit === 'music' || explicit === 'sfx' || explicit === 'tts') return explicit;
  // Infer: a voice_id means speech; otherwise default to music (the flagship).
  if (req.params?.voice_id) return 'tts';
  return 'music';
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

interface ScribeWord {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
}
interface ScribeResponse {
  text?: string;
  words?: ScribeWord[];
  detail?: unknown;
}
interface ErrorResponse {
  detail?: { message?: string } | string;
}

// Task 2.5 — ElevenLabs History (GET /v1/history). The user's re-downloadable
// past generations; matching + reuse spends NO credit (already paid).
interface HistoryItemRaw {
  history_item_id?: string;
  text?: string;
  voice_id?: string;
  date_unix?: number;
}
interface HistoryResponseRaw {
  history?: HistoryItemRaw[];
}

/** Pure History-response → HistoryAudioItem[] (exported for unit test). */
export function parseHistory(json: HistoryResponseRaw): HistoryAudioItem[] {
  const items = Array.isArray(json?.history) ? json.history : [];
  const out: HistoryAudioItem[] = [];
  for (const it of items) {
    const id = typeof it.history_item_id === 'string' ? it.history_item_id : '';
    if (!id) continue;
    out.push({
      id,
      text: typeof it.text === 'string' ? it.text : '',
      voiceId: typeof it.voice_id === 'string' ? it.voice_id : undefined,
      at:
        typeof it.date_unix === 'number' && Number.isFinite(it.date_unix)
          ? new Date(it.date_unix * 1000).toISOString()
          : undefined,
    });
  }
  return out;
}

/** A sync Job wrapper — already resolved (mirrors the Gemini adapter). */
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

export function createElevenLabsAdapter(ctx: AdapterContext): ProviderAdapter {
  function requireKey(): string {
    if (!ctx.apiKey) throw new Error('no ElevenLabs key configured — add one in Settings');
    return ctx.apiKey;
  }

  /** POST JSON, expect a binary audio body → an audio GenAsset. */
  async function postForAudio(path: string, body: unknown): Promise<GenAsset> {
    assertSafeBase(API_BASE);
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': requireKey() },
      body: JSON.stringify(body),
      signal: ctx.signal ?? AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      // Error bodies are JSON; the key is never echoed in them.
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(await readTextCapped(res, 64 * 1024)) as ErrorResponse;
        const d = j.detail;
        msg = (typeof d === 'string' ? d : d?.message) ?? msg;
      } catch {
        /* keep the status message */
      }
      throw new Error(`ElevenLabs error: ${msg}`);
    }
    const bytes = await readBytesCapped(res, MAX_RESPONSE_BYTES);
    if (bytes.byteLength === 0) throw new Error('ElevenLabs returned an empty audio body');
    return { kind: 'audio', mime: res.headers.get('content-type') || 'audio/mpeg', bytes };
  }

  async function runAudio(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    const kind = resolveAudioKind(req);
    const prompt = req.prompt ?? '';
    let asset: GenAsset;
    if (kind === 'tts') {
      const voiceId = str(req.params?.voice_id);
      if (!voiceId) throw new Error('text-to-speech requires a params.voice_id');
      const modelId = str(req.params?.model_id) ?? str(req.model) ?? 'eleven_v3';
      asset = await postForAudio(`/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        text: prompt,
        model_id: modelId,
      });
    } else if (kind === 'sfx') {
      const duration = num(req.params?.durationSeconds);
      asset = await postForAudio('/v1/sound-generation', {
        text: prompt,
        ...(duration ? { duration_seconds: duration } : {}),
      });
    } else {
      // music
      const ms = num(req.params?.durationSeconds);
      asset = await postForAudio('/v1/music', {
        prompt,
        ...(ms ? { music_length_ms: Math.round(ms * 1000) } : {}),
      });
    }
    return { assets: [asset], usage: { ms: Date.now() - started } };
  }

  async function runTranscription(req: GenRequest): Promise<GenResult> {
    const started = Date.now();
    if (!req.sourceAsset) throw new Error('transcription requires a sourceAsset (an audio/video)');
    if (!ctx.readSourceAsset) throw new Error('transcription requires source-asset access');
    const src = await ctx.readSourceAsset(req.sourceAsset);
    if (!src) throw new Error(`source asset not found or unreadable: ${req.sourceAsset}`);

    assertSafeBase(API_BASE);
    // Multipart: the audio file + model_id. Blob keeps the bytes out of a query.
    // Copy to a plain ArrayBuffer (a valid BlobPart; also normalizes byteOffset).
    const buf = src.bytes.buffer.slice(
      src.bytes.byteOffset,
      src.bytes.byteOffset + src.bytes.byteLength
    ) as ArrayBuffer;
    const form = new FormData();
    form.append('file', new Blob([buf], { type: src.mime }), 'audio');
    form.append('model_id', str(req.model) ?? 'scribe_v1');
    const res = await fetch(`${API_BASE}/v1/speech-to-text`, {
      method: 'POST',
      headers: { 'xi-api-key': requireKey() }, // FormData sets its own content-type boundary
      body: form,
      signal: ctx.signal ?? AbortSignal.timeout(300_000),
    });
    const text = await readTextCapped(res, MAX_RESPONSE_BYTES);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as ErrorResponse;
        const d = j.detail;
        msg = (typeof d === 'string' ? d : d?.message) ?? msg;
      } catch {
        /* keep status */
      }
      throw new Error(`ElevenLabs Scribe error: ${msg}`);
    }
    const json = JSON.parse(text) as ScribeResponse;
    // Scribe returns word-level entries with `type` ('word' | 'spacing'); keep words.
    const words = (json.words ?? [])
      .filter((w) => (w.type ?? 'word') === 'word' && typeof w.text === 'string')
      .map((w) => ({ text: String(w.text), start: Number(w.start) || 0, end: Number(w.end) || 0 }));
    const srt = wordsToSrt(words);
    const asset: GenAsset = {
      kind: 'transcription',
      mime: 'application/x-subrip',
      text: srt,
      words,
      wordTiming: 'provider',
    };
    return { assets: [asset], usage: { ms: Date.now() - started }, raw: { text: json.text } };
  }

  // Task 2.5 — the user's re-usable audio history. Re-downloading spends NO
  // credit (already paid). Rate-limited LIST → the route caches the listing;
  // the audio GET localizes through the host's saveAsset (magic-byte sniff).
  async function listHistory(): Promise<HistoryAudioItem[]> {
    assertSafeBase(API_BASE);
    const res = await fetch(`${API_BASE}/v1/history?page_size=100`, {
      headers: { 'xi-api-key': requireKey() },
      signal: ctx.signal ?? AbortSignal.timeout(30_000),
    });
    const text = await readTextCapped(res, 8 * 1024 * 1024);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as ErrorResponse;
        const d = j.detail;
        msg = (typeof d === 'string' ? d : d?.message) ?? msg;
      } catch {
        /* keep status */
      }
      throw new Error(`ElevenLabs history error: ${msg}`);
    }
    return parseHistory(JSON.parse(text) as HistoryResponseRaw);
  }

  async function fetchHistoryAudio(id: string): Promise<GenAsset> {
    // The id is provider-scoped and used ONLY in a fixed, non-interpolated path
    // segment (encodeURIComponent) — no query, no key leak.
    assertSafeBase(API_BASE);
    const res = await fetch(`${API_BASE}/v1/history/${encodeURIComponent(id)}/audio`, {
      headers: { 'xi-api-key': requireKey() },
      signal: ctx.signal ?? AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`ElevenLabs history audio error: HTTP ${res.status}`);
    const bytes = await readBytesCapped(res, MAX_RESPONSE_BYTES);
    if (bytes.byteLength === 0) throw new Error('ElevenLabs history returned an empty audio body');
    return { kind: 'audio', mime: res.headers.get('content-type') || 'audio/mpeg', bytes };
  }

  return {
    descriptor: ELEVENLABS_DESCRIPTOR,
    async listModels() {
      return ELEVENLABS_MODELS;
    },
    async submit(req: GenRequest): Promise<Job> {
      const id = `gen_${crypto.randomUUID()}`;
      const run = req.modality === 'transcription' ? runTranscription(req) : runAudio(req);
      return doneJob(id, run);
    },
    listHistory,
    fetchHistoryAudio,
  };
}
