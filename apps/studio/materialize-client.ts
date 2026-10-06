// The studio child's half of the cell materializer (Task 10).
//
// On a cell the disk is a cache: inert media the journal lists may be in the
// bucket and nowhere on disk. When the static route misses one, it asks the
// hub it runs inside — over loopback, with the per-boot token the hub minted
// for this process (`MAUDE_MATERIALIZE_TOKEN`) — to fill its blob cache, and
// serves the verified file the hub names.
//
// THE HUB'S ANSWER IS CHECKED, NOT TRUSTED (DDR-054: the hub is semi-trusted).
// It is a local path, and it is served only if it resolves — through symlinks
// — to `<MAUDE_MATERIALIZE_CACHE_DIR>/blobs/<64-hex>`: the hub-owned cache, NOT
// anything under the design root (a tenant's git clone, where a committed
// symlink could aim the check itself). Anything else is a miss.
//
// Off unless the hub turned it on: absent env ⇒ `null` ⇒ the route's 404,
// exactly as before (desktop, self-hosted hub).

import { realpathSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';

import { classifyProjectFile } from './sync/file-membership.ts';

const SHA = /^[0-9a-f]{64}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** How long the static route waits on the hop. The hub answers `timeout`
 *  (503) at its own deadline (15 s); this only bounds a hub that hangs. */
const HOP_TIMEOUT_MS = 20_000;

export type MaterializeAnswer =
  | { path: string }
  | { unavailable: true; retryAfterS: number }
  | null;

/**
 * Ask the hub to materialize `logicalAbs` (a missing file under `designRoot`).
 * `null` means "not ours to serve" — the caller answers 404 as before.
 */
export async function materializeMissing(
  designRoot: string,
  logicalAbs: string,
  {
    env = process.env,
    fetchImpl = fetch,
  }: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}
): Promise<MaterializeAnswer> {
  if (env.MAUDE_CELL_MATERIALIZE !== '1') return null;
  const base = env.MAUDE_MATERIALIZE_URL;
  const token = env.MAUDE_MATERIALIZE_TOKEN;
  const cacheDir = env.MAUDE_MATERIALIZE_CACHE_DIR;
  if (!base || !token || !cacheDir) return null;
  let url: URL;
  try {
    url = new URL('/_materialize', base);
  } catch {
    return null;
  }
  // The token must never leave the container: loopback only.
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;

  const rel = relative(designRoot, logicalAbs).split(sep).join('/');
  if (!rel || rel.startsWith('..')) return null;
  // Inert media only — code and companion text are real checkout files.
  // (The hub re-judges this with the project's own canvas groups.)
  if (classifyProjectFile(rel, {}) !== 'inert-media') return null;
  url.searchParams.set('rel', rel);

  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
    });
  } catch {
    return { unavailable: true, retryAfterS: 5 };
  }
  if (res.status === 503) {
    const after = Number(res.headers.get('retry-after'));
    return { unavailable: true, retryAfterS: Number.isFinite(after) && after > 0 ? after : 5 };
  }
  if (!res.ok) return null;
  let body: { path?: unknown };
  try {
    body = (await res.json()) as { path?: unknown };
  } catch {
    return null;
  }
  const path = typeof body?.path === 'string' ? body.path : '';
  return path && isCacheBlob(cacheDir, path) ? { path } : null;
}

/** Does `p` resolve, through symlinks, to `<cacheDir>/blobs/<sha>`? */
export function isCacheBlob(cacheDir: string, p: string): boolean {
  if (!SHA.test(basename(p))) return false;
  try {
    const blobs = realpathSync(join(cacheDir, 'blobs'));
    const real = realpathSync(p);
    return dirname(real) === blobs && SHA.test(basename(real));
  } catch {
    return false;
  }
}

/** How long one listing is reused. The tree reloads on every file event and
 *  every reconnect; the journal answer only changes when media is added or
 *  removed, which reaches the tree through those same events a moment later. */
const LIST_TTL_MS = 15_000;
let listCache: { at: number; base: string; rels: string[] } | null = null;
let listInflight: Promise<string[] | null> | null = null;

/**
 * Every inert-media path the hub can serve although this checkout may not
 * hold it — designRoot-relative, `/`-separated. `null` when this is not a
 * materializing cell (desktop, self-hosted hub) or the hub did not answer:
 * the caller then lists the checkout alone, exactly as before.
 *
 * Paths only, and only as file-tree ROWS: serving any of them still goes
 * through `materializeMissing`, which checks the hub's answer itself.
 */
export async function listMaterializable({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
}: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
} = {}): Promise<string[] | null> {
  if (env.MAUDE_CELL_MATERIALIZE !== '1') return null;
  const base = env.MAUDE_MATERIALIZE_URL;
  const token = env.MAUDE_MATERIALIZE_TOKEN;
  if (!base || !token) return null;
  let url: URL;
  try {
    url = new URL('/_materialize', base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
  url.searchParams.set('list', '1');
  if (listCache && listCache.base === base && now() - listCache.at < LIST_TTL_MS)
    return listCache.rels;
  if (listInflight) return listInflight;
  listInflight = (async () => {
    try {
      const res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
      });
      if (!res.ok) return listCache?.rels ?? null;
      const body = (await res.json()) as { rels?: unknown };
      const rels = Array.isArray(body?.rels)
        ? body.rels.filter(
            (r): r is string =>
              typeof r === 'string' &&
              r.length > 0 &&
              r.length < 1024 &&
              !r.startsWith('/') &&
              !r.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
          )
        : [];
      listCache = { at: now(), base, rels };
      return rels;
    } catch {
      return listCache?.rels ?? null;
    } finally {
      listInflight = null;
    }
  })();
  return listInflight;
}

/** Test seam — forget the cached listing. */
export function resetMaterializableListCache(): void {
  listCache = null;
  listInflight = null;
}
