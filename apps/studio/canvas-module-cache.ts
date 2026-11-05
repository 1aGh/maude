// A byte-bounded LRU for built canvas modules (issue #204).
//
// A canvas module BUNDLES the shared chrome (canvas-lib and everything it pulls in), so every built
// canvas is ~2 MB of JavaScript however small its own source is — measured 2.1 MB on the first-sync
// bench's canvases. The module route kept one per canvas path for the life of the process, with no
// bound: a project's server builds every canvas once just to render its cover (thumbs
// `bootCovers`), so after a first sync of 111 canvases it held ~230 MB of module text, which a JS
// string with any non-Latin-1 character stores at two bytes a character — ~460 MB of heap that was
// never released (the reported `[mem] rss > warn … heapUsed ~317 MB` on an idle synced desktop),
// and ~1.3 GB on a 311-canvas cell. Modules are kept here as UTF-8 bytes (half the size, and off
// the JS heap) under a byte budget; a miss only costs a rebuild, which the route already handles.

/** What a cached module costs. */
export interface Sized {
  /** Bytes this entry holds — what the budget counts. */
  readonly bytes: number;
}

export interface ModuleCache<V extends Sized> {
  get(key: string): V | undefined;
  /** Insert or replace `key`, then evict least-recently-used entries until the budget holds.
   *  The entry just set is never evicted by its own insert, even when it alone is over budget —
   *  the request that built it is about to serve it. */
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  readonly size: number;
  /** Total `bytes` of what is held now. */
  readonly bytes: number;
}

export interface ModuleCacheOptions {
  maxBytes: number;
  /** An additional count bound (the historical-version cache keeps its old one). */
  maxEntries?: number;
}

export function createModuleCache<V extends Sized>(o: ModuleCacheOptions): ModuleCache<V> {
  const map = new Map<string, V>();
  let total = 0;
  const maxEntries = o.maxEntries ?? Number.POSITIVE_INFINITY;

  function drop(key: string): void {
    const v = map.get(key);
    if (v === undefined) return;
    total -= v.bytes;
    map.delete(key);
  }

  return {
    get(key) {
      const v = map.get(key);
      if (v === undefined) return undefined;
      // Most recently used goes last: Map iteration order is insertion order.
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      drop(key);
      map.set(key, value);
      total += value.bytes;
      for (const oldest of map.keys()) {
        if (total <= o.maxBytes && map.size <= maxEntries) break;
        if (oldest === key) break;
        drop(oldest);
      }
    },
    delete: drop,
    clear() {
      map.clear();
      total = 0;
    },
    get size() {
      return map.size;
    },
    get bytes() {
      return total;
    },
  };
}

/** UTF-8 bytes of a built module, the form the caches keep it in. */
export function moduleBytes(js: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(js) as Uint8Array<ArrayBuffer>;
}

/** The env knob, in MB, with a floor so a typo cannot turn the cache off entirely. */
export function budgetFromEnv(name: string, defaultMb: number): number {
  const raw = Number(process.env[name]);
  const mb = Number.isFinite(raw) && raw >= 4 ? raw : defaultMb;
  return mb * 1024 * 1024;
}
