// The studio's canvas-only filters — V2-1.16 §5.3 L6–L10 studio halves (S9.10).
//
// THE RULE for every filtered answer: a canvas-only session sees exactly what it would
// see if the other canvases did not exist. Same shapes, counts derived from the visible
// set (U5), free text that could name another canvas rewritten from the visible paths
// or dropped (U4), invisible answers like absent (U1). A project-role session gets its
// input back unchanged — every filter here is the identity when `access.role !== null`
// (U7: v1 owner / member / viewer bodies stay byte-identical).
//
// TOP-LEVEL API (S9.11 adds `visibleTo` beside these — keep this list a union):
//
//   Visibility
//     visibilityOf(access, closure?)        one session's answer to "may I see rel?"
//     projectVisibility(ctx)                the per-project closure source (shared by
//                                           http.ts's gate and api.ts's filters):
//                                           .closureOf(access) · .visibilityFor(access) ·
//                                           .current() (this request's, via currentAccess)
//   L8 tree / config / system data
//     filterIndexData(data, vis, designRel)        GET /_index-data
//     visibleDesignSystems(list, vis)              the DS entries a session renders with
//     filterConfig(json, vis, designSystems)       GET /_config
//     filterSystemData(data, vis, designRel, ...)  GET /_system-data
//   L9 usage (the V2-1.17 project index)
//     filterIndexSnapshot(snap, vis) · filterIndexSearch(result, vis)   GET /_api/index
//   L10 comments
//     filterCommentsAll(all, vis, designRel)       GET /_comments-all, and every id lookup
//                                                  (reply / patch / delete) through it
//   L6 git / history
//     canvasOnlyLogPaths(vis, path, designRel) · mergeCanvasOnlyLog(runs, limit)
//                                                  GET /_api/git/log
//     filterGitDiff(entries, vis, designRel) · diffRefusal(vis)    GET /_api/git/diff
//     filterAcceptedHistory(rows, vis, designRel)                  GET /_api/project/history
//     changedSubject(canvases)                     the U4 subject ("Changed A, B")
//   L7 export (canvas-only rows; S8 owns the everyone-fixes)
//     exportTargetVerdict(vis, scope, files, designRel)   POST /_api/export(-jobs)
//
// Pure apart from `projectVisibility` (disk reader + bus subscription, once per project).

import type { Context } from '../context.ts';
import type { ProjectIndexSnapshot, SearchResult } from '../index/types.ts';
import { type Closure, type ClosureCache, closureFor, createClosureCache } from './closure.ts';
import { currentAccess, diskProjectReader, toDesignRel } from './request.ts';
import type { Access } from './scope.ts';

// ---------------------------------------------------------------------------
// Visibility.

export interface Visibility {
  /** A project-role session: every filter answers its input unchanged (U7). */
  readonly full: boolean;
  readonly access: Access;
  /** A canvas this session was granted (designRoot-relative). */
  seesCanvas(rel: string): boolean;
  /** A granted canvas or a file in its closure (designRoot-relative). */
  sees(rel: string): boolean;
  /** The closure of the session's grants (null without grants). */
  closure(): Closure | null;
}

/** One session's visibility. `closure` is called lazily, at most once. */
export function visibilityOf(access: Access, closure?: () => Closure | null): Visibility {
  const full = access.role !== null;
  let memo: Closure | null | undefined;
  const get = (): Closure | null => {
    if (memo === undefined) memo = access.grants.length > 0 && closure ? closure() : null;
    return memo;
  };
  return Object.freeze({
    full,
    access,
    seesCanvas: (rel: string) => full || (access.canvasOnly && access.seesCanvas(rel)),
    sees: (rel: string) => {
      if (full) return true;
      if (!access.canvasOnly) return false;
      return access.seesCanvas(rel) || (get()?.read.has(rel) ?? false);
    },
    closure: get,
  });
}

export interface ProjectVisibility {
  closureOf(access: Access): Closure | null;
  visibilityFor(access: Access): Visibility;
  /** This request's visibility (`currentAccess()`, AsyncLocalStorage set by server.ts). */
  current(): Visibility;
}

const sources = new WeakMap<object, ProjectVisibility>();

/**
 * The closure source of one project: its disk reader, a closure cache keyed by (grants,
 * tree generation) and the generation bump on every file change. ONE per Context, so the
 * write gate (http.ts) and the read filters (api.ts) compute the same closure once.
 */
export function projectVisibility(ctx: Pick<Context, 'paths' | 'bus'>): ProjectVisibility {
  const hit = sources.get(ctx);
  if (hit) return hit;
  let generation = 0;
  ctx.bus.on('fs:any', () => {
    generation++;
  });
  const cache: ClosureCache = createClosureCache();
  const reader = diskProjectReader(ctx.paths.designRoot, () => String(generation));
  const closureOf = (access: Access): Closure | null =>
    access.grants.length > 0 ? closureFor(access, reader, cache) : null;
  const visibilityFor = (access: Access) => visibilityOf(access, () => closureOf(access));
  const src: ProjectVisibility = Object.freeze({
    closureOf,
    visibilityFor,
    current: () => visibilityFor(currentAccess()),
  });
  sources.set(ctx, src);
  return src;
}

/** A path as designRoot-relative (`ui/a.tsx`), whichever form it came in. */
const rel = (p: string, designRel: string): string | null => toDesignRel(p, designRel);

// ---------------------------------------------------------------------------
// L8 — the project tree, /_config, /_system-data.

interface IndexGroupShape {
  kind?: string;
  paths: string[];
  dirs?: string[];
  dsFolders?: Array<{ name: string; path: string; folder: string }>;
}

interface IndexDataShape {
  groups: IndexGroupShape[];
  canvasDesignSystems: Record<string, string>;
  canvasKinds: Record<string, string>;
}

/** Repo-relative `.design/ui/x/y.tsx` → every ancestor dir (`.design/ui`, `.design/ui/x`). */
function ancestorsOf(p: string): string[] {
  const parts = p.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

/**
 * GET /_index-data for a canvas-only session: only visible files; `dirs` only the ancestors
 * of a visible file (no folder-only names); a group with nothing visible is not listed (its
 * label names a folder of the project); the Project and Runtime groups are dropped; the DS
 * folders, `canvasDesignSystems` and `canvasKinds` only for what is visible.
 */
export function filterIndexData<T extends IndexDataShape>(
  data: T,
  vis: Visibility,
  designRel: string,
  designSystems: ReadonlyArray<{ name: string; path: string }> = []
): T {
  if (vis.full) return data;
  const seen = (p: string) => {
    const r = rel(p, designRel);
    return r !== null && vis.sees(r);
  };
  const dsNames = new Set(visibleDesignSystems(designSystems, vis).map((d) => d.name));
  const groups: IndexGroupShape[] = [];
  for (const g of data.groups) {
    if (g.kind !== 'canvas') continue;
    const paths = g.paths.filter(seen);
    if (!paths.length) continue;
    const next: IndexGroupShape = { ...g, paths };
    if (g.dirs) {
      const keep = new Set(paths.flatMap(ancestorsOf));
      next.dirs = g.dirs.filter((d) => keep.has(d));
    }
    if (g.dsFolders) {
      const folders = g.dsFolders.filter((f) => dsNames.has(f.name));
      next.dsFolders = folders.length ? folders : undefined;
    }
    groups.push(next);
  }
  const pick = (m: Record<string, string>) =>
    Object.fromEntries(Object.entries(m).filter(([k]) => seen(k)));
  return {
    ...data,
    groups,
    canvasDesignSystems: pick(data.canvasDesignSystems),
    canvasKinds: pick(data.canvasKinds),
  };
}

/**
 * The design systems a session renders with: for a canvas-only session, a DS whose files
 * are in its closure (a granted canvas renders under it, G2). Everyone else: all of them.
 */
export function visibleDesignSystems<D extends { name: string; path: string }>(
  list: readonly D[],
  vis: Visibility
): D[] {
  if (vis.full) return [...list];
  const read = vis.closure()?.read;
  if (!read || !vis.access.canvasOnly) return [];
  return list.filter((d) => {
    const prefix = `${d.path.replace(/^\/+|\/+$/g, '')}/`;
    for (const r of read) if (r.startsWith(prefix)) return true;
    return false;
  });
}

/** Config keys that name the project's folders / link, never sent to a canvas-only session. */
const CONFIG_PROJECT_KEYS = ['newCanvasDir', 'newComponentDir', 'linkedHub'] as const;

/**
 * GET /_config for a canvas-only session: `canvasGroups: []`, `designSystems` = the visible
 * canvases' DS, no `newCanvasDir` / `newComponentDir` / `linkedHub`; a default DS it does not
 * render with is not named.
 */
export function filterConfig<T extends Record<string, unknown>>(
  json: T,
  vis: Visibility,
  designSystems: ReadonlyArray<{ name: string; path: string }>
): T {
  if (vis.full) return json;
  const visible = visibleDesignSystems(designSystems, vis);
  const names = new Set(visible.map((d) => d.name));
  const dropped = new Set<string>(CONFIG_PROJECT_KEYS);
  const d = json.defaultDesignSystem;
  const defaultDs = typeof d === 'string' && names.has(d) ? d : (visible[0]?.name ?? null);
  if (defaultDs === null) dropped.add('defaultDesignSystem');
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(json).filter(([k]) => !dropped.has(k))
  );
  out.canvasGroups = [];
  if (Array.isArray(json.designSystems)) {
    out.designSystems = (json.designSystems as Array<{ name?: unknown }>).filter(
      (x) => typeof x?.name === 'string' && names.has(x.name)
    );
  }
  if ('defaultDesignSystem' in json && defaultDs !== null) out.defaultDesignSystem = defaultDs;
  return out as T;
}

interface SystemDataShape {
  ds: { name: string } | null;
  availableDesignSystems: Array<{ name: string; path: string }>;
  defaultDesignSystem: string | null;
  readme: string | null;
  readmePath: string | null;
  tokens: unknown[];
  tokenGroups: Record<string, unknown>;
  tokensPath: string | null;
  previewGallery: Array<{ path: string }>;
  uiKitsGallery: Array<{ path: string }>;
}

/**
 * GET /_system-data for a canvas-only session: only the visible canvases' DS (an invisible
 * `?ds=` answers exactly like an unknown one — the caller's 404); the README dropped; the
 * galleries only for files it may read (specimens are outside every closure); tokens only
 * from a tokens file it may read.
 * Returns `null` when the named DS is not visible (the caller answers its unknown-DS 404).
 */
export function filterSystemData<T extends SystemDataShape>(
  data: T,
  vis: Visibility,
  designRel: string,
  designSystems: ReadonlyArray<{ name: string; path: string }>,
  /** The designRoot-relative tokens file `data.tokens` was read from. */
  tokensCssRel: string | null
): T | null {
  if (vis.full) return data;
  const visible = visibleDesignSystems(designSystems, vis);
  const names = new Set(visible.map((d) => d.name));
  if (data.ds && !names.has(data.ds.name)) return null;
  const seen = (p: string) => {
    const r = rel(p, designRel);
    return r !== null && vis.sees(r);
  };
  // `tokensPath` is repo-relative from the real path; judge the configured design-relative one.
  const tokensRel = tokensCssRel === null ? null : rel(tokensCssRel, designRel);
  const tokensOk = data.tokensPath !== null && tokensRel !== null && vis.sees(tokensRel);
  return {
    ...data,
    availableDesignSystems: data.availableDesignSystems.filter((d) => names.has(d.name)),
    defaultDesignSystem:
      data.defaultDesignSystem && names.has(data.defaultDesignSystem)
        ? data.defaultDesignSystem
        : (visible[0]?.name ?? null),
    readme: null,
    readmePath: null,
    tokens: tokensOk ? data.tokens : [],
    tokenGroups: tokensOk ? data.tokenGroups : {},
    tokensPath: tokensOk ? data.tokensPath : null,
    previewGallery: data.previewGallery.filter((g) => seen(g.path)),
    uiKitsGallery: data.uiKitsGallery.filter((g) => seen(g.path)),
  };
}

// ---------------------------------------------------------------------------
// L9 — usage: the V2-1.17 project index (⌘K, Canvases panel, "Update N canvases").

const canvasOfKey = (key: string): string => {
  const hash = key.indexOf('#');
  return hash < 0 ? key : key.slice(0, hash);
};

/** FNV-1a over a string — the derived freshness number of a filtered snapshot. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The project index for a canvas-only session: only its canvases; counts, byKind and the
 * stamp derived from those rows (U5); `access.scope: 'canvas'`; no hub link. `writer.seq` is
 * derived from the visible rows, so an edit on another canvas never moves it (the client's
 * `?since=` freshness probe is no activity oracle).
 */
export function filterIndexSnapshot(
  snap: ProjectIndexSnapshot,
  vis: Visibility
): ProjectIndexSnapshot {
  if (vis.full) return snap;
  const canvases = snap.canvases.filter((c) => vis.seesCanvas(c.rel));
  const byKind: ProjectIndexSnapshot['counts']['byKind'] = {};
  let artboards = 0;
  let maxMtimeMs = 0;
  const parts: string[] = [];
  for (const c of canvases) {
    artboards += c.artboards.length;
    for (const a of c.artboards) {
      const k = a.kind ?? 'digital';
      byKind[k] = (byKind[k] ?? 0) + 1;
    }
    if (c.mtimeMs > maxMtimeMs) maxMtimeMs = c.mtimeMs;
    parts.push(`${c.rel}\u0000${c.srcHash}\u0000${c.metaHash ?? ''}\u0000${c.artboardsFrom}`);
  }
  const digest = parts.join('\u0001');
  const hash = fnv(digest).toString(16).padStart(8, '0');
  return {
    ...snap,
    project: { ...snap.project, linkedHub: null },
    writer: { ...snap.writer, seq: fnv(`seq\u0002${digest}`) || 1 },
    stamp: { files: canvases.length, maxMtimeMs, hash },
    access: { ...snap.access, scope: 'canvas' },
    canvases,
    counts: { canvases: canvases.length, artboards, byKind },
  };
}

/** A project-index search for a canvas-only session: rows on its canvases only. */
export function filterIndexSearch(result: SearchResult, vis: Visibility): SearchResult {
  if (vis.full) return result;
  const rows = result.rows.filter((r) => vis.seesCanvas(canvasOfKey(r.key)));
  return { ...result, rows, closeOnly: rows.length > 0 && rows.every((r) => r.close) };
}

// ---------------------------------------------------------------------------
// L10 — comments.

/**
 * `{ file → Comment[] }` for a canvas-only session: only its granted canvases. Every id-based
 * mutation (reply / patch / delete) scans THIS map, so an invisible id is a missing id (U1).
 */
export function filterCommentsAll<C>(
  all: Record<string, C>,
  vis: Visibility,
  designRel: string
): Record<string, C> {
  if (vis.full) return all;
  const out: Record<string, C> = {};
  for (const [file, list] of Object.entries(all)) {
    const r = rel(file, designRel);
    if (r !== null && vis.seesCanvas(r)) out[file] = list;
  }
  return out;
}

// ---------------------------------------------------------------------------
// L6 — git and history.

/** `ui/2026/Combine-kampan.tsx` (or its sidecar) → `Combine-kampan`. */
export function canvasName(p: string): string {
  const base = p.split('/').pop() ?? p;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The U4 subject: derived from the visible canvases only, never the author's free text. */
export function changedSubject(canvases: Iterable<string>): string {
  const names = [...new Set([...canvases].map(canvasName))].sort((a, b) => a.localeCompare(b));
  return names.length ? `Changed ${names.join(', ')}` : 'Changed';
}

/** At most this many paths are logged per canvas-only request (each one is a `git log`). */
export const MAX_LOG_PATHS = 128;

/**
 * The paths a canvas-only `/_api/git/log` runs over, repo-relative, each with the canvas it
 * counts as. `path` (already scope-checked) narrows to that one file; without it, every file
 * a granted canvas owns. A project-role session: null (the log is unchanged).
 */
export function canvasOnlyLogPaths(
  vis: Visibility,
  path: string | null,
  designRel: string
): Array<{ repoRel: string; canvas: string }> | null {
  if (vis.full) return null;
  const closure = vis.closure();
  const prefix = designRel.replace(/^\/+|\/+$/g, '');
  const repo = (r: string) => (prefix ? `${prefix}/${r}` : r);
  if (path) {
    const r = rel(path, designRel);
    if (r === null || !vis.sees(r)) return [];
    return [{ repoRel: repo(r), canvas: closure?.ownedBy.get(r) ?? r }];
  }
  if (!closure || !vis.access.canvasOnly) return [];
  const out: Array<{ repoRel: string; canvas: string }> = [];
  for (const g of vis.access.grants) {
    for (const [r, canvas] of closure.ownedBy) {
      if (canvas !== g.c || out.length >= MAX_LOG_PATHS) continue;
      out.push({ repoRel: repo(r), canvas });
    }
  }
  return out;
}

interface LogEntryShape {
  sha: string;
  message: string;
  author: string;
  email: string;
  date: string;
}

/**
 * Merge per-path logs into one canvas-only log: one row per commit, the subject rewritten
 * from the visible canvases it touched (U4 — no count, no body, no other canvas), the author
 * by name only, newest first (sha breaks ties, so the order never depends on which `git log`
 * finished first), at most `limit` rows.
 */
export function mergeCanvasOnlyLog<E extends LogEntryShape>(
  runs: Array<{ canvas: string; entries: readonly E[] }>,
  limit: number
): E[] {
  const bySha = new Map<string, { entry: E; canvases: Set<string> }>();
  for (const run of runs) {
    for (const e of run.entries) {
      const hit = bySha.get(e.sha);
      if (hit) hit.canvases.add(run.canvas);
      else bySha.set(e.sha, { entry: e, canvases: new Set([run.canvas]) });
    }
  }
  return [...bySha.values()]
    .sort((a, b) =>
      a.entry.date === b.entry.date
        ? a.entry.sha.localeCompare(b.entry.sha)
        : a.entry.date < b.entry.date
          ? 1
          : -1
    )
    .slice(0, Math.max(0, limit))
    .map(({ entry, canvases }) => ({
      ...entry,
      message: changedSubject(canvases),
      email: '',
    }));
}

/**
 * GET /_api/git/diff is raw source — the `export` class (V2-1.7 §5.2). `'capability'` when
 * the session holds export nowhere; null when it may diff (its file list is then filtered).
 */
export function diffRefusal(vis: Visibility): 'capability' | null {
  const a = vis.access;
  if (a.can('export', null)) return null;
  if (a.canvasOnly && a.grants.some((g) => a.can('export', g.c))) return null;
  return 'capability';
}

/** A canvas-only diff: only files a granted canvas owns, and only where it holds export. */
export function filterGitDiff<E extends { file: string }>(
  entries: readonly E[],
  vis: Visibility,
  designRel: string
): E[] {
  if (vis.full) return [...entries];
  const owned = vis.closure()?.ownedBy;
  if (!owned) return [];
  return entries.filter((e) => {
    const r = rel(e.file, designRel);
    const canvas = r === null ? undefined : owned.get(r);
    return canvas !== undefined && vis.access.can('export', canvas);
  });
}

interface HistoryRowShape {
  label?: unknown;
  canvases?: unknown;
}

/**
 * GET /_api/project/history for a canvas-only session: a row with no visible canvas is
 * dropped; `canvases` keeps only the visible ones; the label is rewritten from them (U4).
 */
export function filterAcceptedHistory<R>(
  rows: readonly R[],
  vis: Visibility,
  designRel: string
): R[] {
  if (vis.full) return [...rows];
  const out: R[] = [];
  for (const row of rows) {
    const list = (row as HistoryRowShape | null)?.canvases;
    const canvases = (Array.isArray(list) ? list : []).filter((p) => {
      const r = typeof p === 'string' ? rel(p, designRel) : null;
      return r !== null && vis.seesCanvas(r);
    }) as string[];
    if (!canvases.length) continue;
    out.push({ ...row, canvases, label: changedSubject(canvases) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// L7 — export targets (canvas-only rows).

/** Scopes that pack the project, not a canvas — `project`-class (V2-1.16 L7). */
export const PROJECT_EXPORT_SCOPES: ReadonlySet<string> = new Set(['project-raw']);

/**
 * May a session WITHOUT a project-level `export` export these resolved target files? A
 * project scope, or any target outside its grants, is `not-in-scope` (the same 403 a
 * missing canvas gets); a visible target it may not export is `capability`.
 */
export function exportTargetVerdict(
  vis: Visibility,
  scope: string,
  files: readonly string[],
  designRel: string
): 'ok' | 'not-in-scope' | 'capability' {
  const a = vis.access;
  if (a.can('export', null)) return 'ok';
  if (a.grants.length === 0) return 'capability';
  if (PROJECT_EXPORT_SCOPES.has(scope)) return a.canvasOnly ? 'not-in-scope' : 'capability';
  let verdict: 'ok' | 'capability' = 'ok';
  for (const f of files) {
    const r = rel(f, designRel);
    if (r === null) return 'not-in-scope';
    if (a.canvasOnly && !a.seesCanvas(r)) return 'not-in-scope';
    if (!a.can('export', r)) verdict = 'capability';
  }
  return verdict;
}
