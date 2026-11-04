// A Git LFS pointer file standing where a picture or clip should be (2.0.3).
//
// A project committed with Git LFS but cloned without `git lfs pull` keeps a ~130-byte text file in
// place of each media file:
//
//   version https://git-lfs.github.com/spec/v1
//   oid sha256:<64 hex>
//   size <n>
//
// The canvas cannot draw it, and the sync must not send it up as if it were the media. This module
// only RECOGNISES one: a regular file of at most 1 KB whose first line is exactly the spec line. It
// never reads more than the first 1 KB and never reads a bigger file at all.

import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

/** What the sync says about a pointer it will not upload (the Sync panel shows it). */
export const LFS_POINTER_REASON =
  'A Git LFS placeholder, not the file. Run git lfs pull (or Fix with AI on the picture).';

/** The pointer spec allows ≤ 1024 bytes; anything bigger is the real file. */
export const LFS_POINTER_MAX_BYTES = 1024;
export const LFS_SPEC_LINE = 'version https://git-lfs.github.com/spec/v1';

export interface LfsPointer {
  /** The sha256 of the real file, when the pointer carries a well-formed one. */
  oid: string | null;
  /** The real file's size in bytes, when the pointer says it. */
  size: number | null;
}

/** Parse pointer TEXT (pure). Null when it is not a pointer. */
export function parseLfsPointer(text: string): LfsPointer | null {
  if (text.length > LFS_POINTER_MAX_BYTES) return null;
  const nl = text.indexOf('\n');
  const first = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '');
  if (first !== LFS_SPEC_LINE) return null;
  const oid = /^oid sha256:([0-9a-f]{64})\r?$/m.exec(text)?.[1] ?? null;
  const sizeRaw = /^size (\d{1,15})\r?$/m.exec(text)?.[1];
  return { oid, size: sizeRaw === undefined ? null : Number(sizeRaw) };
}

/**
 * Read a file and say whether it is a pointer. A symlink, a directory, a missing file or anything
 * over 1 KB is not one (and is never opened).
 */
export function readLfsPointer(abs: string): LfsPointer | null {
  let fd: number | null = null;
  try {
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > LFS_POINTER_MAX_BYTES || st.size < LFS_SPEC_LINE.length)
      return null;
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(LFS_POINTER_MAX_BYTES);
    const n = readSync(fd, buf, 0, LFS_POINTER_MAX_BYTES, 0);
    return parseLfsPointer(buf.subarray(0, n).toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* already gone */
      }
    }
  }
}

/** True when the bytes already in hand (≤ 1 KB) are a pointer. */
export function isLfsPointerBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength > LFS_POINTER_MAX_BYTES) return false;
  return parseLfsPointer(Buffer.from(bytes).toString('utf8')) !== null;
}

/**
 * The LFS object store of the git repository that holds `projectRoot`: `<git common dir>/lfs/objects`.
 * Walks UP from the server's own project root (never from a request) at most `maxUp` levels to the
 * first `.git`; a `.git` FILE (a worktree, a submodule) is followed to its `gitdir:` and that dir's
 * `commondir`. Null when there is no repository or no LFS store.
 */
export function lfsObjectsDir(projectRoot: string, maxUp = 8): string | null {
  let dir = path.resolve(projectRoot);
  for (let i = 0; i <= maxUp; i++) {
    const dotGit = path.join(dir, '.git');
    const gitDir = resolveGitDir(dotGit);
    if (gitDir) {
      const store = path.join(gitDir, 'lfs', 'objects');
      try {
        return statSync(store).isDirectory() ? store : null;
      } catch {
        return null;
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

function resolveGitDir(dotGit: string): string | null {
  try {
    const st = lstatSync(dotGit);
    if (st.isDirectory()) return dotGit;
    if (!st.isFile() || st.size > 4096) return null;
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!m?.[1]) return null;
    const gitDir = path.resolve(path.dirname(dotGit), m[1]);
    const commonFile = path.join(gitDir, 'commondir');
    if (existsSync(commonFile)) {
      const common = readFileSync(commonFile, 'utf8').trim();
      if (common) return path.resolve(gitDir, common);
    }
    return gitDir;
  } catch {
    return null;
  }
}

/** Does the store hold the object for `oid`? The oid must be 64 lowercase hex, or the answer is false. */
export function hasLfsObject(objectsDir: string | null, oid: string | null): boolean {
  if (!objectsDir || !oid || !/^[0-9a-f]{64}$/.test(oid)) return false;
  try {
    return statSync(path.join(objectsDir, oid.slice(0, 2), oid.slice(2, 4), oid)).isFile();
  } catch {
    return false;
  }
}
