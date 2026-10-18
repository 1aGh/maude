// thumbs/keys.ts — thumbnail keys (V2-2.17, contract V2-1.17 §5.8 "Key"; S1.11 `thumb/2`).
//
// A key names one picture: what was rendered (canvas, artboard, size, theme) and every input the
// build actually used. It is computable without building, so `thumb()` can answer `ready` from
// disk and an unchanged artboard across many versions is one picture.
//
//   key = sha256('thumb/2' ‖ size ‖ theme ‖ canvas ‖ artboard ‖ srcHash ‖ cssHash ‖ metaHash ‖ depsHash)
//
// - srcHash  = the canvas TSX at the version (the index's own `srcHash` for `now`).
// - cssHash  = the canvas's same-name CSS lane (`<canvas>.css`) the build used: the version's own
//   lane when the historical build overlays it (S1.11, `BuildCanvasOptions.overrides`), today's
//   file otherwise (`-` when there is none). `thumb/1` had no such part, so a version whose TSX
//   matched today's but whose CSS did not was keyed — and rendered — as the live canvas.
// - metaHash = the `.meta.json` the build used: the version's lane when the shell is given it
//   (`metaAt(ref)`), today's sidecar otherwise. A key never claims an input the picture does not
//   show (§5.8 "The key hashes what the build actually used").
// - depsHash = the index's `depsHash` (the canvas's resolved relative imports, at today's content —
//   shared modules render as they are now, DDR-113) plus the design system's tokens / components
//   CSS the shell links.
// Pure: no I/O beyond the memoized file hash below.

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Bumped by S1.11: the key gained the CSS lane, so every `thumb/1` picture re-keys once. */
export const RENDERER = 'thumb/2';
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
  /** the same-name CSS lane the build used; null = none */
  cssHash: string | null;
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
        p.cssHash ?? '-',
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

/** The lanes a historical build overlays besides the TSX (V2-1.9 §5.6), as design-root rels. */
export function laneRels(rel: string): { css: string; meta: string } {
  const stem = rel.replace(/\.tsx$/, '');
  return { css: `${stem}.css`, meta: `${stem}.meta.json` };
}

/** The per-lane hashes a key names: `srcHash` the TSX; `cssHash` / `metaHash` null = no file. */
export interface LaneHashes {
  srcHash: string;
  cssHash: string | null;
  metaHash: string | null;
}

/** Today's lanes: the index row's TSX + sidecar hashes, and the CSS lane read now. */
export function liveLaneHashes(
  designRoot: string,
  rel: string,
  row: { srcHash: string; metaHash: string | null }
): LaneHashes {
  const css = fileHash(path.join(designRoot, laneRels(rel).css));
  return { srcHash: row.srcHash, cssHash: css === '-' ? null : css, metaHash: row.metaHash };
}

/**
 * A version's lanes, as the historical build uses them: its TSX always; its CSS / meta lane when
 * the version has one. `undefined` (the overlay is not wired) and `null` (the version has no such
 * lane) both mean the build falls back to today's file, so the key names today's.
 * `live` says which lanes are today's — those can still change under a render in flight.
 */
export function versionLaneHashes(
  version: { tsx: string; css?: string | null; meta?: string | null },
  today: LaneHashes
): LaneHashes & { live: { css: boolean; meta: boolean } } {
  const css = typeof version.css === 'string' ? srcHashOf(version.css) : undefined;
  const meta = typeof version.meta === 'string' ? srcHashOf(version.meta) : undefined;
  return {
    srcHash: srcHashOf(version.tsx),
    cssHash: css ?? today.cssHash,
    metaHash: meta ?? today.metaHash,
    live: { css: css === undefined, meta: meta === undefined },
  };
}

/** Every lane the build uses is the same: the version IS today's picture (no version build). */
export const sameLanes = (a: LaneHashes, b: LaneHashes) =>
  a.srcHash === b.srcHash && a.cssHash === b.cssHash && a.metaHash === b.metaHash;
