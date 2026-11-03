// ds-assets.ts — a design system's own asset library, one folder at a time (2.0.2; the Assets tab's "Design system"
// source, routes/ds-assets.ts).
//
// v1 let a person browse a design system's picked photo gallery from the left panel; v2's Assets tab listed only the
// project's flat uploads under `<designRoot>/assets/`. A real system keeps thousands of pictures in folders under
// `system/<ds>/assets/` (photos-cut/, logos/, …): this lists them so none of them is out of reach.
//
//   listDsAssets({ designRoot, systemPath, dir, q, cursor, limit, candidates? })
//     → { ok, ds root, dir, dirs:[{path,name,count}], files:[{path,name,ext,kind,size,mtimeMs,placeable}], total, next }
//
// - Media only: the same image / video / sound extensions the project listing shows (api.ts `listAssets`).
// - Contained: `systemPath` must be `system/<one segment>`; every segment of `dir` is a real folder (lstat — a symlink
//   anywhere on the way is refused, and a symlinked file is never listed); `_` runtime names and `.` hidden names are
//   neither walked nor listed.
// - Fast on one 3000-file folder: ONE readdir (a Dirent says file / folder / symlink without a stat), sort by name,
//   then lstat only the page. A folder's `count` is one shallow readdir of it. A search walks from `dir` down, readdir
//   only, with a depth and an entry cap.
// - Paged by name: `cursor` is the last path of the previous page (keyset, so a file added meanwhile neither repeats
//   nor shifts a page); `limit` defaults to 200 and is capped at 500.
// - `candidates` (a canvas-only session): the listing is built from THOSE paths only (the session's closure), never
//   from the disk — such a session learns nothing about a file its canvases do not show.

import type { Dirent } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { dsAssetRel } from './editing/ds-asset-ref.ts';

const IMG = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);
const VID = new Set(['.mp4', '.webm', '.mov', '.m4v', '.ogg']);
const AUD = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.oga', '.opus']);

export type DsAssetKind = 'image' | 'video' | 'audio';

export function dsAssetKindOf(name: string): DsAssetKind | null {
  const ext = path.extname(name).toLowerCase();
  return IMG.has(ext) ? 'image' : VID.has(ext) ? 'video' : AUD.has(ext) ? 'audio' : null;
}

export const DS_ASSETS_LIMIT = 200;
export const DS_ASSETS_LIMIT_MAX = 500;
const DIRS_MAX = 200;
const SEARCH_DEPTH = 10;
const SEARCH_VISIT_MAX = 50_000;
const DIR_MAX_LEN = 400;
const Q_MAX_LEN = 120;

export interface DsAssetFile {
  path: string;
  name: string;
  ext: string;
  kind: DsAssetKind;
  size: number;
  mtimeMs: number;
  /** a canvas can show it: `image.place` takes it as a literal reference (editing/ds-asset-ref.ts) */
  placeable: boolean;
}
export interface DsAssetDir {
  path: string;
  name: string;
  /** pictures, clips and sounds directly inside */
  count: number;
}
export interface DsAssetPage {
  ok: true;
  /** `system/<ds>/assets` */
  root: string;
  /** the folder listed, relative to `root` ('' = the library's top) */
  dir: string;
  dirs: DsAssetDir[];
  files: DsAssetFile[];
  /** how many files match in this folder (or this search), all pages together */
  total: number;
  /** the cursor of the next page, or null */
  next: string | null;
}
export type DsAssetRefusal = { ok: false; status: number; reason: string };

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const byPath = (a: string, b: string) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

const hiddenName = (n: string) => n.startsWith('_') || n.startsWith('.');

/** The assets root of a configured system path, or null when it is not `system/<one segment>`. */
export function dsAssetsRootOf(systemPath: unknown): string | null {
  if (typeof systemPath !== 'string') return null;
  const p = systemPath.replace(/^\/+|\/+$/g, '');
  const m = /^system\/([^/]+)$/.exec(p);
  if (!m || hiddenName(m[1] as string) || m[1] === '..') return null;
  return `${p}/assets`;
}

/** A folder below the root: '' or `a/b`; null when any segment is empty, `.`/`..`, `_…`/`.…`, or has a `\`. */
export function normDsDir(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw !== 'string' || raw.length > DIR_MAX_LEN) return null;
  const d = raw.replace(/^\/+|\/+$/g, '');
  if (!d) return '';
  const parts = d.split('/');
  for (const s of parts) {
    if (!s || s === '..' || s === '.' || hiddenName(s) || s.includes('\\') || s.includes('\0'))
      return null;
  }
  return parts.join('/');
}

function searchWords(q: unknown): string[] {
  if (typeof q !== 'string') return [];
  return q.slice(0, Q_MAX_LEN).toLowerCase().split(/\s+/).filter(Boolean);
}

const matches = (name: string, words: string[]) => {
  const n = name.toLowerCase();
  return words.every((w) => n.includes(w));
};

function clampLimit(raw: unknown): number {
  const n =
    typeof raw === 'string' ? Number.parseInt(raw, 10) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n <= 0) return DS_ASSETS_LIMIT;
  return Math.min(Math.trunc(n), DS_ASSETS_LIMIT_MAX);
}

/** Every segment from the designRoot down to `rel` is a real folder (no symlink on the way). */
async function realDirChain(designRoot: string, rel: string): Promise<boolean> {
  let cur = designRoot;
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    try {
      const st = await lstat(cur);
      if (!st.isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function dirents(abs: string): Promise<Dirent[]> {
  try {
    return await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Media files directly inside, and whether a folder is inside (a folder with neither is not one to open). */
async function shallowCount(abs: string): Promise<{ count: number; dirs: boolean }> {
  let count = 0;
  let dirs = false;
  for (const e of await dirents(abs)) {
    if (hiddenName(e.name)) continue;
    if (e.isDirectory()) dirs = true;
    else if (e.isFile() && dsAssetKindOf(e.name)) count++;
  }
  return { count, dirs };
}

/** Media files under `startRel` (designRoot-relative), readdir only. */
async function walkMedia(designRoot: string, startRel: string): Promise<string[]> {
  const out: string[] = [];
  let visited = 0;
  const stack: Array<{ rel: string; depth: number }> = [{ rel: startRel, depth: 0 }];
  while (stack.length && visited < SEARCH_VISIT_MAX) {
    const { rel, depth } = stack.pop() as { rel: string; depth: number };
    for (const e of await dirents(path.join(designRoot, rel))) {
      if (++visited > SEARCH_VISIT_MAX) break;
      if (hiddenName(e.name)) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (depth + 1 < SEARCH_DEPTH) stack.push({ rel: child, depth: depth + 1 });
      } else if (e.isFile() && dsAssetKindOf(e.name)) out.push(child);
    }
  }
  return out;
}

async function rowOf(designRoot: string, rel: string): Promise<DsAssetFile | null> {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const kind = dsAssetKindOf(name);
  if (!kind) return null;
  try {
    const st = await lstat(path.join(designRoot, rel));
    if (!st.isFile()) return null;
    return {
      path: rel,
      name,
      ext: path.extname(name).slice(1).toLowerCase(),
      kind,
      size: st.size,
      mtimeMs: st.mtimeMs,
      placeable: kind !== 'audio' && dsAssetRel(rel) !== null,
    };
  } catch {
    return null;
  }
}

export interface ListDsAssetsInput {
  designRoot: string;
  /** the system's configured path (designRoot-relative): `system/<ds>` */
  systemPath: string;
  dir?: unknown;
  q?: unknown;
  cursor?: unknown;
  limit?: unknown;
  /** a canvas-only session: the designRoot-relative paths it may see (its closure); the disk is not walked */
  candidates?: Iterable<string>;
}

export async function listDsAssets(
  input: ListDsAssetsInput
): Promise<DsAssetPage | DsAssetRefusal> {
  const root = dsAssetsRootOf(input.systemPath);
  if (!root) return { ok: false, status: 404, reason: 'not-found' };
  const dir = normDsDir(input.dir);
  if (dir === null) return { ok: false, status: 400, reason: 'bad-dir' };
  const designRoot = path.resolve(input.designRoot);
  const base = dir ? `${root}/${dir}` : root;
  const words = searchWords(input.q);
  const limit = clampLimit(input.limit);
  const cursor = typeof input.cursor === 'string' && input.cursor ? input.cursor : null;

  // The candidate files (designRoot-relative) and the folders directly below `base`.
  let files: string[];
  const dirCounts = new Map<string, number>();
  if (input.candidates) {
    files = [];
    const under = `${base}/`;
    for (const rel of input.candidates) {
      if (typeof rel !== 'string' || !rel.startsWith(under)) continue;
      const rest = rel.slice(under.length);
      const segs = rest.split('/');
      if (segs.some((s) => !s || s === '..' || hiddenName(s))) continue;
      if (!dsAssetKindOf(rest)) continue;
      if (words.length) {
        if (matches(segs[segs.length - 1] as string, words)) files.push(rel);
      } else if (segs.length === 1) files.push(rel);
      else if (segs.length === 2) {
        const d = `${base}/${segs[0]}`;
        dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      } else {
        const d = `${base}/${segs[0]}`;
        dirCounts.set(d, dirCounts.get(d) ?? 0);
      }
    }
    // a folder exists for this session only when a file it may see is under it; and every folder on the way to a
    // listed file is a real one (a symlinked folder is not walked in a project listing either)
    if (dir && !files.length && !dirCounts.size)
      return { ok: false, status: 404, reason: 'not-found' };
    const real = new Map<string, Promise<boolean>>();
    const chainOk = (rel: string) => {
      const d = rel.slice(0, rel.lastIndexOf('/'));
      const known = real.get(d);
      if (known) return known;
      const p = realDirChain(designRoot, d);
      real.set(d, p);
      return p;
    };
    const ok = await Promise.all(files.map(chainOk));
    files = files.filter((_, i) => ok[i]);
    for (const d of [...dirCounts.keys()])
      if (!(await realDirChain(designRoot, d))) dirCounts.delete(d);
  } else {
    if (!(await realDirChain(designRoot, base))) {
      // no library yet is an empty one; a folder that is not there (or a symlink) is not found
      if (!dir && !(await realDirChain(designRoot, root)))
        return { ok: true, root, dir, dirs: [], files: [], total: 0, next: null };
      return { ok: false, status: 404, reason: 'not-found' };
    }
    if (words.length) {
      files = (await walkMedia(designRoot, base)).filter((rel) =>
        matches(rel.slice(rel.lastIndexOf('/') + 1), words)
      );
    } else {
      files = [];
      const subdirs: string[] = [];
      for (const e of await dirents(path.join(designRoot, base))) {
        if (hiddenName(e.name)) continue;
        if (e.isDirectory()) subdirs.push(`${base}/${e.name}`);
        else if (e.isFile() && dsAssetKindOf(e.name)) files.push(`${base}/${e.name}`);
      }
      if (!cursor) {
        subdirs.sort(byPath);
        const shown = subdirs.slice(0, DIRS_MAX);
        const counts = await Promise.all(shown.map((d) => shallowCount(path.join(designRoot, d))));
        shown.forEach((d, i) => {
          const c = counts[i] as { count: number; dirs: boolean };
          if (c.count || c.dirs) dirCounts.set(d, c.count);
        });
      }
    }
  }

  files.sort(byPath);
  const total = files.length;
  const from = cursor ? files.findIndex((f) => byPath(f, cursor) > 0) : 0;
  const slice = from < 0 ? [] : files.slice(from, from + limit);
  const rows = (await Promise.all(slice.map((rel) => rowOf(designRoot, rel)))).filter(
    (r): r is DsAssetFile => r !== null
  );
  const more = from >= 0 && from + limit < files.length;
  const dirs: DsAssetDir[] =
    cursor || words.length
      ? []
      : [...dirCounts.entries()]
          .sort((a, b) => byPath(a[0], b[0]))
          .map(([p, count]) => ({ path: p, name: p.slice(p.lastIndexOf('/') + 1), count }));
  return {
    ok: true,
    root,
    dir,
    dirs,
    files: rows,
    total,
    next: more ? (slice[slice.length - 1] as string) : null,
  };
}
