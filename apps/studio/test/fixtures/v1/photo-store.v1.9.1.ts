// FROZEN — apps/studio/photo-store.ts at v1.9.1: what a 1.x peer's /_api/photo-edit answers. Only the two
// imports are re-pointed (the frozen schema; the live Context type). Never edit otherwise.
/**
 * @file       photo-store.ts — PhotoEdit sidecar persistence (Stage C, Task 8)
 * @scope      apps/studio/photo-store.ts
 * @purpose    Read / write the non-destructive `assets/<sha8>.photo.json` sidecar
 *             that backs the photo editor. Mirrors `inspect.ts`'s `createX(ctx)`
 *             factory + `Bun.write`/`Bun.file` shape. Server-side only — imports
 *             the DEPENDENCY-FREE `photo/schema.ts` (never `pixi.js`).
 *
 * @security   The `/_api/photo-edit` route is CANVAS-SAFE (reachable from the
 *             untrusted canvas iframe — DDR-054), and its write PATH is derived
 *             from an attacker-controllable `asset` param. Unlike `/_api/asset`
 *             (content-addressed → path not attacker-chosen), this route's path
 *             comes from the caller, so the DDR-088 cap stack is load-bearing:
 *               1. strict sha8 extraction/validation (hex only, bounded length) —
 *                  rejects `..`, `/`, `%2f`, absolute paths by construction;
 *               2. explicit containment assert (belt-and-braces vs a poisoned
 *                  designRoot — mirrors api.ts saveAssetFromStream);
 *               3. structural `validatePhotoEdit` (unknown keys / bad types /
 *                  out-of-range numbers / non-hex colors / non-relative asset
 *                  paths all rejected — no crafted field round-trips to disk);
 *               4. body/file size cap (64 KB — generous for parameters).
 *             Threat-table (DDR-088): path-traversal → (1)+(2); stored-XSS via a
 *             crafted field → (3), the JSON is only ever re-read by the schema-
 *             typed compositor, never eval'd/HTML-injected; oversized-body DoS →
 *             (4). No `sameOriginWrite` (would block the legit canvas origin, e.g.
 *             the headless bg-remove harness) — `isLoopbackHost` on the route is
 *             the DNS-rebinding guard. Residual (accepted, DDR-054 baseline): an
 *             already-untrusted canvas can write a WELL-FORMED sidecar for any
 *             sha8 — a low-severity integrity nuisance, bounded by (3), same class
 *             as its existing ability to write arbitrary images via /_api/asset.
 */

import path from 'node:path';

import type { Context } from '../../../context.ts';
import { PHOTO_EDIT_VERSION, type PhotoEdit, validatePhotoEdit } from './photo-schema.v1.9.1.ts';

/** Max bytes for a sidecar (read + write). Parameters are tiny; this is slack. */
export const PHOTO_EDIT_MAX_BYTES = 64 * 1024;

const SHA_RE = /^[0-9a-f]{8,64}$/;

/**
 * Extract + validate the content-address sha8 from an `asset` param. Accepts the
 * source in any of the forms a caller might hold — `assets/<sha8>.<ext>`,
 * `/assets/<sha8>.png`, `<sha8>.png`, or bare `<sha8>` — and returns the bare,
 * validated sha8, or null if it isn't clean hex. The hex regex is the primary
 * traversal defense: `..`, `/`, `%2f`, backslashes, and absolute paths can never
 * match, so no path segment survives extraction.
 */
export function assetSha8(param: string | null | undefined): string | null {
  if (typeof param !== 'string') return null;
  let s = param.trim();
  if (!s) return null;
  s = s.replace(/^\/+/, ''); // drop leading slashes
  s = s.replace(/^assets\//, ''); // drop the assets/ prefix
  s = s.replace(/\.[A-Za-z0-9]+$/, ''); // drop a single trailing extension
  return SHA_RE.test(s) ? s : null;
}

export interface PhotoStore {
  /** Absolute path of the sidecar for a validated sha8 (throws if it escapes). */
  editPathForSha8(sha8: string): string;
  /** Read the sidecar → PhotoEdit, or null if absent / unreadable / oversized. */
  getPhotoEdit(assetParam: string | null | undefined): Promise<PhotoEdit | null>;
  /** Validate + persist. Returns a discriminated result (never throws on bad input). */
  savePhotoEdit(
    assetParam: string | null | undefined,
    edit: unknown
  ): Promise<
    { ok: true; path: string; edit: PhotoEdit } | { ok: false; status: number; error: string }
  >;
}

export function createPhotoStore(ctx: Context): PhotoStore {
  const assetsDir = path.join(ctx.paths.designRoot, 'assets');

  function editPathForSha8(sha8: string): string {
    if (!SHA_RE.test(sha8)) throw new Error(`invalid sha8: ${sha8}`);
    const abs = path.join(assetsDir, `${sha8}.photo.json`);
    // Belt-and-braces containment (defense in depth vs a poisoned designRoot —
    // sha8 is already validated hex, so this can only fail pathologically).
    const rel = path.relative(assetsDir, abs);
    if (rel !== `${sha8}.photo.json` || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`photo-edit path escaped assets/: ${abs}`);
    }
    return abs;
  }

  async function getPhotoEdit(assetParam: string | null | undefined): Promise<PhotoEdit | null> {
    const sha8 = assetSha8(assetParam);
    if (!sha8) return null;
    try {
      const file = Bun.file(editPathForSha8(sha8));
      if (!(await file.exists())) return null;
      if (file.size > PHOTO_EDIT_MAX_BYTES) return null; // corrupt / oversized — ignore
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      // A stored sidecar is trusted-ish (we wrote it validated), but re-validate
      // so a hand-edited / corrupt file never reaches the compositor malformed.
      return validatePhotoEdit(parsed).ok ? (parsed as PhotoEdit) : null;
    } catch {
      return null;
    }
  }

  async function savePhotoEdit(
    assetParam: string | null | undefined,
    edit: unknown
  ): Promise<
    { ok: true; path: string; edit: PhotoEdit } | { ok: false; status: number; error: string }
  > {
    const sha8 = assetSha8(assetParam);
    if (!sha8) return { ok: false, status: 400, error: 'invalid or missing asset (expected sha8)' };

    // Size cap BEFORE validation (a giant blob shouldn't be walked field-by-field).
    let serialized: string;
    try {
      serialized = JSON.stringify(edit ?? {});
    } catch {
      return { ok: false, status: 400, error: 'body is not serializable JSON' };
    }
    if (Buffer.byteLength(serialized, 'utf8') > PHOTO_EDIT_MAX_BYTES) {
      return { ok: false, status: 413, error: `photo edit exceeds ${PHOTO_EDIT_MAX_BYTES} bytes` };
    }

    const check = validatePhotoEdit(edit);
    if (!check.ok) {
      return { ok: false, status: 400, error: `invalid PhotoEdit: ${check.errors.join('; ')}` };
    }

    // Stamp the schema version + canonical source on write (never trust the
    // client's version claim; the sidecar's own filename is the source of truth).
    const toWrite: PhotoEdit = {
      ...(edit as PhotoEdit),
      version: PHOTO_EDIT_VERSION,
    };
    let abs: string;
    try {
      abs = editPathForSha8(sha8);
    } catch (e) {
      return { ok: false, status: 400, error: e instanceof Error ? e.message : 'bad path' };
    }
    try {
      // Bun.write creates the assets/ dir if absent.
      await Bun.write(abs, JSON.stringify(toWrite, null, 2));
      // Say the write happened. In a cell the recursive fs.watch never fires,
      // and `fs:any` is how (a) the HMR broadcaster tells open canvases to
      // re-bake the photo and (b) the write-nudge tells the hub to journal the
      // sidecar — without it a photo edit saved in the cloud reached peers
      // only on the walk-import belt, and open canvases not at all. Locally
      // the real watcher fires too; the broadcaster's debounce coalesces.
      ctx.bus.emit('fs:any', path.relative(ctx.paths.designRoot, abs).split(path.sep).join('/'));
    } catch (e) {
      return { ok: false, status: 500, error: e instanceof Error ? e.message : 'write failed' };
    }
    return { ok: true, path: path.posix.join('assets', `${sha8}.photo.json`), edit: toWrite };
  }

  return { editPathForSha8, getPhotoEdit, savePhotoEdit };
}
