// The cell materializer — cell materializer Phase 1 (Task 8).
//
// A cloud cell's disk is 8 GB and ephemeral; a project can be bigger (Brno
// Alligators, 2026-10-01: ~7.8 GB). Phase 0 kept such a cell alive by
// restoring only what fits and leaving the rest in the bucket — honest 404s.
// This module makes the rest SERVABLE: on a cell, the journal says what
// exists, the bucket holds the bytes, and the local disk is a bounded,
// disposable CACHE for inert media.
//
// THE CACHE LIVES OUTSIDE THE WATCHED TREE. `<designRoot>/_cache/` is runtime
// state (DDR-115, all four lists + the hub mirror): the studio's fs-watch,
// walk-import and the file plane never see a blob appear or disappear. So an
// eviction can never reach `recordGone` → tombstone → delete on every
// desktop. That hazard is removed by construction, not by care.
//
// BUCKET BYTES REACH A CLIENT ONLY AFTER VERIFICATION. A miss downloads the
// object to a temp file, re-hashes it, and only a hash equal to the journal
// row's `sha256` is renamed into `blobs/<sha>`. `files/<rel>` keys are
// path-addressed and overwritten in place, so streaming bucket bytes straight
// through would serve whatever is there NOW for a row that names something
// else (TOCTOU/substitution — DDR-054). A mismatch is a typed miss and a loud
// log line, never a served body.
//
// A CACHE PATH COMES ONLY FROM A VERIFIED SHA. Bucket keys and request paths
// never become cache paths; `blobPath` accepts a 64-hex digest or nothing.
//
// PIN-UNTIL-MIRRORED. An upload adopted with `pin()` stays until the
// write-behind has confirmed it durable and calls `unpin()`. Eviction only
// ever removes unpinned blobs, so bytes that exist nowhere else cannot be
// evicted.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { assetPrefixFromEnv } from './asset-key.mjs';
import { writeBehindKey } from './asset-lane.mjs';
import { isContentAddressed } from './assets.mjs';
import { diskReportSync } from './disk.mjs';
import { MAX_PROJECT_FILE_BYTES, sha256File } from './file-limits.mjs';
import { checkoutFileClass } from './file-manifest.mjs';
import { isProjectFileShape } from './file-membership.mjs';
import { getObjectToFile, putObjectFromFile } from './s3.mjs';

const SHA = /^[0-9a-f]{64}$/;

/** A miss past this answers 503 + Retry-After; the fill keeps going for the
 *  next caller. Below the render service's 25 s per-resource timeout. */
export const DEFAULT_DEADLINE_MS = 15_000;

/** A freshly filled blob is not evicted for this long, so a gallery canvas
 *  bigger than the cache does not thrash itself (plan Task 8). */
export const DEFAULT_MIN_RESIDENCY_MS = 10 * 60_000;

/** Evict when the cache passes HIGH of its budget, down to LOW. */
const HIGH_WATER = 0.8;
const LOW_WATER = 0.6;

/** Bucket fills in flight at once. Every reader of a listed photo can start
 *  one; single-flight only dedupes per sha (Phase 1 attacker review #5). */
const MAX_CONCURRENT_FILLS = 4;

/** Pinned (not yet mirrored) bytes may hold at most this share of the cache
 *  budget; past it the write doors answer 503 until the mirror drains. Pins
 *  are not evictable, so without a cap a write token could fill the cache
 *  with them and turn every miss into `full` (attacker review chain 2). */
export const MAX_PINNED_FRACTION = 0.5;

/** Index writes are coalesced — a burst of hits is one write, not hundreds. */
const INDEX_FLUSH_MS = 2_000;

/**
 * The cache's byte budget RIGHT NOW: what is free plus what the cache already
 * holds, less TWO floors — and never more than `MAUDE_CACHE_BUDGET_BYTES`.
 *
 * The same headroom rule as the boot hydrate (Phase 0 attacker review #1): a
 * cache sized against the total disk, or allowed to fill to the floor itself,
 * would shut the write doors exactly the way an unbounded hydrate did — the
 * checkout, git and the data dir all live on the same 8 GB. Recomputed per
 * fill, so a desktop push that eats space shrinks the cache instead of the
 * cache eating the push's room.
 */
export function cacheBudgetFor({
  dir,
  cacheBytes = 0,
  env = process.env,
  report = diskReportSync,
}) {
  const set = String(env.MAUDE_CACHE_BUDGET_BYTES ?? '').trim();
  const raw = Number(set);
  const configured =
    set !== '' && Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : Number.POSITIVE_INFINITY;
  const d = report(dir, env);
  if (!d) return configured; // an unreadable disk is not a reason to cache nothing
  return Math.min(configured, Math.max(0, d.freeBytes + cacheBytes - 2 * d.floorBytes));
}

/** `blobs/<sha>` for a verified digest; null for anything else. */
export function blobPathFor(cacheDir, sha) {
  return typeof sha === 'string' && SHA.test(sha) ? join(cacheDir, 'blobs', sha) : null;
}

/**
 * @param {object} o
 * @param {string} o.designRoot
 * @param {string} [o.cacheDir] where blobs live. On a cell this is under the
 *   HUB-OWNED data dir (`<DATA_DIR>/cache`), never under the design root: the
 *   design root is the tenant's git clone, and a committed symlink at
 *   `.design/_cache` would otherwise aim the cache's create/delete/rename at
 *   any path the hub can write (Phase 1 defender review H1). Defaults to
 *   `<designRoot>/_cache` for tests only.
 * @param {string} o.indexPath  where the sha → {size,lastAccess,pinned} index
 *   lives (`/data/materializer.json` on a cell). Rebuilt from a scan if absent.
 * @param {object} o.journal    the file journal (`latestFor`).
 * @param {object|(() => Promise<object>)|null} o.s3  config or resolver.
 * @param {number|(() => number)} o.budgetBytes the cache's byte budget, or a
 *   function returning it now (cell mode passes one built on `cacheBudgetFor`).
 */
export function createMaterializer({
  designRoot,
  cacheDir: cacheDirOpt = null,
  indexPath,
  journal,
  s3,
  prefix,
  budgetBytes,
  deadlineMs = DEFAULT_DEADLINE_MS,
  minResidencyMs = DEFAULT_MIN_RESIDENCY_MS,
  log = console,
  deps = {},
}) {
  const resolveS3 = typeof s3 === 'function' ? s3 : async () => s3;
  const scope = prefix ?? assetPrefixFromEnv();
  const fetchToFile = deps.getObjectToFile ?? getObjectToFile;
  const putFile = deps.putObjectFromFile ?? putObjectFromFile;
  const hashFile = deps.sha256File ?? sha256File;
  const now = deps.now ?? Date.now;
  const budgetOf = typeof budgetBytes === 'function' ? budgetBytes : () => budgetBytes;

  const cacheDir = cacheDirOpt ?? join(designRoot, '_cache');
  const blobsDir = join(cacheDir, 'blobs');
  const tmpDir = join(cacheDir, 'tmp');
  // NEVER FOLLOW A LINK HERE. Each directory must be a real directory; a
  // symlink (or a file) in its place is removed AS A LINK and recreated —
  // `rmSync(recursive)` through a link is exactly how a planted
  // `_cache/blobs -> /data` deleted the journal (defender H1).
  const realDir = (dir) => {
    let st = null;
    try {
      st = lstatSync(dir);
    } catch {
      st = null;
    }
    if (st && !st.isDirectory()) unlinkSync(dir);
    mkdirSync(dir, { recursive: true });
  };
  realDir(cacheDir);
  realDir(blobsDir);
  realDir(tmpDir);
  // A temp file left by a crash mid-fill is garbage by definition — removed
  // one entry at a time, as files, never recursively through anything.
  for (const name of readdirSync(tmpDir)) {
    try {
      const st = lstatSync(join(tmpDir, name));
      if (st.isFile() || st.isSymbolicLink()) unlinkSync(join(tmpDir, name));
    } catch {
      /* gone */
    }
  }

  /** sha → { size, lastAccess, filledAt, pinned } */
  const index = loadIndex();
  const inflight = new Map(); // sha → Promise<result>
  let filling = 0;
  const fillQueue = [];
  const withFillSlot = async (fn) => {
    if (filling >= MAX_CONCURRENT_FILLS) await new Promise((r) => fillQueue.push(r));
    filling += 1;
    try {
      return await fn();
    } finally {
      filling -= 1;
      fillQueue.shift()?.();
    }
  };
  const counters = { hits: 0, misses: 0, fills: 0, evictions: 0, mismatches: 0 };
  let flushTimer = null;

  function loadIndex() {
    const out = new Map();
    let saved = null;
    try {
      saved = JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch {
      saved = null;
    }
    // The DISK is the truth; the saved index only contributes what a scan
    // cannot see (access times, pins). A saved entry with no blob is dropped;
    // a blob with no saved entry is adopted as unpinned and old.
    let names = [];
    try {
      names = readdirSync(blobsDir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const abs = join(blobsDir, name);
      // Only a regular file under a digest name is a blob. Anything else is
      // left alone and not adopted — never deleted recursively (defender H1).
      if (!SHA.test(name)) continue;
      let size;
      try {
        const st = lstatSync(abs);
        if (!st.isFile()) continue;
        size = st.size;
      } catch {
        continue;
      }
      const prev = saved?.blobs?.[name];
      out.set(name, {
        size,
        lastAccess: Number(prev?.lastAccess) || 0,
        filledAt: Number(prev?.filledAt) || 0,
        pinned: prev?.pinned === true,
      });
    }
    return out;
  }

  function scheduleFlush() {
    if (!indexPath || flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushIndex();
    }, INDEX_FLUSH_MS);
    flushTimer.unref?.();
  }

  function flushIndex() {
    if (!indexPath) return;
    try {
      mkdirSync(dirname(indexPath), { recursive: true });
      const tmp = `${indexPath}.tmp-${process.pid}`;
      writeFileSync(tmp, JSON.stringify({ v: 1, blobs: Object.fromEntries(index) }));
      renameSync(tmp, indexPath);
    } catch (err) {
      log.warn?.(`[materializer] could not save the index: ${err.message}`);
    }
  }

  const bytes = () => {
    let n = 0;
    for (const e of index.values()) n += e.size;
    return n;
  };
  const pinnedBytes = () => {
    let n = 0;
    for (const e of index.values()) if (e.pinned) n += e.size;
    return n;
  };

  function hit(sha) {
    const e = index.get(sha);
    const abs = blobPathFor(cacheDir, sha);
    if (!e || !abs || !existsSync(abs)) {
      if (e) index.delete(sha); // the disk is the truth
      return null;
    }
    e.lastAccess = now();
    scheduleFlush();
    return { path: abs, sha, size: e.size };
  }

  /**
   * Evict down to the low watermark once past the high one, least recently
   * used first, UNPINNED blobs only (pinned bytes exist nowhere else).
   *
   * Minimum residency is SOFT. It keeps housekeeping from churning a gallery
   * bigger than the cache — but when a fill NEEDS room (`need` > 0), or the
   * cache is over its budget, resident blobs go too. The first cut held residency
   * hard, and the Task 15 E2E caught it: with a cache smaller than the working
   * set, every blob was "fresh", nothing could be evicted, and every miss
   * answered 503 for ten minutes. Thrash is a cost; unavailability is an outage.
   */
  function evict(need = 0) {
    const budget = budgetOf();
    if (!Number.isFinite(budget)) return 0;
    let total = bytes();
    if (total + need <= budget * HIGH_WATER) return 0;
    const target = Math.max(0, budget * LOW_WATER - need);
    const t = now();
    const lru = (a, b) => a[1].lastAccess - b[1].lastAccess;
    const unpinned = [...index.entries()].filter(([, e]) => !e.pinned);
    const settled = unpinned.filter(([, e]) => t - e.filledAt >= minResidencyMs).sort(lru);
    const resident = unpinned.filter(([, e]) => t - e.filledAt < minResidencyMs).sort(lru);
    let evicted = 0;
    const drop = ([sha, e]) => {
      rmSync(blobPathFor(cacheDir, sha), { force: true });
      index.delete(sha);
      total -= e.size;
      evicted += 1;
    };
    for (const entry of settled) {
      if (total <= target) break;
      drop(entry);
    }
    // Residency yields to a fill that would otherwise not fit, and to a cache
    // that is OVER its budget (released pins land here fresh) — the budget is
    // the disk's protection, residency is only an anti-churn preference.
    if (need > 0 || total > budget) {
      for (const entry of resident) {
        if (total + need <= budget) break;
        drop(entry);
      }
    }
    if (evicted) {
      counters.evictions += evicted;
      scheduleFlush();
    }
    return evicted;
  }

  async function fill(rel, row) {
    const sha = row.sha256;
    const need = Number(row.size) || 0;
    evict(need);
    const budget = budgetOf();
    if (Number.isFinite(budget) && bytes() + need > budget) {
      // Pinned bytes (unmirrored uploads) and residents fill the budget.
      // A hold, not an error: the write-behind will unpin, residency ends.
      return { miss: 'full' };
    }
    let cfg;
    try {
      cfg = await resolveS3();
    } catch (err) {
      log.warn?.(`[materializer] no bucket credentials for ${rel}: ${err.message}`);
      return { miss: 'unavailable' };
    }
    if (!cfg) return { miss: 'unavailable' };
    const tmp = join(tmpDir, `fill-${randomBytes(8).toString('hex')}`);
    try {
      // At most the row's own size: an object that is bigger is not these bytes,
      // and must not get to fill the disk before the hash says so (defender L2).
      const rowSize = Number.isInteger(row.size) && row.size >= 0 ? row.size : null;
      let n;
      try {
        n = await fetchToFile(cfg, writeBehindKey(rel, scope), tmp, {
          maxBytes: rowSize ?? MAX_PROJECT_FILE_BYTES,
        });
      } catch (err) {
        if (rowSize !== null && /ceiling/.test(err.message)) n = -1;
        else throw err;
      }
      if (n === null) return { miss: 'absent' };
      const got = n === -1 || (rowSize !== null && n !== rowSize) ? null : await hashFile(tmp);
      if (got !== sha) {
        counters.mismatches += 1;
        log.error?.(
          `[materializer] STORE DRIFT: the bucket object for ${rel} ${got ? `hashes to ${got.slice(0, 12)}…` : 'is not the size the row names'}, ` +
            `the journal says ${sha.slice(0, 12)}… — NOT served.`
        );
        return { miss: 'mismatch' };
      }
      const abs = blobPathFor(cacheDir, sha);
      renameSync(tmp, abs);
      const t = now();
      index.set(sha, { size: n, lastAccess: t, filledAt: t, pinned: false });
      counters.fills += 1;
      scheduleFlush();
      return { path: abs, sha, size: n };
    } catch (err) {
      log.warn?.(`[materializer] fill failed for ${rel}: ${err.message}`);
      return { miss: 'unavailable' };
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  return {
    cacheDir,

    /**
     * Resolve `rel` to a verified local file.
     *
     * @returns {Promise<{path: string, sha: string, size: number}
     *   | {miss: 'absent'|'unmirrored'|'mismatch'|'timeout'|'full'|'unavailable'}>}
     */
    async materialize(rel) {
      const row = journal?.latestFor?.(rel) ?? null;
      if (!row || row.deleted || !row.sha256 || !SHA.test(row.sha256)) {
        counters.misses += 1;
        return { miss: 'absent' };
      }
      const cached = hit(row.sha256);
      if (cached) {
        counters.hits += 1;
        return cached;
      }
      counters.misses += 1;
      // Not in the cache and not durable: the bytes exist only where they
      // were lost (a disk-lost row) — nothing to fetch.
      if (row.mirroredAtMs == null) return { miss: 'unmirrored' };
      let p = inflight.get(row.sha256);
      if (!p) {
        p = withFillSlot(() => fill(rel, row)).finally(() => inflight.delete(row.sha256));
        inflight.set(row.sha256, p);
      }
      let timer;
      const timeout = new Promise((res) => {
        timer = setTimeout(() => res({ miss: 'timeout' }), deadlineMs);
        timer.unref?.();
      });
      try {
        return await Promise.race([p, timeout]);
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * Adopt a verified upload into the cache, pinned until mirrored.
     * `file` must be on the same filesystem (a temp beside the cache).
     * The CALLER verified `sha` against the bytes; it is re-validated as a
     * digest here, never trusted as a path.
     */
    pin(sha, file) {
      const abs = blobPathFor(cacheDir, sha);
      if (!abs) throw new Error('pin: not a sha256 digest');
      // The VERIFIED bytes win. Keeping whatever already sat at this name and
      // discarding the fresh upload let an unverified file stand in for it —
      // and the write-behind would then mirror the impostor (defender M1).
      renameSync(file, abs);
      const size = statSync(abs).size;
      const t = now();
      const prev = index.get(sha);
      index.set(sha, {
        size,
        lastAccess: t,
        filledAt: prev?.filledAt ?? t,
        pinned: true,
      });
      scheduleFlush();
      return abs;
    },

    /**
     * Release a pin only when NO unmirrored live row still names this sha
     * (defender M2). Pins are not per path: the same bytes uploaded to two
     * paths share one blob, and an older row superseded or tombstoned before
     * its mirror would otherwise leave its sha pinned forever.
     */
    release(sha) {
      if (journal?.hasUnmirroredSha?.(sha)) return false;
      return this.unpin(sha);
    },

    unpin(sha) {
      const e = index.get(sha);
      if (!e || !e.pinned) return false;
      e.pinned = false;
      scheduleFlush();
      evict();
      return true;
    },

    /**
     * Keep a RECOVERABLE copy of `rel` before it is tombstoned (Task 12).
     *
     * Off-cell, a delete quarantines the checkout file into `_trash/`. On a
     * cell the checkout path is usually empty and `_trash/` is on a disk that
     * goes with the next restart, while `files/<rel>` in the bucket is
     * path-keyed — the next write to the same path overwrites it. So the
     * verified bytes are copied to `<scope>/trash/<stamp>/<rel>` first
     * (DDR-226 §8: a delete is recoverable). `assets/<name>` is content-
     * addressed and never overwritten — nothing to do.
     *
     * @returns {Promise<string|null>} the trash key, or null when there is
     *   nothing to keep. THROWS when bytes exist but could not be copied — the
     *   caller then refuses the delete (fail closed).
     */
    async keepCopy(rel) {
      // Only a CONTENT-ADDRESSED asset name is never overwritten. Human-named
      // ones (`assets/fonts/Gators-Bold.woff2`) are path-keyed like files/ —
      // and need the copy (attacker review #4).
      if (rel.startsWith('assets/') && isContentAddressed(rel.slice('assets/'.length))) return null;
      const got = await this.materialize(rel);
      if (!got.path) {
        // No live hash, or bytes that were never durable and are not here —
        // there is nothing anywhere to keep.
        if (got.miss === 'absent' || got.miss === 'unmirrored') return null;
        throw new Error(`no verified copy to keep (${got.miss})`);
      }
      const cfg = await resolveS3();
      if (!cfg) throw new Error('no object storage to keep a copy in');
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      const key = scope ? `${scope}/trash/${stamp}/${rel}` : `trash/${stamp}/${rel}`;
      await putFile(cfg, key, got.path);
      return key;
    },

    isPinned: (sha) => index.get(sha)?.pinned === true,
    /** May another upload be pinned right now? (see MAX_PINNED_FRACTION) */
    canPin() {
      const budget = budgetOf();
      return !Number.isFinite(budget) || pinnedBytes() < budget * MAX_PINNED_FRACTION;
    },
    /** The path of a cached blob, without touching LRU or counters. */
    peek(sha) {
      const abs = blobPathFor(cacheDir, sha);
      return abs && index.has(sha) && existsSync(abs) ? abs : null;
    },
    /** A temp path inside the cache — for a write door to stream into. */
    tempPath: () => join(tmpDir, `up-${randomBytes(8).toString('hex')}`),
    evict,
    /** Bytes the cache holds — what `cacheBudgetFor` adds back to free space. */
    bytes,
    stats: () => ({
      ...counters,
      blobs: index.size,
      bytes: bytes(),
      pinnedBytes: pinnedBytes(),
      budgetBytes: budgetOf(),
    }),
    flush: flushIndex,
    stop() {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      flushIndex();
    },
  };
}

/** The loopback hop the studio child takes on a disk miss (Task 10). */
export const MATERIALIZE_PATH = '/_materialize';

/** Misses a later request may not meet — answered 503 + Retry-After. */
const TRANSIENT_MISSES = new Set(['timeout', 'full', 'unavailable']);

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sameSecret(offered, expected) {
  const a = Buffer.from(String(offered ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/**
 * `GET /_materialize?rel=<designRoot-rel>` → `{ path, sha, size }`.
 *
 * For the studio child ONLY. Two gates, both required:
 *   • the per-boot token the hub minted for the child (the real gate — the
 *     hub's public listener is the same port, and a front proxy inside the
 *     container could make any request look local);
 *   • a loopback peer address (defense in depth).
 * Every refusal is a bare 404 — this route does not exist for anyone else,
 * and it is in NEITHER canvas allowlist (DDR-088).
 *
 * The answer is a LOCAL PATH inside `_cache/blobs/`, never bytes: the child
 * re-checks containment (DDR-054 — the hub is semi-trusted) and serves the
 * file with its own static-route headers.
 */
export async function handleMaterializeRoute({
  request,
  response,
  method,
  materializer,
  token,
  designRoot,
}) {
  const send = (status, payload, extra = {}) => {
    const body = JSON.stringify(payload);
    response
      .writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
        'X-Content-Type-Options': 'nosniff',
        ...extra,
      })
      .end(body);
    return true;
  };
  const bearer = String(request.headers?.authorization ?? '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (
    !materializer ||
    !token ||
    !LOOPBACK_ADDRESSES.has(request.socket?.remoteAddress ?? '') ||
    !sameSecret(bearer, token)
  ) {
    return send(404, { error: 'not found' });
  }
  if (method !== 'GET') return send(405, { error: 'method not allowed' });
  let rel = '';
  try {
    rel = new URL(request.url ?? '', 'http://loopback').searchParams.get('rel') ?? '';
  } catch {
    rel = '';
  }
  // Inert media only: code modules and companion text stay real checkout
  // files (Bun.build reads them), and nothing else belongs in the cache.
  if (!isProjectFileShape(rel) || checkoutFileClass(rel, designRoot) !== 'inert-media') {
    return send(400, { error: 'not an inert-media path' });
  }
  const res = await materializer.materialize(rel);
  if (res.path) return send(200, res);
  if (TRANSIENT_MISSES.has(res.miss)) return send(503, res, { 'Retry-After': '5' });
  return send(404, res);
}
