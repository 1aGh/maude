/**
 * @file       generation/types.ts — the provider-adapter contract (DDR-16x).
 * @scope      apps/studio/generation/types.ts
 * @purpose    The single normalized contract every media-generation provider —
 *             cloud aggregator (fal), direct-BYOK provider (Gemini/ElevenLabs),
 *             or local runtime (Ollama/ComfyUI) — is expressed through:
 *             `submit(req) → Job`, and the produced bytes localize into the
 *             content-addressed `assets/<sha8>` store (DDR-088).
 *
 * @invariant  DEPENDENCY-FREE. Imported by BOTH the server (registry, adapters,
 *             the /_api/generate-jobs route) and — for the descriptor/model
 *             shapes only — the client Settings panel. It MUST NOT import any
 *             provider SDK, `node:*`, or browser lib. Pure TS types + plain
 *             hand-rolled validators (no Ajv), mirroring `photo/schema.ts` and
 *             `footage/schema.ts`.
 *
 *             Key custody lives in `keys.ts`, NOT here — a descriptor only
 *             DECLARES how it authenticates (`auth` + `keychainService`); the
 *             host injects the resolved credential at call time so keys stay in
 *             one place and never cross into the untrusted canvas realm (DDR-054).
 */

/** Schema version of the generation contract — bumped on incompatible change. */
export const GENERATION_CONTRACT_VERSION = 1 as const;

/** What a provider produces. */
export type Modality = 'image' | 'video' | 'audio' | 'transcription';
export const MODALITIES: readonly Modality[] = ['image', 'video', 'audio', 'transcription'];

/** Where a provider runs — a `cloud` call needs a key + egress; `local` is a
 *  loopback runtime on the user's own hardware (post-v1). */
export type ProviderKind = 'cloud' | 'local';

/** How a provider authenticates. `none` = local runtime (no credential). */
export type AuthKind = 'api-key' | 'none';

/**
 * A provider — a vendor/runtime that exposes one or more models across one or
 * more modalities. The descriptor is inert data (safe to serialize to the
 * client Settings panel); it carries NO secret.
 */
export interface ProviderDescriptor {
  /** Stable slug — the key custody + config + route all key off this. */
  id: string;
  /** Human label for the Settings UI. */
  label: string;
  kind: ProviderKind;
  auth: AuthKind;
  /**
   * OS-keychain service name for the native tier (`com.maude.app.<id>`), and
   * the lookup key in the `~/.config/maude/keys.json` browser fallback. Absent
   * for `auth: 'none'` local runtimes.
   */
  keychainService?: string;
  /** Modalities this provider can produce (drives capability lookup + routing). */
  modalities: readonly Modality[];
  /**
   * Where the user gets a key + the pricing/licensing note the Settings UI must
   * surface (music commercial-rights tier, voice-cloning consent, etc.). Inert
   * copy, never a secret.
   */
  keyUrl?: string;
  notes?: string;
  /**
   * S8.16 — whose account pays, as the consent line names it ("your Google key"). Absent = a
   * local runtime (nothing is billed). Inert copy.
   */
  payer?: string;
  /** S8.16 — the one licence line shown before anything is sent (S8 sidecars O3). Inert copy. */
  licence?: string;
  /** Default loopback host:port for a `local` runtime (probe target). */
  localEndpoint?: string;
}

/** One concrete model a provider offers. */
export interface ModelDescriptor {
  /** Provider-scoped id passed to `submit` (e.g. `gemini-2.5-flash-image`). */
  id: string;
  label: string;
  modality: Modality;
  /** Non-secret capability hints for the generate dialog + routing. */
  aspectRatios?: readonly string[];
  /** Rough per-unit cost note for the UI cost badge (`~$0.04/image`). */
  costNote?: string;
  /** True when the model round-trips synchronously (Job returns already `done`). */
  sync?: boolean;
}

/** The user's generation request, normalized across every modality. */
export interface GenRequest {
  modality: Modality;
  /** Provider id (`gemini`, `elevenlabs`, `fal`, …). */
  provider: string;
  /** Provider-scoped model id. Optional — adapter picks its default. */
  model?: string;
  /** The text prompt (image/video/audio) or the source asset (transcription). */
  prompt?: string;
  /** `assets/<sha8>.<ext>` source for edit/i2v/transcription flows. */
  sourceAsset?: string;
  /** `1:1` / `16:9` / … — adapter maps to the provider's own vocabulary. */
  aspectRatio?: string;
  /** Free-form provider-specific knobs (duration, voice_id, seed, …). Opaque
   *  to the spine; each adapter validates its own subset. */
  params?: Record<string, unknown>;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

/** A progress/log tick a long-running (async) job may emit. */
export interface JobEvent {
  status: JobStatus;
  /** 0..1 fractional progress when the provider reports it. */
  progress?: number;
  message?: string;
}

/** One produced artifact — a URL (localize immediately, may expire), inline
 *  base64/bytes, or a caption text blob. Exactly one payload field is set. */
export interface GenAsset {
  kind: Modality;
  mime: string;
  /** Expiring provider URL — MUST be downloaded through the hardened egress path
   *  (`download.ts`) before it's referenced anywhere. */
  url?: string;
  /** Inline bytes (sync base64 providers decode into this). */
  bytes?: Uint8Array;
  /** Text payload (SRT/VTT captions from a transcription provider). */
  text?: string;
}

/** The normalized result once a Job is `done`. */
export interface GenResult {
  assets: GenAsset[];
  usage?: { cost?: number; ms?: number };
  /** The provider's raw response, kept for audit/debug (never sent to canvas). */
  raw?: unknown;
}

/**
 * A generation handle. Sync providers return an already-`done` Job (so callers
 * never branch on sync/async); async providers drive `queued → running → done`.
 */
export interface Job {
  id: string;
  status(): JobStatus;
  /** Live progress stream (async providers). Sync providers yield one `done`. */
  events(): AsyncIterable<JobEvent>;
  result(): Promise<GenResult>;
  cancel(): void;
}

/**
 * One re-usable past generation from a provider's history (Task 2.5). The user's
 * OWN prior audio, re-downloadable for NO credit (already paid) — ranked against
 * a query alongside the project's local generated audio so reuse beats paying
 * for a near-identical new generation.
 */
export interface HistoryAudioItem {
  /** Provider-scoped id used to re-fetch the bytes (`fetchHistoryAudio`). */
  id: string;
  /** The stored source text / prompt this item was generated from (match key). */
  text: string;
  /** ISO timestamp when it was produced (recency tie-break). */
  at?: string;
  /** e.g. a voice_id for TTS — surfaced for provenance, never trusted blindly. */
  voiceId?: string;
}

/**
 * The one interface every adapter implements. `submit` returns immediately —
 * even sync providers hand back a resolved Job so the host queue is uniform.
 */
export interface ProviderAdapter {
  descriptor: ProviderDescriptor;
  /** Refresh the model catalogue (aggregators). Static providers may omit it. */
  listModels?(): Promise<ModelDescriptor[]>;
  submit(req: GenRequest): Promise<Job>;
  /**
   * Task 2.5 — list the user's re-usable audio history (ElevenLabs). Optional;
   * only providers with a free re-download history implement it. Used by the
   * audio-search route to offer reuse before a paid generation.
   */
  listHistory?(): Promise<HistoryAudioItem[]>;
  /**
   * Task 2.5 — re-fetch a history item's bytes (NO credit — already paid) as an
   * audio GenAsset the host localizes into `assets/<sha8>`. Optional, paired
   * with `listHistory`.
   */
  fetchHistoryAudio?(id: string): Promise<GenAsset>;
}

/**
 * Context the host injects into `submit` at call time — the resolved credential
 * (never stored on the adapter) + a localizer that lands result bytes/URLs into
 * `assets/<sha8>`. Passed alongside the request so key custody stays external.
 */
export interface AdapterContext {
  /** The resolved API key, or null for a `local`/`none`-auth provider. */
  apiKey: string | null;
  /** Localize a produced asset into `assets/<sha8>.<ext>`; returns the rel path. */
  localize(asset: GenAsset): Promise<string>;
  /**
   * Read a content-addressed `assets/<sha8>.<ext>` source's bytes + sniffed mime
   * for edit / image-to-video flows (a `GenRequest.sourceAsset`). Host-provided
   * so the adapter never touches the filesystem; returns null for an unknown or
   * contained-out path. Absent when the host wires no source access (Phase 0).
   */
  readSourceAsset?(rel: string): Promise<{ bytes: Uint8Array; mime: string } | null>;
  /** AbortSignal so a cancelled job tears down its provider request. */
  signal?: AbortSignal;
}

/** An adapter factory — the registry stores these, one per provider. */
export type AdapterFactory = (ctx: AdapterContext) => ProviderAdapter;

// ── Structural validation (dependency-free — no Ajv) ─────────────────────────
// The /_api/generate-jobs route validates the untrusted request body with this
// before it reaches an adapter (security surface — a crafted field must never
// reach a provider POST or the filesystem). Mirrors photo/schema.ts's style.

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Same content-addressed relative-path allowlist as photo/schema.ts — never a
// data:/blob:/absolute/traversing path.
const ASSET_REL_RE = /^assets\/[0-9a-f]{8,}[A-Za-z0-9._-]*$/;
// Conservative provider/model id shape — slug-ish, no path separators.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ASPECT_RE = /^\d{1,2}:\d{1,2}$/;
const MAX_PROMPT_LEN = 8000;

export function isModality(v: unknown): v is Modality {
  return typeof v === 'string' && (MODALITIES as readonly string[]).includes(v);
}

/** Validate an untrusted `GenRequest` body. Returns collected errors. */
export function validateGenRequest(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) return { ok: false, errors: ['request must be an object'] };

  if (!isModality(input.modality)) errors.push(`modality: must be one of ${MODALITIES.join('|')}`);
  if (typeof input.provider !== 'string' || !ID_RE.test(input.provider))
    errors.push('provider: missing or malformed id');
  if (input.model != null && (typeof input.model !== 'string' || !ID_RE.test(input.model)))
    errors.push('model: malformed id');

  if (input.prompt != null) {
    if (typeof input.prompt !== 'string') errors.push('prompt: must be a string');
    else if (input.prompt.length > MAX_PROMPT_LEN)
      errors.push(`prompt: exceeds ${MAX_PROMPT_LEN} chars`);
  }
  if (input.sourceAsset != null) {
    if (typeof input.sourceAsset !== 'string' || !ASSET_REL_RE.test(input.sourceAsset))
      errors.push('sourceAsset: must be a content-addressed assets/<sha8>.<ext> path');
  }
  if (input.aspectRatio != null) {
    if (typeof input.aspectRatio !== 'string' || !ASPECT_RE.test(input.aspectRatio))
      errors.push('aspectRatio: must look like W:H');
  }
  if (input.params != null && !isPlainObject(input.params))
    errors.push('params: must be an object');

  // A request needs SOMETHING to act on — a prompt or a source asset.
  if (input.prompt == null && input.sourceAsset == null)
    errors.push('request needs a prompt or a sourceAsset');

  return { ok: errors.length === 0, errors };
}
