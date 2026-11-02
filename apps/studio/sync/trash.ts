// sync/trash.ts — make `_trash/` discoverable, restorable, and prunable
// (feature-before-first-external-users Task 3, finding F-6).
//
// Quarantine-not-delete is only safe if a person can FIND the quarantine:
// until this module, nothing indexed or pruned `_trash/`, and the product's
// own copy pointed users at a hidden gitignored folder they had no way to
// open (DDR-177: no terminal, no file manager habit).
//
// DELIBERATELY A SCANNER, NOT A WRITE-PATH INDEX. Five different writers park
// files here in five path shapes (`<stamp>/<rel>`, `<rel>-conflict-<ts>`,
// `<ts>__moved-<slug>/`, `<slug>-deleted-<ts>/`, `<slug>-flat-<ts>`), and an
// index file every writer must remember to update is exactly the kind of
// contract that silently rots — the disk itself is the one record that cannot
// drift from reality. The scanner derives source path + reason from the shape
// and falls back to "unknown" honestly.
//
// Pruning is USER-TRIGGERED ONLY (per the plan: "never silently on boot") and
// reports what it removed.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

export interface TrashEntry {
  /** Path under the design root (starts with `_trash/`). */
  trashRel: string;
  /** Where a restore would land, or null when the shape doesn't say. */
  sourceRel: string | null;
  /** Why it was parked, derived from the path shape. */
  reason: 'conflict' | 'removed' | 'moved' | 'deleted' | 'migration' | 'unknown';
  /** Park time — the shape's own stamp when parseable, else file mtime. */
  at: number;
  size: number;
}

const CONFLICT_RE = /^(.*)-conflict-(\d{10,})$/;
const MOVED_DIR_RE = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z?)__moved-(.+)$/;
const DELETED_DIR_RE = /^(.+)-deleted-(\d{10,})$/;
const FLAT_RE = /^(.+)-flat-(\d{10,})$/;
const STAMP_DIR_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z$/;

function walkFiles(
  absDir: string,
  relDir: string,
  out: { rel: string; size: number; mtime: number }[]
): void {
  let names: string[];
  try {
    // by name: one bundle's files share their `at`, and the stable newest-first sort keeps this order
    names = readdirSync(absDir).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const abs = path.join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(abs, rel, out);
    else out.push({ rel, size: st.size, mtime: st.mtimeMs });
  }
}

// S1.2 — `api.deleteCanvas` parks a canvas as `<stamp>__<slug>/` and writes `_trash-manifest.json`
// {canvas, slug, trashed[]} beside it, `trashed` being the design-root-relative path of everything it moved.
// The bundle's file names are the basename (primary + siblings) or the rel with `/` → `__` (slug-keyed
// sidecars, which may be whole directories), so the manifest is enough to say where each file belongs and the
// "moved to the trash" toast can Undo through the ordinary per-file restore. An artboard bundle
// (`kind: 'artboard'`) is not a canvas and keeps its null source.
const CANVAS_BUNDLE_RE = /^(\d{4}-\d{2}-\d{2}T[\d-]+Z)__.+$/;

function bundleSources(trashAbs: string, top: string): Map<string, string> | null {
  let m: { kind?: unknown; trashed?: unknown };
  try {
    m = JSON.parse(readFileSync(path.join(trashAbs, top, '_trash-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!m || m.kind === 'artboard' || !Array.isArray(m.trashed)) return null;
  const out = new Map<string, string>();
  for (const rel of m.trashed) {
    if (typeof rel !== 'string' || !rel || rel.includes('..') || path.isAbsolute(rel)) continue;
    const flat = rel.split('/').join('__');
    if (!out.has(flat)) out.set(flat, rel);
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (!out.has(base)) out.set(base, rel);
  }
  return out;
}

/** Every parked file under `<designRoot>/_trash/`, newest first. */
export function listTrash(designRoot: string): TrashEntry[] {
  const trashAbs = path.join(designRoot, '_trash');
  if (!existsSync(trashAbs)) return [];
  const files: { rel: string; size: number; mtime: number }[] = [];
  walkFiles(trashAbs, '', files);
  const bundles = new Map<string, Map<string, string> | null>();

  const entries: TrashEntry[] = files.map((f) => {
    const top = f.rel.split('/')[0];
    const rest = f.rel.split('/').slice(1).join('/');

    // `_trash/<ISO-stamp>/<rel…>` — the file plane's quarantine of a copy the
    // sync removed/replaced; the remainder IS the original path.
    if (STAMP_DIR_RE.test(top) && rest) {
      return entry(f, rest, 'removed', isoStampMs(top) ?? f.mtime);
    }
    // `<rel>-conflict-<ts>` — LWW loser parked beside its own path shape.
    const conflict = CONFLICT_RE.exec(f.rel);
    if (conflict) {
      return entry(f, conflict[1], 'conflict', Number(conflict[2]));
    }
    // `<ts>__moved-<slug>/…` — a canvas's lanes parked on a cross-machine
    // move. The ORIGINAL rel is not recorded in the shape → no one-click
    // restore; the listing still names and dates it.
    const moved = MOVED_DIR_RE.exec(top);
    if (moved) {
      return entry(f, null, 'moved', isoStampMs(moved[1]) ?? f.mtime);
    }
    const bundle = CANVAS_BUNDLE_RE.exec(top);
    if (bundle && rest) {
      if (!bundles.has(top)) bundles.set(top, bundleSources(trashAbs, top));
      const sources = bundles.get(top);
      if (sources) {
        const seg = rest.split('/')[0];
        const src = sources.get(seg);
        const tail = rest.slice(seg.length);
        return entry(f, src ? `${src}${tail}` : null, 'deleted', isoStampMs(bundle[1]) ?? f.mtime);
      }
    }
    const deleted = DELETED_DIR_RE.exec(top);
    if (deleted) {
      return entry(f, null, 'deleted', Number(deleted[2]));
    }
    const flat = FLAT_RE.exec(top);
    if (flat) {
      return entry(f, null, 'migration', Number(flat[2]));
    }
    return entry(f, null, 'unknown', f.mtime);
  });

  entries.sort((a, b) => b.at - a.at);
  return entries;
}

function entry(
  f: { rel: string; size: number },
  sourceRel: string | null,
  reason: TrashEntry['reason'],
  at: number
): TrashEntry {
  return {
    trashRel: `_trash/${f.rel}`,
    sourceRel,
    reason,
    at: Number.isFinite(at) ? at : 0,
    size: f.size,
  };
}

function isoStampMs(stamp: string): number | null {
  // quarantineLocal writes `new Date().toISOString().replace(/[:.]/g, '-')` —
  // undo exactly that: the LAST two dashes before the trailing Z were colons…
  // except the milliseconds dot. Reconstruct positionally (fixed-width ISO).
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(stamp);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isNaN(t) ? null : t;
}

/**
 * Containment: `rel` must resolve strictly inside the design root, symlinks
 * included — the same posture as the file plane's `safeTarget`. Returns the
 * absolute path or null.
 */
function contained(designRoot: string, rel: string): string | null {
  if (rel.includes('..') || path.isAbsolute(rel)) return null;
  const abs = path.resolve(designRoot, rel);
  const root = path.resolve(designRoot);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export interface RestoreResult {
  ok: boolean;
  restoredTo?: string;
  detail?: string;
}

/**
 * Move ONE parked file back. When the source already exists (something new
 * was written there since), the restore lands BESIDE it as
 * `<rel>.restored-<ts>` rather than overwriting — a restore that destroys the
 * newer copy would be the delete bug wearing a recovery costume.
 */
export function restoreFromTrash(designRoot: string, trashRel: string): RestoreResult {
  if (!trashRel.startsWith('_trash/')) return { ok: false, detail: 'not a _trash/ path' };
  const from = contained(designRoot, trashRel);
  if (!from || !existsSync(from)) return { ok: false, detail: 'that parked file no longer exists' };
  if (!statSync(from).isFile()) return { ok: false, detail: 'restore works per file' };

  const derived = listTrash(designRoot).find((e) => e.trashRel === trashRel)?.sourceRel ?? null;
  if (!derived) {
    return {
      ok: false,
      detail: 'the original location is not recorded for this file — copy it out by hand',
    };
  }
  let destRel = derived;
  let dest = contained(designRoot, destRel);
  if (!dest)
    return { ok: false, detail: 'the original location does not resolve inside the project' };
  if (existsSync(dest)) {
    destRel = `${derived}.restored-${Date.now()}`;
    dest = contained(designRoot, destRel);
    if (!dest)
      return { ok: false, detail: 'the restore location does not resolve inside the project' };
  }
  try {
    mkdirSync(path.dirname(dest), { recursive: true });
    renameSync(from, dest);
    return { ok: true, restoredTo: destRel };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'restore failed' };
  }
}

export interface PruneResult {
  pruned: number;
  bytes: number;
  kept: number;
}

/**
 * Remove parked files older than `olderThanDays` (default 30). USER-TRIGGERED
 * ONLY — nothing calls this on boot — and it answers with what it removed.
 * Empty parent directories are swept afterwards so the folder does not
 * accumulate husks.
 */
export function pruneTrash(designRoot: string, olderThanDays = 30, now = Date.now()): PruneResult {
  const cutoff = now - olderThanDays * 24 * 60 * 60 * 1000;
  const entries = listTrash(designRoot);
  let pruned = 0;
  let bytes = 0;
  for (const e of entries) {
    if (e.at >= cutoff) continue;
    const abs = contained(designRoot, e.trashRel);
    if (!abs) continue;
    try {
      rmSync(abs, { force: true });
      pruned += 1;
      bytes += e.size;
    } catch {
      /* counted as kept below */
    }
  }
  sweepEmptyDirs(path.join(designRoot, '_trash'));
  return { pruned, bytes, kept: entries.length - pruned };
}

function sweepEmptyDirs(absDir: string): void {
  if (!existsSync(absDir)) return;
  let names: string[];
  try {
    names = readdirSync(absDir);
  } catch {
    return;
  }
  for (const name of names) {
    const abs = path.join(absDir, name);
    try {
      if (statSync(abs).isDirectory()) {
        sweepEmptyDirs(abs);
        if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true });
      }
    } catch {
      /* best effort */
    }
  }
}
