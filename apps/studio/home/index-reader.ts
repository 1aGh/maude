// home/index-reader.ts — the Home server's view of the machine index (V2-1.1 §5.6, V2-1.17 §5.6).
//
// Home reads the snapshots each project server writes into $MAUDE_INDEX_DIR, never a project's live
// server (V2-1.1 decision 6). Per pid it
//   1. reads the snapshot (parse failure = missing),
//   2. recomputes the stamp from the project's canvases + config (a stat walk, ~3 ms),
//   3. merges pins and "last opened" from the project's `_canvas-state/` (§5.5),
//   4. when the stamp moved and the project's server is NOT running, rebuilds the snapshot with the
//      static extractor (read-only over sources; writes only the machine index) — a running server
//      writes its own, so its rows are served `stale: true` until it does.
//
// Every project path comes from the snapshot's `project.root` and is believed only when
// `pidOf(realpath(root)) === pid`: a snapshot naming another folder (planted, or a renamed copy) is
// served as `mismatch` and nothing is read or written there.

import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../context.ts';
import { type IndexContext, stampOf } from '../index/extract.ts';
import { match } from '../index/match.ts';
import { createIndexService } from '../index/service.ts';
import { isFresh, projection, readSnapshot, sweepTemps } from '../index/snapshot.ts';
import type { ArtboardKind, CanvasKind, ProjectIndexSnapshot, SearchRow } from '../index/types.ts';
import { readThumb } from '../thumbs/store.ts';
import { pidOf } from './pid.ts';
import { readPins, readRecent } from './user-state.ts';

export interface HomeCanvasRow {
  rel: string;
  name: string;
  folder: string;
  kind: CanvasKind;
  ds: string | null;
  mtimeMs: number;
  artboards: Array<{ id: string; label: string | null; kind: ArtboardKind | null }>;
  dynamic: boolean;
  /** `/_home/thumb/<pid>/<key>.jpg`; `fresh` = rendered from the current source */
  cover: { key: string; w: number; h: number; fresh: boolean } | null;
  madeByAi: boolean;
  pinnedAt: number | null;
  openedAt: number | null;
}

export type HomeProjectState =
  /** snapshot read, root resolves to this pid */
  | 'ok'
  /** no (readable) snapshot for this pid */
  | 'missing'
  /** the snapshot's root is gone — "isn't where it was" (V2-1.1 §5.5) */
  | 'gone'
  /** the snapshot's root resolves to ANOTHER pid — nothing read there */
  | 'mismatch';

export interface HomeProjectIndex {
  pid: string;
  state: HomeProjectState;
  /** the rows may not reflect the files (stamp moved; a running server will rewrite) */
  stale: boolean;
  /** this request rebuilt the snapshot (closed project, stamp moved) */
  rebuilt?: boolean;
  project?: {
    root: string;
    name: string;
    label: string | null;
    formatVersion: number;
    linkedHub: { url: string } | null;
    managed: boolean;
  };
  counts?: ProjectIndexSnapshot['counts'];
  canvases?: HomeCanvasRow[];
}

export interface HomeIndex {
  v: 1;
  projects: HomeProjectIndex[];
}

/** A snapshot whose root still IS this pid, with its design root, or why not. */
export function resolveProject(
  pid: string,
  snap: ProjectIndexSnapshot | null = readSnapshot(pid)
):
  | { ok: true; snap: ProjectIndexSnapshot; root: string; designRoot: string }
  | { ok: false; state: Exclude<HomeProjectState, 'ok'>; snap: ProjectIndexSnapshot | null } {
  if (!snap || snap.pid !== pid) return { ok: false, state: 'missing', snap: null };
  const root = snap.project?.root;
  const designRel = snap.project?.designRel;
  if (typeof root !== 'string' || !path.isAbsolute(root))
    return { ok: false, state: 'missing', snap };
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return { ok: false, state: 'gone', snap };
  }
  if (pidOf(real) !== pid) return { ok: false, state: 'mismatch', snap };
  if (
    typeof designRel !== 'string' ||
    !designRel ||
    path.isAbsolute(designRel) ||
    designRel.split(/[\\/]/).includes('..')
  )
    return { ok: false, state: 'missing', snap };
  const designRoot = path.join(real, designRel);
  // W5: lstat the design root and every parent up to the project root. A symlink anywhere on
  // that path resolves the design dir to ANOTHER folder — Home's closed-project rebuild and
  // `rowsOf` would read there, and `setPin` write there — so it answers like a foreign root.
  let at = real;
  for (const seg of designRel.split(/[\\/]/).filter((s) => s && s !== '.')) {
    at = path.join(at, seg);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(at);
    } catch {
      return { ok: false, state: 'gone', snap };
    }
    if (st.isSymbolicLink()) return { ok: false, state: 'mismatch', snap };
  }
  if (!existsSync(designRoot)) return { ok: false, state: 'gone', snap };
  return { ok: true, snap, root: real, designRoot };
}

function indexContext(root: string, designRoot: string): IndexContext {
  const cfg = loadConfig(root);
  return {
    designRoot,
    repoRoot: root,
    groups: cfg.canvasGroups,
    defaultDs: cfg.defaultDesignSystem || cfg.designSystems?.[0]?.name || null,
    designSystems: cfg.designSystems ?? [],
    componentDir: cfg.newComponentDir,
  };
}

/** Rebuild a CLOSED project's snapshot with the static extractor (V2-1.17 §5.6). */
function rebuildClosed(snap: ProjectIndexSnapshot, root: string, designRoot: string) {
  const ctx = indexContext(root, designRoot);
  const svc = createIndexService({
    root,
    designRel: snap.project.designRel,
    context: () => ctx,
    // what the project server said about itself last time — Home has no project context to ask
    project: () => ({
      name: snap.project.name,
      label: snap.project.label,
      formatVersion: snap.project.formatVersion,
      linkedHub: snap.project.linkedHub,
      managed: snap.project.managed,
    }),
    app: 'maude-home',
    persist: true,
  });
  svc.flush();
  svc.stop();
  return readSnapshot(snap.pid);
}

function rowsOf(snap: ProjectIndexSnapshot, designRoot: string): HomeCanvasRow[] {
  const pins = new Map(readPins(designRoot).pins.map((p) => [p.canvas, p.at]));
  const opened = readRecent(designRoot).opened;
  return snap.canvases.map((c) => ({
    rel: c.rel,
    name: c.name,
    folder: c.folder,
    kind: c.kind,
    ds: c.ds,
    mtimeMs: c.mtimeMs,
    artboards: c.artboards.map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
    dynamic: c.dynamic,
    cover: c.cover
      ? { key: c.cover.key, w: c.cover.w, h: c.cover.h, fresh: c.cover.ofSrc === c.srcHash }
      : null,
    madeByAi: c.madeByAi,
    pinnedAt: pins.get(c.rel) ?? null,
    openedAt: opened[c.rel] ?? null,
  }));
}

/** `/_home/index` — every requested pid, in request order. */
export function readHomeIndex(pids: string[], running: ReadonlySet<string> = new Set()): HomeIndex {
  const projects: HomeProjectIndex[] = [];
  for (const pid of pids) {
    sweepTemps(pid);
    const r = resolveProject(pid);
    if (!r.ok) {
      // a gone root keeps its snapshot's summary (the card names the project); a mismatch and a
      // missing snapshot carry nothing
      const snap = r.state === 'gone' ? r.snap : null;
      projects.push({
        pid,
        state: r.state,
        stale: false,
        ...(snap
          ? {
              project: {
                root: snap.project.root,
                name: snap.project.name,
                label: snap.project.label,
                formatVersion: snap.project.formatVersion,
                linkedHub: snap.project.linkedHub,
                managed: snap.project.managed,
              },
              counts: snap.counts,
            }
          : {}),
      });
      continue;
    }
    let snap = r.snap;
    let stale = false;
    let rebuilt = false;
    try {
      stale = !isFresh(snap, stampOf(indexContext(r.root, r.designRoot)));
    } catch {
      stale = true;
    }
    if (stale && !running.has(pid)) {
      try {
        const next = rebuildClosed(snap, r.root, r.designRoot);
        if (next) {
          snap = next;
          stale = false;
          rebuilt = true;
        }
      } catch {
        /* keep serving the old rows, flagged */
      }
    }
    projects.push({
      pid,
      state: 'ok',
      stale,
      ...(rebuilt ? { rebuilt } : {}),
      project: {
        root: r.root,
        name: snap.project.name,
        label: snap.project.label,
        formatVersion: snap.project.formatVersion,
        linkedHub: snap.project.linkedHub,
        managed: snap.project.managed,
      },
      counts: snap.counts,
      canvases: rowsOf(snap, r.designRoot),
    });
  }
  return { v: 1, projects };
}

export interface HomeSearchGroup {
  pid: string;
  name: string;
  label: string | null;
  rows: Array<SearchRow & { cover: string | null }>;
}

/**
 * The V2-1.17 matcher across projects. Rows carry only the cross-project projection's fields
 * (V2-1.17 §5.2 — rel, names, folder, kind, cover key): `/_home/internal/search` hands these to
 * another project's window. A pid outside `pids` is never read.
 */
export function searchHome(
  q: string,
  pids: string[],
  limit = 50
): { q: string; groups: HomeSearchGroup[]; closeOnly: boolean } {
  const groups: HomeSearchGroup[] = [];
  for (const pid of pids) {
    const r = resolveProject(pid);
    if (!r.ok) continue;
    const view = projection(r.snap);
    const opened = readRecent(r.designRoot).opened;
    const inputs: Array<{
      key: string;
      name: string;
      meta: string;
      openedAt?: number;
      group: SearchRow['group'];
      cover: string | null;
    }> = [];
    for (const c of view.canvases) {
      inputs.push({
        key: c.rel,
        name: c.name,
        meta: c.folder,
        openedAt: opened[c.rel],
        group: 'canvases',
        cover: c.cover?.key ?? null,
      });
      for (const a of c.artboards)
        inputs.push({
          key: `${c.rel}#${a.id}`,
          name: a.label ?? a.id,
          meta: `${c.name} ${c.folder} ${a.kind ?? ''}`,
          openedAt: opened[c.rel],
          group: 'artboards',
          cover: null,
        });
    }
    const hits = match(inputs, q, limit);
    if (!hits.length) continue;
    groups.push({
      pid,
      name: view.project.name,
      label: view.project.label,
      rows: hits.map((h) => ({
        group: h.row.group,
        key: h.row.key,
        name: h.row.name,
        meta: h.row.meta,
        score: h.score,
        close: h.close,
        marks: h.marks,
        cover: h.row.cover,
      })),
    });
  }
  const all = groups.flatMap((g) => g.rows);
  return { q, groups, closeOnly: all.length > 0 && all.every((r) => r.close) };
}

/**
 * The picture source for one pid: a key is served only when that pid's snapshot references it (a
 * canvas cover). Anything else — a key of another project, a key nothing references, a pid whose
 * root moved — is the same "no" (V2-1.1 §5.8 item 5, V2-1.16 L14: no existence oracle).
 */
export function thumbSource(pid: string): {
  serves(k: string): boolean;
  read(k: string): Uint8Array | null;
} {
  const r = resolveProject(pid);
  const keys = new Set<string>();
  if (r.ok) for (const c of r.snap.canvases) if (c.cover?.key) keys.add(c.cover.key);
  return {
    serves: (k) => keys.has(k),
    read: (k) => (keys.has(k) ? readThumb(pid, k) : null),
  };
}
