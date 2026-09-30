/**
 * @file       annotations/migrate-boot.ts — one-shot v1 → v2 migration of board files
 * @scope      apps/studio/annotations/migrate-boot.ts
 * @purpose    DDR-242 §6. For every `<slug>.annotations.svg` at the design root:
 *               • no `<slug>.annotations.json` yet → convert (the pure
 *                 `migrateSvg`), write the board atomically, snapshot the
 *                 original to `_history/<slug>/pre-annotations-v2/`, move the SVG
 *                 to `_trash/annotations-v1/`;
 *               • a board already exists → the SVG is STALE (an old branch
 *                 checkout, a v1 peer) and is quarantined to
 *                 `_trash/annotations-v1/stale-…`, never merged over the board.
 *             Idempotent (the steady state is a no-op), never throws, never
 *             deletes: every original survives under `_history/` or `_trash/`.
 *             Mirrors sync/migrate-flat-fallback.ts. A lock under `_state/` keeps
 *             two processes booting at once from racing the same files.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { MAX_LEGACY_SVG_BYTES } from './constants.ts';
import { migrateSvg } from './migrate-v1.ts';
import { serializeBoard } from './schema.ts';

export interface AnnotationsMigration {
  slug: string;
  action: 'migrated' | 'stale-quarantined' | 'failed';
  elements?: number;
  /** Elements that could not be carried over (from the migration report). */
  dropped?: number;
  detail?: string;
}

const LOCK = path.join('_state', 'annotations-v2-migrate.lock');
const LOCK_STALE_MS = 60_000;

function takeLock(designRoot: string, realRoot: string): (() => void) | null {
  const abs = path.join(designRoot, LOCK);
  try {
    containedDir(realRoot, path.dirname(abs));
    if (existsSync(abs) && Date.now() - statSync(abs).mtimeMs > LOCK_STALE_MS)
      rmSync(abs, { force: true });
    writeFileSync(abs, String(process.pid), { flag: 'wx' });
    return () => rmSync(abs, { force: true });
  } catch {
    return null; // another process is migrating right now — it will finish the job
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** `dir/name`, or a timestamped sibling when that is taken — a re-migration
 *  (the SVG came back) never overwrites the first original (code review M7). */
function freshPath(dir: string, name: string): string {
  const plain = path.join(dir, name);
  return existsSync(plain) ? path.join(dir, `${stamp()}-${name}`) : plain;
}

/**
 * Create `dir` and prove it resolves inside the design root. `_history`,
 * `_trash` and `_state` are ordinary directories a synced or checked-out
 * project controls — a symlink among them must not turn a boot-time write
 * into a write anywhere on disk (security review, defender #3).
 */
function containedDir(realRoot: string, dir: string): string {
  const inside = (p: string) => {
    const real = realpathSync(p);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new Error(`${path.relative(realRoot, dir)} resolves outside the design root`);
    }
  };
  // Check the deepest EXISTING ancestor before creating anything: a recursive
  // mkdir would already have followed a symlinked `_trash` out of the root.
  let probe = dir;
  while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  inside(probe);
  mkdirSync(dir, { recursive: true });
  inside(dir);
  return dir;
}

export function migrateAnnotationsV2(opts: {
  designRoot: string;
  log?: (line: string) => void;
}): AnnotationsMigration[] {
  const { designRoot } = opts;
  const log = opts.log ?? ((line: string) => console.log(line));
  const out: AnnotationsMigration[] = [];
  let names: string[];
  try {
    names = readdirSync(designRoot).filter((n) => n.toLowerCase().endsWith('.annotations.svg'));
  } catch {
    return out;
  }
  if (!names.length) return out;
  let realRoot: string;
  try {
    realRoot = realpathSync(designRoot);
  } catch {
    return out;
  }
  const release = takeLock(designRoot, realRoot);
  if (!release) return out;
  try {
    for (const name of names) {
      const slug = name.slice(0, -'.annotations.svg'.length);
      const svgAbs = path.join(designRoot, name);
      const jsonAbs = path.join(designRoot, `${slug}.annotations.json`);
      try {
        // Only a regular file is migrated — never a symlink's target — and its
        // size is checked before a byte is read (untrusted content, DDR-054).
        const st = lstatSync(svgAbs, { throwIfNoEntry: false });
        if (!st) continue;
        if (!st.isFile()) throw new Error('not a regular file');
        if (st.size > MAX_LEGACY_SVG_BYTES) {
          throw new Error(`larger than ${MAX_LEGACY_SVG_BYTES} bytes`);
        }
        const trashDir = containedDir(realRoot, path.join(designRoot, '_trash', 'annotations-v1'));
        if (existsSync(jsonAbs)) {
          const to = path.join(trashDir, `stale-${stamp()}-${name}`);
          renameSync(svgAbs, to);
          out.push({ slug, action: 'stale-quarantined', detail: path.relative(designRoot, to) });
          log(
            `[annotations] ${name} reappeared next to ${slug}.annotations.json — quarantined to ${path.relative(designRoot, to)} (the board was not changed)`
          );
          continue;
        }
        const text = readFileSync(svgAbs, 'utf8');
        const { elements, report } = migrateSvg(text);
        // Snapshot first: if anything below fails, the original is still in place.
        const snapDir = containedDir(
          realRoot,
          path.join(designRoot, '_history', slug, 'pre-annotations-v2')
        );
        writeFileSync(freshPath(snapDir, name), text, { flag: 'wx' });
        const stateDir = containedDir(realRoot, path.join(designRoot, '_state'));
        const tmp = path.join(stateDir, `annotations-v2-${slug}-${process.pid}.tmp`);
        writeFileSync(tmp, serializeBoard(elements));
        renameSync(tmp, jsonAbs);
        renameSync(svgAbs, freshPath(trashDir, name));
        out.push({ slug, action: 'migrated', elements: elements.length, dropped: report.length });
        log(
          `[annotations] migrated ${name} → ${slug}.annotations.json (${elements.length} elements${
            report.length
              ? `, ${report.length} not carried over — see _history/${slug}/pre-annotations-v2/`
              : ''
          })`
        );
        for (const r of report) log(`[annotations]   ${r.id ?? '(board)'}: ${r.reason}`);
      } catch (err) {
        out.push({ slug, action: 'failed', detail: (err as Error).message });
        log(`[annotations] could not migrate ${name}: ${(err as Error).message} — left in place`);
      }
    }
  } finally {
    release();
  }
  return out;
}
