// sync/pending-deletes.ts — fix/ds-convert-hooks-cli #7: a deletion made while no studio runs.
//
// "This canvas is gone" travels only on the `canvas-deleted` bus event (sync/index.ts `noteToHub`):
// a file missing from disk is "this machine stopped carrying it", never a deletion. A verb that
// runs IN-PROCESS because no studio answers (`maude design ds convert <ds> --restore`,
// ds/ds-verb.ts) has no bus — so its deletion went nowhere, and the next boot's pull brought the
// hub's copy straight back (and with it, on the next convert, `ds-convert-exists`).
//
// So the in-process run writes the deletion down here, and the next sync boot (1) keeps the boot
// pull from fetching those canvases and (2) emits `canvas-deleted` for each one whose file is
// still absent — the same signal the routes send, so the hub hears it exactly as it would have.
// A canvas whose file is back by then (re-created offline) is not a deletion any more: dropped.
//
// `<designRoot>/_state/pending-deletes.json` — `_state/` is per-machine runtime state in every
// DDR-115 list, so this never syncs, never commits, and a clone never carries one.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FILE = ['_state', 'pending-deletes.json'] as const;
const MAX = 256;
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,199}$/;

export interface PendingDelete {
  slug: string;
  /** The canvas file, design-root-relative, POSIX — checked for absence at boot. */
  rel: string;
  at: number;
}

const fileOf = (designRoot: string) => path.join(designRoot, ...FILE);

function safeRel(rel: unknown): rel is string {
  return (
    typeof rel === 'string' &&
    rel.length > 0 &&
    rel.length <= 1024 &&
    !rel.startsWith('/') &&
    !rel.split('/').some((s) => s === '..' || s === '' || s.startsWith('_'))
  );
}

/** The recorded deletions; `[]` for none, a missing file or anything malformed. */
export function readPendingDeletes(designRoot: string): PendingDelete[] {
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(fileOf(designRoot), 'utf8'));
  } catch {
    return [];
  }
  const list = (doc as { v?: unknown; deletes?: unknown })?.deletes;
  if ((doc as { v?: unknown })?.v !== 1 || !Array.isArray(list)) return [];
  return list
    .filter(
      (d): d is PendingDelete =>
        !!d &&
        typeof d.slug === 'string' &&
        SLUG_RE.test(d.slug) &&
        safeRel(d.rel) &&
        typeof d.at === 'number'
    )
    .slice(0, MAX);
}

/** Write one deletion down (deduplicated by slug, newest kept). Best-effort, never throws. */
export function recordPendingDelete(
  designRoot: string,
  d: { slug: string; rel: string },
  now = Date.now()
): boolean {
  if (!SLUG_RE.test(d.slug) || !safeRel(d.rel)) return false;
  try {
    const next = [
      ...readPendingDeletes(designRoot).filter((x) => x.slug !== d.slug),
      { slug: d.slug, rel: d.rel, at: now },
    ].slice(-MAX);
    const abs = fileOf(designRoot);
    mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ v: 1, deletes: next })}\n`, { mode: 0o600 });
    renameSync(tmp, abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Boot: take the recorded deletions. Returns the ones still deletions (their file is absent) and
 * clears the record — what it held is either told now or no longer true.
 */
export function takePendingDeletes(designRoot: string): PendingDelete[] {
  const all = readPendingDeletes(designRoot);
  try {
    rmSync(fileOf(designRoot), { force: true });
  } catch {
    /* a record we cannot clear is told again next boot — the hub's delete is idempotent */
  }
  return all.filter((d) => !existsSync(path.join(designRoot, ...d.rel.split('/'))));
}
