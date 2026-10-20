// generation/adapters/gemini.ts — Google "Nano Banana" image generation via the
// Gemini REST API (DDR-16x, Phase 0). Direct BYOK: the user's own Google key →
// generativelanguage.googleapis.com directly, no aggregator, no SDK (plain
// `fetch` in the sidecar per the plan).
//
// SYNC shape: `:generateContent` returns the image inline as base64 in ONE round
// trip, so `submit()` hands back an already-`done` Job — callers never branch on
// sync/async. The base64 is localized into `assets/<sha8>.png` by the host's
// `ctx.localize` (download.ts), never referenced inline.
//
// The key is injected via AdapterContext at call time (keys.ts) and used ONLY in
// the `x-goog-api-key` header — never logged, never put in the URL query (so it
// can't leak via a redirect Location or an error string echoed to the client).
//
// Editing (maskless, Nano Banana's strength): pass a `sourceAsset` and the host
// reads its bytes into an inlineData part alongside the text — the Phase-1 image-
// editing wiring (Task 1.2) drives that; Phase 0 is text→image only.

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

const GEMINI_DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_API_BASE = process.env.MAUDE_GEMINI_API_BASE ?? GEMINI_DEFAULT_BASE;
// The only host the BYOK key may ever be sent to. `MAUDE_GEMINI_API_BASE` exists
// so a test can point at a local mock — but per the security fan-out (F2) an
// env-controlled base is otherwise a key-egress redirect + SSRF, so a non-default
// base is refused unless MAUDE_GEN_ALLOW_CUSTOM_BASE is explicitly opted in.
const GEMINI_ALLOWED_HOST = 'generativelanguage.googleapis.com';
const ALLOW_CUSTOM_BASE = /^(1|true|on|yes)$/i.test(process.env.MAUDE_GEN_ALLOW_CUSTOM_BASE ?? '');

// Hard ceiling on the provider RESPONSE the adapter will buffer before decode
// (security fan-out F1). `res.json()` + `Buffer.from(base64)` would otherwise
// materialize a multi-GB upstream body in RAM — OOM-crashing the shared server —
// long before saveAsset's disk cap can fire. Generous for a 4K image, bounded
// against abuse. Env-overridable for an operator who raises the asset caps.
const MAX_RESPONSE_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAUDE_GEMINI_MAX_RESPONSE_BYTES) || 64 * 1024 * 1024
);

/**
 * Validate the outbound base ONCE at call time (F1/F2 defense-in-depth). Assert
 * https + the fixed host allowlist so a poisoned env can never redirect the
 * key-bearing request to a plaintext scheme or an attacker/internal host.
 */
function assertSafeBase(base: string): void {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error('Gemini API base is not a valid URL');
  }
  if (u.protocol !== 'https:') throw new Error('Gemini API base must be https');
  if (u.hostname !== GEMINI_ALLOWED_HOST && !ALLOW_CUSTOM_BASE) {
    throw new Error(
      `Gemini API base host ${u.hostname} is not allowlisted (set MAUDE_GEN_ALLOW_CUSTOM_BASE=1 to override)`
    );
  }
}

/** Read a Response body into text with a hard byte cap (F1) — rejects a body
 *  that exceeds the cap by Content-Length hint OR by actual streamed size, so an
 *  upstream that omits Content-Length can't slip past. */
async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Gemini response too large (${declared} > ${maxBytes} bytes)`);
  }
  const body = res.body;
  if (!body) return await res.text();
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
        throw new Error(`Gemini response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

// Video is far heavier than a JSON image response — a separate, higher cap for
// the Veo MP4 download (still bounded against a wedged/hostile upstream). F1.
const MAX_VIDEO_BYTES = Math.max(
  1024 * 1024,
  Number(process.env.MAUDE_VEO_MAX_RESPONSE_BYTES) || 256 * 1024 * 1024
);

/** Read a Response body into bytes with a hard cap (F1) — for the Veo MP4. */
async function readBytesCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Veo response too large (${declared} > ${maxBytes} bytes)`);
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
        throw new Error(`Veo response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export const GEMINI_DESCRIPTOR: ProviderDescriptor = {
  id: 'gemini',
  label: 'Google Gemini (Nano Banana + Veo)',
  kind: 'cloud',
  auth: 'api-key',
  keychainService: 'com.maude.app.gemini',
  modalities: ['image', 'video'],
  keyUrl: 'https://aistudio.google.com/apikey',
  notes:
    'Nano Banana image generation + Veo video (async, native synced audio + image-to-video). Your Google AI Studio key bills your own Google account. Generated media may carry a SynthID watermark; review Google’s usage terms for commercial use. A video clip takes 1–several minutes.',
  payer: 'your Google key',
  licence:
    'Images may carry an invisible SynthID watermark. Check Google’s terms for commercial use.',
};

export const GEMINI_MODELS: ModelDescriptor[] = [
  {
    id: 'gemini-2.5-flash-image',
    label: 'Nano Banana (2.5 Flash Image)',
    modality: 'image',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'],
    costNote: '~$0.04/image',
    sync: true,
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro (3 Pro Image)',
    modality: 'image',
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    costNote: 'higher — 1K/2K/4K',
    sync: true,
  },
  {
    id: 'veo-3.1-generate-preview',
    label: 'Veo 3.1 (video, native audio)',
    modality: 'video',
    aspectRatios: ['16:9', '9:16'],
    costNote: 'per second — see Google pricing',
    sync: false,
  },
];

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const DEFAULT_VIDEO_MODEL = 'veo-3.1-generate-preview';
// A Veo clip takes 1–several minutes; bound the poll so a stuck operation can't
// pin a job slot forever. Env-overridable for slower models / long clips.
const VIDEO_POLL_TIMEOUT_MS = Math.max(
  60_000,
  Number(process.env.MAUDE_VEO_TIMEOUT_MS) || 10 * 60 * 1000
);
const VIDEO_POLL_INTERVAL_MS = 10_000;
/** Poll cadence, read at CALL time so a test can shrink it via env. */
function videoPollInterval(): number {
  return Math.max(1, Number(process.env.MAUDE_VEO_POLL_INTERVAL_MS) || VIDEO_POLL_INTERVAL_MS);
}

/** The subset of the Gemini generateContent response we read. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** The subset of the Veo long-running-operation response we read. Veo's exact
 *  shape has shifted across previews, so `extractVideoUri` walks it defensively. */
interface VeoOperation {
  name?: string;
  done?: boolean;
  error?: { message?: string };
  response?: unknown;
}

/** Pull the operation name from a predictLongRunning start response. */
export function extractOperationName(json: unknown): string | null {
  if (json && typeof json === 'object' && typeof (json as { name?: unknown }).name === 'string')
    return (json as { name: string }).name;
  return null;
}

/**
 * Walk a done Veo operation for the generated video URI. Veo has returned it at
 * `response.generateVideoResponse.generatedSamples[].video.uri` and at
 * `...generatedVideos[].video.uri` across previews — so recursively find the
 * first `{ uri | fileUri }` string under any `video`/`file` object. Pure +
 * exported so the parse is unit-testable without a live operation.
 */
export function extractVideoUri(op: VeoOperation): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string | null => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null;
    seen.add(node);
    const o = node as Record<string, unknown>;
    for (const key of ['uri', 'fileUri', 'videoUri']) {
      const v = o[key];
      if (typeof v === 'string' && /^https:\/\//.test(v)) return v;
    }
    for (const v of Object.values(o)) {
      if (Array.isArray(v)) {
        for (const item of v) {
          const hit = walk(item);
          if (hit) return hit;
        }
      } else if (v && typeof v === 'object') {
        const hit = walk(v);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(op.response);
}

/**
 * Build the request body — text prompt + optional source image (maskless edit,
 * Nano Banana's strength: the source is read into an `inlineData` part alongside
 * the text) + optional aspect config. Async because the source-asset read is
 * host-provided (ctx.readSourceAsset) so the adapter never touches the FS.
 */
async function buildBody(req: GenRequest, ctx: AdapterContext): Promise<unknown> {
  const parts: Array<Record<string, unknown>> = [];

  // Edit flow (Task 1.2): the source image goes FIRST, then the instruction text
  // (Gemini's documented image-editing order). Requires the host to have wired
  // readSourceAsset; a sourceAsset with no reader is a hard error (never a
  // silent text-only generation that ignores the requested edit).
  if (req.sourceAsset) {
    if (!ctx.readSourceAsset) {
      throw new Error('image editing requires source-asset access, which is not wired');
    }
    const src = await ctx.readSourceAsset(req.sourceAsset);
    if (!src) throw new Error(`source asset not found or unreadable: ${req.sourceAsset}`);
    if (!src.mime.startsWith('image/')) {
      throw new Error(`source asset is not an image (${src.mime}) — cannot edit`);
    }
    parts.push({
      inlineData: { mimeType: src.mime, data: Buffer.from(src.bytes).toString('base64') },
    });
  }

  if (req.prompt) parts.push({ text: req.prompt });

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(req.aspectRatio ? { imageConfig: { aspectRatio: req.aspectRatio } } : {}),
    },
  };
  return body;
}

/** Resolve the model, defaulting when the request left it blank. */
function resolveModel(req: GenRequest): string {
  if (req.model && GEMINI_MODELS.some((m) => m.id === req.model)) return req.model;
  return DEFAULT_MODEL;
}

/** A sync Job wrapper — already resolved, so callers never branch on async. */
function doneJob(id: string, result: Promise<GenResult>): Job {
  let settledStatus: 'done' | 'failed' = 'done';
  const guarded = result.catch((err) => {
    settledStatus = 'failed';
    throw err;
  });
  return {
    id,
    status: () => settledStatus,
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

/** An ASYNC Job (Veo video): status starts `running`, `cancel()` aborts the
 *  in-flight poll/download via the shared controller. */
function runningJob(id: string, result: Promise<GenResult>, controller: AbortController): Job {
  let status: 'running' | 'done' | 'failed' = 'running';
  const guarded = result.then(
    (r) => {
      status = 'done';
      return r;
    },
    (err) => {
      status = 'failed';
      throw err;
    }
  );
  return {
    id,
    status: () => status,
    async *events() {
      yield { status: 'running' as const };
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
    cancel: () => controller.abort(),
  };
}

/** Sleep that rejects promptly if the signal aborts (so cancel/timeout is snappy). */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });
}

export function createGeminiAdapter(ctx: AdapterContext): ProviderAdapter {
  async function runOnce(req: GenRequest): Promise<GenResult> {
    if (!ctx.apiKey) {
      throw new Error('no Google Gemini key configured — add one in Settings');
    }
    const model = resolveModel(req);
    const started = Date.now();
    // F2 — validate the outbound base (https + host allowlist) BEFORE the
    // key-bearing request, so a poisoned env can't redirect the BYOK key.
    assertSafeBase(GEMINI_API_BASE);
    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

    // Build the body first (an edit flow reads the source asset host-side here).
    const requestBody = JSON.stringify(await buildBody(req, ctx));

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Key ONLY in the header — never the query string (redirect/log leak).
          'x-goog-api-key': ctx.apiKey,
        },
        body: requestBody,
        signal: ctx.signal ?? AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new Error(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // F1 — bound the response before decode so an oversized upstream body can't
    // OOM-crash the shared server (saveAsset's cap only guards the disk write,
    // which is downstream of this full in-RAM allocation).
    let json: GeminiResponse | null = null;
    try {
      const text = await readTextCapped(res, MAX_RESPONSE_BYTES);
      json = JSON.parse(text) as GeminiResponse;
    } catch (err) {
      // A too-large body is a hard error; a parse failure on an error status
      // falls through to the status-based message below.
      if (err instanceof Error && /too large|exceeded/.test(err.message)) throw err;
      json = null;
    }
    if (!res.ok) {
      // Never surface the key; Gemini's own error message is safe to relay.
      const msg = json?.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`Gemini error: ${msg}`);
    }
    if (json?.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${json.promptFeedback.blockReason}`);
    }

    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const assets: GenAsset[] = [];
    for (const part of parts) {
      const inline = part.inlineData;
      if (inline?.data) {
        assets.push({
          kind: 'image',
          mime: inline.mimeType ?? 'image/png',
          bytes: new Uint8Array(Buffer.from(inline.data, 'base64')),
        });
      }
    }
    if (assets.length === 0) {
      throw new Error('Gemini returned no image (the model may have refused the prompt)');
    }

    return { assets, usage: { ms: Date.now() - started }, raw: json };
  }

  /**
   * Veo video (ASYNC): start a long-running operation, poll it to completion,
   * then download the produced MP4 WITH the key (the Veo URI is on Google's host
   * and requires `x-goog-api-key` — so the ADAPTER downloads it, mirroring
   * ElevenLabs history-audio, rather than handing a key-bearing URL to
   * download.ts). Returns the bytes as a normal video GenAsset the host
   * localizes into assets/<sha8>.mp4.
   */
  async function runVideo(req: GenRequest, signal: AbortSignal): Promise<GenResult> {
    if (!ctx.apiKey) throw new Error('no Google Gemini key configured — add one in Settings');
    if (!req.prompt) throw new Error('video generation requires a prompt');
    assertSafeBase(GEMINI_API_BASE);
    const started = Date.now();
    const model =
      req.model && GEMINI_MODELS.some((m) => m.id === req.model && m.modality === 'video')
        ? req.model
        : DEFAULT_VIDEO_MODEL;

    // Optional image-to-video seed (Task 3.2 seeds a generated still here).
    let image: { mimeType: string; bytesBase64Encoded: string } | undefined;
    if (req.sourceAsset) {
      if (!ctx.readSourceAsset) throw new Error('image-to-video requires source-asset access');
      const src = await ctx.readSourceAsset(req.sourceAsset);
      if (!src) throw new Error(`source asset not found or unreadable: ${req.sourceAsset}`);
      if (!src.mime.startsWith('image/'))
        throw new Error(`i2v seed must be an image (${src.mime})`);
      image = { mimeType: src.mime, bytesBase64Encoded: Buffer.from(src.bytes).toString('base64') };
    }

    const startBody = JSON.stringify({
      instances: [{ prompt: req.prompt, ...(image ? { image } : {}) }],
      parameters: { ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}) },
    });
    const startRes = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:predictLongRunning`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': ctx.apiKey },
        body: startBody,
        signal,
      }
    );
    const startJson = JSON.parse(await readTextCapped(startRes, MAX_RESPONSE_BYTES));
    if (!startRes.ok)
      throw new Error(`Veo start error: ${startJson?.error?.message ?? `HTTP ${startRes.status}`}`);
    const opName = extractOperationName(startJson);
    if (!opName) throw new Error('Veo did not return an operation name');

    // Poll the operation (10s cadence) until done or the wall-clock cap.
    const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
    const interval = videoPollInterval();
    let op: VeoOperation | null = null;
    for (;;) {
      await abortableSleep(interval, signal);
      const pollRes = await fetch(`${GEMINI_API_BASE}/${opName}`, {
        headers: { 'x-goog-api-key': ctx.apiKey },
        signal,
      });
      op = JSON.parse(await readTextCapped(pollRes, MAX_RESPONSE_BYTES)) as VeoOperation;
      if (!pollRes.ok)
        throw new Error(`Veo poll error: ${op?.error?.message ?? `HTTP ${pollRes.status}`}`);
      if (op.error) throw new Error(`Veo failed: ${op.error.message ?? 'unknown'}`);
      if (op.done) break;
      if (Date.now() >= deadline) throw new Error('Veo timed out (operation still running)');
    }

    const uri = extractVideoUri(op);
    if (!uri) throw new Error('Veo operation finished but produced no video URI');
    // Download the MP4 with the key. Re-assert https + the Google host (the URI
    // is provider-issued, but a compromised/rerouted response must not exfiltrate
    // the key to another host).
    const u = new URL(uri);
    if (u.protocol !== 'https:' || u.hostname !== GEMINI_ALLOWED_HOST)
      throw new Error(`Veo video URI host not allowlisted (${u.hostname})`);
    const dlRes = await fetch(uri, { headers: { 'x-goog-api-key': ctx.apiKey }, signal });
    if (!dlRes.ok) throw new Error(`Veo video download failed: HTTP ${dlRes.status}`);
    const bytes = await readBytesCapped(dlRes, MAX_VIDEO_BYTES);
    if (bytes.byteLength === 0) throw new Error('Veo returned an empty video');

    const asset: GenAsset = {
      kind: 'video',
      mime: dlRes.headers.get('content-type') || 'video/mp4',
      bytes,
    };
    return { assets: [asset], usage: { ms: Date.now() - started }, raw: op };
  }

  return {
    descriptor: GEMINI_DESCRIPTOR,
    async listModels() {
      return GEMINI_MODELS;
    },
    async submit(req: GenRequest): Promise<Job> {
      const id = `gen_${crypto.randomUUID()}`;
      if (req.modality === 'video') {
        // Async provider — a real running Job that polls the operation. cancel()
        // aborts the poll/download; the queue's own timeout also flows in.
        const controller = new AbortController();
        if (ctx.signal)
          ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });
        return runningJob(id, runVideo(req, controller.signal), controller);
      }
      // Sync image — kick off the single call and wrap it in an already-resolving
      // Job so the queue treats it uniformly with async providers.
      return doneJob(id, runOnce(req));
    },
  };
}
