// maude-render request handling — the routes, the job queue and the cloud render budget (DDR-230).
//
// server.ts owns the process (boot assert, env, Bun.serve, SIGTERM); this module owns what a
// request does. It is kept free of the studio's exporters on purpose: server.ts hands it the
// adapter runner and the format check, so these rules are testable with only the Worker's own
// deps installed (render-deploy.yml runs `bun test apps/render/test` that way).
//
// #128 cloud comments 2–3 (T3.7, decision maude/burndown-d7-cloud-render-budget):
//   - a cloud video renders at scale 1 with JPEG intermediate frames (`cloudRenderOptions`) — a
//     1294-frame comp at scale 2 needed ~2 h of frame-step on the render instance, past its 60 min
//     ceiling, so it could never finish. The instance size is unchanged.
//   - ONE video job runs at a time, with a queue of one behind it (`videoLane`); a third gets 503.
//     Two parallel frame-step videos on the one instance each ran at half speed.
//   - a job carries a random `renderId` its cell chose; `GET /_render/status?id=` answers
//     waiting / running + frame progress, `POST /_render/cancel` stops it and frees its slot.
//     Both need the ingress bearer AND the id, and the id is never logged — the bearer is shared
//     by every cell, so the unguessable id is what keeps one cell off another's job.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

import { startTokenProxy } from './proxy.ts';

/** The formats the render service renders frame by frame — the heavy ones. */
export const VIDEO_FORMATS: ReadonlySet<string> = new Set(['mp4', 'webm', 'gif']);

/** Scale every cloud video renders at (the user's 1–3× choice is capped to it). */
export const CLOUD_VIDEO_SCALE = 1;

/**
 * The cloud render budget: a video renders at {@link CLOUD_VIDEO_SCALE} and, unless it is a GIF,
 * with JPEG intermediate frames (the video adapter's `frameFormat`; a GIF's palette quantization
 * already loses precision, so a lossy intermediate under it is pure downside — video.ts ignores it
 * there too). Images and documents pass through untouched: they render in seconds.
 */
export function cloudRenderOptions(
  format: string,
  options: Record<string, unknown>,
  maxScale: number = CLOUD_VIDEO_SCALE
): Record<string, unknown> {
  if (!VIDEO_FORMATS.has(format)) return options;
  const asked = Number(options.scale);
  const scale =
    Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), maxScale) : maxScale;
  return { ...options, scale, ...(format === 'gif' ? {} : { frameFormat: 'jpeg' }) };
}

/** A render id: 22–64 url-safe characters — long enough to be an unguessable handle. */
export const RENDER_ID_RE = /^[A-Za-z0-9_-]{22,64}$/;

// ── a counting lane with a bounded wait list ────────────────────────────────────────────────────

type Release = () => void;

export class Lane {
  running = 0;
  #waiters: Array<{ grant: (r: Release | 'aborted') => void }> = [];

  constructor(
    readonly maxRunning: number,
    readonly maxWaiting: number
  ) {}

  get waiting(): number {
    return this.#waiters.length;
  }

  #release(): Release {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.#waiters.shift();
      // Hand the slot straight to the next waiter: `running` stays, so nobody can slip in between.
      if (next) next.grant(this.#release());
      else this.running -= 1;
    };
  }

  /** A slot, `null` when the lane and its wait list are full, `'aborted'` when `signal` fires first. */
  acquire(signal?: AbortSignal): Promise<Release | null | 'aborted'> {
    if (signal?.aborted) return Promise.resolve('aborted');
    if (this.running < this.maxRunning && this.#waiters.length === 0) {
      this.running += 1;
      return Promise.resolve(this.#release());
    }
    if (this.#waiters.length >= this.maxWaiting) return Promise.resolve(null);
    return new Promise((resolve) => {
      const waiter = {
        grant: (r: Release | 'aborted') => {
          signal?.removeEventListener('abort', onAbort);
          resolve(r);
        },
      };
      const onAbort = () => {
        const i = this.#waiters.indexOf(waiter);
        if (i !== -1) this.#waiters.splice(i, 1);
        resolve('aborted');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }
}

// ── the request handler ─────────────────────────────────────────────────────────────────────────

export interface RenderResult {
  filename: string;
  contentType: string;
  body: Uint8Array | ReadableStream<Uint8Array>;
  degraded?: unknown;
}

export interface RenderCtx {
  designRoot: string;
  repoRoot: string;
  serverOrigin: string;
  tokensCssRel?: string;
  componentsCssRel?: string;
}

export interface RenderHooks {
  signal?: AbortSignal;
  onProgress?: (update: { current: number; total: number }) => void;
}

/** Runs one export adapter — server.ts passes the studio's `getAdapter(format).run`. */
export type RunAdapter = (
  format: string,
  targets: unknown[],
  options: Record<string, unknown>,
  ctx: RenderCtx,
  hooks: RenderHooks
) => Promise<RenderResult>;

interface CanvasAccess {
  origin: string;
  token?: string;
  tokensCssRel?: string;
  componentsCssRel?: string;
}

export interface RenderServiceOptions {
  secret: string;
  allowedOrigins: string[];
  run: RunAdapter;
  /** why a format cannot render here, or null (server.ts: the studio's format sets) */
  rejectFormat: (format: unknown) => string | null;
  startProxy?: (canvas: CanvasAccess) => { origin: string; stop(): void; log(): string };
  maxConcurrent?: number;
  maxQueued?: number;
  videoMaxConcurrent?: number;
  videoMaxQueued?: number;
  videoMaxScale?: number;
  timeoutMs?: number;
  version?: string;
}

interface Entry {
  state: 'waiting' | 'running';
  progress?: { current: number; total: number };
  controller: AbortController;
  cancelled: boolean;
}

function clampProgress(p: unknown): { current: number; total: number } | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const { current, total } = p as { current?: unknown; total?: unknown };
  if (typeof current !== 'number' || typeof total !== 'number') return undefined;
  if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return undefined;
  const t = Math.min(Math.floor(total), 1_000_000);
  return { current: Math.min(Math.max(Math.floor(current), 0), t), total: t };
}

/**
 * SSRF gate — PARSE FIRST, then match the parsed scheme+host (security-review attacker HIGH). A raw
 * string match let `https://canvas-x@169.254.169.254#.cloud.maude.sh` (userinfo `canvas-x`, host the
 * metadata IP, fragment `.cloud.maude.sh`) pass a prefix/suffix test. Matching the PARSED
 * `protocol://host` makes the check see exactly what `fetch` will connect to. The allowlist entry's
 * single `*` may only stand in for a run of hostname characters (`[a-z0-9-]`), never a dot.
 */
export function originAllowed(origin: string, allowedOrigins: readonly string[]): boolean {
  let scheme: string;
  let host: string;
  try {
    const u = new URL(origin);
    if (u.username || u.password) return false;
    scheme = u.protocol.replace(/:$/, '');
    host = u.host.toLowerCase();
  } catch {
    return false;
  }
  if (scheme !== 'https' && scheme !== 'http') return false;
  const canonical = `${scheme}://${host}`;
  return allowedOrigins.some((allowed) => {
    const a = allowed.toLowerCase().replace(/\/+$/, '');
    const star = a.indexOf('*');
    if (star === -1) return canonical === a;
    const prefix = a.slice(0, star);
    const suffix = a.slice(star + 1);
    if (!canonical.startsWith(prefix) || !canonical.endsWith(suffix)) return false;
    const filled = canonical.slice(prefix.length, canonical.length - suffix.length);
    return filled.length > 0 && /^[a-z0-9-]+$/.test(filled);
  });
}

interface RenderBody {
  format: string;
  targets: unknown[];
  options?: Record<string, unknown>;
  canvas: CanvasAccess;
  renderId?: string;
}

/**
 * Why a job was refused, or `null` when it is renderable. NAMED, not boolean (DDR-231 Phase 2 T4):
 * says which field and why, never what the value was — the body is attacker-influenced and the
 * response crosses back to the cell.
 */
function rejectReason(b: unknown, rejectFormat: (f: unknown) => string | null): string | null {
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  const body = b as Record<string, unknown>;
  const formatWhy = rejectFormat(body.format);
  if (formatWhy) return formatWhy;
  if (!Array.isArray(body.targets)) return 'targets must be an array';
  if (body.targets.length === 0)
    return 'no targets resolved — the cell found nothing to render for this scope';
  // file-tree targets carry repo paths this process cannot (and must not) read.
  if (!body.targets.every((t) => (t as { kind?: unknown })?.kind === 'element'))
    return 'targets must all be element targets — a file-tree scope (project-raw) cannot render here';
  const canvas = body.canvas as Record<string, unknown> | undefined;
  if (!canvas || typeof canvas.origin !== 'string' || !canvas.origin)
    return 'canvas.origin is required';
  if (
    body.renderId !== undefined &&
    (typeof body.renderId !== 'string' || !RENDER_ID_RE.test(body.renderId))
  )
    return 'renderId must be 22–64 url-safe characters';
  return null;
}

export function createRenderService(o: RenderServiceOptions) {
  const startProxy = o.startProxy ?? startTokenProxy;
  const timeoutMs = o.timeoutMs ?? 60 * 60 * 1000;
  // Default 2, not 1 (security-review: a single slot lets one wedging comp hold the whole fleet's
  // render capacity — a cross-tenant DoS). Videos are further held to one at a time below.
  const lane = new Lane(Math.max(1, o.maxConcurrent ?? 2), Math.max(0, o.maxQueued ?? 4));
  const videoLane = new Lane(
    Math.max(1, o.videoMaxConcurrent ?? 1),
    Math.max(0, o.videoMaxQueued ?? 1)
  );
  const jobs = new Map<string, Entry>();

  function authorized(req: Request): boolean {
    if (!o.secret) return false; // unset secret = closed service, never an open one
    const got = Buffer.from(req.headers.get('authorization') ?? '');
    const want = Buffer.from(`Bearer ${o.secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  }

  const counts = () => ({
    running: lane.running,
    queued: lane.waiting + videoLane.waiting,
  });

  async function handleRender(req: Request): Promise<Response> {
    if (!authorized(req)) return new Response('unauthorized', { status: 401 });
    let parsed: unknown;
    try {
      parsed = await req.json();
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }
    const reason = rejectReason(parsed, o.rejectFormat);
    if (reason) return new Response(`invalid render job: ${reason}`, { status: 400 });
    const body = parsed as RenderBody;
    if (!originAllowed(body.canvas.origin, o.allowedOrigins)) {
      return new Response(
        'canvas origin not in MAUDE_RENDER_CANVAS_ORIGINS — this service only renders from configured origins',
        { status: 403 }
      );
    }
    // An old cell sends no id: the job runs, it just cannot be followed or cancelled.
    const id = body.renderId ?? `internal-${crypto.randomUUID()}`;
    if (jobs.has(id)) return new Response('render id already in use', { status: 409 });

    console.error(
      `[maude-render] job received: format=${body.format} targets=${body.targets.length}`
    );
    const entry: Entry = { state: 'waiting', controller: new AbortController(), cancelled: false };
    jobs.set(id, entry);
    const releases: Release[] = [];
    const busy = () =>
      new Response('render service busy', { status: 503, headers: { 'retry-after': '10' } });
    const cancelled = () => new Response('render cancelled', { status: 409 });
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let proxy: ReturnType<typeof startProxy> | undefined;
    let scratch: string | undefined;
    try {
      if (VIDEO_FORMATS.has(body.format)) {
        const v = await videoLane.acquire(entry.controller.signal);
        if (v === null) return busy();
        if (v === 'aborted') return cancelled();
        releases.push(v);
      }
      const g = await lane.acquire(entry.controller.signal);
      if (g === null) return busy();
      if (g === 'aborted') return cancelled();
      releases.push(g);
      entry.state = 'running';

      proxy = startProxy(body.canvas);
      // Throwaway roots: the adapters only need a place for their tmp captures — this process holds
      // no tenant checkout (DDR-230 §1) and never will.
      scratch = await mkdtemp(path.join(tmpdir(), 'maude-render-'));
      timer = setTimeout(() => {
        timedOut = true;
        entry.controller.abort();
      }, timeoutMs);
      const res = await o.run(
        body.format,
        body.targets,
        cloudRenderOptions(body.format, body.options ?? {}, o.videoMaxScale),
        {
          designRoot: scratch,
          repoRoot: scratch,
          serverOrigin: proxy.origin,
          tokensCssRel: body.canvas.tokensCssRel,
          componentsCssRel: body.canvas.componentsCssRel,
        },
        {
          signal: entry.controller.signal,
          onProgress: (p) => {
            const next = clampProgress(p);
            if (next) entry.progress = next;
          },
        }
      );
      return new Response(res.body as unknown as BodyInit, {
        headers: {
          'content-type': res.contentType,
          'x-maude-filename': res.filename,
          // base64 — the degradation reason is free text, and a raw JSON value in an HTTP header is
          // Latin-1-only: a `—` in the reason 500'd an otherwise-successful (degraded) render.
          ...(res.degraded
            ? {
                'x-maude-degraded': Buffer.from(JSON.stringify(res.degraded), 'utf8').toString(
                  'base64'
                ),
              }
            : {}),
        },
      });
    } catch (err) {
      if (entry.cancelled) return cancelled();
      const msg = err instanceof Error ? err.message : String(err);
      // Attach the proxy's per-request log so a stuck canvas load is diagnosable from the export
      // dialog (the container's own logs are unreachable here).
      const trail = proxy?.log();
      return new Response(`render failed: ${msg}${trail ? `\n\n[canvas proxy] ${trail}` : ''}`, {
        status: timedOut ? 504 : 500,
      });
    } finally {
      if (timer) clearTimeout(timer);
      proxy?.stop();
      jobs.delete(id);
      for (const r of releases.reverse()) r();
      if (scratch) void rm(scratch, { recursive: true, force: true }).catch(() => {});
    }
  }

  function handleStatus(req: Request, url: URL): Response {
    if (!authorized(req)) return new Response('unauthorized', { status: 401 });
    const id = url.searchParams.get('id') ?? '';
    const entry = RENDER_ID_RE.test(id) ? jobs.get(id) : undefined;
    if (!entry) return new Response('not found', { status: 404 });
    return Response.json({
      state: entry.state,
      ...(entry.progress ? { progress: entry.progress } : {}),
    });
  }

  async function handleCancel(req: Request): Promise<Response> {
    if (!authorized(req)) return new Response('unauthorized', { status: 401 });
    let id = '';
    try {
      const b = (await req.json()) as { id?: unknown };
      id = typeof b?.id === 'string' ? b.id : '';
    } catch {
      return new Response('invalid JSON', { status: 400 });
    }
    const entry = RENDER_ID_RE.test(id) ? jobs.get(id) : undefined;
    if (!entry) return new Response('not found', { status: 404 });
    entry.cancelled = true;
    entry.controller.abort();
    return Response.json({ cancelled: true });
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/_health') {
      // Version + posture, no tenant data ever. `configured` says whether this instance can accept
      // work at all — the fleet check reads it.
      return Response.json({
        ok: true,
        app: 'maude-render',
        version: o.version ?? 'dev',
        configured: Boolean(o.secret) && o.allowedOrigins.length > 0,
        ...counts(),
      });
    }
    if (url.pathname === '/render' && req.method === 'POST') return handleRender(req);
    if (url.pathname === '/_render/status' && req.method === 'GET') return handleStatus(req, url);
    if (url.pathname === '/_render/cancel' && req.method === 'POST') return handleCancel(req);
    return new Response('not found', { status: 404 });
  }

  return { fetch, counts };
}
