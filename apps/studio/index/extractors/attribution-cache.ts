// index/extractors/attribution-cache.ts — the "what changed" words of one action on one canvas
// (V2-1.9 §5.5.5, V2-1.5 §5.7, V2-1.17 §5.4; S1.10).
//
// One entry per `(actionId, canvas)`: `{ changes, detail, ms }` from `describeVersion`, computed once where
// the version lands, off the hot path, and read back for every version-history row. Recomputable: a miss
// (never computed, a corrupt file, an older describer) runs the compute again from the store's before/after
// blobs, so nothing here is ever the only copy.
//
// Where it lives: `<projectDir(pid)>/attribution/<actionId>.json` under the MACHINE index cache
// (`$MAUDE_INDEX_DIR`, default `~/.maude/index/v1/projects/<pid>/`) — outside every project tree, never
// synced, no DDR-115 list entry (V2-1.17 §5.1, the same footing as `index.json`). One file per action holds
// that action's canvases (an action can touch several), written atomically (tmp → rename).
//
// The words are scope-independent (no lane names a canvas other than its own; see history/describe-version.ts),
// so the key needs no viewer scope. A canvas-only viewer reads the same entry; only an AI row's PROMPT, chosen
// at read time by `rowTitle`, differs.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import type { Change, Lanes } from '../../history/describe';
import { type DescribeVersionOptions, describeVersion } from '../../history/describe-version';
import { projectDir } from '../snapshot.ts';

export const ATTRIBUTION_FORMAT = 'maude.attribution-cache';
export const ATTRIBUTION_VERSION = 1;
/** Bump when the describer's words change: every older entry reads as a miss and is recomputed. */
export const DESCRIBER_VERSION = 1;

export interface AttributionEntry {
  changes: Change[];
  /** The original lines of each collapsed artboard (Compare's expanded view). */
  detail: Record<string, Change[]>;
  ms: number;
}

export interface AttributionCache {
  readonly dir: string;
  get(actionId: string, canvas: string): AttributionEntry | undefined;
  set(actionId: string, canvas: string, entry: AttributionEntry): void;
  getOrCompute(actionId: string, canvas: string, compute: () => AttributionEntry): AttributionEntry;
  /** Drop every canvas of an action. */
  forget(actionId: string): void;
  /** Keep the newest `keep` action files, delete the rest (the caller's GC; never needed for correctness). */
  prune(keep: number): number;
}

export interface AttributionCacheOptions {
  dir: string;
  /** In-memory entries kept (default 256). */
  memory?: number;
}

/** `<projectDir(pid)>/attribution` — the default home of a project's cache. */
export const attributionDir = (pid: string): string => path.join(projectDir(pid), 'attribution');

const SAFE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
/** An action id becomes a file name only when it is plainly one; anything else is hashed. */
export function fileNameOf(actionId: string): string {
  const stem = SAFE.test(actionId)
    ? actionId
    : `h-${createHash('sha256').update(actionId).digest('hex').slice(0, 32)}`;
  return `${stem}.json`;
}

interface FileShape {
  format: string;
  v: number;
  describer: number;
  actionId: string;
  canvases: Record<string, AttributionEntry>;
}

const isChange = (c: unknown): c is Change =>
  !!c &&
  typeof c === 'object' &&
  typeof (c as Change).words === 'string' &&
  Array.isArray((c as Change).artboards);

const isEntry = (e: unknown): e is AttributionEntry =>
  !!e &&
  typeof e === 'object' &&
  Array.isArray((e as AttributionEntry).changes) &&
  (e as AttributionEntry).changes.every(isChange) &&
  !!(e as AttributionEntry).detail &&
  typeof (e as AttributionEntry).detail === 'object';

function readFile(file: string): FileShape | null {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const d = doc as Partial<FileShape> | null;
  if (
    !d ||
    d.format !== ATTRIBUTION_FORMAT ||
    d.v !== ATTRIBUTION_VERSION ||
    d.describer !== DESCRIBER_VERSION ||
    !d.canvases ||
    typeof d.canvases !== 'object'
  )
    return null;
  return d as FileShape;
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

export function createAttributionCache(opts: AttributionCacheOptions): AttributionCache {
  const { dir } = opts;
  const cap = opts.memory ?? 256;
  const mem = new Map<string, AttributionEntry>();
  const memKey = (a: string, c: string) => `${a}\u0001${c}`;
  const remember = (a: string, c: string, e: AttributionEntry): void => {
    const k = memKey(a, c);
    mem.delete(k);
    mem.set(k, e);
    if (mem.size > cap) mem.delete(mem.keys().next().value as string);
  };
  const fileOf = (actionId: string): string => path.join(dir, fileNameOf(actionId));

  const get = (actionId: string, canvas: string): AttributionEntry | undefined => {
    const hit = mem.get(memKey(actionId, canvas));
    if (hit) return hit;
    const f = readFile(fileOf(actionId));
    const e = f?.canvases[canvas];
    if (!isEntry(e)) return undefined;
    remember(actionId, canvas, e);
    return e;
  };

  const set = (actionId: string, canvas: string, entry: AttributionEntry): void => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = fileOf(actionId);
    const prior = readFile(file);
    const doc: FileShape = {
      format: ATTRIBUTION_FORMAT,
      v: ATTRIBUTION_VERSION,
      describer: DESCRIBER_VERSION,
      actionId,
      canvases: { ...(prior?.canvases ?? {}), [canvas]: entry },
    };
    writeAtomic(file, JSON.stringify(doc));
    remember(actionId, canvas, entry);
  };

  return {
    dir,
    get,
    set,
    getOrCompute(actionId, canvas, compute) {
      const hit = get(actionId, canvas);
      if (hit) return hit;
      const e = compute();
      try {
        set(actionId, canvas, e);
      } catch {
        // a read-only or full disk must not break a version row: the words are recomputable
        remember(actionId, canvas, e);
      }
      return e;
    },
    forget(actionId) {
      for (const k of [...mem.keys()]) if (k.startsWith(`${actionId}\u0001`)) mem.delete(k);
      rmSync(fileOf(actionId), { force: true });
    },
    prune(keep) {
      let names: string[];
      try {
        names = readdirSync(dir).filter((n) => n.endsWith('.json'));
      } catch {
        return 0;
      }
      if (names.length <= keep) return 0;
      const aged = names
        .map((n) => ({ n, t: statSync(path.join(dir, n)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      const drop = aged.slice(keep);
      for (const d of drop) rmSync(path.join(dir, d.n), { force: true });
      mem.clear();
      return drop.length;
    },
  };
}

/**
 * The words of one action on one canvas, from the cache or computed once from the store's before/after
 * lanes (`describeVersion`). Consecutive rows may share a parse by passing the same `Lanes` objects.
 */
export function attributionFor(
  cache: AttributionCache,
  actionId: string,
  canvas: string,
  before: Lanes,
  after: Lanes,
  opts: DescribeVersionOptions = {}
): AttributionEntry {
  return cache.getOrCompute(actionId, canvas, () => {
    const r = describeVersion(canvas, before, after, opts);
    return { changes: r.changes, detail: r.detail, ms: r.ms };
  });
}
