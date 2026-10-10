// thumbs/store.ts — the per-project picture cache (V2-2.17, contract V2-1.17 §5.8, §5.10, R6).
//
//   $MAUDE_INDEX_DIR or ~/.maude/index/v1/projects/<pid>/thumbs/<k0k1>/<key>.jpg
//
// Machine cache next to the project's index snapshot, outside every project tree (never synced,
// no DDR-115 list entry — §5.10). A key is validated against KEY_RE before it touches a path, so
// a route parameter can never name anything but a picture file. Writes are atomic (tmp → fsync →
// rename) so a reader never sees half a JPEG.

import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

import { projectDir } from '../index/snapshot.ts';
import { KEY_RE } from './keys.ts';

export const thumbsDir = (pid: string) => path.join(projectDir(pid), 'thumbs');

export function thumbPath(pid: string, key: string): string {
  if (!KEY_RE.test(key)) throw new Error('bad thumbnail key');
  return path.join(thumbsDir(pid), key.slice(0, 2), `${key}.jpg`);
}

export function writeThumb(pid: string, key: string, bytes: Uint8Array): string {
  const dest = thumbPath(pid, key);
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, dest);
  return dest;
}

export function readThumb(pid: string, key: string): Uint8Array | null {
  if (!KEY_RE.test(key)) return null;
  try {
    return readFileSync(thumbPath(pid, key));
  } catch {
    return null;
  }
}

export function hasThumb(pid: string, key: string): boolean {
  if (!KEY_RE.test(key)) return false;
  return statSync(thumbPath(pid, key), { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * Version-picture retention (§9 Q6 default): an LRU of `maxKeys` pictures or `maxBytes`, whichever
 * comes first, oldest mtime out first; `keep` (the snapshot's covers) is never pruned. Temps older
 * than an hour (a crash between write and rename) go too.
 */
export function pruneThumbs(
  pid: string,
  keep: Set<string>,
  { maxKeys = 2000, maxBytes = 200 * 1024 * 1024, now = Date.now() } = {}
): number {
  const root = thumbsDir(pid);
  const files: Array<{ abs: string; key: string; size: number; mtimeMs: number }> = [];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return 0;
  }
  for (const d of dirs) {
    if (!/^[0-9a-f]{2}$/.test(d)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(path.join(root, d));
    } catch {
      continue;
    }
    for (const name of names) {
      const abs = path.join(root, d, name);
      const st = statSync(abs, { throwIfNoEntry: false });
      if (!st?.isFile()) continue;
      if (name.includes('.tmp-')) {
        if (now - st.mtimeMs > 3_600_000) rmSync(abs, { force: true });
        continue;
      }
      const key = name.replace(/\.jpg$/, '');
      if (KEY_RE.test(key)) files.push({ abs, key, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  let bytes = files.reduce((n, f) => n + f.size, 0);
  let count = files.length;
  let removed = 0;
  for (const f of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (count <= maxKeys && bytes <= maxBytes) break;
    if (keep.has(f.key)) continue;
    rmSync(f.abs, { force: true });
    count--;
    bytes -= f.size;
    removed++;
  }
  return removed;
}
