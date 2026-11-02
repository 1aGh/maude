// index/assets.ts — the asset rows of the project index (S8.11, contract V2-1.17 §5.3–§5.5).
//
// Composes four things behind `assets()` / `usage()` / `notUsed()`:
//   • the listing of `<designRoot>/assets/` (kind, size, mtime; sidecars are not rows),
//   • who uses each file (extractors/asset-usage.ts — lazy, incremental),
//   • which older versions still point at it (history-refs.ts — background scan),
//   • the bytes' sha256 → the thumbnail key (an async, serial pass; never blocks the server).
// `service.ts` only hosts this: it forwards fs events (`touch`), canvas rows and the emit callback.
//
// "Not used" is a verdict with three values. `true` only when no canvas, no other file, no retained
// older version and no fresh AI take names the file AND the history scan has finished. While it runs
// the verdict is 'checking' and `notUsed()` lists nothing (§5.5: a false "used" is safe).
//
// Canvas-only sessions (V2-1.16 L9) pass a view: only assets that a GRANTED canvas references exist,
// and the answer carries nothing about anything else (no usage elsewhere, no older versions).

import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { assetKey } from '../thumbs/keys.ts';
import {
  type AssetUsage,
  assetKindOf,
  createAssetUsage,
  hasTile,
} from './extractors/asset-usage.ts';
import {
  createHistoryRefs,
  type HistoryLanes,
  type HistoryRefs,
  type HistorySource,
} from './history-refs.ts';
import type { AssetKind, AssetRow, AssetsAnswer, AssetView, HistoryScanState } from './types.ts';

/** An AI take nobody placed yet stays out of "Not used" for this long. */
export const TAKE_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_GEN_BYTES = 16 * 1024;

export interface AssetIndexOptions {
  designRoot: string;
  canvases(): string[];
  history: () => HistorySource | null;
  /** `<projectDir(pid)>/history-refs.json`; null = in memory */
  historyFile: string | null;
  now: () => number;
  /** the service's emit: bumps seq, tells listeners (`assets/x.png` rels), schedules the snapshot */
  emit(rels: string[]): void;
  /** hash the bytes in the background (default true) */
  hash?: boolean;
}

export interface AssetIndex {
  assets(view?: AssetView): AssetRow[];
  usage(
    assetRel: string,
    view?: AssetView
  ): { canvases: string[]; olderVersions: boolean | 'checking' };
  notUsed(view?: AssetView): { checking: boolean; assets: AssetRow[] };
  answer(seq: number, view?: AssetView): AssetsAnswer;
  historyState(): HistoryScanState;
  dynamicReferences(): string[];
  /** an fs event: true when it changed what the asset rows say */
  touch(rel: string): boolean;
  /** canvas rows were rebuilt (config reload) */
  reset(): void;
  startHistoryScan(): void;
  noteVersion(canvas: string, ref: string, lanes: HistoryLanes): void;
  forgetVersion(canvas: string, ref: string): void;
  settled(): Promise<void>;
  flush(): void;
  stop(): void;
}

interface Listed {
  rel: string;
  name: string;
  kind: AssetKind;
  size: number;
  mtimeMs: number;
}
interface Gen {
  size: number;
  mtimeMs: number;
  at: number | null;
}

const ASSETS = 'assets';
const stemOf = (name: string) => {
  const dot = name.indexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
};

export function createAssetIndex(o: AssetIndexOptions): AssetIndex {
  const usage: AssetUsage = createAssetUsage({ designRoot: o.designRoot, canvases: o.canvases });
  const history: HistoryRefs = createHistoryRefs({
    file: o.historyFile,
    source: o.history,
    canvases: o.canvases,
    onChange: () => o.emit([ASSETS]),
  });
  let listing: Map<string, Listed> | null = null;
  const genFiles = new Map<string, { size: number; mtimeMs: number }>(); // stem → gen.json stat
  const genCache = new Map<string, Gen>();
  const hashes = new Map<string, { size: number; mtimeMs: number; sha: string }>();
  const hashQueue: string[] = [];
  let hashing: Promise<void> | null = null;
  let stopped = false;

  function list(): Map<string, Listed> {
    if (listing) return listing;
    const out = new Map<string, Listed>();
    genFiles.clear();
    const dir = path.join(o.designRoot, ASSETS);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      /* no assets dir yet */
    }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const gen = name.endsWith('.gen.json');
      const kind = gen ? null : assetKindOf(name);
      if (!gen && !kind) continue;
      let st: ReturnType<typeof lstatSync>;
      try {
        // lstat, not stat: a symlink planted under assets/ is not a file here (as /_api/assets does)
        st = lstatSync(path.join(dir, name));
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      if (gen)
        genFiles.set(name.slice(0, -'.gen.json'.length), { size: st.size, mtimeMs: st.mtimeMs });
      else
        out.set(`${ASSETS}/${name}`, {
          rel: `${ASSETS}/${name}`,
          name,
          kind: kind as AssetKind,
          size: st.size,
          mtimeMs: Math.trunc(st.mtimeMs),
        });
    }
    listing = out;
    return out;
  }

  /** `at` of `assets/<stem>.gen.json` (maude.gen v1; unknown keys kept, v > 1 = absent). */
  function takeAt(stem: string): number | null {
    const st = genFiles.get(stem);
    if (!st || st.size > MAX_GEN_BYTES) return null;
    const hit = genCache.get(stem);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.at;
    let at: number | null = null;
    try {
      const doc = JSON.parse(
        readFileSync(path.join(o.designRoot, ASSETS, `${stem}.gen.json`), 'utf8')
      ) as { format?: unknown; v?: unknown; at?: unknown };
      if (doc.format === 'maude.gen' && doc.v === 1 && typeof doc.at === 'string') {
        const t = Date.parse(doc.at);
        at = Number.isFinite(t) ? t : null;
      }
    } catch {
      at = null;
    }
    genCache.set(stem, { size: st.size, mtimeMs: st.mtimeMs, at });
    return at;
  }

  // ── hashing ───────────────────────────────────────────────────────────────────────────────
  function shaOf(file: Listed) {
    const h = hashes.get(file.rel);
    return h && h.size === file.size && h.mtimeMs === file.mtimeMs ? h.sha : undefined;
  }

  function hashFile(file: Listed): Promise<string | null> {
    return new Promise((resolve) => {
      const h = createHash('sha256');
      const s = createReadStream(path.join(o.designRoot, file.rel));
      s.on('data', (c) => h.update(c));
      s.on('error', () => resolve(null));
      s.on('end', () => resolve(h.digest('hex')));
    });
  }

  function pump() {
    if (hashing || stopped || o.hash === false) return;
    hashing = (async () => {
      while (hashQueue.length && !stopped) {
        const rel = hashQueue.shift() as string;
        const f = listing?.get(rel);
        if (!f || shaOf(f)) continue;
        const sha = await hashFile(f);
        // the file may have changed while it was read: keep the answer only for what was listed
        const now = listing?.get(rel);
        if (!sha || !now || now.size !== f.size || now.mtimeMs !== f.mtimeMs) continue;
        hashes.set(rel, { size: f.size, mtimeMs: f.mtimeMs, sha });
        o.emit([rel]);
      }
    })().finally(() => {
      hashing = null;
    });
  }

  function queueHashes() {
    if (o.hash === false) return;
    const order: AssetKind[] = ['image', 'video', 'audio', 'font', 'document'];
    const todo = [...list().values()]
      .filter((f) => !shaOf(f) && !hashQueue.includes(f.rel))
      .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.size - b.size);
    for (const f of todo) hashQueue.push(f.rel);
    if (todo.length) pump();
  }

  // ── rows ──────────────────────────────────────────────────────────────────────────────────
  function rowsFor(view?: AssetView): AssetRow[] {
    const files = list();
    queueHashes();
    const use = usage.all();
    const state = history.state();
    const now = o.now();
    const out: AssetRow[] = [];
    for (const f of files.values()) {
      const u = use.get(f.rel);
      let usedIn = u?.canvases ?? [];
      if (view) {
        usedIn = usedIn.filter((c) => view.canvases.has(c));
        if (!usedIn.length) continue; // L9: an asset no granted canvas references does not exist
      }
      const sha = shaOf(f);
      const tile = sha && hasTile(f.name) ? assetKey('card', sha) : undefined;
      const base = {
        rel: f.rel,
        kind: f.kind,
        size: f.size,
        mtimeMs: f.mtimeMs,
        ...(sha ? { sha256: sha } : {}),
        ...(tile ? { tile } : {}),
        usedIn,
        usedBy: usedIn.length,
      };
      if (view) {
        out.push({
          ...base,
          usedElsewhere: false,
          olderVersions: false,
          recentTake: false,
          notUsed: false,
        });
        continue;
      }
      const older = history.usedBy(f.rel).length > 0;
      const olderVersions: AssetRow['olderVersions'] = older
        ? true
        : state === 'ready'
          ? false
          : 'checking';
      const usedElsewhere = u?.elsewhere ?? false;
      const at = takeAt(stemOf(f.name));
      const recentTake =
        !usedIn.length && !usedElsewhere && at !== null && now - at < TAKE_GRACE_MS;
      const notUsed: AssetRow['notUsed'] =
        usedIn.length || usedElsewhere || recentTake || older
          ? false
          : state === 'ready'
            ? true
            : 'checking';
      out.push({ ...base, usedElsewhere, olderVersions, recentTake, notUsed });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.rel < b.rel ? -1 : 1));
  }

  const api: AssetIndex = {
    assets: rowsFor,
    usage(assetRel, view) {
      const u = usage.of(assetRel);
      if (view)
        return { canvases: u.canvases.filter((c) => view.canvases.has(c)), olderVersions: false };
      const state = history.state();
      return {
        canvases: u.canvases,
        olderVersions: history.usedBy(assetRel).length
          ? true
          : state === 'ready'
            ? false
            : 'checking',
      };
    },
    notUsed(view) {
      if (view) return { checking: false, assets: [] };
      return {
        checking: history.state() !== 'ready',
        assets: rowsFor().filter((r) => r.notUsed === true),
      };
    },
    answer(seq, view) {
      return { seq, history: history.state(), assets: rowsFor(view) };
    },
    historyState: () => history.state(),
    dynamicReferences: () => usage.dynamicReferences(),
    touch(rel) {
      if (rel === ASSETS || rel.startsWith(`${ASSETS}/`)) {
        // a file under assets/: the listing and its hash are stale; nothing else moves
        if (rel.indexOf('/', ASSETS.length + 1) !== -1) return false;
        if (listing === null) return false;
        listing = null;
        queueHashes(); // re-list now (≈ 3 ms) so the new bytes are hashed without waiting for a read
        return true;
      }
      return usage.touch(rel);
    },
    reset() {
      usage.reset();
      listing = null;
    },
    startHistoryScan: () => history.start(),
    noteVersion: (canvas, ref, lanes) => history.note(canvas, ref, lanes),
    forgetVersion: (canvas, ref) => history.forget(canvas, ref),
    async settled() {
      // a failed scan waits for its retry timer, not for us
      for (;;) {
        await history.settled();
        if (!hashing) return;
        await hashing;
      }
    },
    flush: () => history.flush(),
    stop() {
      stopped = true;
      history.stop();
    },
  };
  return api;
}
