// index/snapshot.ts — the persisted project index (V2-2.17, contract V2-1.17 §5.2/§5.6).
//
// One machine cache, outside every project tree (never synced, no DDR-115 list entry):
//   $MAUDE_INDEX_DIR or ~/.maude/index/v1/projects/<pid>/index.json
// Writes are atomic (tmp → fsync → rename); a reader trusts nothing the writer claims and
// recomputes the stamp — a crash between an edit and the debounce, or edits made while no server
// ran (terminal Claude Code, git, Syncthing), all show up as `stale`.

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import type { ProjectIndexSnapshot, Stamp } from './types.ts';

export const SNAPSHOT_CAP_BYTES = 256 * 1024;

export function indexDir(): string {
  return process.env.MAUDE_INDEX_DIR || path.join(homedir(), '.maude', 'index', 'v1');
}

/** V2-1.1 §5.2: `l` + the first 16 hex of sha256(realpath(root)). */
export function pidOf(root: string): string {
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    /* gone — hash what we were given */
  }
  return `l${createHash('sha256').update(real).digest('hex').slice(0, 16)}`;
}

export const projectDir = (pid: string) => path.join(indexDir(), 'projects', pid);
export const snapshotPath = (pid: string) => path.join(projectDir(pid), 'index.json');

/** Over the cap, the artboard rows of the oldest canvases leave the snapshot (they stay in memory). */
export function capSnapshot(snap: ProjectIndexSnapshot): ProjectIndexSnapshot {
  let text = JSON.stringify(snap);
  if (text.length <= SNAPSHOT_CAP_BYTES) return snap;
  const canvases = snap.canvases.map((c) => ({ ...c }));
  const oldestFirst = [...canvases].sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const c of oldestFirst) {
    if (!c.artboards.length) continue;
    c.artboards = [];
    text = JSON.stringify({ ...snap, canvases });
    if (text.length <= SNAPSHOT_CAP_BYTES) break;
  }
  return { ...snap, canvases };
}

/** Atomic write: tmp-<pid>-<rand> → fsync → rename. */
export function writeSnapshot(snap: ProjectIndexSnapshot): string {
  const dir = projectDir(snap.pid);
  mkdirSync(dir, { recursive: true });
  const final = snapshotPath(snap.pid);
  const tmp = `${final}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(capSnapshot(snap)));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, final);
  return final;
}

/** The snapshot as written, or null when missing / unreadable (both mean "build it"). */
export function readSnapshot(pid: string): ProjectIndexSnapshot | null {
  try {
    const snap = JSON.parse(readFileSync(snapshotPath(pid), 'utf8')) as ProjectIndexSnapshot;
    return snap.format === 'maude.project-index' && snap.v === 1 ? snap : null;
  } catch {
    return null;
  }
}

/** Fresh only when the recomputed stamp equals the written one. */
export function isFresh(snap: ProjectIndexSnapshot, now: Stamp): boolean {
  return snap.stamp.hash === now.hash && snap.stamp.files === now.files;
}

/** Temp files older than an hour are a dead writer's — any reader sweeps them. */
export function sweepTemps(pid: string, now = Date.now()) {
  const dir = projectDir(pid);
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    if (!n.startsWith('index.json.tmp-')) continue;
    try {
      if (now - statSync(path.join(dir, n)).mtimeMs > 60 * 60 * 1000)
        rmSync(path.join(dir, n), { force: true });
    } catch {
      /* raced */
    }
  }
}

/** What another project's window may see (V2-1.17 §5.2): no root, no hashes, no hub. */
export function projection(snap: ProjectIndexSnapshot) {
  return {
    pid: snap.pid,
    project: {
      name: snap.project.name,
      label: snap.project.label,
      formatVersion: snap.project.formatVersion,
    },
    canvases: snap.canvases.map((c) => ({
      rel: c.rel,
      name: c.name,
      folder: c.folder,
      kind: c.kind,
      artboards: c.artboards.map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
      cover: c.cover ? { key: c.cover.key } : null,
      mtimeMs: c.mtimeMs,
      madeByAi: c.madeByAi,
    })),
  };
}
