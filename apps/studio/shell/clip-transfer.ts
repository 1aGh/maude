// shell/clip-transfer.ts — #122 (122-C): a clip between two projects on this Mac (contract
// client/v2/contracts/122-cross-canvas-clipboard.md §5.6). The routes are in routes/shell.ts; this is what
// they do, so a test can hold each rule without a server.
//
//   export   the source server: a desktop-shelf clip it read from its OWN disk, the sha256 of every module a
//            carried relative import names, and the content-addressed assets the items use (rel + size).
//   asset    the source server: one of those assets, only one the clip lists.
//   import   the target server, AFTER the person said Paste in its tab: the clip re-checked item by item
//            (edit-ops/clipboard.ts `checkTransfer`), every carried relative import kept only when this project
//            has the same file (same designRoot-relative path, same sha256), every asset's bytes checked
//            against its `<sha8>` name (a photo sidecar must parse and travel with its picture), then the
//            assets written into `assets/` (skipped when present, tmp + rename) and the clip kept.
//
// Nothing is written before every check passed. The target never reads the source project (Rust carries the
// bytes): no server ever reaches another root, and text only comes from a server that read it from its disk.
//
// The frame Rust posts to `clip-import`: a 4-byte big-endian header length, the header JSON
// `{ clip, project, assets: [{ rel, size }] }`, then each asset's bytes in that order.

import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';

import {
  type ClipHandle,
  type ClipTransfer,
  checkTransfer,
  exportClip,
  isDesignRel,
  keepTransfer,
} from '../edit-ops/clipboard.ts';
import { CLIP_MEDIA_EXT, isClipMedia } from '../edit-ops/clip-carry.ts';
import { sanitizeSvgAllowlist } from '../bin/_import-asset.mjs';

/** Picture bytes one clip may bring (the server's own body bound is ~108 MB; the header rides under it). */
export const CLIP_ASSETS_MAX_BYTES = 80 * 1024 * 1024;
export const CLIP_HEADER_MAX_BYTES = 16 * 1024 * 1024;
export const CLIP_FRAME_MAX_BYTES = 4 + CLIP_HEADER_MAX_BYTES + CLIP_ASSETS_MAX_BYTES;
export const CLIP_ASSETS_MAX = 256;
const SIDECAR_MAX_BYTES = 256 * 1024;

// only media crosses (edit-ops/clip-carry.ts `CLIP_MEDIA_EXT`): a `.tsx` named by its own hash is still code
const CAS_RE = new RegExp(`^assets/([0-9a-f]{8})\\.(?:${CLIP_MEDIA_EXT.join('|')})$`);
const SIDECAR_RE = /^assets\/([0-9a-f]{8})(?:\.[0-9a-f]{8,16})?\.photo\.json$/;

export const GONE = 'That copy is gone; copy it again.';
export const CHANGED = 'That copy changed on the way; copy it again.';
export const TOO_BIG = 'That copy has too many pictures to paste in another project.';

/** A content-addressed picture, a photo sidecar, or nothing that can cross (a renamed `assets/logo.png`). */
export function assetShape(rel: string): { kind: 'cas' | 'sidecar'; sha8: string } | null {
  const side = SIDECAR_RE.exec(rel);
  if (side) return { kind: 'sidecar', sha8: side[1] as string };
  const cas = CAS_RE.exec(rel);
  return cas ? { kind: 'cas', sha8: cas[1] as string } : null;
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** `rel` under the design root, real path (symlinks followed) still inside it; null = outside or missing. */
function inside(designRoot: string, rel: string): string | null {
  if (!isDesignRel(rel)) return null;
  try {
    const root = realpathSync(designRoot);
    const real = realpathSync(resolve(root, rel));
    return real.startsWith(root + sep) ? real : null;
  } catch {
    return null;
  }
}

function fileSha(designRoot: string, rel: string): string | null {
  const abs = inside(designRoot, rel);
  if (!abs) return null;
  try {
    if (!statSync(abs).isFile()) return null;
    return sha256(readFileSync(abs));
  } catch {
    return null;
  }
}

export interface ClipExport extends Omit<ClipTransfer, 'carry'> {
  carry: ClipTransfer['carry'];
  /** every module a carried relative import names, with its sha256 here (null = not here) */
  modules: Array<{ path: string; sha256: string | null }>;
  /** the content-addressed pictures (+ sidecars) that cross */
  assets: Array<{ rel: string; size: number }>;
}

export type Refusal = { ok: false; status: number; error: string; message?: string };

/** The source half: what crosses for clip `id`. */
export function exportForShell(
  id: string,
  designRoot: string
): { ok: true; body: ClipExport } | Refusal {
  const clip = exportClip(id);
  if (!clip) return { ok: false, status: 404, error: 'gone', message: GONE };
  const modules = new Map<string, string | null>();
  for (const i of clip.carry.imports)
    if (i.spec.startsWith('.') && i.module && !modules.has(i.module))
      modules.set(i.module, fileSha(designRoot, i.module));
  const assets: Array<{ rel: string; size: number }> = [];
  let total = 0;
  for (const rel of clip.carry.assets) {
    if (!assetShape(rel)) continue;
    const abs = inside(designRoot, rel);
    if (!abs) continue;
    let size: number;
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      size = st.size;
    } catch {
      continue;
    }
    total += size;
    assets.push({ rel, size });
  }
  if (total > CLIP_ASSETS_MAX_BYTES || assets.length > CLIP_ASSETS_MAX)
    return { ok: false, status: 413, error: 'too-big', message: TOO_BIG };
  return {
    ok: true,
    body: { ...clip, modules: [...modules].map(([path, s]) => ({ path, sha256: s })), assets },
  };
}

/** The source half of `clip-asset`: the file of one asset clip `id` lists; null = not one of its assets. */
export function assetForShell(id: string, rel: string, designRoot: string): string | null {
  const clip = exportClip(id);
  if (!clip?.carry.assets.includes(rel) || !assetShape(rel)) return null;
  const abs = inside(designRoot, rel);
  try {
    return abs && statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

/** Split Rust's frame; null = not one. */
export function parseFrame(buf: Uint8Array): { header: unknown; blobs: Uint8Array } | null {
  if (buf.length < 4) return null;
  const n = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  if (n > CLIP_HEADER_MAX_BYTES || 4 + n > buf.length) return null;
  try {
    const header = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(4, 4 + n))
    );
    return { header, blobs: buf.subarray(4 + n) };
  } catch {
    return null;
  }
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const whatUses = (t: ClipTransfer) =>
  t.kind === 'artboards'
    ? t.items.length === 1
      ? 'That artboard uses'
      : 'Those artboards use'
    : t.items.length === 1
      ? 'That object uses'
      : 'Those objects use';

const copyOver = (t: ClipTransfer, rel: string) =>
  `${whatUses(t)} ${rel}, which this project doesn’t have. Copy that file over first.`;

/**
 * An SVG crosses only as the import-asset sanitizer (bin/_import-asset.mjs) leaves it: sanitizing it again
 * changes nothing. One that came in another way is brought in through import-asset, not the clip lane.
 */
function svgAsSanitized(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return sanitizeSvgAllowlist(text) === text;
  } catch {
    return false;
  }
}

/** The target half: check everything, then write the pictures and keep the clip. */
export function importFromShell(
  frame: { header: unknown; blobs: Uint8Array },
  designRoot: string
): { ok: true; handle: ClipHandle; wrote: number } | Refusal {
  const invalid: Refusal = { ok: false, status: 400, error: 'invalid' };
  const { header, blobs } = frame;
  if (!isRec(header) || !isRec(header.clip)) return invalid;
  const t = checkTransfer(header.clip);
  const project = header.project;
  if (!t || typeof project !== 'string' || !project.trim() || project.length > 200) return invalid;

  // a carried relative import is kept only when this project has the very same file
  const sent = new Map<string, string | null>();
  const mods = header.clip.modules;
  if (!Array.isArray(mods) || mods.length > 64) return invalid;
  for (const m of mods) {
    if (!isRec(m) || !isDesignRel(m.path)) return invalid;
    if (!(m.sha256 === null || (typeof m.sha256 === 'string' && /^[0-9a-f]{64}$/.test(m.sha256))))
      return invalid;
    sent.set(m.path, m.sha256);
  }
  for (const i of t.carry.imports) {
    if (!i.spec.startsWith('.')) continue;
    const want = i.module ? sent.get(i.module) : null;
    if (!i.module || !want || fileSha(designRoot, i.module) !== want)
      return {
        ok: false,
        status: 409,
        error: 'module-missing',
        message: `${whatUses(t)} ${i.local} from ${i.module ?? i.spec}, which this project doesn’t have. Copy that file over first.`,
      };
  }

  // the pictures: listed by the clip, shaped, sized, and their bytes what their names say
  const list = header.assets;
  if (!Array.isArray(list) || list.length > CLIP_ASSETS_MAX) return invalid;
  const listed = new Set(t.carry.assets);
  const files: Array<{ rel: string; bytes: Uint8Array }> = [];
  const seen = new Set<string>();
  let at = 0;
  for (const a of list) {
    if (!isRec(a) || typeof a.rel !== 'string' || !Number.isSafeInteger(a.size)) return invalid;
    const size = a.size as number;
    if (size < 0 || seen.has(a.rel) || !listed.has(a.rel) || !assetShape(a.rel)) return invalid;
    seen.add(a.rel);
    if (at + size > blobs.length) return invalid;
    files.push({ rel: a.rel, bytes: blobs.subarray(at, at + size) });
    at += size;
  }
  if (at !== blobs.length || at > CLIP_ASSETS_MAX_BYTES) return invalid;

  // a file under assets/ that is not media never crosses: the person copies it over first, as with a module
  for (const rel of t.carry.assets)
    if (!isClipMedia(rel) && !SIDECAR_RE.test(rel) && !inside(designRoot, rel))
      return { ok: false, status: 409, error: 'asset-not-media', message: copyOver(t, rel) };
  const pictures = new Set<string>();
  for (const f of files) {
    const shape = assetShape(f.rel) as { kind: 'cas' | 'sidecar'; sha8: string };
    if (shape.kind !== 'cas') continue;
    if (sha256(f.bytes).slice(0, 8) !== shape.sha8)
      return { ok: false, status: 422, error: 'asset-mismatch', message: CHANGED };
    if (f.rel.endsWith('.svg') && !svgAsSanitized(f.bytes))
      return { ok: false, status: 422, error: 'asset-not-media', message: copyOver(t, f.rel) };
    pictures.add(shape.sha8);
  }
  for (const f of files) {
    const shape = assetShape(f.rel) as { kind: 'cas' | 'sidecar'; sha8: string };
    if (shape.kind !== 'sidecar') continue;
    if (f.bytes.length > SIDECAR_MAX_BYTES || !pictures.has(shape.sha8))
      return { ok: false, status: 422, error: 'asset-mismatch', message: CHANGED };
    try {
      if (!isRec(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(f.bytes))))
        throw new Error('not an object');
    } catch {
      return { ok: false, status: 422, error: 'asset-mismatch', message: CHANGED };
    }
  }

  // every check passed: write what is not here yet, then keep the clip
  let wrote = 0;
  if (files.length) {
    let dir: string;
    try {
      const root = realpathSync(designRoot);
      dir = join(root, 'assets');
      if (existsSync(dir)) {
        if (lstatSync(dir).isSymbolicLink() || !statSync(dir).isDirectory())
          return { ok: false, status: 409, error: 'assets-dir' };
      } else mkdirSync(dir);
    } catch {
      return { ok: false, status: 500, error: 'assets-dir' };
    }
    for (const f of files) {
      // never a name that is not media or a sidecar (checked above; held again at the one write)
      if (!assetShape(f.rel)) return invalid;
      const name = f.rel.slice('assets/'.length);
      const abs = join(dir, name);
      if (existsSync(abs)) continue;
      const tmp = join(dir, `.tmp-clip-${randomBytes(6).toString('hex')}`);
      try {
        writeFileSync(tmp, f.bytes, { flag: 'wx' });
        renameSync(tmp, abs);
        wrote++;
      } catch {
        return { ok: false, status: 500, error: 'asset-write' };
      }
    }
  }
  return { ok: true, handle: keepTransfer(t, project.trim()), wrote };
}
