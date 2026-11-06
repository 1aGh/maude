// apps/studio/index-cache.ts — #207: the project tree answers at once, from the last build.
//
// `/_index-data` walks every canvas group, reads every canvas's sidecar and every canvas's import
// closure. On StudyFi (8.3k paths, 316 canvases) that took 13 s on Michal's desktop, every time —
// nothing was kept between requests, and the client saw "taking a while — trying again…" on a
// project whose files are all local.
//
// This keeps the last build and hands it out until something it depends on changes:
//   - `invalidate()` (a file event outside the root runtime folders, an API write announcing
//     itself) marks it out of date; the next request waits for ONE rebuild — every request in the
//     meantime joins it (never two builds at once, never a build per retry).
//   - A copy of the last build on disk (`seed`) answers the first request after a restart at once,
//     marked `stale`, while the real build runs; nothing else is ever served stale. A `fresh`
//     request waits for a real build instead.
//
// `createIndexCache` is pure (no disk, no bus); api.ts wires the build, the seed and the events.
// Below it: the canvas part's shape, its disk copy, and which events make it out of date.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface IndexCacheOptions<T> {
  /**
   * Compute the value from the disk (the expensive part). `early` may be called once, before the
   * content reads, with what a `partial` request is answered with meanwhile (the bare listing). It
   * is never kept as the value nor persisted.
   */
  build: (early?: (value: T) => void) => Promise<T>;
  /** The last value a previous run kept on disk, or null (read once, on the first request). */
  seed?: () => T | null;
  /** A build finished: keep a copy for the next run (called after the value is stored). */
  persist?: (value: T) => void;
  /** A background build failed (the seed path has no caller waiting on it). */
  onError?: (error: unknown) => void;
}

export interface IndexCache<T> {
  /**
   * The current value. `stale` only for the seed of a previous run, served while the first build
   * runs and the caller did not ask for `fresh` — or, when there is no seed either, for the listing
   * the first build published early (`partial`), and only to a caller that asked for `partial`.
   */
  get(opts?: {
    fresh?: boolean;
    partial?: boolean;
  }): Promise<{ value: T; stale: boolean; partial?: true }>;
  /** Something the value depends on changed: the next `get` rebuilds. */
  invalidate(): void;
  /** For tests: builds started so far, and whether one is running. */
  stats(): { builds: number; running: boolean };
}

/** Let every request already waiting run (and an answer already made get out) before going on. */
export const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A build is retried at most this often in a row when the tree keeps changing under it. */
const MAX_CHASE = 3;

export function createIndexCache<T>(o: IndexCacheOptions<T>): IndexCache<T> {
  let gen = 0;
  let current: { value: T; gen: number } | null = null;
  let seeded: { value: T } | null | undefined; // undefined = not read yet
  let running: Promise<void> | null = null;
  // #207 — what the running build published before its content reads; cleared when it ends.
  let early: { value: T } | null = null;
  let earlyWaiters: Array<() => void> = [];
  let builds = 0;
  const wakeEarly = () => {
    const waiting = earlyWaiters;
    earlyWaiters = [];
    for (const wake of waiting) wake();
  };

  function start(): Promise<void> {
    if (running) return running;
    const at = gen;
    builds++;
    running = (async () => {
      try {
        const value = await o.build((v) => {
          if (early) return;
          early = { value: v };
          wakeEarly();
        });
        // A slower build never replaces a newer one (only one runs at a time, but be exact).
        if (!current || current.gen <= at) current = { value, gen: at };
        try {
          o.persist?.(value);
        } catch (err) {
          o.onError?.(err);
        }
      } finally {
        running = null;
        early = null;
        wakeEarly();
      }
    })();
    return running;
  }

  /** The first build's early listing; null once a whole value exists or the build ended without one. */
  function earlyListing(): Promise<{ value: T } | null> {
    return new Promise((resolve) => {
      const take = () => resolve(current ? null : early);
      if (early || !running) take();
      else earlyWaiters.push(take);
    });
  }

  async function fresh(): Promise<T> {
    // The tree may change while a build runs; chase it a few times, then answer with the newest
    // build there is (what the uncached route always did: an answer from just before the change).
    for (let round = 0; ; round++) {
      if (current && current.gen === gen) return current.value;
      if (current && round >= MAX_CHASE) return current.value;
      await start();
    }
  }

  return {
    async get(opts = {}) {
      if (current && current.gen === gen) return { value: current.value, stale: false };
      if (!current && !opts.fresh) {
        if (seeded === undefined) {
          try {
            const v = o.seed?.() ?? null;
            seeded = v === null ? null : { value: v };
          } catch {
            seeded = null;
          }
        }
        if (seeded) {
          start().catch((err) => o.onError?.(err));
          return { value: seeded.value, stale: true };
        }
        // #207 — no copy either (the first open ever): the bare listing as soon as the build has it.
        if (opts.partial) {
          const whole = fresh();
          const listing = await earlyListing();
          if (listing) {
            whole.catch((err) => o.onError?.(err)); // the caller's next request meets a failure
            return { value: listing.value, stale: true, partial: true };
          }
          return { value: await whole, stale: false };
        }
      }
      return { value: await fresh(), stale: false };
    },
    invalidate() {
      gen++;
    },
    stats: () => ({ builds, running: running !== null }),
  };
}

// ---------- the `/_index-data` canvas part, its disk copy, and what invalidates it ----------

/** The slow, reader-independent half of `/_index-data` (api.ts `buildCanvasIndexPart`). */
export interface CanvasIndexPart {
  groups: Array<{
    label: string;
    paths: string[];
    fullPath: string;
    stripPrefix: string;
    kind: 'project' | 'canvas' | 'runtime';
    dsFolders?: Array<{ name: string; path: string; folder: string }>;
    dirs?: string[];
  }>;
  canvasDesignSystems: Record<string, string>;
  canvasKinds: Record<string, string>;
  canvasImportsCanvases?: Record<string, string[]>;
  canvasMissingImports?: Record<string, string[]>;
  canvasDsRevs?: Record<string, string>;
  canvasDsKept?: Record<string, string>;
  systemHeads?: Record<string, string | null>;
  dsConverted?: Record<string, boolean>;
  dsRevGaps?: Record<string, string | null>;
}

/**
 * A file event the canvas part cannot depend on: anything under a ROOT runtime name — a path inside
 * a root runtime folder (`_canvas-state/x.view.json`, `_export-jobs/…`, `_cache/…`) or a root
 * runtime file (`_locator.json`). The part lists no `_` name (findFiles skips them; the Runtime row
 * is listed per request), and an import walk never follows one (closure.ts refuses a `_` first
 * segment). Those are written all the time while the studio runs — each write used to throw the
 * whole index away.
 */
export function isRootRuntimeRel(rel: string): boolean {
  if (typeof rel !== 'string') return false;
  return rel.replace(/\\/g, '/').replace(/^\/+/, '').startsWith('_');
}

/**
 * Bus events an API write raises before (or instead of) its file event: the client reloads the
 * tree as soon as the write answers, so the cache must be out of date by then.
 */
export const CANVAS_INDEX_WRITE_EVENTS = [
  'activity:suppress',
  'activity:unsuppress',
  'canvas-list-update',
  'canvas-move-begin',
  'canvas-created',
  'canvas-deleted',
  'source-writing',
  'source-written',
  'source-op',
  'config-updated',
  'access:changed',
  'ds:outside',
] as const;

/** A burst of edits writes the disk copy once. */
export const CANVAS_INDEX_SEED_DEBOUNCE_MS = 1000;

const SEED_VERSION = 1;
/** A copy larger than this is not kept (a project that big pays its first build). */
const SEED_CAP_BYTES = 16 * 1024 * 1024;

const isStrList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isStrRecord = (v: unknown): v is Record<string, string> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v as object).every((x) => typeof x === 'string');

/**
 * The previous run's canvas part, or null. Machine cache (`~/.maude/index/v1/projects/<pid>/`, the
 * V2-1.17 per-project folder — outside every project tree, never synced). It is only ever served
 * marked stale and rebuilt at once; a copy written under another config, or of the wrong shape, is
 * not served at all.
 */
export function readCanvasIndexSeed(file: string, cfgKey: string): CanvasIndexPart | null {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  if (raw.length > SEED_CAP_BYTES) return null;
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  const d = doc as { v?: unknown; cfgKey?: unknown; part?: unknown } | null;
  if (!d || d.v !== SEED_VERSION || d.cfgKey !== cfgKey) return null;
  const part = d.part as CanvasIndexPart | undefined;
  if (!part || !Array.isArray(part.groups)) return null;
  for (const g of part.groups) {
    if (!g || typeof g.label !== 'string' || !isStrList(g.paths)) return null;
    if (g.dirs !== undefined && !isStrList(g.dirs)) return null;
  }
  if (!isStrRecord(part.canvasDesignSystems) || !isStrRecord(part.canvasKinds)) return null;
  return part;
}

/** Atomic write (tmp → rename), 0600 in a 0700 folder; a failure only costs the next cold start. */
export function writeCanvasIndexSeed(file: string, part: CanvasIndexPart, cfgKey: string): void {
  try {
    const text = JSON.stringify({ v: SEED_VERSION, cfgKey, part });
    if (text.length > SEED_CAP_BYTES) return;
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    console.warn('[index-data] could not keep the tree for the next start:', err);
  }
}
