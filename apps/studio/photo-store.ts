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

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { PER_USE_PHOTO_RE, photoEditHash } from './access/scope.ts';
import type { Context } from './context.ts';
import { PHOTO_EDIT_VERSION, type PhotoEdit, validatePhotoEdit } from './photo/schema.ts';

/** Max bytes for a sidecar (read + write). Parameters are tiny; this is slack. */
export const PHOTO_EDIT_MAX_BYTES = 64 * 1024;

const SHA_RE = /^[0-9a-f]{8,64}$/;

/**
 * S8.15 — the name of a per-use edit (`data-photo-edit="<edit8>"`, contract
 * S8-asset-sidecars §5.1): 8 hex of the edit's canonical hash, lengthened to 12
 * and then 16 on a collision. Checked BEFORE any path is built — the hex regex is
 * the traversal guard, exactly like `SHA_RE` for the asset.
 */
export const EDIT8_RE = /^[0-9a-f]{8,16}$/;

/** The name lengths a writer tries, in order (a collision lengthens the name). */
const EDIT_NAME_LENGTHS = [8, 12, 16] as const;

/** `assets/<img8>.<edit8>.photo.json` — the per-use edit of one use of an asset. */
export const perUseRel = (sha8: string, edit8: string): string =>
  `assets/${sha8}.${edit8}.photo.json`;

/** What a per-use PUT will write: its name, its bytes, and whether those bytes are already there. */
export type PerUsePlan =
  | {
      ok: true;
      sha8: string;
      edit8: string;
      rel: string;
      abs: string;
      edit: PhotoEdit;
      bytes: string;
      /** the file already holds these bytes — the write is a no-op (same name ⇒ same bytes) */
      present: boolean;
    }
  | { ok: false; status: number; error: string };

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
  /** S8.15 — read one use's edit (`assets/<sha8>.<edit8>.photo.json`); null if absent or invalid. */
  getPerUseEdit(
    assetParam: string | null | undefined,
    edit8: string | null
  ): Promise<PhotoEdit | null>;
  /** S8.15 — name a per-use edit by its bytes (pure planning, no write). */
  planPerUseEdit(assetParam: string | null | undefined, edit: unknown): Promise<PerUsePlan>;
  /** S8.15 — persist a per-use edit; a same-bytes rewrite is a no-op, never an overwrite. */
  savePerUseEdit(
    assetParam: string | null | undefined,
    edit: unknown
  ): Promise<
    | { ok: true; path: string; edit8: string; edit: PhotoEdit }
    | { ok: false; status: number; error: string }
  >;
  /**
   * S8.15 — the access gate's view of a `/_api/photo-edit` request: the file it
   * writes or reads (`undefined` = not this route's concern, `null` = a name that is
   * not one) and, for a per-use PUT, the exact bytes it would write.
   */
  gateTarget(req: Request): Promise<string | null | undefined>;
  gateBody(req: Request): Promise<string | undefined>;
  /** Does `rel` hold bytes OTHER than `body` (a per-use file that is already there is no overwrite)? */
  holdsOther(rel: string, body: string): boolean;
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

  // ── S8.15: the per-use edit ────────────────────────────────────────────────
  function perUsePath(sha8: string, edit8: string): string {
    if (!SHA_RE.test(sha8)) throw new Error(`invalid sha8: ${sha8}`);
    if (!EDIT8_RE.test(edit8)) throw new Error(`invalid edit name: ${edit8}`);
    const name = `${sha8}.${edit8}.photo.json`;
    const abs = path.join(assetsDir, name);
    const rel = path.relative(assetsDir, abs);
    if (rel !== name || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`photo-edit path escaped assets/: ${abs}`);
    }
    return abs;
  }

  /** The full canonical hash of the file at `abs`, or null when it is absent / unreadable. */
  function hashOnDisk(abs: string): string | null {
    if (!existsSync(abs)) return null;
    try {
      if (statSync(abs).size > PHOTO_EDIT_MAX_BYTES) return '';
      return photoEditHash(JSON.parse(readFileSync(abs, 'utf8')));
    } catch {
      return ''; // there, but not a PhotoEdit: it still occupies the name
    }
  }

  async function getPerUseEdit(
    assetParam: string | null | undefined,
    edit8: string | null
  ): Promise<PhotoEdit | null> {
    const sha8 = assetSha8(assetParam);
    if (!sha8 || typeof edit8 !== 'string' || !EDIT8_RE.test(edit8)) return null;
    try {
      const file = Bun.file(perUsePath(sha8, edit8));
      if (!(await file.exists()) || file.size > PHOTO_EDIT_MAX_BYTES) return null;
      const parsed = JSON.parse(await file.text());
      return validatePhotoEdit(parsed).ok ? (parsed as PhotoEdit) : null;
    } catch {
      return null;
    }
  }

  async function planPerUseEdit(
    assetParam: string | null | undefined,
    edit: unknown
  ): Promise<PerUsePlan> {
    const sha8 = assetSha8(assetParam);
    if (!sha8) return { ok: false, status: 400, error: 'invalid or missing asset (expected sha8)' };
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
    // The same stamp the every-use writer applies, BEFORE hashing: the name is the hash of
    // exactly the object on disk, so any reader can check a file against its own name.
    const toWrite: PhotoEdit = { ...(edit as PhotoEdit), version: PHOTO_EDIT_VERSION };
    const full = photoEditHash(toWrite);
    const bytes = JSON.stringify(toWrite, null, 2);
    for (const n of EDIT_NAME_LENGTHS) {
      const edit8 = full.slice(0, n);
      const abs = perUsePath(sha8, edit8);
      const there = hashOnDisk(abs);
      if (there !== null && there !== full) continue; // a collision: lengthen the name
      return {
        ok: true,
        sha8,
        edit8,
        rel: perUseRel(sha8, edit8),
        abs,
        edit: toWrite,
        bytes,
        present: there === full,
      };
    }
    return { ok: false, status: 409, error: 'every name for this edit is taken by other bytes' };
  }

  async function savePerUseEdit(
    assetParam: string | null | undefined,
    edit: unknown
  ): Promise<
    | { ok: true; path: string; edit8: string; edit: PhotoEdit }
    | { ok: false; status: number; error: string }
  > {
    const plan = await planPerUseEdit(assetParam, edit);
    if (!plan.ok) return plan;
    if (!plan.present) {
      try {
        await Bun.write(plan.abs, plan.bytes);
        ctx.bus.emit('fs:any', plan.rel);
      } catch (e) {
        return { ok: false, status: 500, error: e instanceof Error ? e.message : 'write failed' };
      }
    }
    return { ok: true, path: plan.rel, edit8: plan.edit8, edit: plan.edit };
  }

  function routeParams(req: Request): URLSearchParams | null {
    try {
      const url = new URL(req.url);
      return url.pathname === '/_api/photo-edit' ? url.searchParams : null;
    } catch {
      return null;
    }
  }

  const isPerUsePut = (req: Request, q: URLSearchParams) =>
    (req.method === 'PUT' || req.method === 'POST') && q.get('perUse') === '1';

  async function bodyOf(req: Request): Promise<unknown> {
    try {
      const text = await req.clone().text();
      if (Buffer.byteLength(text, 'utf8') > PHOTO_EDIT_MAX_BYTES + 1024) return undefined;
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  async function gateTarget(req: Request): Promise<string | null | undefined> {
    const q = routeParams(req);
    if (!q) return undefined;
    const asset = q.get('asset');
    const edit = q.get('edit');
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (edit === null) return undefined; // the every-use read keeps its v1 answer
      const sha8 = assetSha8(asset);
      return sha8 && EDIT8_RE.test(edit) ? perUseRel(sha8, edit) : null;
    }
    if (isPerUsePut(req, q)) {
      const plan = await planPerUseEdit(asset, await bodyOf(req));
      return plan.ok ? plan.rel : null;
    }
    const sha8 = assetSha8(asset);
    return sha8 ? `assets/${sha8}.photo.json` : null;
  }

  async function gateBody(req: Request): Promise<string | undefined> {
    const q = routeParams(req);
    if (!q || !isPerUsePut(req, q)) return undefined;
    const plan = await planPerUseEdit(q.get('asset'), await bodyOf(req));
    return plan.ok ? plan.bytes : undefined;
  }

  function holdsOther(rel: string, body: string): boolean {
    const m = PER_USE_PHOTO_RE.exec(rel);
    const abs = path.join(ctx.paths.designRoot, rel);
    if (!m) return existsSync(abs);
    const there = hashOnDisk(abs);
    if (there === null) return false;
    try {
      return there !== photoEditHash(JSON.parse(body));
    } catch {
      return true;
    }
  }

  return {
    editPathForSha8,
    getPhotoEdit,
    savePhotoEdit,
    getPerUseEdit,
    planPerUseEdit,
    savePerUseEdit,
    gateTarget,
    gateBody,
    holdsOther,
  };
}
