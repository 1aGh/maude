// Atomic file writes for the bidirectional file sync agent (Phase 9 Task 4).
//
// fs.watch on macOS/Linux fires on rename, so a non-atomic write (open →
// truncate → write chunks → close) emits multiple watch events with partial
// content. The agent's echo guard hashes the final content, so a partial-write
// event would miss the hash match and incorrectly bubble the (truncated) state
// up to Y.Doc — corrupting the live state.
//
// Pattern: open `<path>.tmp.<random-128-bit>` with O_CREAT|O_EXCL ('wx' in
// Node), write bytes, close, `renameSync` to the final path. POSIX rename is
// atomic when source + destination are on the same filesystem; the watch sees
// the final-content-already-present rename event rather than a stream of
// in-flight chunks. O_EXCL + 128-bit suffix defeats pre-created symlinks on
// shared-tenant hosts (DDR-054 §2c — closes attacker Chain C + defender L1).
//
// File mode 0o600 on the staging file so other tenants on shared hosts can't
// read in-flight content before the rename.
//
// Windows note: rename of a file the watcher has open returns EBUSY. The
// plan's Task 4 step 4 acknowledges this as a known minor risk for v1.1;
// the agent treats EBUSY as a transient error and retries once after a 25ms
// jitter.

import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const RETRY_DELAY_MS = 25;
// 'wx' = O_CREAT | O_EXCL — fails if the target already exists, including as
// a dangling/live symlink. Plus O_TRUNC is implied; mode 0o600 sets owner-only.
const TMP_OPEN_FLAGS = 'wx' as const;
const TMP_OPEN_MODE = 0o600;

/**
 * Write `bytes` to `path` atomically. Returns the absolute path written
 * (same as input — convenience for chaining).
 *
 * Bytes are written via Node's synchronous `openSync` with `O_CREAT|O_EXCL`
 * (fails on pre-existing tmp / symlink), then `renameSync` moves it into
 * place. 128-bit random suffix; mode 0o600. On POSIX the rename is atomic;
 * on Windows there is a small window where the watcher may see a brief gap,
 * retried once on EBUSY.
 *
 * `bytes` accepts string (UTF-8 encoded) or Uint8Array (written verbatim).
 */
export function atomicWrite(path: string, bytes: string | Uint8Array): string {
  // Ensure the parent directory exists. Cheap (mkdirSync recursive is a no-op
  // when present) and removes the per-canvas burden of creating _comments/
  // before the agent's first flush.
  mkdirSync(dirname(path), { recursive: true });
  // 16 bytes = 32 hex chars = 128 bits. Unforgeable in practice against a
  // local racer (vs. the prior 32-bit value which was brute-forceable in ms).
  const suffix = randomBytes(16).toString('hex');
  const tmp = `${path}.tmp.${suffix}`;
  let fd: number | null = null;
  try {
    fd = openSync(tmp, TMP_OPEN_FLAGS, TMP_OPEN_MODE);
    const buf = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : Buffer.from(bytes);
    writeSync(fd, buf, 0, buf.byteLength, 0);
    closeSync(fd);
    fd = null;
    try {
      renameSync(tmp, path);
    } catch (err) {
      if (isWindowsBusy(err)) {
        // Brief retry — Windows watcher may hold a handle while reading the
        // pre-rename target. 25ms is short enough to be invisible to the user
        // and long enough to clear the typical fs.watch poll interval.
        const start = Date.now();
        while (Date.now() - start < RETRY_DELAY_MS) {
          // Tight loop is OK for 25ms — keeps the call synchronous so callers
          // can record the echo-guard hash before any fs event fires.
        }
        renameSync(tmp, path);
      } else {
        throw err;
      }
    }
  } catch (err) {
    // Best-effort cleanup of the .tmp + fd on failure — don't mask the
    // original exception with a cleanup error.
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw asDiskFull(err, path);
  }
  return path;
}

// ── S11.17 (C37) — a full disk is a typed error ────────────────────────────
//
// ENOSPC (no space left) and EDQUOT (over a quota) mean the same thing to a
// person: "This Mac is out of space". Callers that hold the bytes until there
// is room (`sync/write-hold.ts`) catch exactly this type; everyone else still
// sees an Error whose `code` is the system's own, so existing `.code` checks
// keep working.

const DISK_FULL_CODES = new Set(['ENOSPC', 'EDQUOT']);
// ENOSPC's errno is 28 on Linux and macOS (Bun signs it negative); only read when `code` is absent.
const DISK_FULL_ERRNOS = new Set([28, -28]);

export class DiskFullError extends Error {
  readonly code: string;
  readonly path: string;
  override readonly cause: unknown;
  constructor(path: string, cause?: unknown) {
    super(`No space left on this Mac to write ${path}`);
    this.name = 'DiskFullError';
    this.path = path;
    this.cause = cause;
    const code = (cause as { code?: unknown } | null)?.code;
    this.code = typeof code === 'string' && DISK_FULL_CODES.has(code) ? code : 'ENOSPC';
  }
}

/** Is `err` a full disk (ENOSPC / EDQUOT, typed or raw)? */
export function isDiskFull(err: unknown): boolean {
  if (err instanceof DiskFullError) return true;
  if (!err || typeof err !== 'object') return false;
  const { code, errno } = err as { code?: unknown; errno?: unknown };
  if (typeof code === 'string') return DISK_FULL_CODES.has(code);
  return typeof errno === 'number' && DISK_FULL_ERRNOS.has(errno);
}

/** A raw full-disk error as a `DiskFullError` for `path`; any other error handed back unchanged. */
export function asDiskFull(err: unknown, path: string): unknown {
  if (err instanceof DiskFullError || !isDiskFull(err)) return err;
  return new DiskFullError(path, err);
}

function isWindowsBusy(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
}
