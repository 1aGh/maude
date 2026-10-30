// thumbs/service.ts — the thumbnail service (V2-2.17, contract V2-1.17 §5.8).
//
// `thumb()` answers from disk when the picture for the key exists (`ready`), otherwise queues a
// render and answers `pending` (later `/_ws {type:'thumb-ready', key}`), or `unavailable` with a
// reason. One renderer shim per project server (`bin/_thumbs-playwright.mjs`), started on the
// first job; the queue pauses while an export job runs.
//
// At boot (P8, 2026-10-29) the project server queues a background cover for every canvas whose
// cover is missing or stale (`bootCovers`). The Home server has no renderer, so without it a
// project opened before v2 kept grey covers on Home until someone opened its Canvases panel. A
// project whose covers are all fresh queues nothing and never starts the renderer.
//
// Security (§5.8 R1–R7; tests in test/thumbs-*.test.ts):
//   R1 renders only land on the read-only capture origin: the shim is handed a main-origin shell
//      URL built like every export's (`canvasShellUrl`), follows the 307, and asserts the final
//      origin is `captureOrigin()`. No capture origin (split off, or a cell) → nothing renders.
//   R2 keys, targets, sizes, URLs come from here; the shim's only accepted output is JPEG bytes
//      that `checkJpeg` validates against the size this service asked for.
//   R3 a separate Chromium process per project server, one non-persistent context.
//   R4/R5/R6 are the routes' (`thumbs/routes.ts`); `serves(key)` is R6's reference check.
//   R7 `enabled: false` (a cell) renders nothing and answers `no-engine`.

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { exportShimPath, resolveExportRuntime } from '../exporters/_runtime.ts';
import { canvasShellUrl } from '../exporters/index.ts';
import type { IndexService } from '../index/service.ts';
import type { ArtboardKind, ArtboardRow, CanvasRow } from '../index/types.ts';
import {
  assetKey,
  dsCssHash,
  fileHash,
  isSize,
  keyDepsHash,
  type LaneHashes,
  laneRels,
  liveLaneHashes,
  SIZE_PX,
  sameLanes,
  srcHashOf,
  type ThumbSize,
  thumbKey,
  versionLaneHashes,
} from './keys.ts';
import { hasThumb, pruneThumbs, readThumb, writeThumb } from './store.ts';
import { checkJpeg, jpegSize } from './validate.ts';

export type ThumbAt = 'now' | { rev: number } | { sha: string };
export interface ThumbRequest {
  canvas: string;
  artboard: string | null;
  at?: ThumbAt;
  size: ThumbSize;
  priority: 'visible' | 'background';
}
export type UnavailableReason = 'no-engine' | 'failed' | 'not-in-scope' | 'no-artboard';
export type ThumbResult =
  | { status: 'ready'; key: string; url: string; w: number; h: number }
  | { status: 'pending'; key: string }
  | { status: 'unavailable'; reason: UnavailableReason };

/** The renderer process, as the service sees it (tests substitute one). */
export interface ShimHandle {
  send(msg: Record<string, unknown>): void;
  onMessage(cb: (msg: Record<string, unknown>) => void): void;
  exited: Promise<number>;
  kill(): void;
}

export interface ThumbServiceOptions {
  pid: string;
  designRoot: string;
  index: Pick<IndexService, 'canvas' | 'snapshot' | 'mergeRuntime' | 'setCover'>;
  /** read per job: the shell links the DS CSS, the project theme keys the picture */
  config: () => { theme: string; tokensCssRel?: string; componentsCssRel?: string };
  /** the main origin (`http://localhost:<port>`) the shim's shell URL starts on */
  serverOrigin: () => string | undefined;
  /** the read-only capture origin a render must land on (R1); undefined = render nothing */
  captureOrigin: () => string | undefined;
  /** false in a cell (R7) */
  enabled?: boolean;
  /** true while an export job runs — the queue pauses */
  exportBusy?: () => boolean;
  /** a canvas source at a version (`{sha}` git, `{rev}` accepted revision); null = unreadable */
  readVersion?: (rel: string, at: { rev: number } | { sha: string }) => Promise<string | null>;
  /**
   * S1.11 — a canvas's same-name CSS / meta lane at a version, read from the SAME source the
   * historical build overlays it from (`serveHistoricalCanvas`'s `cssAt` / `metaAt`); null = the
   * version has no such lane. Wire it only together with that overlay: absent ⇒ the build uses
   * today's lanes and the key says so.
   */
  readVersionLane?: (
    rel: string,
    lane: 'css' | 'meta',
    at: { rev: number } | { sha: string }
  ) => Promise<string | null>;
  /**
   * The canvas's resolved-imports hash, read NOW (index/extract.ts `extractCanvas(..).depsHash`).
   * The index re-extracts a canvas only when the canvas itself changes, so its row's `depsHash`
   * goes stale when an imported module changes; without this, keys fall back to the row's value.
   */
  freshDepsHash?: (rel: string) => string | null;
  /** a picture landed (→ `/_ws {type:'thumb-ready', key}`) */
  onReady?: (key: string) => void;
  spawnShim?: () => ShimHandle;
  now?: () => number;
}

export interface ThumbService {
  thumb(req: ThumbRequest): Promise<ThumbResult>;
  assetTile(rel: string, size: ThumbSize): Promise<ThumbResult>;
  /** POST /_api/thumbs/want — raise these keys to `visible` (unknown keys are ignored) */
  want(keys: string[]): void;
  /** queue every canvas's cover in the background (the Canvases panel asks for it) */
  startBackground(): Promise<void>;
  /** boot: queue, at background priority, a cover for exactly the canvases whose cover is missing
   *  or stale (`cover == null || cover.ofSrc !== srcHash`, or its picture is gone). Waits up to
   *  `waitMs` (default 60 s) for the capture origin; resolves with the number of covers queued. */
  bootCovers(opts?: { delayMs?: number; waitMs?: number }): Promise<number>;
  /** R6: is this key one the snapshot (a cover) or a caller's request references? */
  serves(key: string): boolean;
  read(key: string): Uint8Array | null;
  /** queued + running jobs (diagnostics, tests) */
  pending(): number;
  /** resolves when the queue is empty (tests, the bench) */
  idle(): Promise<void>;
  probe(): Promise<Record<string, unknown> | null>;
  stop(): void;
}

interface Target {
  key: string;
  artboard: string | null;
  size: ThumbSize;
  px: number;
}
interface Job {
  id: string;
  kind: 'canvas' | 'tile';
  rel: string;
  /** `sha` / `r<rev>` for a version build, null for now */
  atParam: string | null;
  srcHash: string;
  /** the same-name CSS lane the key named (canvas jobs) */
  cssHash?: string | null;
  metaHash: string | null;
  depsHash: string;
  /** which lanes of a version build are today's files (they can change under the render) */
  liveLanes?: { css: boolean; meta: boolean };
  hasArtboards: boolean;
  targets: Target[];
  priority: 0 | 1;
  enqueuedAt: number;
  retryOfPartial?: boolean;
  video?: boolean;
}

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const VIDEO = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const ARTBOARD_KINDS = new Set<ArtboardKind>(['digital', 'print', 'web', 'video']);
const HIST_WINDOW_MS = 10_000;
const HIST_MAX = 12; // §5.8: ≤ 12 version renders per 10 s (serveHistoricalCanvas allows 24)
const MAX_PAGES = 4;
/** background jobs (the cover sweep, tiles) that render at once — the rest of the pages are for what is on screen */
const BACKGROUND_PAGES = 2;
/** the covers `startBackground` treats as on screen: Home's most recent shelf */
const FIRST_SCREEN = 12;
const MAX_FAILURES = 3;
const MAX_REFERENCED = 20_000;
const NO_BROWSER_EXIT = 3;

/** how long after boot the cover pass waits (the opening project's first paint goes first) */
export const BOOT_COVERS_DELAY_MS = 10_000;

const live = new Set<ThumbService>();
/** server.ts shutdown: kill every renderer (they also exit when their stdin closes). */
export function stopAllThumbs() {
  for (const s of live) s.stop();
}

export const unavailable = (reason: UnavailableReason): ThumbResult => ({
  status: 'unavailable',
  reason,
});

/** The real renderer process (exported for the budget bench, which wraps it to read timings). */
export function spawnRendererShim(): ShimHandle {
  // { cmd, env } together: the compiled-self rung only works with its BUN_BE_BUN (DDR-177).
  const runtime = resolveExportRuntime();
  const proc = Bun.spawn([runtime.cmd, exportShimPath('_thumbs-playwright.mjs')], {
    cwd: path.dirname(exportShimPath('_thumbs-playwright.mjs')),
    env: runtime.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const listeners: Array<(m: Record<string, unknown>) => void> = [];
  void (async () => {
    const reader = proc.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: '' }));
      if (done) break;
      buf += value;
      let nl = buf.indexOf('\n');
      while (nl !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          for (const cb of listeners) cb(msg);
        } catch {
          /* not ours */
        }
      }
    }
  })();
  void (async () => {
    const reader = proc.stderr.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: '' }));
      if (done) break;
      if (process.env.MAUDE_THUMBS_DEBUG) process.stderr.write(`[thumbs] ${value}`);
    }
  })();
  return {
    send(msg) {
      try {
        proc.stdin.write(`${JSON.stringify(msg)}\n`);
        proc.stdin.flush();
      } catch {
        /* exited — `exited` reports it */
      }
    },
    onMessage: (cb) => listeners.push(cb),
    exited: proc.exited,
    kill: () => {
      try {
        proc.stdin.end();
      } catch {
        /* closed */
      }
      proc.kill();
    },
  };
}

function readRecent(designRoot: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const raw = JSON.parse(
      readFileSync(path.join(designRoot, '_canvas-state', '_recent.json'), 'utf8')
    ) as unknown;
    const list = Array.isArray(raw) ? raw : (raw as { recent?: unknown })?.recent;
    if (Array.isArray(list))
      for (const r of list) {
        const rel = (r as { rel?: unknown })?.rel;
        const at = (r as { openedAt?: unknown })?.openedAt;
        if (typeof rel === 'string' && typeof at === 'number') out.set(rel, at);
      }
  } catch {
    /* none yet (V2-1.1 §5.5) */
  }
  return out;
}

/** `.meta.json` bits the renderer needs: Present order (C31) and video posters (S7). */
function metaHints(designRoot: string, rel: string) {
  let meta: Record<string, unknown> | null = null;
  try {
    meta = JSON.parse(
      readFileSync(path.join(designRoot, rel.replace(/\.tsx$/, '.meta.json')), 'utf8')
    ) as Record<string, unknown>;
  } catch {
    meta = null;
  }
  const order = (meta?.present as { order?: unknown } | undefined)?.order;
  const coverOrder = Array.isArray(order)
    ? order.filter((x): x is string => typeof x === 'string').slice(0, 500)
    : null;
  const posters: Record<string, number> = {};
  const am = meta?.artboardMeta;
  if (am && typeof am === 'object')
    for (const [id, v] of Object.entries(am as Record<string, unknown>).slice(0, 2000)) {
      const p = (v as { poster?: unknown })?.poster;
      if (typeof p === 'number' && Number.isFinite(p) && p >= 0) posters[id] = Math.trunc(p);
    }
  return { coverOrder, posters };
}

function sanitizeRuntime(raw: unknown): ArtboardRow[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ArtboardRow[] = [];
  const seen = new Set<string>();
  for (const a of raw.slice(0, 2000)) {
    const r = a as Record<string, unknown>;
    if (typeof r?.id !== 'string' || !r.id || r.id.length > 128 || seen.has(r.id)) continue;
    seen.add(r.id);
    const n = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v) : null;
    rows.push({
      id: r.id,
      label: typeof r.label === 'string' ? r.label.slice(0, 200) : null,
      kind: ARTBOARD_KINDS.has(r.kind as ArtboardKind) ? (r.kind as ArtboardKind) : null,
      w: n(r.w),
      h: n(r.h),
    });
  }
  return rows;
}

const sameArtboards = (a: ArtboardRow[], b: ArtboardRow[]) =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      x.id === b[i]?.id &&
      x.w === b[i]?.w &&
      x.h === b[i]?.h &&
      x.kind === b[i]?.kind &&
      x.label === b[i]?.label
  );

export function createThumbService(o: ThumbServiceOptions): ThumbService {
  const now = o.now ?? Date.now;
  const enabled = o.enabled ?? true;
  const queue = new Map<string, Job>();
  const running = new Set<Job>();
  const keyJob = new Map<string, Job>();
  const failures = new Map<string, number>();
  const noArtboard = new Set<string>();
  const dims = new Map<string, { w: number; h: number }>();
  const referenced = new Set<string>();
  const histStarts: number[] = [];
  const idleWaiters: Array<() => void> = [];
  let shim: ShimHandle | null = null;
  let engineMissing = false;
  let seq = 0;
  const inflight = new Map<number, (m: Record<string, unknown>) => void>();
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  let background = false;
  let stopped = false;
  let writes = 0;

  const reference = (key: string) => {
    referenced.delete(key);
    referenced.add(key);
    if (referenced.size > MAX_REFERENCED) {
      const first = referenced.values().next().value;
      if (first !== undefined) referenced.delete(first);
    }
  };

  /**
   * p8-sweep-errors — name a canvas's new cover. The key it replaces stays servable (R6: this project's own picture
   * of a moment ago) while its file is on disk: a row that read the index before the swap mounts its <img> with the
   * old key, and would otherwise get a 404 for a picture that is still here.
   */
  const setCover = (rel: string, cover: Parameters<typeof o.index.setCover>[1]) => {
    const was = o.index.canvas(rel)?.cover?.key;
    if (was && was !== cover.key) reference(was);
    o.index.setCover(rel, cover);
  };

  function readyDims(key: string) {
    // the file is the truth (retention prunes it): the memo only saves re-reading its header
    if (!hasThumb(o.pid, key)) {
      dims.delete(key);
      return null;
    }
    const d = dims.get(key);
    if (d) return d;
    const bytes = readThumb(o.pid, key);
    const size = bytes ? jpegSize(bytes) : null;
    if (size) dims.set(key, size);
    return size;
  }

  function ensureShim(): ShimHandle | null {
    if (shim) return shim;
    if (engineMissing) return null;
    try {
      shim = (o.spawnShim ?? spawnRendererShim)();
    } catch {
      engineMissing = true; // no node/bun to run it (resolveExportRuntime threw)
      return null;
    }
    const mine = shim;
    mine.onMessage((m) => {
      const id = typeof m.id === 'number' ? m.id : -1;
      const done = inflight.get(id);
      if (done) {
        inflight.delete(id);
        done(m);
      }
    });
    void mine.exited.then((code) => {
      if (shim === mine) shim = null;
      if (code === NO_BROWSER_EXIT) engineMissing = true; // `launchChromium`: no browser, no download
      for (const [id, done] of inflight) {
        inflight.delete(id);
        done({ id, ok: false, error: code === NO_BROWSER_EXIT ? 'no-engine' : 'exited' });
      }
    });
    return mine;
  }

  function request(msg: Record<string, unknown>, timeoutMs: number) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const s = ensureShim();
      if (!s) return resolve({ ok: false, error: 'no-engine' });
      const id = ++seq;
      const timer = setTimeout(() => {
        inflight.delete(id);
        resolve({ id, ok: false, error: 'timeout' });
      }, timeoutMs);
      inflight.set(id, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      s.send({ ...msg, id });
    });
  }

  function historicalAllowed(): boolean {
    const t = now();
    while (histStarts.length && t - (histStarts[0] as number) >= HIST_WINDOW_MS) histStarts.shift();
    return histStarts.length < HIST_MAX;
  }

  function schedulePump(ms: number) {
    if (pumpTimer || stopped) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, ms);
    pumpTimer.unref?.();
  }

  function settleIdle() {
    if (queue.size === 0 && running.size === 0) for (const w of idleWaiters.splice(0)) w();
  }

  function pump() {
    if (stopped) return;
    if (o.exportBusy?.()) return schedulePump(500); // an export owns the machine: wait
    const ordered = [...queue.values()].sort(
      (a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt
    );
    for (const job of ordered) {
      if (running.size >= MAX_PAGES) break;
      if (
        job.priority === 1 &&
        [...running].filter((r) => r.priority === 1).length >= BACKGROUND_PAGES
      )
        continue;
      if (job.atParam !== null) {
        if (!historicalAllowed()) {
          schedulePump(1000);
          continue;
        }
        histStarts.push(now());
      }
      queue.delete(job.id);
      running.add(job);
      void run(job).finally(() => {
        running.delete(job);
        for (const t of job.targets) if (keyJob.get(t.key) === job) keyJob.delete(t.key);
        pump();
        settleIdle();
      });
    }
    settleIdle();
  }

  function enqueue(job: Omit<Job, 'enqueuedAt'>) {
    const existing = queue.get(job.id);
    if (existing) {
      for (const t of job.targets)
        if (!existing.targets.some((x) => x.key === t.key)) {
          existing.targets.push(t);
          keyJob.set(t.key, existing);
        }
      if (job.priority < existing.priority) existing.priority = job.priority;
    } else {
      const full: Job = { ...job, enqueuedAt: now() };
      queue.set(job.id, full);
      for (const t of full.targets) keyJob.set(t.key, full);
    }
    pump();
  }

  function fail(key: string) {
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }

  /** The inputs the key named are still the inputs on disk (a change mid-render re-keys). */
  function stillCurrent(job: Job): boolean {
    const row = o.index.canvas(job.rel);
    if (!row) return false;
    if (depsOf(row) !== job.depsHash) return false;
    const abs = path.join(o.designRoot, job.rel);
    // a version's own lanes are immutable; only the lanes it took from today can move
    const live = job.atParam === null ? { css: true, meta: true } : job.liveLanes;
    const today = liveLaneHashes(o.designRoot, job.rel, { srcHash: '', metaHash: null });
    if ((live?.css ?? true) && today.cssHash !== (job.cssHash ?? null)) return false;
    const metaAbs = path.join(o.designRoot, laneRels(job.rel).meta);
    const meta = existsSync(metaAbs) ? srcHashOf(readFileSync(metaAbs, 'utf8')) : null;
    if ((live?.meta ?? true) && meta !== job.metaHash) return false;
    if (job.atParam !== null) return true; // a version's source is immutable
    try {
      return srcHashOf(readFileSync(abs, 'utf8')) === job.srcHash;
    } catch {
      return false;
    }
  }

  function store(job: Job, t: Target, b64: unknown): boolean {
    if (typeof b64 !== 'string' || b64.length > 2 * 1024 * 1024) return false;
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const check = checkJpeg(bytes, t.px);
    if (!check.ok) return false;
    writeThumb(o.pid, t.key, bytes);
    dims.set(t.key, { w: check.w, h: check.h });
    reference(t.key);
    if (job.kind === 'canvas' && t.artboard === null && t.size === 'card' && job.atParam === null)
      setCover(job.rel, { key: t.key, w: check.w, h: check.h, ofSrc: job.srcHash });
    if (++writes % 50 === 0) {
      const keep = new Set<string>();
      for (const c of o.index.snapshot().canvases) if (c.cover) keep.add(c.cover.key);
      pruneThumbs(o.pid, keep);
    }
    o.onReady?.(t.key);
    return true;
  }

  async function run(job: Job) {
    const server = o.serverOrigin();
    const capture = o.captureOrigin();
    if (!server || !capture) {
      for (const t of job.targets) fail(t.key);
      return;
    }
    const cfg = o.config();
    let reply: Record<string, unknown>;
    if (job.kind === 'tile') {
      const designRel = path.basename(o.designRoot);
      const t = job.targets[0] as Target;
      reply = await request(
        {
          op: 'tile',
          // gate-b-c4 — `frame` scopes the capture to the canvas the tile imports (access/frame.ts).
          url: `${server}/_canvas-shell.html?hide-chrome=1&frame=${encodeURIComponent(job.rel)}`,
          expectOrigin: capture,
          src: `/${designRel}/${job.rel.split('/').map(encodeURIComponent).join('/')}`,
          video: job.video === true,
          px: t.px,
        },
        15_000
      );
    } else {
      let url = canvasShellUrl(
        {
          designRoot: o.designRoot,
          repoRoot: path.dirname(o.designRoot),
          serverOrigin: server,
          tokensCssRel: cfg.tokensCssRel,
          componentsCssRel: cfg.componentsCssRel,
        },
        job.rel
      );
      if (job.atParam !== null) url += `&sha=${encodeURIComponent(job.atParam)}`;
      // A version picture shows ONE artboard: ask the canvas to mount only that one (canvas-lib
      // `thumbOnly`) — a 21-board canvas otherwise renders and loads the images of 20 boards that
      // are never shot. Only for a past version: today's render feeds the index its artboard list.
      const only = new Set(job.targets.map((t) => t.artboard));
      const [one] = [...only];
      if (job.atParam !== null && only.size === 1 && typeof one === 'string')
        url += `&thumb-only=${encodeURIComponent(one)}`;
      reply = await request(
        {
          op: 'render',
          url,
          expectOrigin: capture,
          hasArtboards: job.hasArtboards,
          // the artboards the index already knows: the renderer stops waiting for late ones at
          // this count (a version's own source can differ from today's, so only "now" is told)
          knownArtboards:
            job.atParam === null ? (o.index.canvas(job.rel)?.artboards.length ?? 0) : 0,
          deadlineMs: 20_000,
          ...metaHints(o.designRoot, job.rel),
          targets: job.targets.map((t) => ({ artboard: t.artboard, px: t.px })),
        },
        // readiness ≤ 20 s, then each shot (≤ 3 s images, ≤ 3 s poster, ≤ 10 s screenshot)
        30_000 + 1000 * job.targets.length
      );
    }
    if (reply.error === 'no-engine') engineMissing = true;
    if (reply.ok !== true) {
      // the shell refused or failed the mount (access/closure, a build error): the same source
      // fails the same way, and the key changes when it does — no retries to the failure cap
      const permanent = reply.error === 'canvas-failed';
      for (const t of job.targets) {
        if (permanent) failures.set(t.key, MAX_FAILURES);
        else fail(t.key);
      }
      return;
    }
    // re-keyed under us (an edit mid-render): store nothing — the next thumb() names the new key
    if (job.kind === 'canvas' && !stillCurrent(job)) return;
    if (job.kind === 'tile' && fileHash(path.join(o.designRoot, job.rel), 'full') !== job.srcHash)
      return;
    if (job.kind === 'canvas' && job.atParam === null && job.hasArtboards) {
      const rows = sanitizeRuntime((reply.runtime as { artboards?: unknown })?.artboards);
      const row = o.index.canvas(job.rel);
      if (rows?.length && row && !sameArtboards(row.artboards, rows))
        o.index.mergeRuntime(job.rel, job.srcHash, rows);
    }
    const shots = Array.isArray(reply.shots) ? (reply.shots as Record<string, unknown>[]) : [];
    let partial = false;
    for (const [i, t] of job.targets.entries()) {
      const shot = shots.find((s) => s?.target === i);
      if (shot?.missing === true) {
        noArtboard.add(t.key);
        continue;
      }
      if (!shot || !store(job, t, shot.jpeg)) fail(t.key);
      else if (shot.partial === true) partial = true;
    }
    if (partial && !job.retryOfPartial)
      enqueue({ ...job, id: `${job.id}#partial`, priority: 1, retryOfPartial: true });
  }

  /** the key's depsHash: the canvas's imports as they are now + the DS CSS the shell links */
  function depsOf(row: CanvasRow): string {
    const cfg = o.config();
    return keyDepsHash(
      o.freshDepsHash?.(row.rel) ?? row.depsHash,
      dsCssHash(o.designRoot, cfg.tokensCssRel, cfg.componentsCssRel)
    );
  }

  async function keyInputs(row: CanvasRow, at: ThumbAt) {
    const cfg = o.config();
    const depsHash = depsOf(row);
    const today: LaneHashes = liveLaneHashes(o.designRoot, row.rel, row);
    if (at === 'now' || at === undefined)
      return {
        ...today,
        depsHash,
        atParam: null,
        liveLanes: undefined,
        theme: cfg.theme,
      };
    let atParam: string | null = null;
    if ('sha' in at && typeof at.sha === 'string' && /^[0-9a-f]{7,40}$/.test(at.sha))
      atParam = at.sha;
    if ('rev' in at && Number.isSafeInteger(at.rev) && at.rev >= 0) atParam = `r${at.rev}`;
    if (atParam === null || !o.readVersion) return null;
    const source = await o.readVersion(row.rel, at).catch(() => null);
    if (source === null) return null;
    // S1.11: the CSS / meta lanes the historical build overlays, from the same source it reads
    // them from. A lane read that fails is not "absent" — the build would then disagree with the
    // key — so it is unavailable, never a guess.
    const lane = async (name: 'css' | 'meta') => {
      if (!o.readVersionLane) return undefined; // overlay not wired: today's lane
      const rel = laneRels(row.rel)[name];
      return o.readVersionLane(rel, name, at).then(
        (t) => t,
        () => false as const
      );
    };
    const [css, meta] = await Promise.all([lane('css'), lane('meta')]);
    if (css === false || meta === false) return null;
    const version = versionLaneHashes({ tsx: source, css, meta }, today);
    // every lane the build uses equals today's: the same picture, no version build needed. A
    // version that differs ONLY in its CSS or meta is still a version — keyed and built as one.
    if (sameLanes(version, today)) atParam = null;
    return {
      srcHash: version.srcHash,
      cssHash: version.cssHash,
      metaHash: version.metaHash,
      depsHash,
      atParam,
      liveLanes: atParam === null ? undefined : version.live,
      theme: cfg.theme,
    };
  }

  const svc: ThumbService = {
    async thumb(req) {
      if (!enabled || stopped) return unavailable('no-engine');
      if (!req || typeof req.canvas !== 'string' || !isSize(req.size))
        return unavailable('not-in-scope');
      const artboard = req.artboard ?? null;
      if (artboard !== null && (typeof artboard !== 'string' || !artboard || artboard.length > 128))
        return unavailable('no-artboard');
      const row = o.index.canvas(req.canvas);
      if (!row) return unavailable('not-in-scope');
      const inputs = await keyInputs(row, req.at ?? 'now');
      if (!inputs) return unavailable('failed');
      const key = thumbKey({
        size: req.size,
        theme: inputs.theme,
        canvas: row.rel,
        artboard,
        srcHash: inputs.srcHash,
        cssHash: inputs.cssHash,
        metaHash: inputs.metaHash,
        depsHash: inputs.depsHash,
      });
      reference(key);
      const d = readyDims(key);
      if (d) return { status: 'ready', key, url: `/_api/thumb/${key}`, ...d };
      if (engineMissing || !o.captureOrigin() || !o.serverOrigin()) return unavailable('no-engine');
      if (noArtboard.has(key)) return unavailable('no-artboard');
      const f = failures.get(key) ?? 0;
      if (f >= MAX_FAILURES) return unavailable('failed');
      enqueue({
        // every lane in the id: a job only ever gathers targets keyed by the same inputs
        id: [
          row.rel,
          inputs.atParam ?? 'now',
          inputs.srcHash,
          inputs.cssHash ?? '-',
          inputs.metaHash ?? '-',
        ].join('\0'),
        kind: 'canvas',
        rel: row.rel,
        atParam: inputs.atParam,
        srcHash: inputs.srcHash,
        cssHash: inputs.cssHash,
        metaHash: inputs.metaHash,
        depsHash: inputs.depsHash,
        liveLanes: inputs.liveLanes,
        hasArtboards: row.hasArtboards,
        targets: [{ key, artboard, size: req.size, px: SIZE_PX[req.size] }],
        priority: req.priority === 'visible' ? 0 : 1,
      });
      return f > 0 ? unavailable('failed') : { status: 'pending', key };
    },

    async assetTile(rel, size) {
      if (!enabled || stopped) return unavailable('no-engine');
      if (typeof rel !== 'string' || !isSize(size)) return unavailable('not-in-scope');
      const norm = path.posix.normalize(rel);
      if (
        norm.startsWith('..') ||
        path.isAbsolute(norm) ||
        norm.split('/').some((s) => s.startsWith('_') || s.startsWith('.'))
      )
        return unavailable('not-in-scope');
      const abs = path.join(o.designRoot, norm);
      const st = statSync(abs, { throwIfNoEntry: false });
      const ext = path.extname(norm).toLowerCase();
      if (!st?.isFile()) return unavailable('not-in-scope');
      // SVG is scriptable (DDR-145), PDF/PSD/HEIC need S8's converters: the kind glyph
      if (!RASTER.has(ext) && !VIDEO.has(ext)) return unavailable('not-in-scope');
      const bytesSha = fileHash(abs, 'full');
      const key = assetKey(size, bytesSha);
      reference(key);
      const d = readyDims(key);
      if (d) return { status: 'ready', key, url: `/_api/thumb/${key}`, ...d };
      if (engineMissing || !o.captureOrigin() || !o.serverOrigin()) return unavailable('no-engine');
      if (noArtboard.has(key)) return unavailable('not-in-scope');
      const f = failures.get(key) ?? 0;
      if (f >= MAX_FAILURES) return unavailable('failed');
      enqueue({
        id: `tile\0${key}`,
        kind: 'tile',
        rel: norm,
        atParam: null,
        srcHash: bytesSha,
        metaHash: null,
        depsHash: '',
        hasArtboards: false,
        video: VIDEO.has(ext),
        targets: [{ key, artboard: null, size, px: SIZE_PX[size] }],
        priority: 1,
      });
      return f > 0 ? unavailable('failed') : { status: 'pending', key };
    },

    want(keys) {
      let raised = false;
      for (const k of keys) {
        const job = keyJob.get(k);
        if (job && queue.get(job.id) === job && job.priority !== 0) {
          job.priority = 0;
          raised = true;
        }
      }
      if (raised) pump();
    },

    async startBackground() {
      if (background || !enabled) return;
      background = true;
      const recent = readRecent(o.designRoot);
      const rows = [...o.index.snapshot().canvases].sort(
        (a, b) => (recent.get(b.rel) ?? 0) - (recent.get(a.rel) ?? 0)
      );
      // resolves once every cover is queued (or answered from disk), not when they are rendered
      // the first screen (Home's most recent 12) is not "background": it renders on all pages
      await Promise.all(
        rows.map((r, i) =>
          svc.thumb({
            canvas: r.rel,
            artboard: null,
            size: 'card',
            priority: i < FIRST_SCREEN ? 'visible' : 'background',
          })
        )
      );
    },

    async bootCovers(opts = {}) {
      if (!enabled || stopped) return 0;
      const sleep = (ms: number) =>
        new Promise<void>((r) => {
          const t = setTimeout(r, ms);
          (t as { unref?: () => void }).unref?.();
        });
      if (opts.delayMs) await sleep(opts.delayMs);
      // the capture listener starts after the http layer: wait for it (no origin = nothing renders, R1)
      const deadline = now() + (opts.waitMs ?? 60_000);
      while (!stopped && (!o.captureOrigin() || !o.serverOrigin()) && now() < deadline)
        await sleep(500);
      if (stopped || engineMissing || !o.captureOrigin() || !o.serverOrigin()) return 0;
      const recent = readRecent(o.designRoot);
      const stale = o.index
        .snapshot()
        .canvases.filter(
          (c) => !c.cover || c.cover.ofSrc !== c.srcHash || !hasThumb(o.pid, c.cover.key)
        )
        .sort((a, b) => (recent.get(b.rel) ?? 0) - (recent.get(a.rel) ?? 0));
      let queued = 0;
      for (const row of stale) {
        const r = await svc.thumb({
          canvas: row.rel,
          artboard: null,
          size: 'card',
          priority: 'background',
        });
        if (r.status === 'pending') queued++;
        // the picture for today's inputs is already on disk (a snapshot that lost its cover): name it
        else if (r.status === 'ready')
          setCover(row.rel, { key: r.key, w: r.w, h: r.h, ofSrc: row.srcHash });
      }
      return queued;
    },

    serves(key) {
      if (referenced.has(key)) return true;
      for (const c of o.index.snapshot().canvases) if (c.cover?.key === key) return true;
      return false;
    },

    read: (key) => readThumb(o.pid, key),
    pending: () => queue.size + running.size,
    idle: () =>
      queue.size === 0 && running.size === 0
        ? Promise.resolve()
        : new Promise<void>((r) => idleWaiters.push(r)),
    async probe() {
      if (!shim) return null;
      const m = await request({ op: 'probe' }, 5000);
      return (m.probe as Record<string, unknown>) ?? null;
    },
    stop() {
      stopped = true;
      if (pumpTimer) clearTimeout(pumpTimer);
      queue.clear();
      shim?.kill();
      shim = null;
      live.delete(svc);
      for (const w of idleWaiters.splice(0)) w();
    },
  };
  live.add(svc);
  return svc;
}
