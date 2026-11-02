// The object conflicts THIS Mac lost — S9.24 (10 · co-sync-back, co-conflict).
//
// When the project accepts one of our annotations proposals with elements HELD at the head's version
// (`objectConflicts`, sync/object-conflict.ts — both sides changed the same sticky), the card that
// offers Keep yours / Keep theirs / Keep both must survive a restart: the proposal may have been
// replayed from the durable outbox by a later run, long after the window that made it closed. So the
// held elements are written here, per canvas, as runtime state of this Mac:
//
//   <designRoot>/_state/conflicts/<slug>.json   { v: 1, slug, conflicts: [ConflictEntry] }
//
// `_state/` is per-machine runtime state in every DDR-115 list (never versioned, never synced) — the
// card is the proposer's, never a peer's. Two producers feed it, and both are idempotent (an entry is
// keyed by element id; the newer record of an id replaces the older):
//   • the lane proposal's own answer (accepted-link `laneLink().propose`), and
//   • the transaction client's `onResult` — the ONLY hook that sees an outbox replay after a restart,
//     where nobody awaits the proposal any more.
// The resolve route (routes/sync-conflicts.ts) reads it and drops an entry once the person picked.

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { HeldObjectConflict } from './projection.ts';
import { slugFromDocName } from './remote-docs.ts';

export interface ConflictEntry extends HeldObjectConflict {
  /** The project action that carried the proposal (its `@aside` effect keeps our board). */
  actionId?: string;
  /** When this Mac learned of it (ms). */
  at: number;
}

export interface ConflictRecord {
  v: 1;
  slug: string;
  conflicts: ConflictEntry[];
}

// A canvas slug (canvas-slug.ts): never a separator, never a leading dot — a plain file name.
const SLUG_RE = /^[^/\\\0.][^/\\\0]{0,199}$/u;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Per canvas; the hub's answer is already bounded (heldObjects keeps ≤ 200). */
const MAX_ENTRIES = 200;
/** One element body as recorded (a sticky is a few hundred bytes; an ink stroke more). */
const MAX_ELEMENT_BYTES = 64 * 1024;

const dirOf = (designRoot: string) => path.join(designRoot, '_state', 'conflicts');

export function conflictFile(designRoot: string, slug: string): string | null {
  return SLUG_RE.test(slug) ? path.join(dirOf(designRoot), `${slug}.json`) : null;
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const element = (v: unknown): Record<string, unknown> | null => {
  if (!isRec(v)) return null;
  try {
    return JSON.stringify(v).length <= MAX_ELEMENT_BYTES ? v : null;
  } catch {
    return null;
  }
};

/** One entry as read back from disk (the file is ours, but a torn or hand-edited one is not trusted). */
function cleanEntry(v: unknown): ConflictEntry | null {
  if (!isRec(v) || typeof v.id !== 'string' || !ID_RE.test(v.id)) return null;
  const mine = element(v.mine);
  const theirs = element(v.theirs);
  if (!mine && !theirs) return null;
  return {
    id: v.id,
    type: typeof v.type === 'string' ? v.type.slice(0, 40) : '',
    fields: Array.isArray(v.fields)
      ? v.fields.filter((f): f is string => typeof f === 'string').slice(0, 40)
      : [],
    mine,
    theirs,
    ...(typeof v.actionId === 'string' && v.actionId.length <= 128 ? { actionId: v.actionId } : {}),
    at: typeof v.at === 'number' && Number.isFinite(v.at) ? v.at : 0,
  };
}

/** The canvas's held conflicts (empty when none, or when the file is unreadable). */
export function readConflicts(designRoot: string, slug: string): ConflictEntry[] {
  const file = conflictFile(designRoot, slug);
  if (!file) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!isRec(raw) || !Array.isArray(raw.conflicts)) return [];
    return raw.conflicts
      .slice(0, MAX_ENTRIES)
      .map(cleanEntry)
      .filter((e): e is ConflictEntry => !!e);
  } catch {
    return [];
  }
}

/** Every canvas with a held conflict on this Mac. */
export function listConflicts(designRoot: string): ConflictRecord[] {
  let names: string[];
  try {
    names = readdirSync(dirOf(designRoot));
  } catch {
    return [];
  }
  const out: ConflictRecord[] = [];
  for (const n of names.sort()) {
    const slug = n.endsWith('.json') ? n.slice(0, -5) : '';
    if (!SLUG_RE.test(slug)) continue;
    const conflicts = readConflicts(designRoot, slug);
    if (conflicts.length) out.push({ v: 1, slug, conflicts });
  }
  return out;
}

function writeConflicts(designRoot: string, slug: string, list: ConflictEntry[]): void {
  const file = conflictFile(designRoot, slug);
  if (!file) return;
  if (!list.length) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  const body: ConflictRecord = { v: 1, slug, conflicts: list.slice(-MAX_ENTRIES) };
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(body)}\n`);
  renameSync(tmp, file);
}

/**
 * Note held conflicts for one canvas. An id already recorded is replaced (the newer race is the
 * one the card must show); the rest are kept. Best-effort: a failed write never fails the sync.
 */
export function recordConflicts(
  designRoot: string,
  slug: string,
  held: readonly HeldObjectConflict[],
  o: { actionId?: string; now?: number } = {}
): void {
  if (!SLUG_RE.test(slug) || !held.length) return;
  const at = o.now ?? Date.now();
  const fresh = held
    .map((c) => cleanEntry({ ...c, ...(o.actionId ? { actionId: o.actionId } : {}), at }))
    .filter((e): e is ConflictEntry => !!e);
  if (!fresh.length) return;
  const ids = new Set(fresh.map((e) => e.id));
  const kept = readConflicts(designRoot, slug).filter((e) => !ids.has(e.id));
  try {
    writeConflicts(designRoot, slug, [...kept, ...fresh]);
  } catch {
    /* best-effort: the kernel kept our board aside regardless — Version history still has it */
  }
}

/** The person picked: the entry goes (the file goes with the last one). True when it was there. */
export function clearConflict(designRoot: string, slug: string, id: string): boolean {
  const list = readConflicts(designRoot, slug);
  const next = list.filter((e) => e.id !== id);
  if (next.length === list.length) return false;
  writeConflicts(designRoot, slug, next);
  return true;
}

/**
 * The `onResult` producer: an accepted result's `merged[]` names each held doc. Grouped by the
 * LOCAL slug of the doc (namespaced or flat — `slugFromDocName` refuses anything else).
 */
export function recordFromResult(
  designRoot: string,
  result: { status?: unknown; actionId?: unknown; merged?: unknown },
  o: { now?: number } = {}
): void {
  if (result.status !== 'accepted' || !Array.isArray(result.merged)) return;
  const actionId = typeof result.actionId === 'string' ? result.actionId : undefined;
  for (const m of result.merged) {
    if (!isRec(m) || m.lane !== 'annotations' || !Array.isArray(m.conflicts)) continue;
    const doc = typeof m.followedTo === 'string' ? m.followedTo : m.doc;
    const slug = typeof doc === 'string' ? slugFromDocName(doc) : null;
    if (!slug) continue;
    const held = m.conflicts
      .slice(0, MAX_ENTRIES)
      .filter((c): c is HeldObjectConflict => isRec(c) && typeof c.id === 'string');
    recordConflicts(designRoot, slug, held, { ...(actionId ? { actionId } : {}), ...o });
  }
}
