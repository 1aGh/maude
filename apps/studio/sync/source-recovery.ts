// Bounded recovery slots, outside the rolling snapshot queue: a corrupt peer
// cannot evict the last valid source by flooding rejected updates (#121).
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './atomic-write.ts';
import { MAX_HTML_BYTES } from './limits.ts';
import { sourceError } from './source-validation.ts';

/**
 * `base` is the body disk and doc last agreed on — the merge base a restart
 * needs, since the journal keeps only its hash (audit 2026-09-13 P0 #1).
 */
export type RecoverySlot = 'last-valid' | 'local' | 'incoming' | 'base';

/** The first rejected draft and its proven base, not the mutable latest draft. */
export interface RecoveryCandidate {
  version: 1;
  original: string | null;
  base: string | null;
  resolved: boolean;
}

function candidatePath(historyDir: string, file: string): string {
  return path.join(historyDir, 'sync-recovery', `candidate${path.extname(file)}.json`);
}

/**
 * #168 T5.4 S1 — the recovery folder a WRITE may use, or a throw (callers report it as
 * `snapshotFailed`). `historyDir` is `<designRoot>/_history/<slug>`: no folder from the design
 * root down to `sync-recovery` may be a symlink, and the folder must resolve inside the design
 * root, so a link planted under `_history` (a cloned repo can carry one) never carries the bytes
 * elsewhere. The design root itself may sit behind a link (a shared design folder). The design
 * root is the parent of the path's last `_history` segment; a path without one is anchored at
 * `historyDir`'s parent.
 */
function writableRecoveryDir(historyDir: string): string {
  const dir = path.resolve(historyDir, 'sync-recovery');
  const parts = dir.split(path.sep);
  const at = parts.lastIndexOf('_history');
  const anchor =
    at > 0 ? parts.slice(0, at).join(path.sep) || path.sep : path.dirname(path.resolve(historyDir));
  let cur = anchor;
  let deepest = anchor;
  for (const seg of path.relative(anchor, dir).split(path.sep)) {
    cur = path.join(cur, seg);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(cur);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; // created as plain folders
      throw error;
    }
    if (st.isSymbolicLink()) throw new Error('Recovery folder is a symlink; not written');
    if (!st.isDirectory()) throw new Error('Recovery folder is not a folder; not written');
    deepest = cur;
  }
  const root = realpathSync(anchor);
  const real = realpathSync(deepest);
  if (real !== root && !real.startsWith(`${root}${path.sep}`))
    throw new Error('Recovery folder is outside the design root; not written');
  return dir;
}

function boundedBody(body: unknown): body is string | null {
  return (
    body === null || (typeof body === 'string' && Buffer.byteLength(body, 'utf8') <= MAX_HTML_BYTES)
  );
}

/** Corrupt/inaccessible records fail closed: never replace an unreadable draft. */
export function readRecoveryCandidate(historyDir: string, file: string): RecoveryCandidate | null {
  const target = candidatePath(historyDir, file);
  let size: number;
  try {
    size = statSync(target).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  // Two byte-capped strings, each potentially JSON-escaped as six bytes/char.
  if (size > 12 * MAX_HTML_BYTES + 256) throw new Error('Recovery candidate exceeds size limit');
  const value: unknown = JSON.parse(readFileSync(target, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid recovery candidate');
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.resolved !== 'boolean' ||
    !boundedBody(record.original) ||
    !boundedBody(record.base)
  )
    throw new Error('Invalid recovery candidate');
  return { version: 1, original: record.original, base: record.base, resolved: record.resolved };
}

/** One bounded, atomic record per source file; retries/restarts cannot evict it. */
export function preserveRecoveryCandidate(
  historyDir: string,
  file: string,
  original: string | null,
  base: string | null
): void {
  if (!boundedBody(original) || !boundedBody(base))
    throw new Error('Recovery source exceeds size limit');
  const previous = readRecoveryCandidate(historyDir, file);
  if (previous && !previous.resolved) return;
  writableRecoveryDir(historyDir);
  atomicWrite(
    candidatePath(historyDir, file),
    JSON.stringify({ version: 1, original, base, resolved: false })
  );
}

/** Retain the bytes after resolution, allowing replacement only by a new episode. */
export function resolveRecoveryCandidate(historyDir: string, file: string): void {
  const previous = readRecoveryCandidate(historyDir, file);
  if (!previous || previous.resolved) return;
  writableRecoveryDir(historyDir);
  atomicWrite(candidatePath(historyDir, file), JSON.stringify({ ...previous, resolved: true }));
}

export function saveRecoveryBody(
  historyDir: string,
  file: string,
  slot: RecoverySlot,
  body: string
): string {
  if (Buffer.byteLength(body, 'utf8') > MAX_HTML_BYTES)
    throw new Error('Recovery source exceeds size limit');
  const target = path.join(historyDir, 'sync-recovery', `${slot}${path.extname(file)}`);
  writableRecoveryDir(historyDir);
  if (!existsSync(target) || readFileSync(target, 'utf8') !== body) atomicWrite(target, body);
  return target;
}

/** One recovery slot's body, or null when absent/unreadable/oversized. */
export function readRecoveryBody(
  historyDir: string,
  file: string,
  slot: RecoverySlot
): string | null {
  const target = path.join(historyDir, 'sync-recovery', `${slot}${path.extname(file)}`);
  try {
    if (statSync(target).size > MAX_HTML_BYTES) return null;
    return readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

export function lastValidSource(historyDir: string, file: string): string | null {
  const ext = path.extname(file);
  const retained = path.join(historyDir, 'sync-recovery', `last-valid${ext}`);
  let candidates = [retained];
  try {
    candidates = candidates.concat(
      readdirSync(historyDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(ext))
        .map((e) => e.name)
        .sort()
        .reverse()
        .slice(0, 300)
        .map((name) => path.join(historyDir, name))
    );
  } catch {
    /* no older history */
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).size > MAX_HTML_BYTES) continue;
      const body = readFileSync(candidate, 'utf8');
      if (body.trim() && sourceError(file, body) === null) return body;
    } catch {
      /* try the next snapshot */
    }
  }
  return null;
}
