// apps/studio/present/media-presence.ts — S3.8: which of a clip's files are on THIS Mac (04 md-edge-offline,
// "Offline still presents").
//
// Present plays whatever is on disk with no network. A clip whose file never arrived (a peer's reel the sync
// has not delivered, a download cut short) cannot play: the audience screen holds its first frame
// (present-media.ts, the same engine in the audience window) and the presenter's Now box says why, with Skip.
//
// The canvas reports the media files the presented clip uses (`present-media.sources`, plain src URLs); the
// shell asks which files exist here through the route that already lists them — GET /_api/assets, the
// AssetPicker's list of `<designRoot>/assets/` — so there is no new endpoint, and nothing in the canvas can
// claim a file is present. When the S8.19 asset-state service lands (sync/asset-state.ts: here · uploading ·
// waiting · missing), this file's `LocalAssets` is the one thing it replaces; the words and the callers stay.
//
// Pure apart from `fetchLocalAssets`, which takes its `fetch`. Imported by the shell (client/v2/present).

/** The Now box's notice (04 md-edge-offline): why the clip is not playing, and what the audience sees. */
export const CLIP_MISSING_NOTICE = "Clip isn't on this Mac — the audience sees its first frame";

/** `GET /_api/assets` caps its list at this many (newest first): a full list cannot prove a file absent. */
export const ASSET_LIST_CAP = 500;

export interface LocalAssets {
  /** `assets/<name>` — what a src resolves to under the design root. */
  paths: ReadonlySet<string>;
  /** False when the list hit its cap: a path that is not in it may still exist. */
  complete: boolean;
}

export interface PathOpts {
  /** The design root's folder name (`cfg.designRel`, `.design`): a src may carry it as a prefix. */
  designRel?: string;
  /** Hosts a project asset may be served from, besides loopback (a cloud tab's own canvas origin). */
  hosts?: readonly string[];
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * A media src → the project asset path (`assets/<file>`) it names, or null when it is not one: a blob or
 * data URL, a host that is not this machine's, a design system's own asset, a path with a folder or a `..`.
 * Null means "not ours to judge", never "missing".
 */
export function assetPathOf(src: string, opts: PathOpts = {}): string | null {
  if (typeof src !== 'string' || !src || src.length > 2000) return null;
  let pathname: string;
  try {
    const url = new URL(src, 'http://local.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.hostname !== 'local.invalid') {
      const h = url.hostname.toLowerCase();
      if (!LOOPBACK.has(h) && !(opts.hosts ?? []).some((x) => x.toLowerCase() === h)) return null;
    }
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  let segs = pathname.split('/').filter((s) => s !== '');
  const root = (opts.designRel ?? '').replace(/^\/+|\/+$/g, '');
  if (root && segs[0] === root) segs = segs.slice(1);
  if (segs.length !== 2 || segs[0] !== 'assets') return null;
  const name = segs[1] as string;
  if (!name || name === '.' || name === '..' || /[\\\0]/.test(name)) return null;
  return `assets/${name}`;
}

/** The `GET /_api/assets` body → the local list, or null when it is not one. */
export function localAssetsOf(body: unknown): LocalAssets | null {
  const b = body as { ok?: unknown; assets?: unknown } | null;
  if (!b || typeof b !== 'object' || b.ok !== true || !Array.isArray(b.assets)) return null;
  const paths = new Set<string>();
  for (const a of b.assets) {
    const p = (a as { path?: unknown } | null)?.path;
    if (typeof p === 'string' && p.startsWith('assets/')) paths.add(p);
  }
  return { paths, complete: b.assets.length < ASSET_LIST_CAP };
}

/**
 * The clip's files that are not on this Mac (asset paths, deduplicated). Judges only project assets, and only
 * against a list that can prove absence — no list, a capped list, or a remote src gives no verdict.
 */
export function missingSources(
  sources: readonly string[] | null | undefined,
  local: LocalAssets | null,
  opts: PathOpts = {}
): string[] {
  if (!local || !local.complete || !sources?.length) return [];
  const out: string[] = [];
  for (const src of sources) {
    const p = assetPathOf(src, opts);
    if (p && !local.paths.has(p) && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Ask the existing asset-list route which files are here. Null when it did not answer. */
export async function fetchLocalAssets(fetchFn: typeof fetch = fetch): Promise<LocalAssets | null> {
  try {
    const r = await fetchFn('/_api/assets', { cache: 'no-store' });
    if (!r.ok) return null;
    return localAssetsOf(await r.json());
  } catch {
    return null;
  }
}
