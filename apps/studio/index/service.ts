// index/service.ts — the project server's index (V2-2.17, contract V2-1.17 §5.3/§5.5).
//
// Built at boot from the static extractor, reusing the previous snapshot's runtime artboards and
// covers for canvases whose source did not change; updated per fs event (one canvas re-extracted);
// persisted debounced (2 s after the last change, ≤ one write per 10 s under churn, always on
// flush). Thumbnails, runtime harvest and descriptions plug in through mergeRuntime() and the
// renderer (S1/S8) — this service owns the rows they hang off.

import { randomBytes } from 'node:crypto';

import {
  extractCanvas,
  type IndexContext,
  isCanvasRel as isListedCanvas,
  listCanvases,
  stampOf,
} from './extract.ts';
import { match } from './match.ts';
import { pidOf, readSnapshot, sweepTemps, writeSnapshot } from './snapshot.ts';
import type {
  ArtboardRow,
  CanvasRow,
  ProjectIndexSnapshot,
  SearchResult,
  SearchRow,
} from './types.ts';

export interface IndexServiceOptions {
  root: string;
  designRel: string;
  /** read fresh on every rebuild: config can change (groups, design systems) */
  context: () => IndexContext;
  project: () => {
    name: string;
    label: string | null;
    formatVersion: number;
    linkedHub: { url: string } | null;
    managed: boolean;
  };
  app?: string;
  /** false in tests and one-shot CLIs */
  persist?: boolean;
  now?: () => number;
  debounceMs?: number;
  minIntervalMs?: number;
}

export interface IndexService {
  ready(): Promise<void>;
  snapshot(): ProjectIndexSnapshot;
  canvas(rel: string): CanvasRow | undefined;
  counts(): ProjectIndexSnapshot['counts'];
  search(q: string, opts?: { limit?: number }): SearchResult;
  /** re-extract these canvases (create / change / delete); returns the new seq */
  update(rels: string[]): number;
  rebuild(): void;
  mergeRuntime(rel: string, srcHash: string, artboards: ArtboardRow[]): void;
  /** the thumbnail renderer's last card-size cover for this source (§5.2 `cover`); ignored when
   *  the canvas changed since the render started */
  setCover(rel: string, cover: NonNullable<CanvasRow['cover']>): void;
  on(event: 'changed', cb: (e: { seq: number; rels: string[] }) => void): () => void;
  /** write now (shutdown) */
  flush(): void;
  /** stop timers (tests, shutdown) */
  stop(): void;
  /** the last build's wall time, ms (budget ≤ 250 ms on Alligators) */
  buildMs(): number;
}

const isCanvasRel = (rel: string) => rel.endsWith('.tsx');
const canvasOfMeta = (rel: string) =>
  rel.endsWith('.meta.json') ? rel.replace(/\.meta\.json$/, '.tsx') : null;

/** Every live service in this process — server.ts flushes them on shutdown. */
const live = new Set<IndexService>();
export function flushAllIndexes() {
  for (const svc of live) {
    try {
      svc.flush();
      svc.stop();
    } catch {
      /* best effort on the way out */
    }
  }
}

export function createIndexService(o: IndexServiceOptions): IndexService {
  const now = o.now ?? Date.now;
  const persist = o.persist ?? true;
  const debounceMs = o.debounceMs ?? 2000;
  const minIntervalMs = o.minIntervalMs ?? 10_000;
  const pid = pidOf(o.root);
  const bootId = randomBytes(8).toString('hex');
  const rows = new Map<string, CanvasRow>();
  const listeners = new Set<(e: { seq: number; rels: string[] }) => void>();
  let seq = 0;
  let lastBuildMs = 0;
  let lastWriteAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  function counts(): ProjectIndexSnapshot['counts'] {
    const byKind: ProjectIndexSnapshot['counts']['byKind'] = {};
    let artboards = 0;
    for (const c of rows.values()) {
      artboards += c.artboards.length;
      for (const a of c.artboards) {
        const k = a.kind ?? 'digital';
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    return { canvases: rows.size, artboards, byKind };
  }

  function snapshot(): ProjectIndexSnapshot {
    const ctx = o.context();
    return {
      format: 'maude.project-index',
      v: 1,
      pid,
      project: { root: o.root, designRel: o.designRel, ...o.project() },
      writer: { pid: process.pid, bootId, app: o.app ?? 'maude-studio', at: now(), seq },
      stamp: stampOf(ctx, [...rows.keys()]),
      access: { scope: 'full', epoch: 0 },
      canvases: [...rows.values()].sort((a, b) => a.rel.localeCompare(b.rel)),
      counts: counts(),
    };
  }

  function write() {
    timer = null;
    if (!persist || !dirty) return;
    dirty = false;
    lastWriteAt = now();
    try {
      writeSnapshot(snapshot());
    } catch {
      dirty = true; // try again on the next change / flush
    }
  }

  function schedule() {
    dirty = true;
    if (!persist) return;
    if (timer) clearTimeout(timer);
    const wait = Math.max(debounceMs, lastWriteAt + minIntervalMs - now());
    timer = setTimeout(write, wait);
    timer.unref?.();
  }

  function emit(rels: string[]) {
    seq++;
    for (const cb of listeners) cb({ seq, rels });
    schedule();
  }

  function extractKeeping(ctx: IndexContext, rel: string, prev?: CanvasRow): CanvasRow | null {
    let row: CanvasRow;
    try {
      row = extractCanvas(ctx, rel);
    } catch {
      return null; // vanished between list and read
    }
    // a runtime harvest and the last cover outlive a restart while the source is the same
    if (prev && prev.srcHash === row.srcHash && prev.artboardsFrom === 'runtime') {
      row.artboards = prev.artboards;
      row.artboardsFrom = 'runtime';
    }
    if (prev?.cover) row.cover = prev.cover;
    return row;
  }

  function rebuild() {
    const t0 = performance.now();
    const ctx = o.context();
    const previous = readSnapshot(pid);
    if (persist) sweepTemps(pid);
    const prevRows = new Map((previous?.canvases ?? []).map((c) => [c.rel, c]));
    for (const [rel, row] of rows) prevRows.set(rel, row);
    rows.clear();
    for (const rel of listCanvases(ctx)) {
      const row = extractKeeping(ctx, rel, prevRows.get(rel));
      if (row) rows.set(rel, row);
    }
    lastBuildMs = performance.now() - t0;
    emit([...rows.keys()]);
  }

  function update(rels: string[]): number {
    const ctx = o.context();
    const touched: string[] = [];
    for (const raw of rels) {
      const rel = isCanvasRel(raw) ? raw : canvasOfMeta(raw);
      if (!rel) continue;
      if (isListedCanvas(ctx, rel)) {
        const row = extractKeeping(ctx, rel, rows.get(rel));
        if (row) rows.set(rel, row);
        else rows.delete(rel);
      } else if (rows.has(rel)) {
        rows.delete(rel);
      } else continue;
      touched.push(rel);
    }
    if (touched.length) emit(touched);
    return seq;
  }

  rebuild();

  const svc: IndexService = {
    ready: async () => {},
    snapshot,
    canvas: (rel) => rows.get(rel),
    counts,
    rebuild,
    update,
    search(q, opts) {
      const inputs: Array<{
        key: string;
        name: string;
        meta: string;
        openedAt?: number;
        group: SearchRow['group'];
      }> = [];
      for (const c of rows.values()) {
        inputs.push({ key: c.rel, name: c.name, meta: c.folder, group: 'canvases' });
        for (const a of c.artboards)
          inputs.push({
            key: `${c.rel}#${a.id}`,
            name: a.label ?? a.id,
            meta: `${c.name} ${c.folder} ${a.kind ?? ''}`,
            group: 'artboards',
          });
      }
      const hits = match(inputs, q, opts?.limit ?? 200);
      const out: SearchRow[] = hits.map((h) => ({
        group: h.row.group,
        key: h.row.key,
        name: h.row.name,
        meta: h.row.meta,
        score: h.score,
        close: h.close,
        marks: h.marks,
      }));
      return { q, rows: out, closeOnly: out.length > 0 && out.every((r) => r.close) };
    },
    mergeRuntime(rel, srcHash, artboards) {
      const row = rows.get(rel);
      if (!row || row.srcHash !== srcHash) return;
      row.artboards = artboards;
      row.artboardsFrom = 'runtime';
      emit([rel]);
    },
    setCover(rel, cover) {
      const row = rows.get(rel);
      if (!row || row.srcHash !== cover.ofSrc) return;
      const was = row.cover;
      if (was && was.key === cover.key && was.w === cover.w && was.h === cover.h) return;
      row.cover = { key: cover.key, w: cover.w, h: cover.h, ofSrc: cover.ofSrc };
      emit([rel]);
    },
    on(_event, cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    flush() {
      if (timer) clearTimeout(timer);
      dirty = true;
      write();
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      live.delete(svc);
    },
    buildMs: () => lastBuildMs,
  };
  if (persist) live.add(svc);
  return svc;
}
