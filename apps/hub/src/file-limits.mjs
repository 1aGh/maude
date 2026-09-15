// Project file size limits and bounded-memory hashing — plan T18.
//
// ONE place says how big a project file may be, so the door, the upload
// sessions, the journal, the read route and the bucket mirror cannot drift
// into five different ceilings (they were: 95 MiB at the door, 512 MiB
// everywhere else, and a 300 MB video simply never moved).
//
//   SINGLE_PUT_BYTES   — one `PUT /api/file/<rel>` body. Beyond it a peer uses
//                        an upload session (parts, resumable, verified whole).
//   PART_BYTES         — the size of one session part.
//   MAX_PROJECT_FILE_BYTES — the ceiling for any project file, in any lane.
//                        `MAUDE_MAX_PROJECT_FILE_BYTES` overrides it (bounded).
//
// Nothing here ever holds a whole large file in memory: hashing reads
// fixed-size chunks.

import { closeSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';

const MIB = 1024 * 1024;

export const SINGLE_PUT_BYTES = 95 * MIB;
export const PART_BYTES = 8 * MIB;
const DEFAULT_MAX_PROJECT_FILE_BYTES = 2048 * MIB;
const HARD_CEILING = 8192 * MIB;

/** The project-file ceiling, from the environment when it says so sensibly. */
export function maxProjectFileBytes(env = process.env) {
  const raw = Number(env.MAUDE_MAX_PROJECT_FILE_BYTES);
  if (Number.isFinite(raw) && raw >= SINGLE_PUT_BYTES) return Math.min(raw, HARD_CEILING);
  return DEFAULT_MAX_PROJECT_FILE_BYTES;
}

export const MAX_PROJECT_FILE_BYTES = maxProjectFileBytes();

/** sha256 of a file, read in 1 MiB chunks. Throws when unreadable. */
export function sha256File(abs, { chunk = MIB } = {}) {
  const hash = createHash('sha256');
  const buf = Buffer.allocUnsafe(chunk);
  const fd = openSync(abs, 'r');
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, chunk, null);
      if (n <= 0) break;
      hash.update(n === chunk ? buf : buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * Parse one `Range: bytes=a-b` header against a size. Returns `null` when
 * absent, `{invalid: true}` when unsatisfiable, else `{start, end}` inclusive.
 * Multi-range requests are answered with the whole body (null) — a sync
 * client never sends them.
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || !header.startsWith('bytes=')) return null;
  const spec = header.slice('bytes='.length).trim();
  if (spec.includes(',')) return null;
  const m = /^(\d*)-(\d*)$/.exec(spec);
  if (!m) return { invalid: true };
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}
