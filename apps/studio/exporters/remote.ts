// Remote render dispatch — feature-cloud-export-render-workers (DDR-230).
//
// In a workspace cell the browser-needing exporters cannot run: no browser
// enters the image (DDR-209 A′1, unchanged). What a cell CAN do is resolve the
// export's scope against its own checkout (Target is pure data) and hand the
// fully-resolved job to the `maude-render` service, which holds a Chromium and
// NOTHING ELSE — no HUB_SECRET, no tenant store, no provider keys (DDR-230).
// The service reaches the canvas exactly the way the member's browser does:
// through the public canvas origin, authenticated by the member's own
// short-lived read-only render token, forwarded from the enqueue request.
//
// This module is deliberately dumb: one POST, the artifact (or a typed error)
// back. Progress is coarse in v1 — queued → running → done; the per-frame
// stream stays a local-lane feature until the service grows a progress channel.

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { dedupeFor, type TargetAnswer, type TargetFacts } from '../outbox/policy.ts';
import type { IntentRecord } from '../outbox/types.ts';
import type { ExportDegradation } from './degraded.ts';
import type { ExportOptions, ExportResult, Format } from './index.ts';
import type { Target } from './scope.ts';
import type { ExportSpecV2 } from './spec-v2.ts';

// The render service is the fleet's LEAST-trusted process (DDR-230 — it is the
// one place tenant TSX is evaluated in Chromium). Everything crossing back from
// it is untrusted, so its response is sanitized at THIS boundary before it
// reaches disk or the job record — security-review defender findings, 2026-08-21.

/**
 * Cap on the artifact a render worker may return — a hostile one must not OOM
 * the cell. Read per-call (not a module const) so the deployment can tune it
 * and tests can exercise the ceiling.
 */
export function artifactCap(): number {
  return Math.max(
    1_000_000,
    Number(process.env.MAUDE_RENDER_MAX_ARTIFACT_BYTES) || 512 * 1024 * 1024
  );
}

/**
 * Reduce whatever the render service put in `x-maude-filename` to a safe
 * basename. This value has TWO untrusted sinks (security-review): it lands in
 * `Bun.write(path.join(jobsDir, id, name), …)` (jobs.ts), so `../../…` is an
 * arbitrary-path write; and it is reflected into a `Content-Disposition:
 * attachment; filename="…"` header (http.ts), so a quote or CR/LF is header
 * injection. A strict allowlist charset closes BOTH: keep only letters, digits,
 * dot, dash, underscore — drop everything else (separators, quotes, control
 * chars) — then reject a name that is only dots.
 */
function safeArtifactName(raw: string | null, format: Format): string {
  const fallback = `export.${format === 'canva' ? 'zip' : format}`;
  if (!raw) return fallback;
  const base = path.basename(raw).replace(/[^A-Za-z0-9._-]/g, '');
  if (!base || /^\.+$/.test(base)) return fallback;
  return base.slice(0, 255);
}

/**
 * Reduce whatever the render service put in `x-maude-degraded` to a value the
 * rest of the system can hold, mirroring `safeArtifactName` above.
 *
 * The header was previously `JSON.parse`d and cast straight to
 * `ExportDegradation` — the one field on this boundary that skipped the file's
 * own "everything crossing back is untrusted" rule. It mattered less while the
 * only consumer read a boolean; it matters now that a degradation can carry a
 * `fontsNotEmbedded` ARRAY which `client/export-center.jsx` renders with
 * `.join(', ')`. A hostile or simply mixed-version worker sending an object
 * there turns the export panel into a TypeError, and unbounded `reason` /
 * `remedy` strings land verbatim in the on-disk history ledger.
 *
 * Returns undefined for anything unusable — a malformed note must never cost a
 * real artifact, which is the same reason the caller swallows parse errors.
 */
function safeDegradation(raw: unknown): ExportDegradation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const text = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v ? v.slice(0, max) : undefined;

  const reason = text(o.reason, 2000);
  if (!reason) return undefined; // `reason` is the only required field
  const fonts = Array.isArray(o.fontsNotEmbedded)
    ? o.fontsNotEmbedded.flatMap((f) => text(f, 200) ?? []).slice(0, 50)
    : undefined;
  return {
    reason,
    ...(o.audioDropped === true ? { audioDropped: true } : {}),
    ...(fonts?.length ? { fontsNotEmbedded: fonts } : {}),
    ...(text(o.remedy, 2000) ? { remedy: text(o.remedy, 2000) } : {}),
  };
}

/** Read a response body with a hard byte ceiling — `arrayBuffer()` has none. */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) {
    throw new Error(`render artifact too large (${declared} bytes > ${max})`);
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`render artifact exceeded ${max} bytes mid-stream`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Formats that never touch a browser. `zip` is JSZip over project files — it
 * runs in-cell in every lane. Everything else captures through the Playwright
 * spine and must dispatch (or refuse) in a workspace.
 */
export const BROWSER_FREE_FORMATS: ReadonlySet<Format> = new Set<Format>(['zip']);

export function formatNeedsBrowser(format: Format): boolean {
  return !BROWSER_FREE_FORMATS.has(format);
}

/**
 * Formats the render service cannot produce: `canva` bundles PNG captures WITH
 * project files (CSV, README, sources), and the service holds no tenant store
 * to read them from (DDR-230 §1). In a workspace these refuse with a
 * use-the-desktop remedy on BOTH the `remote` and `none` lanes.
 */
export const REMOTE_UNSUPPORTED_FORMATS: ReadonlySet<Format> = new Set<Format>(['canva']);

export const REMOTE_UNSUPPORTED_MESSAGE =
  'Canva handoff bundles project files the render service can’t reach — export it from the desktop app.';

/** Where the render service lives, from the cell/hub environment (T6 wiring). */
export interface RenderService {
  /** `MAUDE_RENDER_URL` — origin of the maude-render service. */
  url: string;
  /** `MAUDE_RENDER_SECRET` — shared ingress bearer. Never a hub secret. */
  secret: string;
}

/** How the render service reaches the tenant's canvas — the member's own grant. */
export interface RemoteCanvasAccess {
  /** PUBLIC canvas origin (what the member's browser iframes load from). */
  origin: string;
  /** The member's render token (x-maude-canvas-token), forwarded verbatim. */
  token?: string;
  /** designRoot-relative tokens CSS path (`?tokens=` on the shell URL). */
  tokensCssRel?: string;
  /** designRoot-relative shared components CSS path, when the DS has one. */
  componentsCssRel?: string;
}

export function resolveRenderService(env: NodeJS.ProcessEnv = process.env): RenderService | null {
  const url = env.MAUDE_RENDER_URL;
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), secret: env.MAUDE_RENDER_SECRET ?? '' };
}

/** The message a lane-`none` refusal carries — surfaced verbatim in the job UI. */
export const NO_RENDER_SERVICE_MESSAGE =
  'This format needs the render service, which this workspace doesn’t have configured. ' +
  'ZIP still works here; for rendered formats use the desktop app, or add the maude-render ' +
  'service (see the self-hosting docs).';

export class NoRenderServiceError extends Error {
  constructor() {
    super(NO_RENDER_SERVICE_MESSAGE);
    this.name = 'NoRenderServiceError';
  }
}

/**
 * POST one fully-resolved export job to the render service and return the
 * artifact as a normal `ExportResult`. Degradation travels back as a JSON
 * header rather than a wrapped body so the artifact bytes stream unmodified.
 */
/**
 * Keys a render adapter legitimately consumes (grepped from `exporters/*.ts`
 * `options.*` reads). Scope hints (`canvasFile`/`artboardId`/`selection`) are
 * deliberately absent — the cell resolves scope into `targets` before dispatch,
 * so the worker never needs them. `printProps`/`unsupportedMedia` are re-set by
 * the cell AFTER this pick (jobs.ts), so they pass through here too.
 */
const REMOTE_OPTION_KEYS = new Set([
  'scale',
  'dpi',
  'mode',
  'raster',
  'pageFit',
  'pdfPrint',
  // S8.7 — Text as outlines: `options.text` is read by the pdf adapter (parsePdfText) and the render image ships Ghostscript;
  // dropped here, a cloud Print PDF came back with live Type 3 fonts while the sheet said "shapes"
  'text',
  'audio',
  'allowUnsupportedMedia',
  'timeoutSec',
  'durationMs',
  'fps',
  'frameFormat',
  'frames',
  'gifColors',
  'maxFrames',
  'printProps',
  'unsupportedMedia',
]);

function pickRemoteOptions(options: ExportOptions): ExportOptions {
  const out: ExportOptions = {};
  for (const [k, v] of Object.entries(options)) {
    if (REMOTE_OPTION_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export async function renderRemotely(args: {
  format: Format;
  targets: Target[];
  options: ExportOptions;
  canvas: RemoteCanvasAccess;
  service: RenderService;
  signal?: AbortSignal;
}): Promise<ExportResult> {
  const { format, targets, options, canvas, service, signal } = args;
  // S8.1b — the second line behind routes/export.ts: the option allowlist below would drop these two
  // keys, and the service would hand back an sRGB file / today's canvas as if it were what was asked.
  // A v1 worker cannot honour either, so neither crosses; the protocol stays unchanged.
  if (options.colorProfile === 'display-p3')
    throw new Error('Display P3 exports in the desktop app — the render service writes sRGB.');
  if (options.atSha !== undefined)
    throw new Error(
      'Exporting a past version works in the desktop app, not on the render service.'
    );
  // The exporters' per-navigation timeouts (png.ts goto `--timeout`, etc.)
  // default to ~8s — tuned for the DESKTOP path where the canvas origin is
  // loopback and already warm. The render worker instead loads the canvas from
  // the REMOTE canvas origin, and a cold cell builds the tenant's TSX in its
  // sandbox on first access, so `_canvas-shell.html` can take far longer than
  // 8s to fire `load`. Give the remote path a generous floor (unless the
  // caller asked for more) so a cold-cell first render doesn't time out.
  // ALLOWLIST what crosses to the worker (security review F3). `options` is a
  // free-form bag the requesting member (a viewer, in a workspace) fills, and
  // the worker is the fleet's least-trusted process (DDR-230) shared across
  // tenants. Forward ONLY the keys the render adapters actually read — an
  // unknown attacker key never reaches worker code, and the scope-only hints
  // (canvasFile / artboardId / selection) that were already consumed cell-side
  // to build `targets` don't leak the canvas path onward.
  const remoteOptions: ExportOptions = {
    ...pickRemoteOptions(options),
    timeoutSec: Math.max(Number((options as { timeoutSec?: number }).timeoutSec) || 0, 60),
  };
  let res: Response;
  try {
    // Bun's `fetch` has its OWN default ceiling — 300 s — independent of the
    // signal, and it rejects with a plain TimeoutError that the catch below
    // read as "the service didn't answer". Every video job longer than five
    // minutes failed that way (measured: 300 s exactly; `timeout: false`
    // lifts it). The JOB timeout (exporters/jobs.ts jobTimeoutMs, sized to
    // the frame count) is the governor here, through `signal`; the fetch
    // must not carry a second, shorter one.
    // `timeout` is a Bun extension the bundled RequestInit types don't declare
    // (bun 1.3.3); the runtime honours it — see the measurement above.
    const init: RequestInit & { timeout: false } = {
      method: 'POST',
      signal,
      timeout: false,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${service.secret}`,
      },
      body: JSON.stringify({ format, targets, options: remoteOptions, canvas }),
    };
    const postStart = Date.now();
    console.error(`[remote] POST ${format} → ${service.url}/render`);
    res = await fetch(`${service.url}/render`, init);
    console.error(`[remote] ${format} responded ${res.status} in ${Date.now() - postStart}ms`);
  } catch (err) {
    if (signal?.aborted) throw err;
    // DDR-231 T7 — the member sees this in the export dialog / notification
    // center: name the LIKELY cause (a sleeping container waking) instead of
    // leaking a bare fetch error.
    throw new Error(
      'The render service didn’t answer — it may still be waking up. Try the export again in a minute.'
    );
  }
  if (res.status === 503) {
    throw new Error('The render service is busy with other exports right now — try again shortly.');
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')) || `${res.status}`;
    // Surface the worker's failure reason on the STUDIO side — the worker's own
    // stderr buffers under render load and is lost when the test kills it, so
    // this is the only reliable window into WHY a render 500'd.
    console.error(`[remote] ${format} FAILED ${res.status}: ${detail.slice(0, 800)}`);
    throw new Error(`render service refused the job: ${detail}`);
  }
  // Sanitize the filename BEFORE it can reach `Bun.write` in jobs.ts — the
  // service is untrusted (DDR-230), and this header would otherwise choose the
  // write path.
  const filename = safeArtifactName(res.headers.get('x-maude-filename'), format);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  let degraded: ExportDegradation | undefined;
  const degradedHeader = res.headers.get('x-maude-degraded');
  if (degradedHeader) {
    try {
      // base64 on the wire — the degradation reason is free text (it can carry
      // an em-dash, quotes, any Unicode from a renderer error), and a raw JSON
      // header value is restricted to Latin-1 with no control chars: a `—` in
      // the reason made the worker's Response construction throw 500 and lose
      // the whole (successful, degraded) render. Decode base64 first; fall back
      // to raw JSON so a mixed-version worker/cell still parses.
      const raw = /^[A-Za-z0-9+/=]+$/.test(degradedHeader)
        ? Buffer.from(degradedHeader, 'base64').toString('utf8')
        : degradedHeader;
      degraded = safeDegradation(JSON.parse(raw));
    } catch {
      /* a malformed degradation note must not fail a real artifact */
    }
  }
  const body = await readCapped(res, artifactCap());
  return { filename, contentType, body, ...(degraded ? { degraded } : {}) };
}

// ─── S8.5 — cloud or this Mac, and the offline queue (09 ex-offline) ─────────────────────────────
//
// A desktop renders on this Mac unless the person picks the cloud for a video. "Suggest each time"
// (the default) asks with the cloud ticked for 4K and long videos; the Advanced fold can pin
// "always the cloud" or "always this Mac". Images and PDFs always export on this Mac, in seconds —
// offline too, so nothing is blocked (09 note 17).
//
// A cloud render is an outbox intent (`export.cloud`, V2-1.14): the record id IS the job id, so an
// identical export asked twice while offline is one row and a replay after a crash gets the first
// answer (§5.6). The sender (`outbox/senders/export-cloud.ts`) only hands the job over; following it
// to the finished file is this module's tracker, persisted under `_state/export-cloud/`, so a
// restart resumes polling by job id instead of rendering twice. `_state/` is runtime in all four
// DDR-115 lists — no list changes.

/** The formats a cloud render is offered for. Everything else renders on this Mac. */
export const CLOUD_VIDEO_FORMATS: ReadonlySet<string> = new Set(['mp4', 'webm', 'gif']);
/** 4K: a video whose short side reaches 2160 px (2160 × 3840 portrait, 3840 × 2160 landscape). */
export const CLOUD_SUGGEST_SHORT_SIDE = 2160;
/** A long video: past one minute (S8-export-spec §5.6 "> 60 s"). */
export const CLOUD_SUGGEST_SECONDS = 60;

export type RenderWhere = 'this-mac' | 'cloud';
export type SuggestWhy = '4k' | 'long' | null;

type LaneSpec = Pick<ExportSpecV2, 'format' | 'byKind' | 'options' | 'at'>;

/** The formats a spec makes: each kind's own in a batch, else the one. */
function formatsOf(spec: Pick<ExportSpecV2, 'format' | 'byKind'>): string[] {
  const byKind = Object.values(spec.byKind ?? {}).map((e) => e.format as string);
  return byKind.length ? byKind : [spec.format as string];
}

/** Does this spec make a video at all? Only then is there a cloud-or-this-Mac question. */
export function specHasVideo(spec: Pick<ExportSpecV2, 'format' | 'byKind'>): boolean {
  return formatsOf(spec).some((f) => CLOUD_VIDEO_FORMATS.has(f));
}

/**
 * Why the sheet ticks the cloud for a video: 4K, or longer than a minute. `shortSide` is the output's
 * shorter side in px (artboard × scale), `seconds` the longest comp's duration; unknown = null.
 */
export function suggestWhy(shortSide: number | null, seconds: number | null): SuggestWhy {
  if (typeof shortSide === 'number' && shortSide >= CLOUD_SUGGEST_SHORT_SIDE) return '4k';
  if (typeof seconds === 'number' && seconds > CLOUD_SUGGEST_SECONDS) return 'long';
  return null;
}

/** Display P3 and a past version render on this Mac only (Q6, S8.1b). */
const thisMacOnly = (spec: LaneSpec): boolean =>
  spec.options?.colorProfile === 'display-p3' || !!spec.at;

/**
 * THE choice, server-authoritative. A spec that asks for the cloud gets it only for a video, only when
 * a cloud door exists, never with Display P3 or a past version. `auto` on a desktop never sends
 * anything to the cloud by itself: the sheet asks and sends an explicit lane. Everything else is this
 * Mac.
 */
export function chooseRenderLane(spec: LaneSpec, facts: { cloud: boolean }): RenderWhere {
  if (spec.options?.lane !== 'cloud') return 'this-mac';
  if (!facts.cloud || !specHasVideo(spec) || thisMacOnly(spec)) return 'this-mac';
  return 'cloud';
}

/**
 * The estimate's `render` block: is the cloud on offer, and what "Suggest each time" ticks. Pure —
 * the sheet reads it (client/export-lane.js); the route computes it from the index sizes and the
 * comps' own `durationInFrames` / `fps`.
 */
export function renderSuggestion(
  spec: LaneSpec,
  facts: { cloud: boolean; shortSide: number | null; seconds: number | null }
): { cloud: boolean; suggest: RenderWhere; why: SuggestWhy } {
  const cloud = facts.cloud && specHasVideo(spec) && !thisMacOnly(spec);
  const why = cloud ? suggestWhy(facts.shortSide, facts.seconds) : null;
  return { cloud, suggest: why ? 'cloud' : 'this-mac', why };
}

/**
 * A comp's length in seconds from its own source: the longest literal `durationInFrames={N}` at its
 * `fps={N}` (30 when absent). A computed duration (a const, arithmetic) is unknown — null — and then
 * only 4K can suggest the cloud. Read-only, regex over the known vocabulary (the house style of
 * `_canvas-rects-static.mjs`).
 */
export function compSecondsFromSource(source: string): number | null {
  const fpsM = /\bfps=\{\s*(\d{1,3})\s*\}/.exec(source);
  const fps = fpsM ? Math.max(1, Number(fpsM[1])) : 30;
  let frames = 0;
  for (const m of source.matchAll(/\bdurationInFrames=\{\s*(\d{1,7})\s*\}/g))
    frames = Math.max(frames, Number(m[1]));
  return frames > 0 ? frames / fps : null;
}

// ── the cloud door ──────────────────────────────────────────────────────────────────────────────

/** Where a cloud job stands, as the door answers a poll. */
export type CloudJobStatus =
  | { state: 'queued' | 'running'; progress?: { current: number; total: number } }
  | { state: 'done' }
  | { state: 'failed'; error?: string }
  /** the cloud no longer knows the job (past its age, another project) */
  | { state: 'gone' }
  /** no answer — offline again, the cell asleep; the tracker keeps the job and asks later */
  | { state: 'unreachable' };

/**
 * The cloud render door, as this Mac sees it. `submit` is idempotent by `jobId` (V2-1.14 §5.11: the
 * render side treats the client's job id as its idempotency key). Tests pass a fake; nothing here
 * ever names the real render service.
 */
export interface CloudRenderDoor {
  submit(job: {
    jobId: string;
    spec: ExportSpecV2;
    label: string;
    /** what this Mac holds of the canvas's files at SEND time (S8.5b §6); the cell judges it */
    expect?: CloudFingerprintEntry[];
  }): Promise<TargetAnswer>;
  status(jobId: string): Promise<CloudJobStatus>;
  artifact(jobId: string): Promise<{ filename: string | null; body: Uint8Array } | null>;
}

/** One file of a canvas's closure as this Mac holds it: sha256, or null for presence-only (an asset). */
export interface CloudFingerprintEntry {
  rel: string;
  sha256: string | null;
}
/** Past this many entries a render is not offered to the cloud (S8.5b §6): it renders on this Mac. */
export const CLOUD_FINGERPRINT_MAX = 2000;

/** The cloud answers a poll with this when the artifact is past the byte ceiling: the job is over. */
export class CloudArtifactTooLargeError extends Error {
  constructor() {
    super('cloud artifact too large');
    this.name = 'CloudArtifactTooLargeError';
  }
}

/** The words of a cloud row while it waits (09 ex-offline, CONTRACT §4). */
export const CLOUD_QUEUED_WORDS = 'Queued — starts when this Mac is online';
export const CLOUD_GONE_WORDS = 'The cloud no longer has this export. Export it again.';
export const CLOUD_FAILED_WORDS = 'The cloud couldn’t render it.';
export const CLOUD_EXPIRED_WORDS = 'Not exported — it waited a day.';
export const CLOUD_ACCESS_REMOVED_WORDS = 'Not sent — you’re no longer in this project.';
export const CLOUD_TOO_BIG_WORDS =
  'Not exported — this is too much to send to the cloud at once. Render it on this Mac.';
export const CLOUD_CAP_WORDS = 'Not exported — it is longer than one export may be.';
/** How long a `not-synced` answer is retried (while online) before it is final (S8.5b §6). */
export const CLOUD_NOT_SYNCED_AFTER_MS = 10 * 60 * 1000;

/**
 * "Your latest changes to {file} haven’t reached the cloud." `file` is the name the cell reported —
 * untrusted text: only a short printable basename is kept, else the sentence names no file.
 */
export function cloudNotSyncedWords(file?: string | null): string {
  const name = String(file ?? '')
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^\p{L}\p{N} ._()+-]/gu, '')
    .trim()
    .slice(0, 80);
  return `Not exported — your latest changes to ${name || 'this canvas'} haven’t reached the cloud. Render it on this Mac.`;
}
/** The day a render may take before it is "Export again" (`MAX_JOB_AGE_MS`, V2-1.14 §5.7). */
export const CLOUD_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Design-root-relative home of the tracker (per Mac, never synced). */
export const CLOUD_JOBS_REL = '_state/export-cloud';

type TrackPhase = 'rendering' | 'done' | 'failed';
interface TrackRecord {
  v: 1;
  jobId: string;
  label: string;
  format: string;
  spec: ExportSpecV2;
  createdAt: number;
  acceptedAt: number;
  phase: TrackPhase;
  progress?: { current: number; total: number };
  filename?: string;
  error?: string;
  finishedAt?: number;
}

/** A row the Exports panel lists — the `ExportJob` shape (exporters/jobs.ts) plus the waiting words. */
export interface CloudRow {
  id: string;
  format: string;
  scope: string;
  options: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'failed';
  createdAt: string;
  finishedAt?: string;
  filename?: string;
  error?: string;
  progress?: { current: number; total: number };
  spec: ExportSpecV2;
  label: string;
  runsOn: 'cloud';
  /** queued in the outbox: the row says so and offers "Render on this Mac now" */
  waiting?: string;
}

type CloudEnqueue = {
  kind: 'export.cloud';
  actor: string;
  device: string;
  project: { id: string | null; hub: string | null };
  target?: IntentRecord['target'];
  label: string;
  payload: { kind: 'export.cloud'; spec: Record<string, unknown>; saveTo: string };
};

/** The outbox half the tracker needs (outbox/index.ts `Outbox`). */
export interface CloudOutbox {
  enqueue: (
    input: CloudEnqueue
  ) =>
    | { ok: true; record: IntentRecord; deduped: false | 'same' | 'replaced' }
    | { ok: false; code: string; words?: string };
  store: {
    list(): IntentRecord[];
    get(id: string): IntentRecord | null;
    cancel(id: string): { ok: true; record: IntentRecord } | { ok: false; code: string };
  };
}

export interface CloudExportsOptions {
  designRoot: string;
  outbox: CloudOutbox;
  /** the door, read per use (a sign-in or a link can change it); null = no cloud on this Mac */
  door: () => CloudRenderDoor | null;
  /** `export:job` — the Exports panel's row frames */
  emit?: (row: CloudRow) => void;
  now?: () => number;
  pollMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  log?: Pick<Console, 'warn'>;
}

const JOB_ID_RE = /^i_[a-z0-9]{20}$/;

/** The intent's spec, back as a v2 spec (the outbox stores it opaque). */
const specOf = (r: IntentRecord): ExportSpecV2 =>
  (r.payload.kind === 'export.cloud' ? r.payload.spec : {}) as unknown as ExportSpecV2;

/**
 * The target facts an `export.cloud` record is judged by before it is sent (V2-1.14 §5.9): the
 * canvas in the trash (G3), or every artboard it names moved to the trash — then the export didn't
 * start, worded with the export's own name. Your role now comes in `base` (Can view: G14, no
 * downloads, A19; removed: G9).
 */
export function cloudTargetFacts(
  record: IntentRecord,
  base: TargetFacts,
  probe: {
    /** `present` | `trashed` | `missing` for a designRoot-relative canvas */
    canvas(rel: string): 'present' | 'trashed' | 'missing';
    /** the DCArtboard ids the canvas holds now (null = unreadable: don't judge) */
    artboards(rel: string): ReadonlySet<string> | null;
  }
): TargetFacts {
  const rel = record.target.canvas?.replace(/^path:/, '');
  if (!rel) return base;
  const state = probe.canvas(rel);
  if (state !== 'present') return { ...base, canvas: { state, name: record.label } };
  const wanted = record.target.artboards ?? [];
  if (wanted.length) {
    const have = probe.artboards(rel);
    if (have && wanted.every((id) => !have.has(id)))
      return { ...base, canvas: { state: 'trashed', name: record.label } };
  }
  return { ...base, canvas: { state: 'present', name: record.label } };
}

function failedWords(r: IntentRecord): string {
  switch (r.outcome?.code) {
    case 'expired':
      return CLOUD_EXPIRED_WORDS;
    case 'target-trashed':
      return `${r.label} is in the trash, so its export didn't start.`;
    case 'access-reduced':
      return 'Not exported — Can view can’t download from this project.';
    case 'access-removed':
      return CLOUD_ACCESS_REMOVED_WORDS;
    default:
      return CLOUD_FAILED_WORDS;
  }
}

export function createCloudExports(opts: CloudExportsOptions) {
  const now = opts.now ?? Date.now;
  const pollMs = opts.pollMs ?? 5000;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const log = opts.log ?? console;
  const dir = path.join(opts.designRoot, CLOUD_JOBS_REL);
  const tracked = new Map<string, TrackRecord>();
  const timers = new Map<string, unknown>();
  let stopped = false;

  const fileOf = (id: string) => path.join(dir, `${id}.json`);
  function persist(t: TrackRecord): void {
    mkdirSync(dir, { recursive: true });
    const tmp = `${fileOf(t.jobId)}.tmp`;
    writeFileSync(tmp, JSON.stringify(t));
    renameSync(tmp, fileOf(t.jobId));
  }

  function rowOfTrack(t: TrackRecord): CloudRow {
    return {
      id: t.jobId,
      format: t.format,
      scope: String(t.spec.scope ?? 'selection'),
      options: {},
      status: t.phase === 'rendering' ? 'running' : t.phase,
      createdAt: new Date(t.createdAt).toISOString(),
      ...(t.finishedAt ? { finishedAt: new Date(t.finishedAt).toISOString() } : {}),
      ...(t.filename ? { filename: t.filename } : {}),
      ...(t.error ? { error: t.error } : {}),
      ...(t.progress ? { progress: t.progress } : {}),
      spec: t.spec,
      label: t.label,
      runsOn: 'cloud',
    };
  }

  function rowOfIntent(r: IntentRecord): CloudRow | null {
    if (r.kind !== 'export.cloud') return null;
    const spec = specOf(r);
    const base = {
      id: r.id,
      format: String(spec.format ?? ''),
      scope: String(spec.scope ?? 'selection'),
      options: {},
      createdAt: new Date(r.createdAt).toISOString(),
      spec,
      label: r.label,
      runsOn: 'cloud' as const,
    };
    if (r.state === 'queued' || r.state === 'sending')
      return { ...base, status: 'queued', waiting: CLOUD_QUEUED_WORDS };
    if (r.state === 'dropped' || r.state === 'needs-you') {
      if (r.outcome?.code === 'cancelled') return null; // rendered here instead, or withdrawn
      return {
        ...base,
        status: 'failed',
        error: failedWords(r),
        ...(r.outcome ? { finishedAt: new Date(r.outcome.at).toISOString() } : {}),
      };
    }
    return null; // done: the tracker's row says the rest
  }

  /** Every cloud row: the tracked jobs, then whatever still waits in the outbox. Newest first. */
  function rows(): CloudRow[] {
    const out: CloudRow[] = [...tracked.values()].map(rowOfTrack);
    for (const r of opts.outbox.store.list()) {
      if (tracked.has(r.id)) continue;
      const row = rowOfIntent(r);
      if (row) out.push(row);
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const announce = (row: CloudRow | null) => {
    if (row) opts.emit?.(row);
  };

  function schedule(id: string, ms = pollMs): void {
    if (stopped) return;
    const prev = timers.get(id);
    if (prev !== undefined) clearTimer(prev);
    timers.set(
      id,
      setTimer(() => {
        timers.delete(id);
        void poll(id);
      }, ms)
    );
  }

  function finish(t: TrackRecord, patch: Partial<TrackRecord>): void {
    const next: TrackRecord = { ...t, ...patch, finishedAt: now() };
    if (patch.progress === undefined && 'progress' in patch) delete next.progress;
    tracked.set(t.jobId, next);
    persist(next);
    announce(rowOfTrack(next));
  }

  /** One poll of a tracked job; the next is scheduled unless it ended. */
  async function poll(id: string): Promise<void> {
    const t = tracked.get(id);
    if (!t || t.phase !== 'rendering' || stopped) return;
    if (now() - t.acceptedAt > CLOUD_JOB_MAX_AGE_MS)
      return finish(t, { phase: 'failed', error: CLOUD_EXPIRED_WORDS });
    const door = opts.door();
    if (!door) return schedule(id);
    let st: CloudJobStatus;
    try {
      st = await door.status(id);
    } catch {
      st = { state: 'unreachable' };
    }
    if (st.state === 'unreachable') return schedule(id);
    if (st.state === 'gone') return finish(t, { phase: 'failed', error: CLOUD_GONE_WORDS });
    if (st.state === 'failed') {
      const error = typeof st.error === 'string' && st.error ? st.error.slice(0, 500) : '';
      return finish(t, { phase: 'failed', error: error || CLOUD_FAILED_WORDS });
    }
    if (st.state === 'queued' || st.state === 'running') {
      if (st.progress) {
        const next = { ...t, progress: st.progress };
        tracked.set(id, next);
        announce(rowOfTrack(next));
      }
      return schedule(id);
    }
    // done — the file comes down to this Mac, under the same untrusted-name rule as a render reply
    let art: Awaited<ReturnType<CloudRenderDoor['artifact']>> = null;
    try {
      art = await door.artifact(id);
    } catch (err) {
      // a file past the ceiling will never fit: asking every poll for a day would only re-download it
      if (err instanceof CloudArtifactTooLargeError)
        return finish(t, { phase: 'failed', error: CLOUD_FAILED_WORDS });
      art = null;
    }
    if (!art) return schedule(id); // offline between the poll and the download: ask again
    if (art.body.byteLength > artifactCap())
      return finish(t, { phase: 'failed', error: CLOUD_FAILED_WORDS });
    const filename = safeArtifactName(art.filename, t.format as Format);
    mkdirSync(path.join(dir, id), { recursive: true });
    writeFileSync(path.join(dir, id, filename), art.body);
    finish(t, { phase: 'done', filename, progress: undefined });
  }

  /** The sender's success hook: the cloud took the job — follow it to the file. */
  function accepted(record: IntentRecord): void {
    if (tracked.has(record.id)) return; // a replay that got the first answer
    const spec = specOf(record);
    const t: TrackRecord = {
      v: 1,
      jobId: record.id,
      label: record.label,
      format: String(spec.format ?? ''),
      spec,
      createdAt: record.createdAt,
      acceptedAt: now(),
      phase: 'rendering',
    };
    tracked.set(t.jobId, t);
    persist(t);
    announce(rowOfTrack(t));
    schedule(t.jobId, 0);
  }

  return {
    /** Is the cloud on offer on this Mac right now? */
    available: () => opts.door() !== null,
    door: () => opts.door(),
    /**
     * Queue a cloud render. The record id is the job id; an identical export still waiting collapses
     * into its row (`deduped: true`, the same job id back).
     */
    start(input: {
      spec: ExportSpecV2;
      label: string;
      actor: string;
      device: string;
      project: { id: string | null; hub: string | null };
    }):
      | { ok: true; jobId: string; deduped: boolean; words: string }
      | { ok: false; code: string; words?: string } {
      const canvas = input.spec.canvas;
      const artboards = input.spec.selection?.artboards;
      const payload = {
        kind: 'export.cloud' as const,
        spec: input.spec as unknown as Record<string, unknown>,
        saveTo: input.spec.options?.saveTo ?? 'downloads',
      };
      // §5.6 — the store folds a twin that is still `queued`; the drain marks a fresh record
      // `sending` the moment it is enqueued (every gate open, the attempt in flight), so a second
      // identical export asked during that attempt would fork a second job id. Any unfinished twin
      // — queued or mid-attempt — is the same row.
      const { key } = dedupeFor(input.project.id, payload);
      const twin = opts.outbox.store
        .list()
        .find(
          (x) =>
            x.kind === 'export.cloud' &&
            x.dedupeKey === key &&
            x.project.id === input.project.id &&
            (x.state === 'queued' || x.state === 'sending')
        );
      if (twin) return { ok: true, jobId: twin.id, deduped: true, words: CLOUD_QUEUED_WORDS };
      const r = opts.outbox.enqueue({
        kind: 'export.cloud',
        actor: input.actor,
        device: input.device,
        project: input.project,
        target: {
          ...(canvas ? { canvas: `path:${canvas}` } : {}),
          ...(artboards?.length ? { artboards: [...artboards] } : {}),
        },
        label: input.label,
        payload,
      });
      if (!r.ok) return { ok: false, code: r.code, ...(r.words ? { words: r.words } : {}) };
      announce(rowOfIntent(r.record));
      return {
        ok: true,
        jobId: r.record.id,
        deduped: r.deduped !== false,
        words: CLOUD_QUEUED_WORDS,
      };
    },
    accepted,
    rows,
    /** The finished file's bytes (`/_api/export-jobs/download?id=`) — only a done cloud job. */
    bytes(
      id: string
    ):
      | { ok: true; filename: string; body: Uint8Array }
      | { ok: false; reason: 'missing' | 'not-done' } {
      if (!JOB_ID_RE.test(id)) return { ok: false, reason: 'missing' };
      const t = tracked.get(id);
      if (!t) return { ok: false, reason: 'missing' };
      if (t.phase === 'rendering') return { ok: false, reason: 'not-done' };
      if (t.phase !== 'done' || !t.filename) return { ok: false, reason: 'missing' };
      try {
        const body = new Uint8Array(readFileSync(path.join(dir, id, t.filename)));
        return { ok: true, filename: t.filename, body };
      } catch {
        return { ok: false, reason: 'missing' };
      }
    },
    /**
     * "Render on this Mac now": withdraw the queued cloud row and hand its spec back for the this-Mac
     * lane. One already handed to the cloud cannot be un-sent (`in-flight`).
     */
    takeBack(id: string): { ok: true; spec: ExportSpecV2 } | { ok: false; code: string } {
      const r = opts.outbox.store.get(id);
      if (!r || r.kind !== 'export.cloud') return { ok: false, code: 'not-found' };
      if (tracked.has(id)) return { ok: false, code: 'in-flight' };
      const c = opts.outbox.store.cancel(id);
      if (!c.ok) return { ok: false, code: c.code };
      const spec = specOf(r);
      return {
        ok: true,
        spec: { ...spec, options: { ...(spec.options ?? {}), lane: 'this-mac' } },
      };
    },
    /** Boot: read every tracked job back and resume polling the unfinished ones by job id. */
    resume(): number {
      let names: string[] = [];
      try {
        names = readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        return 0;
      }
      let n = 0;
      for (const f of names) {
        try {
          const t = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as TrackRecord;
          if (t?.v !== 1 || !JOB_ID_RE.test(t.jobId) || `${t.jobId}.json` !== f) continue;
          tracked.set(t.jobId, t);
          if (t.phase === 'rendering') {
            n += 1;
            schedule(t.jobId, 0);
          }
        } catch (err) {
          log.warn(`[export-cloud] unreadable ${f}: ${(err as Error).message}`);
        }
      }
      return n;
    },
    /** Tests: run one poll now. */
    pollNow: (id: string) => poll(id),
    stop() {
      stopped = true;
      for (const h of timers.values()) clearTimer(h);
      timers.clear();
    },
  };
}

export type CloudExports = ReturnType<typeof createCloudExports>;

/** A designRoot-relative canvas's source, or null (outside the root, unreadable, too big). */
function readCanvasSource(designRoot: string, rel: string): string | null {
  const root = path.resolve(designRoot);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) || !/\.(tsx|jsx)$/i.test(abs)) return null;
  try {
    const text = readFileSync(abs, 'utf8');
    return text.length > 4 * 1024 * 1024 ? null : text;
  } catch {
    return null;
  }
}

/**
 * What the boot hands the cloud target check and the estimate, read from this Mac's own files: a
 * canvas is `trashed` when the shared Trash stops it (`stopped` = routes/trash.ts write-stop stems)
 * or its file is gone from this Mac; its artboards are the `<DCArtboard id="…">` ids its source holds
 * now; its length is its comps' literal `durationInFrames`.
 */
export function desktopCloudFacts(
  designRoot: string,
  stopped: () => ReadonlySet<string>
): Parameters<typeof cloudTargetFacts>[2] & { videoSeconds(rel: string): number | null } {
  const stems = (): ReadonlySet<string> => {
    try {
      return stopped();
    } catch {
      return new Set(); // boot order: the write stop is built after the outbox
    }
  };
  return {
    canvas(rel) {
      if (stems().has(rel.replace(/\.(tsx|jsx|html)$/i, ''))) return 'trashed';
      return readCanvasSource(designRoot, rel) === null ? 'trashed' : 'present';
    },
    artboards(rel) {
      const src = readCanvasSource(designRoot, rel);
      if (src === null) return null;
      const ids = new Set<string>();
      for (const m of src.matchAll(/<DCArtboard\b[^>]*?\bid=["']([^"']+)["']/g))
        if (m[1]) ids.add(m[1]);
      return ids;
    },
    videoSeconds(rel) {
      const src = readCanvasSource(designRoot, rel);
      return src === null ? null : compSecondsFromSource(src);
    },
  };
}

/** The hub's project role as the replay table reads it (V2-1.7: observer = Can view). */
export function intentRole(role: string | null | undefined): TargetFacts['role'] {
  switch (role) {
    case 'owner':
      return 'owner';
    case 'member':
      return 'edit';
    case 'viewer':
      return 'comment';
    case 'observer':
      return 'view';
    default:
      return null;
  }
}

/** A cloud row's name: the canvas (or folder / project) and what it makes — "video-hype · MP4". */
export function cloudLabel(
  spec: Pick<ExportSpecV2, 'canvas' | 'folder' | 'format'>,
  project: string
): string {
  const where = spec.canvas ?? spec.folder ?? '';
  const name = where ? path.basename(where).replace(/\.(tsx|jsx|html)$/i, '') : project || 'Export';
  return `${name} · ${String(spec.format).toUpperCase()}`;
}
