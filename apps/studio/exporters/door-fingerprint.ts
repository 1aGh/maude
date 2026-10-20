// S8.5b-1 — the file-hash check behind the cloud render door (contract
// client/v2/contracts/S8.5b-cloud-render-door.md §6).
//
// The cell renders its OWN synced checkout, never bytes the Mac uploads. So before a desktop's
// cloud export runs, the hub asks one question: does the checkout hold at least what this Mac had
// when the export was SENT? The desktop answers it with a closure fingerprint — every file the
// canvas reads (its sidecars, its imports, its design system, its static assets), code by sha256
// and content-addressed assets by presence — and the hub judges that list against its checkout.
//
// SHARED by the hub (`apps/hub`, Node strip-only TypeScript) and the desktop (Bun): keep this file
// on `node:*` plus the light `access/*` and `sync/file-membership.ts` modules. No Bun APIs, no
// oxc, no canvas-edit, no TS parameter properties or enums.
//
// Security (§12): the list is UNTRUSTED on the judging side. `parseFingerprint` bounds it;
// `judgeFreshness` reads only well-shaped, non-runtime rels that resolve inside the checkout,
// and only rels the SESSION sees — an out-of-closure rel is skipped silently, so the answer is no
// existence or content oracle (T7). At most `MAX_BEHIND_NAMED` rels are named.

import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

import { closureFor, type ProjectReader } from '../access/closure.ts';
import { diskProjectReader } from '../access/request.ts';
import { resolveAccess } from '../access/scope.ts';
import { isProjectFileShape, isRuntimeStateRel } from '../sync/file-membership.ts';

/** One closure entry: a file by content hash, or (sha256 null) a content-addressed asset by presence. */
export interface FingerprintEntry {
  rel: string;
  sha256: string | null;
}

/** Past this many entries the door does not run: "render it on this Mac" (§6, Q5). */
export const MAX_FINGERPRINT_ENTRIES = 2000;
/** A `not-synced` answer names at most this many rels (§6). */
export const MAX_BEHIND_NAMED = 20;
/** A file bigger than this is judged by presence: hashing it on every send is not worth it. */
export const MAX_HASHED_BYTES = 64 * 1024 * 1024;
const MAX_REL_CHARS = 512;

/** `assets/<sha8…>.<ext>` — the name IS the hash of the bytes, so presence is equality. */
const CONTENT_ADDRESSED_RE = /^assets\/[0-9a-f]{8,64}\.[A-Za-z0-9][A-Za-z0-9.]{0,15}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

export type FingerprintResult =
  | { ok: true; expect: FingerprintEntry[] }
  | { ok: false; reason: 'too-large'; count: number };

export type FreshnessVerdict = { ok: true } | { ok: false; behind: string[] };

/** A rel this check may name or read at all: a project file's shape, never runtime state. */
function judgeable(rel: string): boolean {
  return (
    typeof rel === 'string' &&
    rel.length > 0 &&
    rel.length <= MAX_REL_CHARS &&
    !isAbsolute(rel) &&
    !rel.includes('\\') &&
    isProjectFileShape(rel) &&
    !isRuntimeStateRel(rel)
  );
}

/**
 * `rel` inside `root`, following symlinks — the realpath must stay under the root's realpath
 * (a link out of the checkout answers like a missing file). Null = missing or outside.
 */
function containedFile(rootReal: string, rel: string): { abs: string; size: number } | null {
  const abs = resolve(rootReal, rel);
  if (abs !== rootReal && !abs.startsWith(rootReal + sep)) return null;
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return null;
  }
  if (!real.startsWith(rootReal + sep)) return null;
  try {
    const st = statSync(real);
    return st.isFile() ? { abs: real, size: st.size } : null;
  } catch {
    return null;
  }
}

function sha256File(abs: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(abs, 'r');
    const size = fstatSync(fd).size;
    const h = createHash('sha256');
    const buf = Buffer.allocUnsafe(Math.min(1024 * 1024, Math.max(1, size)));
    let pos = 0;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      h.update(n === buf.length ? buf : buf.subarray(0, n));
      pos += n;
    }
    return h.digest('hex');
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function rootRealOf(root: string): string | null {
  try {
    return realpathSync(root);
  } catch {
    return null;
  }
}

/**
 * DESKTOP side, at send time: what this Mac expects the cloud copy to hold for `canvases`
 * (design-root rels; a Folder scope passes every canvas in it — the closure is their union).
 * Only files that exist here are listed, sorted by rel.
 */
export function closureFingerprint(
  designRoot: string,
  canvases: string | readonly string[],
  opts: { reader?: ProjectReader } = {}
): FingerprintResult {
  const list = typeof canvases === 'string' ? [canvases] : [...canvases];
  const rootReal = rootRealOf(designRoot);
  if (!rootReal || list.length === 0) return { ok: true, expect: [] };
  const access = resolveAccess({ v: 1, role: null, grants: list.map((c) => ({ c, r: 'viewer' })) });
  const reader = opts.reader ?? diskProjectReader(rootReal, () => 'fingerprint');
  const rels = [...closureFor(access, reader).read].filter(judgeable).sort();
  const expect: FingerprintEntry[] = [];
  for (const rel of rels) {
    const file = containedFile(rootReal, rel);
    if (!file) continue; // not on this Mac: nothing to expect
    if (CONTENT_ADDRESSED_RE.test(rel) || file.size > MAX_HASHED_BYTES) {
      expect.push({ rel, sha256: null });
    } else {
      const sha256 = sha256File(file.abs);
      if (sha256) expect.push({ rel, sha256 });
    }
    if (expect.length > MAX_FINGERPRINT_ENTRIES)
      return { ok: false, reason: 'too-large', count: expect.length };
  }
  return { ok: true, expect };
}

/**
 * JUDGING side: the untrusted `expect` of a request body, or null (= 400). Bounded to
 * `MAX_FINGERPRINT_ENTRIES`; every entry exactly `{rel, sha256}`; duplicates refused.
 */
export function parseFingerprint(raw: unknown): FingerprintEntry[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_FINGERPRINT_ENTRIES) return null;
  const seen = new Set<string>();
  const out: FingerprintEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null;
    const keys = Object.keys(e);
    if (keys.length !== 2 || !keys.includes('rel') || !keys.includes('sha256')) return null;
    const { rel, sha256 } = e as { rel: unknown; sha256: unknown };
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > MAX_REL_CHARS) return null;
    if (sha256 !== null && (typeof sha256 !== 'string' || !SHA256_RE.test(sha256))) return null;
    if (seen.has(rel)) return null;
    seen.add(rel);
    out.push({ rel, sha256 });
  }
  return out;
}

/**
 * HUB side: does the checkout at `root` hold at least what the desktop sent? `visible(rel)` is
 * the session's own `sees` — a rel it does not see is skipped without a read, so an answer never
 * tells a session anything about a file outside its closure. A malformed or runtime-state rel is
 * skipped the same way. `behind` names the first `MAX_BEHIND_NAMED` visible rels that are missing,
 * outside the checkout, or different.
 */
export function judgeFreshness(
  expect: readonly FingerprintEntry[],
  opts: { root: string; visible: (rel: string) => boolean }
): FreshnessVerdict {
  const rootReal = rootRealOf(opts.root);
  const behind: string[] = [];
  for (const e of expect.slice(0, MAX_FINGERPRINT_ENTRIES)) {
    if (!judgeable(e.rel)) continue;
    if (!opts.visible(e.rel)) continue;
    const file = rootReal ? containedFile(rootReal, e.rel) : null;
    const fresh =
      file !== null &&
      // a hash the desktop took is of a file ≤ MAX_HASHED_BYTES: a bigger one here differs
      (e.sha256 === null || (file.size <= MAX_HASHED_BYTES && sha256File(file.abs) === e.sha256));
    if (!fresh) {
      behind.push(e.rel);
      if (behind.length >= MAX_BEHIND_NAMED) break;
    }
  }
  return behind.length ? { ok: false, behind } : { ok: true };
}
