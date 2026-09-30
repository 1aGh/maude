/**
 * @file       annotations/replica.ts — the annotations-v2 Yjs replica (DDR-242 §5)
 * @scope      apps/studio/annotations/replica.ts
 * @purpose    One codec for the board inside a Y.Doc, used by every writer: the
 *             collab room, the studio sync agent + projection, and the hub
 *             kernel. The replica is
 *
 *               Y.Map('annotations2')   element id → Y.Map(field → JSON value)
 *                 '~v'      = 2          format marker (present once v2 wrote)
 *                 '~action' = <id>       the action that produced the last write
 *
 *             A NEW type name on purpose: a v1 peer keeps writing
 *             `Y.Map('annotations').svg`, which v2 never reads once '~v' is set,
 *             so a stale peer can't erase a v2 board (the DDR-223 failure class).
 *             Before any v2 write, the legacy value is read through the v1→v2
 *             migration (lazy, read-only).
 *
 *             Writes are DIFFS: callers hand over a whole board (or ops) and
 *             only changed elements / fields become Yjs updates — so every lane
 *             "replace" in the sync code now crosses the wire per element.
 *
 *             The doc is peer-writable in legacy mode, so every read validates
 *             (DDR-054): a malformed element is dropped, never trusted.
 */

import * as Y from 'yjs';
import { MAX_LEGACY_SVG_BYTES } from './constants.ts';
import { jsonEq } from './fields.ts';
import { migrateSvg } from './migrate-v1.ts';
import { type ApplyResult, applyOps, type Op } from './ops.ts';
import { type BoardResult, parseBoard, serializeBoard, validateElements } from './schema.ts';
import type { AnnotationElement } from './types.ts';

export const REPLICA_TYPE = 'annotations2';
/** The v1 map (`svg` key). Read only for lazy migration. */
export const LEGACY_TYPE = 'annotations';
export const FORMAT_KEY = '~v';
export const ACTION_KEY = '~action';
export const REPLICA_VERSION = 2;

const ACTION_RE = /^[A-Za-z0-9_-]{1,96}$/;

export function validActionId(v: unknown): v is string {
  return typeof v === 'string' && ACTION_RE.test(v);
}

function outer(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(REPLICA_TYPE);
}

/** True once any v2 writer has written this doc. */
export function hasReplica(doc: Y.Doc): boolean {
  return outer(doc).get(FORMAT_KEY) === REPLICA_VERSION;
}

function legacySvg(doc: Y.Doc): string | null {
  const svg = doc.getMap<unknown>(LEGACY_TYPE).get('svg');
  return typeof svg === 'string' && svg.trim() ? svg : null;
}

/**
 * The board held by the doc, or null when it was never populated (neither a v2
 * write nor a legacy value) — the cold-start "unknown" state, distinct from an
 * empty board.
 */
export function readReplica(doc: Y.Doc): BoardResult | null {
  const map = outer(doc);
  if (map.get(FORMAT_KEY) === REPLICA_VERSION) {
    const raw: unknown[] = [];
    for (const [key, value] of map.entries()) {
      if (key.startsWith('~')) continue;
      if (value instanceof Y.Map) raw.push({ ...value.toJSON(), id: key });
    }
    return validateElements(raw);
  }
  const svg = legacySvg(doc);
  if (svg !== null) {
    // A peer-written legacy value far beyond the v1 cap is not parsed at all.
    if (svg.length > MAX_LEGACY_SVG_BYTES) {
      return {
        elements: [],
        dropped: [{ reason: 'legacy annotations value exceeds the size cap' }],
      };
    }
    const m = migrateSvg(svg);
    return { elements: m.elements, dropped: m.report };
  }
  if (doc.getMap<unknown>(LEGACY_TYPE).has('svg')) return { elements: [], dropped: [] };
  return null;
}

/** Canonical board text of the doc, or null when never populated. */
export function replicaBoardText(doc: Y.Doc): string | null {
  const r = readReplica(doc);
  return r ? serializeBoard(r.elements) : null;
}

/** The last action id recorded by a v2 writer (echo suppression). */
export function replicaActionId(doc: Y.Doc): string | undefined {
  const v = outer(doc).get(ACTION_KEY);
  return validActionId(v) ? v : undefined;
}

/**
 * The board text a doc's replica last AGREED with on disk — noted by every
 * doc→disk projector (the room's flush, the sync agent's writer) and by the
 * disk→doc importer. Keyed by the doc, so all projectors of a shared doc see
 * the same base (sync/codec.ts `importAnnotationsFromDisk`).
 */
const onDisk = new WeakMap<Y.Doc, string>();

/** Record that disk holds `text` as projected from / imported into `doc`. */
export function noteAnnotationsOnDisk(doc: Y.Doc, text: string): void {
  onDisk.set(doc, text);
}

export function annotationsOnDiskOf(doc: Y.Doc): string | undefined {
  return onDisk.get(doc);
}

export interface WriteOpts {
  /** Recorded under '~action' so the author can recognise its own echo. */
  actionId?: string;
}

/**
 * Make the replica hold exactly `elements` (already canonical), touching only
 * what differs. Returns whether anything changed. One transaction, `origin`
 * tagged, so peers receive ONE update.
 */
export function writeReplica(
  doc: Y.Doc,
  elements: readonly AnnotationElement[],
  origin?: unknown,
  opts: WriteOpts = {}
): boolean {
  const map = outer(doc);
  const target = new Map(elements.map((e) => [e.id, e]));
  let changed = false;
  doc.transact(() => {
    if (map.get(FORMAT_KEY) !== REPLICA_VERSION) {
      map.set(FORMAT_KEY, REPLICA_VERSION);
      changed = true;
    }
    for (const key of [...map.keys()]) {
      if (key.startsWith('~') || target.has(key)) continue;
      map.delete(key);
      changed = true;
    }
    for (const [id, el] of target) {
      const cur = map.get(id);
      const fields = Object.entries(el).filter(([k]) => k !== 'id');
      if (!(cur instanceof Y.Map)) {
        const inner = new Y.Map<unknown>();
        for (const [k, v] of fields) inner.set(k, v);
        map.set(id, inner);
        changed = true;
        continue;
      }
      const keep = new Set(fields.map(([k]) => k));
      for (const k of [...cur.keys()]) {
        if (!keep.has(k)) {
          cur.delete(k);
          changed = true;
        }
      }
      for (const [k, v] of fields) {
        if (!jsonEq(cur.get(k), v)) {
          cur.set(k, v);
          changed = true;
        }
      }
    }
    if (changed && opts.actionId && validActionId(opts.actionId))
      map.set(ACTION_KEY, opts.actionId);
    else if (changed) map.delete(ACTION_KEY);
  }, origin);
  return changed;
}

/** `writeReplica` from untrusted board text. Returns null when the text is not a board. */
export function writeReplicaText(
  doc: Y.Doc,
  text: string | null,
  origin?: unknown,
  opts: WriteOpts = {}
): boolean | null {
  if (text === null || text === '') return writeReplica(doc, [], origin, opts);
  const parsed = parseBoard(text);
  if (parsed.dropped.some((d) => d.id === undefined)) return null; // not a board document
  return writeReplica(doc, parsed.elements, origin, opts);
}

/** Apply ops to the replica under the DDR-242 merge rule; writes only the diff. */
export function applyOpsToReplica(
  doc: Y.Doc,
  ops: readonly Op[],
  origin?: unknown,
  opts: WriteOpts = {}
): ApplyResult {
  const cur = readReplica(doc)?.elements ?? [];
  const r = applyOps(new Map(cur.map((e) => [e.id, e])), ops);
  if (r.touched.size || !hasReplica(doc)) writeReplica(doc, [...r.state.values()], origin, opts);
  return r;
}

/**
 * Observe the replica. `cb` receives the whole validated board, the ids whose
 * records changed, and the action id of the write (undefined for a legacy /
 * unattributed write). Fires once immediately with the current state — but
 * never for a doc that was never populated: "no value yet" is not an empty
 * board, and reporting it as one would wipe what the caller already loaded
 * (the DDR-223 lesson).
 */
export function observeReplica(
  doc: Y.Doc,
  cb: (
    elements: AnnotationElement[],
    changed: ReadonlySet<string>,
    actionId: string | undefined
  ) => void
): () => void {
  const map = outer(doc);
  const legacy = doc.getMap<unknown>(LEGACY_TYPE);
  const emit = (changed: Set<string>) => {
    const r = readReplica(doc);
    if (r === null) return;
    cb(r.elements, changed, replicaActionId(doc));
  };
  const onDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const changed = new Set<string>();
    for (const ev of events) {
      if (ev.target === map) {
        for (const k of (ev as Y.YMapEvent<unknown>).keysChanged)
          if (!k.startsWith('~')) changed.add(k);
      } else {
        const id = ev.path[0];
        if (typeof id === 'string') changed.add(id);
      }
    }
    if (changed.size) emit(changed);
  };
  // Until a v2 writer has written, a legacy peer's `svg` is the source.
  const onLegacy = (ev: Y.YMapEvent<unknown>) => {
    if (!hasReplica(doc) && ev.keysChanged.has('svg')) emit(new Set());
  };
  map.observeDeep(onDeep);
  legacy.observe(onLegacy);
  emit(new Set());
  return () => {
    map.unobserveDeep(onDeep);
    legacy.unobserve(onLegacy);
  };
}

/** Zero elements — the cold-start emptiness test (DDR-223), for board text or legacy SVG. */
export function isEmptyBoardText(text: string | null): boolean {
  if (text === null || text.trim() === '') return true;
  if (/^\s*</.test(text)) {
    if (text.length > MAX_LEGACY_SVG_BYTES) return false; // unparsed ≠ empty (DDR-223)
    return migrateSvg(text).elements.length === 0;
  }
  return parseBoard(text).elements.length === 0;
}
