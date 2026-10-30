// index/history-refs.ts — which assets older versions still point at (S8.11, contract V2-1.17 §5.5).
//
// "Not used" must never say so about a picture an older version of a canvas still shows: restoring
// that version would bring back a broken image. So per immutable (canvas, version) the asset
// references of its html, css and meta lanes are extracted ONCE and cached; a background scan fills
// the cache for existing history. Until the scan has finished the answer is "checking" — a false
// "used" is safe, a false "not used" is not. A scan that could not read some canvas (the home was
// unreachable) does not finish: it stays "checking" and retries.
//
// The cache lives in the machine index dir (`<projectDir(pid)>/history-refs.json`), never in the
// project: it is rebuildable from the history, so it needs no DDR-115 entry and no migration.
// V2-1.9 calls `forget` when it prunes a version; the version recorder calls `note`.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import { assetRefsOf } from './extractors/asset-usage.ts';
import type { HistoryScanState } from './types.ts';

export const HISTORY_REFS_FORMAT = 'maude.history-refs';

export type HistoryLane = 'html' | 'css' | 'meta';

/** What the scan reads versions through (the sync runtime or a legacy hub's git, wired by the host). */
export interface HistorySource {
  /** immutable version refs of one canvas (`r812`, `git:<sha>`), any order. `null` = this home
   *  keeps no history of it. Rejecting = unreachable: the scan cannot conclude. */
  versions(canvas: string): Promise<string[] | null>;
  /** one lane's text at a version; `null` = absent. */
  text(canvas: string, ref: string, lane: HistoryLane): Promise<string | null>;
}

export type HistoryLanes = Partial<Record<HistoryLane, string | null | undefined>>;

export interface HistoryRefsOptions {
  /** cache file; null = in memory only */
  file: string | null;
  source: () => HistorySource | null;
  /** the canvases to scan (current rows) */
  canvases: () => string[];
  /** called whenever the cache or the state changed */
  onChange?: () => void;
  retryMs?: number;
  debounceMs?: number;
}

export interface HistoryRefs {
  state(): HistoryScanState;
  /** begin (or restart) the background scan; `checking` immediately when a source exists */
  start(): void;
  /** canvases whose retained versions reference this asset (sorted) */
  usedBy(assetRel: string): string[];
  note(canvas: string, ref: string, lanes: HistoryLanes): void;
  forget(canvas: string, ref: string): void;
  /** resolves when no scan is running (a failed scan's retry timer is not awaited) */
  settled(): Promise<void>;
  flush(): void;
  stop(): void;
}

type Store = Map<string, Map<string, string[]>>; // canvas → ref → assets

const tick = () => new Promise<void>((r) => setImmediate(r));

function writeAtomic(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
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

function load(file: string | null): Store {
  const store: Store = new Map();
  if (!file) return store;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      format?: string;
      v?: number;
      names?: unknown;
      canvases?: Record<string, Record<string, unknown>>;
    };
    if (doc.format !== HISTORY_REFS_FORMAT || doc.v !== 1 || !Array.isArray(doc.names))
      return store;
    const names = doc.names as string[];
    for (const [canvas, versions] of Object.entries(doc.canvases ?? {})) {
      const m = new Map<string, string[]>();
      for (const [ref, idx] of Object.entries(versions)) {
        if (!Array.isArray(idx)) continue;
        m.set(
          ref,
          idx.map((i) => names[i as number]).filter((n): n is string => typeof n === 'string')
        );
      }
      store.set(canvas, m);
    }
  } catch {
    /* missing or torn: the scan refills it */
  }
  return store;
}

export function createHistoryRefs(o: HistoryRefsOptions): HistoryRefs {
  const store = load(o.file);
  const retryMs = o.retryMs ?? 30_000;
  const debounceMs = o.debounceMs ?? 2000;
  let state: HistoryScanState = 'idle';
  let running: Promise<void> | null = null;
  let rerun = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let dirtyFile = false;
  let reverse: Map<string, Set<string>> | null = null;
  /** pruned by the version history this boot: a later scan must not read them back */
  const forgotten = new Set<string>();

  /** `notify` = tell the host (state changes, notes, prunes); a scan read only dirties the cache */
  const changed = (notify = true) => {
    reverse = null;
    dirtyFile = true;
    if (o.file && !writeTimer && !stopped) {
      writeTimer = setTimeout(flush, debounceMs);
      writeTimer.unref?.();
    }
    if (notify) o.onChange?.();
  };

  function flush() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    if (!o.file || !dirtyFile) return;
    dirtyFile = false;
    const names: string[] = [];
    const at = new Map<string, number>();
    const canvases: Record<string, Record<string, number[]>> = {};
    for (const [canvas, versions] of store) {
      const out: Record<string, number[]> = {};
      for (const [ref, assets] of versions)
        out[ref] = assets.map((a) => {
          let i = at.get(a);
          if (i === undefined) {
            i = names.length;
            names.push(a);
            at.set(a, i);
          }
          return i;
        });
      canvases[canvas] = out;
    }
    try {
      writeAtomic(o.file, JSON.stringify({ format: HISTORY_REFS_FORMAT, v: 1, names, canvases }));
    } catch {
      dirtyFile = true; // next change / flush retries
    }
  }

  const refsOf = (lanes: HistoryLanes) =>
    [
      ...new Set([lanes.html, lanes.css, lanes.meta].flatMap((t) => (t ? assetRefsOf(t) : []))),
    ].sort();

  async function pass(): Promise<boolean> {
    const src = o.source();
    if (!src) return true;
    let complete = true;
    for (const canvas of [...o.canvases()].sort()) {
      if (stopped) return false;
      let refs: string[] | null;
      try {
        refs = await src.versions(canvas);
      } catch {
        complete = false;
        continue;
      }
      if (!refs) continue;
      let seen = store.get(canvas);
      for (const ref of refs) {
        if (stopped) return false;
        if (seen?.has(ref) || forgotten.has(`${canvas}\0${ref}`)) continue;
        try {
          const [html, css, meta] = await Promise.all([
            src.text(canvas, ref, 'html'),
            src.text(canvas, ref, 'css'),
            src.text(canvas, ref, 'meta'),
          ]);
          if (!seen) {
            seen = new Map();
            store.set(canvas, seen);
          }
          seen.set(ref, refsOf({ html, css, meta }));
          changed(false);
        } catch {
          complete = false;
        }
        await tick();
      }
    }
    return complete;
  }

  function run(): Promise<void> {
    return (async () => {
      do {
        rerun = false;
        let complete = false;
        try {
          complete = await pass();
        } catch {
          complete = false;
        }
        if (stopped) return;
        if (rerun) continue;
        state = o.source() ? (complete ? 'ready' : 'checking') : 'idle';
        if (state === 'checking') {
          retry = setTimeout(() => {
            retry = null;
            api.start();
          }, retryMs);
          retry.unref?.();
        }
        o.onChange?.();
      } while (rerun);
    })().finally(() => {
      running = null;
    });
  }

  const api: HistoryRefs = {
    state: () => state,
    start() {
      if (stopped) return;
      if (retry) clearTimeout(retry);
      retry = null;
      if (!o.source()) {
        state = 'idle';
        return;
      }
      state = 'checking';
      if (running) rerun = true;
      else running = run();
    },
    usedBy(assetRel) {
      if (!reverse) {
        reverse = new Map();
        for (const [canvas, versions] of store)
          for (const assets of versions.values())
            for (const a of assets) {
              let s = reverse.get(a);
              if (!s) {
                s = new Set();
                reverse.set(a, s);
              }
              s.add(canvas);
            }
      }
      return [...(reverse.get(assetRel) ?? [])].sort();
    },
    note(canvas, ref, lanes) {
      let versions = store.get(canvas);
      if (!versions) {
        versions = new Map();
        store.set(canvas, versions);
      }
      versions.set(ref, refsOf(lanes));
      changed();
    },
    forget(canvas, ref) {
      forgotten.add(`${canvas}\0${ref}`);
      const versions = store.get(canvas);
      if (!versions?.delete(ref)) return;
      if (!versions.size) store.delete(canvas);
      changed();
    },
    async settled() {
      while (running) await running;
    },
    flush,
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      flush();
    },
  };
  return api;
}
