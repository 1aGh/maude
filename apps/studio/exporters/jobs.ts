// Background export job queue (feature-background-export-notification-center).
//
// Turns the previously-synchronous `POST /_api/export` into a backgroundable
// operation: `enqueue()` returns immediately with a job id + a Promise that
// resolves with the same `ExportResult` the old synchronous call produced, so
// `/_api/export` stays byte-for-byte contract-unchanged (it just awaits the
// Promise). `POST /_api/export-jobs` returns the id WITHOUT awaiting, and the
// job progresses queued → running → done|failed in the background, emitting
// `bus.emit('export:job', job)` on every transition so ws.ts can broadcast a
// live snapshot to the notification center.
//
// Concurrency is capped by a small hand-rolled counting semaphore (same
// "no new dependency" convention as `writeLocator()` in http.ts) so N
// Playwright/Chromium-heavy renders don't all launch at once — MAUDE_EXPORT_
// MAX_CONCURRENT (default 2) lets a quick PNG start while a slow PDF/video is
// still running, without letting an unbounded number of Chromiums spawn.
//
// History persistence: the in-memory `jobs` Map IS the source of truth. The
// on-disk `_export-history.json` ledger is re-derived from it (done/failed
// jobs, newest-first, capped) and overwritten in one shot on every
// completion — no read-modify-write, so concurrent completions can't drop
// entries (the race the old api.ts loadExportHistory/appendExportHistory
// pair had). The ledger is seeded from disk once at construction so history
// survives a server restart even though job state itself doesn't.

import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { readAllArtboardPrintProps } from '../canvas-edit.ts';

import type { Bus } from '../context.ts';
import { currentSession, normalizeSessionKey } from '../session-scope.ts';
import { resolveRenderLane } from '../workspace-mode.ts';
import {
  type ExportContext,
  type ExportDegradation,
  type ExportOptions,
  type ExportResult,
  type Format,
  runExport,
  type Scope,
} from './index.ts';
import {
  formatNeedsBrowser,
  NoRenderServiceError,
  REMOTE_UNSUPPORTED_FORMATS,
  REMOTE_UNSUPPORTED_MESSAGE,
  type RemoteCanvasAccess,
  renderRemotely,
  resolveRenderService,
} from './remote.ts';
import { type ResolveScopeArgs, resolveScope, type Target } from './scope.ts';
import { scanUnsupportedMedia } from './unsupported-media.ts';

/** Extended shape of the old Phase 6.5 T10 history entry — additive fields only. */
export interface ExportHistoryEntry {
  format: string;
  scope: string;
  options?: Record<string, unknown>;
  filename: string;
  at: string;
  id?: string;
  status?: 'done' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Present when the export produced less than was asked for (e.g. muted mp4). */
  degraded?: ExportDegradation;
  /**
   * DDR-231 Phase 2 T6 — the browser lane captured and saved this export in
   * the member's OWN browser; the cell holds no bytes for it. Present so the
   * Recent tab and the notification center can list it without offering a
   * download that would 404.
   */
  deliveredInBrowser?: boolean;
}

export type ExportJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ExportJob {
  id: string;
  format: Format;
  scope: Scope;
  options: ExportOptions;
  status: ExportJobStatus;
  progress?: { current: number; total: number };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  filename?: string;
  contentType?: string;
  error?: string;
  /**
   * Set when the export finished but produced less than was asked for. `status`
   * stays `done` (the file is real); this is what tells the UI, the WS
   * subscriber and the history ledger that it is not a clean result.
   * RCA `issue-mp4-audio-export-html5audio-silent-degrade`.
   */
  degraded?: ExportDegradation;
  /** DDR-231 browser lane — produced and saved in the member's own browser;
   * this process stores no bytes for it. See {@link ExportHistoryEntry}. */
  deliveredInBrowser?: boolean;
}

export interface EnqueueArgs {
  format: Format;
  scope: Scope;
  options: ExportOptions;
  resolve: Omit<ResolveScopeArgs, 'scope'>;
  ctx: ExportContext;
  /**
   * feature-cloud-export-render-workers (DDR-230) — how the render service
   * reaches this project's canvas when the job dispatches remotely: the
   * PUBLIC canvas origin plus the requesting member's own render token,
   * forwarded from the enqueue request. Absent on a desktop, where the lane
   * is `local` and this is never read.
   */
  remoteCanvas?: RemoteCanvasAccess;
  /**
   * V2-2.8 S5 — whose job this is: the proxy-vouched session key of the member
   * who asked (session-scope.ts). Defaults to the ambient request's session;
   * `''` (desktop, CLI, tests) is the one shared owner a desktop always had.
   */
  session?: string;
}

export type DownloadResult =
  | { ok: true; bytes: Uint8Array; filename: string; contentType: string }
  | { ok: false; reason: 'missing' | 'not-done' };

/**
 * V2-2.8 S5 (V2-1.16 L7 "everyone-fix") — every read below is scoped to ONE
 * owner: the `session` argument, defaulting to the ambient request's session
 * key (session-scope.ts `currentSession()`, set per request by server.ts
 * `withSession`). A cell serves every member from one process (DDR-209), and
 * these used to answer with every member's jobs. An invisible job answers
 * exactly like a missing one (U1). On a desktop every key is `''`, so the
 * answers are unchanged.
 */
export interface ExportJobQueue {
  enqueue(args: EnqueueArgs): { id: string; result: Promise<ExportResult> };
  /**
   * Record an export the MEMBER'S BROWSER produced and saved (DDR-231 browser
   * lane) so it appears in the same ledger every other export does. No bytes
   * are kept — the file never passed through this process.
   */
  recordBrowserExport(args: {
    format: Format;
    scope: Scope;
    filename: string;
    session?: string;
  }): ExportHistoryEntry;
  get(id: string, session?: string): ExportJob | undefined;
  list(session?: string): ExportJob[];
  loadHistory(session?: string): ExportHistoryEntry[];
  getBytes(id: string, session?: string): Promise<DownloadResult>;
}

const HISTORY_DEPTH = 20;
const MAX_JOB_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_JOB_TIMEOUT_MS = 5 * 60 * 1000;

// Video/animation exports run a per-frame capture loop, so they legitimately
// take far longer than the 5-min default that's fine for image exports. The
// fast one-pass renderMediaOnWeb path is quick, but a comp that can't use it —
// e.g. it overflows @remotion/web-renderer's recursive precompositing (RCA
// issue-video-mp4-rendermediaonweb-stack-overflow) — degrades to frame-step
// screenshots at ~1.5–2 s/frame (2× scale). A 900-frame comp then runs 20–30
// min, so the image default would abort it mid-render (the "Target page closed
// at frame ~180/900" failure). Size the budget to the WORK — a generous
// per-frame estimate × the frame count — clamped to [5 min, 60 min]. The lower
// bound is deliberately the same 5 min as image exports (not a flat 30 min): a
// tiny clip that WEDGES shouldn't hold a scarce render slot for half an hour,
// and a security review flagged that a hostile comp which reliably overflows
// the renderer could otherwise turn a fast-fail into a long slot occupation.
// The upper bound is a runaway backstop. MAUDE_EXPORT_VIDEO_TIMEOUT_MS overrides
// end-to-end for renders bigger than the ceiling (e.g. if MAX_FRAMES is raised)
// — it DELIBERATELY bypasses the 60-min cap, since removing the backstop is the
// whole point of an operator escape hatch (trusted env, not attacker-reachable).
const VIDEO_FORMATS = new Set(['mp4', 'webm', 'gif']);
const VIDEO_TIMEOUT_MIN_MS = 5 * 60 * 1000; // 5 min — same baseline as image exports
const VIDEO_TIMEOUT_CEIL_MS = 60 * 60 * 1000; // 60 min hard ceiling (runaway backstop)
const VIDEO_PER_FRAME_BUDGET_MS = 2500; // ~2.5 s/frame — covers the slow frame-step path up to 3× scale
const VIDEO_SETUP_BUDGET_MS = 60 * 1000; // boot + goto + renderMediaOnWeb attempt before fallback

/** Wall-clock render budget for a job — sized to the frame count for video, 5 min otherwise. */
function jobTimeoutMs(args: EnqueueArgs): number {
  if (!VIDEO_FORMATS.has(args.format)) return DEFAULT_JOB_TIMEOUT_MS;
  // Operator escape hatch — intentionally uncapped (see note above).
  const envOverride = Number(process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS);
  if (Number.isFinite(envOverride) && envOverride > 0) return envOverride;
  const o = args.options ?? {};
  const fps = Number(o.fps) || 30;
  const explicitFrames = Number(o.frames);
  const durationMs = Number(o.durationMs);
  const frames =
    Number.isFinite(explicitFrames) && explicitFrames > 0
      ? explicitFrames
      : Number.isFinite(durationMs) && durationMs > 0
        ? Math.round((durationMs / 1000) * fps)
        : 900; // no duration hint → assume the frame cap (worst case)
  const est = VIDEO_SETUP_BUDGET_MS + frames * VIDEO_PER_FRAME_BUDGET_MS;
  return Math.min(VIDEO_TIMEOUT_CEIL_MS, Math.max(VIDEO_TIMEOUT_MIN_MS, est));
}

/**
 * Security fan-out finding (defender, /flow:done) — MEDIUM: `enqueue()` had
 * no cap on queued/running jobs, so a flood of `POST /_api/export-jobs`
 * (unauthenticated same-origin-omitted-Origin callers pass `sameOriginWrite`)
 * could grow the in-memory Map and fill `_export-jobs/` on disk unbounded —
 * the old synchronous `/_api/export` had natural backpressure (one render at
 * a time from the client's own perspective) that the background queue
 * removed. `MAX_PENDING` bounds queued+running jobs; `enqueue()` throws
 * `ExportQueueFullError` past it and http.ts maps that to 429.
 */
const MAX_PENDING = Math.max(1, Number(process.env.MAUDE_EXPORT_MAX_QUEUED) || 20);

/** Thrown by `enqueue()` when `MAX_PENDING` queued/running jobs are already in flight. */
export class ExportQueueFullError extends Error {
  constructor() {
    super('export queue is full — too many pending exports, try again shortly');
    this.name = 'ExportQueueFullError';
  }
}

/** Small counting semaphore — no new dependency, mirrors writeLocator()'s style. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      const next = this.waiters.shift();
      if (next) next();
    };
  }
}

function isFinished(job: ExportJob): boolean {
  return job.status === 'done' || job.status === 'failed';
}

/**
 * Resolve a client-influenced canvas `file` to an absolute path INSIDE the
 * design root, following symlinks (security review F2). `file` originates from
 * `options.canvasFile`/`selection.file` — a viewer picks it — so the floor is
 * the DESIGN root (not the whole checkout: no `.git`/`.env`/sibling files), the
 * containment is re-checked AFTER `realpathSync` (a `startsWith` string prefix
 * alone is escaped by an in-checkout symlink), and only `.tsx`/`.html` canvas
 * files are eligible. Returns null on any failure — the reader then contributes
 * nothing, exactly as an unreadable canvas does.
 */
function safeCanvasAbs(
  repoRoot: string | undefined,
  designRoot: string | undefined,
  file: string
): string | null {
  if (!repoRoot || !designRoot) return null;
  if (!/\.(tsx|html)$/i.test(file)) return null;
  let designReal: string;
  let abs: string;
  try {
    designReal = realpathSync(path.resolve(designRoot));
    // `file` is REPO-relative (it carries the `.design/` prefix) — resolve
    // against repoRoot, then require the realpath sits under the DESIGN root.
    abs = realpathSync(path.resolve(repoRoot, file));
  } catch {
    return null;
  }
  return abs === designReal || abs.startsWith(designReal + path.sep) ? abs : null;
}

/** The cell-side `scanUnsupportedMedia` for a remote video job — the first
 * element target's canvas (video renders one artboard). */
function readUnsupportedMediaFor(
  targets: Target[],
  repoRoot: string | undefined,
  designRoot: string | undefined
) {
  const t = targets.find((x) => x.kind === 'element');
  if (!t || t.kind !== 'element') return [];
  const abs = safeCanvasAbs(repoRoot, designRoot, t.file);
  return abs ? scanUnsupportedMedia(abs) : [];
}

/**
 * `{ [repoRelativeCanvasFile]: { [artboardId]: print } }` for every canvas an
 * element target names — what exporters/pdf.ts reads as `options.printProps`
 * when it renders on the worker. Read from the cell's own checkout; a canvas
 * that won't parse or has no print artboard contributes nothing.
 */
function readPrintPropsFor(
  targets: Target[],
  repoRoot: string | undefined,
  designRoot: string | undefined
): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const t of targets) {
    if (t.kind !== 'element' || out[t.file]) continue;
    const abs = safeCanvasAbs(repoRoot, designRoot, t.file);
    if (!abs) continue;
    try {
      const props = readAllArtboardPrintProps(abs, readFileSync(abs, 'utf8'));
      if (Object.keys(props).length) out[t.file] = props;
    } catch {
      /* unreadable canvas — the adapter treats it as non-print, same as local */
    }
  }
  return out;
}

export function createExportJobQueue(bus: Bus, designRoot: string): ExportJobQueue {
  const jobsDir = path.join(designRoot, '_export-jobs');
  const historyPath = path.join(designRoot, '_export-history.json');
  const maxConcurrent = Math.max(1, Number(process.env.MAUDE_EXPORT_MAX_CONCURRENT) || 2);
  const semaphore = new Semaphore(maxConcurrent);
  const jobs = new Map<string, ExportJob>();
  // V2-2.8 S5 — job id → the session key that asked for it. Kept beside the job
  // rather than on it so no response, socket frame or public ledger row ever
  // carries a session key; only the on-disk ledger stores it (as `session`).
  const owners = new Map<string, string>();
  const ownerOf = (id: string): string => owners.get(id) ?? '';
  const ownedBy = (session: string) => (job: ExportJob) => ownerOf(job.id) === session;

  // Seed the ledger from disk ONCE — the only read of the history file. Every
  // later persist derives fresh from `jobs` and overwrites; there is no
  // subsequent read-then-write step, which is what eliminates the race.
  try {
    const raw = readFileSync(historyPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const id = typeof e.id === 'string' && e.id ? e.id : crypto.randomUUID();
        const finishedAt =
          typeof e.finishedAt === 'string'
            ? e.finishedAt
            : typeof e.at === 'string'
              ? e.at
              : undefined;
        jobs.set(id, {
          id,
          format: e.format as Format,
          scope: e.scope as Scope,
          options: (e.options as ExportOptions) ?? {},
          status: e.status === 'failed' ? 'failed' : 'done',
          createdAt: (e.startedAt as string) ?? finishedAt ?? new Date().toISOString(),
          startedAt: e.startedAt as string | undefined,
          finishedAt,
          filename: e.filename as string | undefined,
          error: e.error as string | undefined,
        });
        // V2-2.8 S5 — a row written before ownership existed has no `session`
        // and stays the shared ('') owner's, which in a cell is nobody.
        const owner = normalizeSessionKey(typeof e.session === 'string' ? e.session : '');
        if (owner) owners.set(id, owner);
      }
    }
  } catch {
    /* no ledger yet, or unreadable — start empty */
  }

  // Orphaned `_export-jobs/*` dirs from a process that died mid-export — job
  // state is in-memory only and doesn't survive a restart, so anything on
  // disk from a prior run is stale. Best-effort, never blocks boot — but a
  // job's byte write waits for it: a zip finishes in milliseconds, and an
  // unawaited sweep landing after that write deleted the fresh job's bytes
  // (a 404 on download, seen on Linux CI).
  const staleSwept: Promise<void> = rm(jobsDir, { recursive: true, force: true })
    .catch(() => {})
    .then(() => mkdir(jobsDir, { recursive: true }).catch(() => {}))
    .then(() => {});

  function emit(job: ExportJob): void {
    // V2-2.8 S5 — the socket push goes to the owner's shell only (ws.ts honours
    // `meta.session`); a desktop job (owner '') still reaches every socket.
    const owner = ownerOf(job.id);
    bus.emit('export:job', { ...job }, owner ? { session: owner } : undefined);
  }

  /** `filter` scopes the PUBLIC view; the on-disk ledger passes none. */
  function deriveHistory(filter?: (job: ExportJob) => boolean): ExportHistoryEntry[] {
    return Array.from(jobs.values())
      .filter(isFinished)
      .filter((j) => (filter ? filter(j) : true))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''))
      .slice(0, HISTORY_DEPTH)
      .map((j) => ({
        id: j.id,
        format: j.format,
        scope: j.scope,
        options: j.options,
        filename: j.filename ?? '',
        at: j.finishedAt ?? j.createdAt,
        status: j.status as 'done' | 'failed',
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        error: j.error,
        // A muted mp4 must not look like a clean one in the ledger either — the
        // history entry is what a later session (or an agent) reads back.
        degraded: j.degraded,
        deliveredInBrowser: j.deliveredInBrowser,
      }));
  }

  async function persistAndEvict(): Promise<void> {
    // The ledger keeps every member's rows, each with its owner (`session`,
    // only when there is one — a desktop ledger is byte-for-byte unchanged), so
    // ownership survives a restart. It is runtime state (DDR-115), never served
    // as-is: GET /_api/export-history reads `loadHistory(session)` instead.
    const history = deriveHistory().map((entry) => {
      const owner = entry.id ? ownerOf(entry.id) : '';
      return owner ? { ...entry, session: owner } : entry;
    });
    await Bun.write(historyPath, JSON.stringify(history, null, 2));

    const now = Date.now();

    // BYTE eviction is ranked among jobs that HAVE bytes on disk — never driven
    // by browser-lane rows. A `deliveredInBrowser` row (recordBrowserExport)
    // holds no bytes and is reachable by a viewer, so counting it toward the
    // FIFO-`HISTORY_DEPTH` window would let a viewer flood fake rows and push a
    // real member's not-yet-downloaded PDF/video past the cap — deleting its
    // bytes (security review F2: an append that was secretly a delete
    // primitive). The two concerns are now separate: the ledger above is a
    // display list; this is GC of real artifacts only.
    const withBytes = Array.from(jobs.values())
      .filter((j) => isFinished(j) && !j.deliveredInBrowser && j.filename)
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
    const staleBytes = withBytes.filter((j, i) => {
      if (i >= HISTORY_DEPTH) return true;
      const finishedAt = j.finishedAt ? Date.parse(j.finishedAt) : Number.NaN;
      return Number.isFinite(finishedAt) && now - finishedAt > MAX_JOB_AGE_MS;
    });
    for (const job of staleBytes) {
      jobs.delete(job.id);
      owners.delete(job.id);
      await rm(path.join(jobsDir, job.id), { recursive: true, force: true }).catch(() => {});
    }

    // In-memory record eviction for the byte-free rows (browser-lane +
    // aged/over-cap finished jobs whose bytes are already gone) — bound the Map
    // so the ledger's own history depth caps memory. No disk to remove.
    const byteless = Array.from(jobs.values())
      .filter((j) => isFinished(j) && (j.deliveredInBrowser || !j.filename))
      .sort((a, b) => (b.finishedAt ?? '').localeCompare(a.finishedAt ?? ''));
    for (const job of byteless.slice(HISTORY_DEPTH)) {
      jobs.delete(job.id);
      owners.delete(job.id);
    }
  }

  function enqueue(args: EnqueueArgs): { id: string; result: Promise<ExportResult> } {
    let pending = 0;
    for (const job of jobs.values()) {
      if (job.status === 'queued' || job.status === 'running') pending += 1;
    }
    if (pending >= MAX_PENDING) throw new ExportQueueFullError();

    const id = crypto.randomUUID();
    const job: ExportJob = {
      id,
      format: args.format,
      scope: args.scope,
      options: args.options,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    const owner = normalizeSessionKey(args.session ?? currentSession());
    if (owner) owners.set(id, owner);
    jobs.set(id, job);
    emit(job);

    const controller = new AbortController();

    // DDR-230 — where this job renders. `local` is the pre-render-workers
    // spine, byte-identical. In a workspace the browser formats dispatch to
    // the maude-render service (`remote`) or refuse with a remedy (`none`);
    // browser-free formats (zip) run in-cell in every lane, because there is
    // nothing to evaluate. Resolved per job, not per process, so tests can
    // exercise the lanes without a reboot.
    const lane = resolveRenderLane();
    const dispatchRemote = lane !== 'local' && formatNeedsBrowser(args.format);
    console.error(
      `[jobs] ${args.format}: lane=${lane} dispatchRemote=${dispatchRemote} (renderUrl=${process.env.MAUDE_RENDER_URL ? 'set' : 'unset'})`
    );

    const result = (async (): Promise<ExportResult> => {
      // Fail BEFORE taking a render slot: a job that can never render must not
      // queue behind ones that can, and the refusal message is the remedy the
      // export dialog shows (belt to the client's own lane gate).
      const laneRefusal =
        lane !== 'local' && REMOTE_UNSUPPORTED_FORMATS.has(args.format)
          ? REMOTE_UNSUPPORTED_MESSAGE
          : dispatchRemote && lane === 'none'
            ? new NoRenderServiceError().message
            : null;
      if (laneRefusal) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = laneRefusal;
        emit(job);
        await persistAndEvict();
        throw new Error(laneRefusal);
      }
      const release = await semaphore.acquire();
      // Started here, not at enqueue — the timeout bounds RENDER time (the
      // intent), not queue-wait time. A job can legitimately sit `queued`
      // behind MAUDE_EXPORT_MAX_CONCURRENT other jobs for longer than its
      // render budget; arming the timer before the semaphore resolves would
      // abort it before it ever ran (code-review finding, /flow:done).
      const timer = setTimeout(() => controller.abort(), jobTimeoutMs(args));
      try {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        emit(job);

        // Scope resolves HERE, against the cell's own checkout — Target is
        // pure data, and the render service holds no tenant store to resolve
        // against (DDR-230 §1).
        const remoteTargets = dispatchRemote
          ? await resolveScope({ scope: args.scope, ...args.resolve, options: args.options })
          : [];
        const res = dispatchRemote
          ? await renderRemotely({
              format: args.format,
              targets: remoteTargets,
              // Same rule for anything ELSE the adapter would read off disk: a
              // print artboard's `print` prop (bleed, paper) lives in the canvas
              // source, which only this process has. Resolve it here and ship
              // it as data, or the worker's PDF silently loses its boxes/marks.
              options:
                args.format === 'pdf'
                  ? {
                      ...args.options,
                      printProps: readPrintPropsFor(
                        remoteTargets,
                        args.resolve.repoRoot,
                        args.resolve.designRoot
                      ),
                    }
                  : VIDEO_FORMATS.has(args.format)
                    ? {
                        ...args.options,
                        // The <Audio>/<OffthreadVideo> pre-flight reads the canvas
                        // source — same "only the cell has the checkout" rule.
                        unsupportedMedia: readUnsupportedMediaFor(
                          remoteTargets,
                          args.resolve.repoRoot,
                          args.resolve.designRoot
                        ),
                        // Ship the FULL frame-scaled render budget to the worker.
                        // The cell sizes jobTimeoutMs to the frame count (a 704-
                        // frame comp gets ~30 min), but the worker's shim caps
                        // renderMediaOnWeb + its hard-kill on `options.timeoutSec`,
                        // which defaulted to 60 s — so every real video fell back
                        // to frame-step after 60 s and then hard-killed at 150 s,
                        // long before a legitimate render could finish. Without
                        // this the worker never knows the job it was handed is
                        // allowed minutes, not seconds.
                        timeoutSec: Math.ceil(jobTimeoutMs(args) / 1000),
                      }
                    : args.options,
              canvas: args.remoteCanvas ?? { origin: '' },
              // resolveRenderService() is non-null on the `remote` lane by
              // construction (the lane IS the presence of MAUDE_RENDER_URL).
              service: resolveRenderService()!,
              signal: controller.signal,
            })
          : await runExport({
              format: args.format,
              scope: args.scope,
              options: args.options,
              resolve: args.resolve,
              ctx: args.ctx,
              hooks: {
                signal: controller.signal,
                onProgress: (update) => {
                  job.progress = update;
                  emit(job);
                },
              },
            });

        // Bytes land on disk BEFORE the job reads `done`. The other way round,
        // a poller saw `done` while the write was still in flight and its
        // download 404'd (Linux CI, exporters/jobs.test.ts).
        if (res.body.byteLength) {
          const dir = path.join(jobsDir, id);
          await staleSwept;
          await mkdir(dir, { recursive: true });
          await Bun.write(path.join(dir, res.filename), res.body);
        }
        job.status = 'done';
        job.finishedAt = new Date().toISOString();
        job.filename = res.filename;
        job.contentType = res.contentType;
        // `done` + `degraded` is a real, deliberate combination: the file exists
        // and is downloadable, but it is missing something that was asked for.
        // Before this, the ONLY trace of a muted mp4 was a console.error line in
        // the desktop app's stderr — see RCA
        // issue-mp4-audio-export-html5audio-silent-degrade.
        if (res.degraded) job.degraded = res.degraded;
        emit(job);
        await persistAndEvict();
        return res;
      } catch (err) {
        job.status = 'failed';
        job.finishedAt = new Date().toISOString();
        job.error = err instanceof Error ? err.message : String(err);
        emit(job);
        await persistAndEvict();
        throw err;
      } finally {
        clearTimeout(timer);
        release();
      }
    })();

    return { id, result };
  }

  return {
    enqueue,
    get(id, session = currentSession()) {
      const job = jobs.get(id);
      return job && ownerOf(id) === normalizeSessionKey(session) ? job : undefined;
    },
    list: (session = currentSession()) =>
      Array.from(jobs.values())
        .filter(ownedBy(normalizeSessionKey(session)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    recordBrowserExport({ format, scope, filename, session = currentSession() }) {
      const now = new Date().toISOString();
      const job: ExportJob = {
        id: crypto.randomUUID(),
        format,
        scope,
        options: {},
        status: 'done',
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        filename,
        deliveredInBrowser: true,
      };
      const owner = normalizeSessionKey(session);
      if (owner) owners.set(job.id, owner);
      jobs.set(job.id, job);
      emit(job);
      // Fire-and-forget: the member already HAS the file, so a slow ledger
      // write must not gate their UI, and a failed one must not fail an export
      // that already succeeded.
      void persistAndEvict().catch(() => {});
      return {
        id: job.id,
        format,
        scope,
        filename,
        at: now,
        status: 'done',
        startedAt: now,
        finishedAt: now,
        deliveredInBrowser: true,
      };
    },
    loadHistory: (session = currentSession()) =>
      deriveHistory(ownedBy(normalizeSessionKey(session))),
    async getBytes(id, session = currentSession()) {
      const job = jobs.get(id);
      // Another member's job answers exactly like a missing one (V2-1.16 U1).
      if (!job || ownerOf(id) !== normalizeSessionKey(session))
        return { ok: false, reason: 'missing' };
      if (job.status !== 'done') return { ok: false, reason: 'not-done' };
      if (!job.filename) return { ok: false, reason: 'missing' };
      const file = Bun.file(path.join(jobsDir, id, job.filename));
      if (!(await file.exists())) return { ok: false, reason: 'missing' };
      return {
        ok: true,
        bytes: new Uint8Array(await file.arrayBuffer()),
        filename: job.filename,
        contentType: job.contentType ?? 'application/octet-stream',
      };
    },
  };
}
