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
// - `journal` (2.0.3, a materializing cell): on a cell the disk is a cache (DDR-243) — a system's media lives in the
//   bucket and is served from a hub-owned cache outside the design root, never at its checkout path, so a disk-only
//   listing showed every folder with 0 files. The hub's inert-media listing (`listMaterializable`, the source the file
//   tree and the closure's `withJournalMedia` read) joins the disk: its paths under the library count, list, search and
//   page like files on disk (size/mtime 0 — the hub hands out paths only). It only ADDS names: a disk entry at the same
//   path (a symlink included) is judged as before, and a folder that is a symlink on disk stays refused.

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

/**
 * The folders from the designRoot down to `rel`: `real` when every one is a real folder, `bad` when one is a symlink or
 * not a folder, `absent` when the chain stops at a name that is not there (only the journal can hold files below it).
 */
async function dirChain(designRoot: string, rel: string): Promise<'real' | 'absent' | 'bad'> {
  let cur = designRoot;
  for (const seg of rel.split('/')) {
    cur = path.join(cur, seg);
    try {
      const st = await lstat(cur);
      if (!st.isDirectory()) return 'bad';
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code === 'ENOENT' ? 'absent' : 'bad';
    }
  }
  return 'real';
}

/** The journal's media below `base` (designRoot-relative), shape-checked: no empty / `..` / `_` / `.` segment. */
function journalUnder(base: string, journal: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!journal) return out;
  const under = `${base}/`;
  for (const rel of journal) {
    if (typeof rel !== 'string' || !rel.startsWith(under) || rel.length > 1024) continue;
    const segs = rel.slice(under.length).split('/');
    if (segs.some((s) => !s || s === '..' || hiddenName(s) || s.includes('\\') || s.includes('\0')))
      continue;
    if (dsAssetKindOf(rel)) out.add(rel);
  }
  return out;
}

async function dirents(abs: string): Promise<Dirent[]> {
  try {
    return await readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Media files directly inside (by name), and whether a folder is inside (a folder with neither is not one to open). */
async function shallowCount(abs: string): Promise<{ names: Set<string>; dirs: boolean }> {
  const names = new Set<string>();
  let dirs = false;
  for (const e of await dirents(abs)) {
    if (hiddenName(e.name)) continue;
    if (e.isDirectory()) dirs = true;
    else if (e.isFile() && dsAssetKindOf(e.name)) names.add(e.name);
  }
  return { names, dirs };
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

async function rowOf(
  designRoot: string,
  rel: string,
  journal: ReadonlySet<string>
): Promise<DsAssetFile | null> {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const kind = dsAssetKindOf(name);
  if (!kind) return null;
  const row = (size: number, mtimeMs: number): DsAssetFile => ({
    path: rel,
    name,
    ext: path.extname(name).slice(1).toLowerCase(),
    kind,
    size,
    mtimeMs,
    placeable: kind !== 'audio' && dsAssetRel(rel) !== null,
  });
  try {
    const st = await lstat(path.join(designRoot, rel));
    if (!st.isFile()) return null;
    return row(st.size, st.mtimeMs);
  } catch (err) {
    // not on this disk: a materializing cell's journal names it (the hub serves it from its cache)
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT' && journal.has(rel)) return row(0, 0);
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
  /** a materializing cell: inert media the hub serves although the checkout does not hold it (designRoot-relative) */
  journal?: Iterable<string> | null;
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
  const journal = journalUnder(base, input.journal);
  // one lstat chain per folder, shared by every path below it
  const chains = new Map<string, Promise<'real' | 'absent' | 'bad'>>();
  const chainOf = (d: string) => {
    let p = chains.get(d);
    if (!p) {
      p = dirChain(designRoot, d);
      chains.set(d, p);
    }
    return p;
  };
  const parentOf = (rel: string) => rel.slice(0, rel.lastIndexOf('/'));
  /** journal paths, minus any whose folder on the way is a symlink (or not a folder) on this disk */
  const journalOk = async (rels: string[]) => {
    const ok = await Promise.all(rels.map(async (r) => (await chainOf(parentOf(r))) !== 'bad'));
    return rels.filter((_, i) => ok[i]);
  };

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
    // on a cell a closure path may be the journal's only, in a folder this disk does not hold at all
    const journalBelow = (d: string) => {
      for (const r of journal) if (r.startsWith(`${d}/`)) return true;
      return false;
    };
    const fileOk = async (rel: string) => {
      const c = await chainOf(parentOf(rel));
      return c === 'real' || (c === 'absent' && journal.has(rel));
    };
    const ok = await Promise.all(files.map(fileOk));
    files = files.filter((_, i) => ok[i]);
    for (const d of [...dirCounts.keys()]) {
      const c = await chainOf(d);
      if (!(c === 'real' || (c === 'absent' && journalBelow(d)))) dirCounts.delete(d);
    }
  } else {
    const baseChain = await chainOf(base);
    if (baseChain === 'bad' || (baseChain === 'absent' && !journal.size)) {
      // no library yet is an empty one; a folder that is not there (or a symlink) is not found
      if (!dir && (await chainOf(root)) === 'absent')
        return { ok: true, root, dir, dirs: [], files: [], total: 0, next: null };
      return { ok: false, status: 404, reason: 'not-found' };
    }
    const onDisk = baseChain === 'real';
    if (words.length) {
      const all = new Set(onDisk ? await walkMedia(designRoot, base) : []);
      for (const r of await journalOk([...journal].filter((r) => !all.has(r)))) all.add(r);
      files = [...all].filter((rel) => matches(rel.slice(rel.lastIndexOf('/') + 1), words));
    } else {
      const here = new Set<string>();
      const subdirs = new Set<string>();
      if (onDisk)
        for (const e of await dirents(path.join(designRoot, base))) {
          if (hiddenName(e.name)) continue;
          if (e.isDirectory()) subdirs.add(`${base}/${e.name}`);
          else if (e.isFile() && dsAssetKindOf(e.name)) here.add(`${base}/${e.name}`);
        }
      // the journal's: files directly in this folder, and the folders below it (by their first segment)
      const direct: string[] = [];
      const below = new Map<string, string[]>();
      for (const r of journal) {
        const rest = r.slice(base.length + 1);
        const slash = rest.indexOf('/');
        if (slash < 0) {
          if (!here.has(r)) direct.push(r);
          continue;
        }
        const d = `${base}/${rest.slice(0, slash)}`;
        const list = below.get(d);
        if (list) list.push(r);
        else below.set(d, [r]);
      }
      for (const r of await journalOk(direct)) here.add(r);
      files = [...here];
      if (!cursor) {
        for (const d of below.keys()) subdirs.add(d);
        const shown: string[] = [];
        for (const d of [...subdirs].sort(byPath)) {
          if (shown.length >= DIRS_MAX) break;
          // a journal folder whose name is a symlink (or a file) on this disk is not one to open
          if ((await chainOf(d)) !== 'bad') shown.push(d);
        }
        const counts = await Promise.all(
          shown.map(async (d) => {
            const c =
              (await chainOf(d)) === 'real' ? await shallowCount(path.join(designRoot, d)) : null;
            const names = c?.names ?? new Set<string>();
            let dirs = c?.dirs ?? false;
            for (const r of below.get(d) ?? []) {
              const rest = r.slice(d.length + 1);
              if (rest.includes('/')) dirs = true;
              else names.add(rest);
            }
            return { count: names.size, dirs };
          })
        );
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
  const rows = (await Promise.all(slice.map((rel) => rowOf(designRoot, rel, journal)))).filter(
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
