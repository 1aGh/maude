// thumbs/keys.ts — thumbnail keys (V2-2.17, contract V2-1.17 §5.8 "Key").
//
// A key names one picture: what was rendered (canvas, artboard, size, theme) and every input the
// build actually used. It is computable without building, so `thumb()` can answer `ready` from
// disk and an unchanged artboard across many versions is one picture.
//
//   key = sha256('thumb/1' ‖ size ‖ theme ‖ canvas ‖ artboard ‖ srcHash ‖ metaHash ‖ depsHash)
//
// - srcHash  = the canvas TSX at the version (the index's own `srcHash` for `now`).
// - metaHash = the `.meta.json` the build used. The canvas runtime always reads today's sidecar
//   (`/_api/canvas-meta`, no `sha`), so for a version it is today's too: a key never claims an
//   input the picture does not show (§5.8 "The key hashes what the build actually used").
// - depsHash = the index's `depsHash` (the canvas's resolved relative imports — its CSS lane
//   `import './x.css'` included, at today's content, which is what a history build uses, DDR-113)
//   plus the design system's tokens / components CSS the shell links.
// Pure: no I/O beyond the memoized file hash below.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const RENDERER = 'thumb/1';
export type ThumbSize = 'card' | 'row';
/** Long side, px (§5.8 ThumbRequest.size). */
export const SIZE_PX: Record<ThumbSize, number> = { card: 480, row: 160 };
/** Full 64 hex (DDR-145 F3). The ONLY shape a key may take on a route or a path. */
export const KEY_RE = /^[0-9a-f]{64}$/;

export const isSize = (s: unknown): s is ThumbSize => s === 'card' || s === 'row';

/** The index's own content hash (index/extract.ts `sha`): 16 hex of sha256. */
export const srcHashOf = (source: string | Uint8Array) =>
  createHash('sha256').update(source).digest('hex').slice(0, 16);

export interface KeyParts {
  size: ThumbSize;
  theme: string;
  canvas: string;
  /** null = the cover (first artboard in canvas order, or the specimen itself) */
  artboard: string | null;
  srcHash: string;
  metaHash: string | null;
  depsHash: string;
}

export function thumbKey(p: KeyParts): string {
  return createHash('sha256')
    .update(
      [
        RENDERER,
        p.size,
        p.theme,
        p.canvas,
        // `ab:` keeps an artboard literally named "cover" from sharing the cover's key
        p.artboard === null ? 'cover' : `ab:${p.artboard}`,
        p.srcHash,
        p.metaHash ?? '-',
        p.depsHash,
      ].join('\0')
    )
    .digest('hex');
}

/** `sha256('asset/1' ‖ size ‖ sha256(bytes))`. */
export function assetKey(size: ThumbSize, bytesSha256: string): string {
  return createHash('sha256').update(['asset/1', size, bytesSha256].join('\0')).digest('hex');
}

const fileHashMemo = new Map<string, { size: number; mtimeMs: number; hash: string }>();

/** sha256 of one file, memoized by (path, size, mtime); `-` when it does not exist. */
export function fileHash(abs: string, algo: 'short' | 'full' = 'short'): string {
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isFile()) return '-';
  const memoKey = `${algo}\0${abs}`;
  const m = fileHashMemo.get(memoKey);
  if (m && m.size === st.size && m.mtimeMs === st.mtimeMs) return m.hash;
  const full = createHash('sha256').update(readFileSync(abs)).digest('hex');
  const hash = algo === 'full' ? full : full.slice(0, 16);
  fileHashMemo.set(memoKey, { size: st.size, mtimeMs: st.mtimeMs, hash });
  return hash;
}

/** The design system's tokens + components CSS the shell links (`?tokens=` / `?components=`). */
export function dsCssHash(designRoot: string, tokensCssRel?: string, componentsCssRel?: string) {
  const one = (rel?: string) => (rel ? `${rel}\0${fileHash(path.join(designRoot, rel))}` : '-');
  return `${one(tokensCssRel)}|${one(componentsCssRel)}`;
}

/** The key's `depsHash`: the index's resolved imports + the DS CSS (§5.8). */
export const keyDepsHash = (indexDepsHash: string, dsCss: string) =>
  srcHashOf(`${indexDepsHash}\0${dsCss}`);
