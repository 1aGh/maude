// client/v2/shell/still-store.js — #212 §5 (T2.2): the overview stills, kept across sessions by the SHELL.
//
// The canvas frame (untrusted origin, DDR-054) never reaches this store: it only posts a still over the typed
// bridge, and client/v2/shell/still-bridge.js decides the key. This module holds the bytes and the caps:
//
//   one record per (pid, scope, artboard)   scope = a SHA-256 of the frame's capability for its canvas (C4), chosen
//          by the shell (the capability itself is never written down)
//   src  = the index's srcHash:metaHash:depsHash at write time; `list` returns only records of the CURRENT src and
//          deletes the others (a changed canvas never shows a stale still)
//   caps = 256 kB a still (and a real still WebP or single-image PNG, bridge/still-webp.ts) · 8 MB and 2000 stills a canvas · 32 MB a
//          project · 96 MB the store · 300 writes and 2 MB a minute a canvas
//   eviction: a canvas pays for its own writes first (its own records used longest ago); another canvas's records go
//          only when the project or store cap still holds after that, oldest first — so one canvas's writes neither
//          flush another canvas nor tell it anything about that canvas's use
//
// Storage: the main origin's IndexedDB (`maude-stills`) — the app's own data store in the desktop shell, the
// browser profile's otherwise; never the design root (not synced, not committed). No IndexedDB, or one that
// fails: the store answers nothing and keeps nothing. Contract: client/v2/contracts/212-still-cache.md §5.

import { checkStillImage, STILL_PERSIST_MAX_BYTES } from '../../../bridge/still-webp.ts';

export const STILL_PROJECT_MAX_BYTES = 32 * 1024 * 1024;
export const STILL_STORE_MAX_BYTES = 96 * 1024 * 1024;
export const STILL_CANVAS_MAX = 2000;
/** A canvas's share of the project cap. */
export const STILL_CANVAS_MAX_BYTES = 8 * 1024 * 1024;
export const STILL_WRITES_PER_MINUTE = 300;
export const STILL_BYTES_PER_MINUTE = 2 * 1024 * 1024;
/** A read refreshes a record's place in the eviction order only when its last refresh is older than this. */
export const STILL_TOUCH_AFTER_MS = 10 * 60_000;
/** The record shape. Records of another shape (the first one, keyed on the plain capability) are dropped. */
export const STILL_RECORD_V = 2;
const MAX_PART = 2048;

const okPart = (s) =>
  typeof s === 'string' && s.length > 0 && s.length <= MAX_PART && !s.includes('\0');
const keyOf = (pid, scope, artboard) => `${pid}\0${scope}\0${artboard}`;

/** An in-memory backend (tests; also the shape the IndexedDB one keeps). */
export function memoryStillBackend() {
  const meta = new Map();
  const bytes = new Map();
  return {
    async loadMeta() {
      return [...meta.values()].map((m) => ({ ...m }));
    },
    async getBytes(k) {
      // a copy, as IndexedDB gives: the bridge transfers (detaches) the answer's buffers
      return bytes.get(k)?.slice(0) ?? null;
    },
    async put(m, b) {
      meta.set(m.k, { ...m });
      bytes.set(m.k, b);
    },
    /** Several records' new `at` in one go (IndexedDB: one transaction). */
    async touch(ms) {
      for (const m of ms) if (meta.has(m.k)) meta.set(m.k, { ...m });
    },
    /** tests: a raw record, as an older build wrote it */
    _raw(m, b) {
      meta.set(m.k, { ...m });
      bytes.set(m.k, b);
    },
    async del(keys) {
      for (const k of keys) {
        meta.delete(k);
        bytes.delete(k);
      }
    },
    /** tests: what is on "disk" */
    _keys: () => [...meta.keys()],
  };
}

const DB_NAME = 'maude-stills';
const DB_VERSION = 1;

/** The IndexedDB backend: `meta` (keyPath `k`) and `bytes` (out-of-line, same key). Null when there is none. */
export function idbStillBackend(idb = typeof indexedDB !== 'undefined' ? indexedDB : null) {
  if (!idb) return null;
  let dbp = null;
  const db = () => {
    dbp ??= new Promise((res, rej) => {
      let req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (err) {
        rej(err);
        return;
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('bytes')) d.createObjectStore('bytes');
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
      req.onblocked = () => rej(new Error('blocked'));
    });
    return dbp;
  };
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(['meta', 'bytes'], mode);
      let out;
      tx.oncomplete = () => res(out);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
      out = fn(tx.objectStore('meta'), tx.objectStore('bytes'));
    });
  };
  return {
    async loadMeta() {
      const d = await db();
      return new Promise((res, rej) => {
        const req = d.transaction('meta', 'readonly').objectStore('meta').getAll();
        req.onsuccess = () => res(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => rej(req.error);
      });
    },
    async getBytes(k) {
      const d = await db();
      return new Promise((res, rej) => {
        const req = d.transaction('bytes', 'readonly').objectStore('bytes').get(k);
        req.onsuccess = () => res(req.result ?? null);
        req.onerror = () => rej(req.error);
      });
    },
    put: (m, b) =>
      run('readwrite', (meta, bytes) => {
        meta.put(m);
        bytes.put(b, m.k);
      }),
    touch: (ms) =>
      run('readwrite', (meta) => {
        for (const m of ms) meta.put(m);
      }),
    del: (keys) =>
      run('readwrite', (meta, bytes) => {
        for (const k of keys) {
          meta.delete(k);
          bytes.delete(k);
        }
      }),
  };
}

/**
 * The store. `put` and `list` never throw: a failing backend is the same as no store.
 * Records: `{ v, k, pid, scope, artboard, src, sig, size, at }` + the bytes beside them.
 */
export function createStillStore({ backend = idbStillBackend(), now = () => Date.now() } = {}) {
  let metas = null; // Map k → meta, loaded once
  let loading = null;
  const writes = new Map(); // `${pid}\0${scope}` → [time, bytes] of its writes in the last minute
  let tick = 0;
  const stamp = () => Math.max(now(), ++tick);
  const load = async () => {
    if (metas) return metas;
    loading ??= (async () => {
      const m = new Map();
      const old = [];
      try {
        for (const r of (await backend?.loadMeta()) ?? []) {
          if (!r || typeof r.k !== 'string') continue;
          if (r.v === STILL_RECORD_V && Number.isFinite(r.size)) m.set(r.k, r);
          else old.push(r.k);
        }
      } catch {
        /* no store: an empty one */
      }
      metas = m;
      if (old.length) {
        try {
          await backend?.del(old);
        } catch {}
      }
      return m;
    })();
    return loading;
  };
  const drop = async (keys) => {
    if (!keys.length) return;
    for (const k of keys) metas?.delete(k);
    try {
      await backend?.del(keys);
    } catch {}
  };
  /**
   * Over a cap: records leave until `over()` is false — first `own` (the writing canvas's, used longest ago first),
   * then `rest` (oldest first). The record just written is in neither.
   */
  const evict = async (own, rest, over) => {
    const out = [];
    const byAge = (rs) => [...rs].sort((x, y) => x.at - y.at);
    for (const r of [...byAge(own), ...byAge(rest)]) {
      if (!over()) break;
      if (!metas.has(r.k)) continue;
      out.push(r.k);
      metas.delete(r.k);
    }
    await drop(out);
  };
  /** One canvas's write rate: writes and bytes in the last minute. */
  const rateOk = (pid, scope, size) => {
    const id = `${pid}\0${scope}`;
    const t = now();
    const list = (writes.get(id) ?? []).filter((x) => t - x[0] < 60_000);
    const sent = list.reduce((n, x) => n + x[1], 0);
    if (list.length >= STILL_WRITES_PER_MINUTE || sent + size > STILL_BYTES_PER_MINUTE) {
      writes.set(id, list);
      return false;
    }
    list.push([t, size]);
    writes.set(id, list);
    return true;
  };
  return {
    /** Keep one still. False when it is refused (not a still WebP / PNG, too big, over the write rate, no store). */
    async put({ pid, scope, src, artboard, sig, bytes }) {
      if (!backend) return false;
      if (![pid, scope, src, artboard].every(okPart) || typeof sig !== 'string' || sig.length > 200)
        return false;
      const check = checkStillImage(bytes);
      if (!check.ok) return false;
      const size = bytes.byteLength;
      if (size > STILL_PERSIST_MAX_BYTES) return false;
      if (!rateOk(pid, scope, size)) return false;
      const m = await load();
      const k = keyOf(pid, scope, artboard);
      const rec = { v: STILL_RECORD_V, k, pid, scope, artboard, src, sig, size, at: stamp() };
      const prev = m.get(k);
      m.set(k, rec);
      const live = (pred) => [...m.values()].filter(pred);
      const sum = (rs) => rs.reduce((n, r) => n + r.size, 0);
      const mine = (r) => r.pid === pid && r.scope === scope;
      const ownOld = () => live((r) => mine(r) && r.k !== k);
      // 1. the canvas's own count and its share of the project: only its own records go
      await evict(ownOld(), [], () => {
        const rs = live(mine);
        return rs.length > STILL_CANVAS_MAX || sum(rs) > STILL_CANVAS_MAX_BYTES;
      });
      // 2. the project, 3. the store: the writer's own records first, then the oldest of the others
      await evict(
        ownOld(),
        live((r) => r.pid === pid && !mine(r)),
        () => sum(live((r) => r.pid === pid)) > STILL_PROJECT_MAX_BYTES
      );
      await evict(
        ownOld(),
        live((r) => !mine(r)),
        () => sum(live(() => true)) > STILL_STORE_MAX_BYTES
      );
      try {
        await backend.put(rec, bytes.slice(0));
        return true;
      } catch {
        if (prev) m.set(k, prev);
        else m.delete(k);
        return false;
      }
    },
    /**
     * The stills of one canvas scope at the current `src`: `[{ artboard, sig, bytes }]`. Records of any other src
     * are deleted (their canvas changed). A record whose bytes fail the check again is deleted too.
     */
    async list({ pid, scope, src }) {
      if (!backend || ![pid, scope, src].every(okPart)) return [];
      const m = await load();
      const mine = [...m.values()].filter((r) => r.pid === pid && r.scope === scope);
      await drop(mine.filter((r) => r.src !== src).map((r) => r.k));
      const out = [];
      const bad = [];
      const touched = [];
      const t = now();
      for (const r of mine) {
        if (r.src !== src) continue;
        let bytes = null;
        try {
          bytes = await backend.getBytes(r.k);
        } catch {
          bytes = null;
        }
        if (!checkStillImage(bytes).ok) {
          bad.push(r.k);
          continue;
        }
        // a read refreshes the eviction order: only a record not refreshed lately, all in one write
        if (t - r.at > STILL_TOUCH_AFTER_MS) {
          r.at = stamp();
          touched.push(r);
        }
        out.push({ artboard: r.artboard, sig: r.sig, bytes });
      }
      if (touched.length) {
        try {
          await backend.touch(touched);
        } catch {}
      }
      await drop(bad);
      return out;
    },
    /** tests + diagnostics */
    async stats() {
      const m = await load();
      let bytes = 0;
      for (const r of m.values()) bytes += r.size;
      return { n: m.size, bytes };
    },
  };
}

let shared = null;
/** The page's one store (lazily opened). */
export function stillStore() {
  shared ??= createStillStore();
  return shared;
}
