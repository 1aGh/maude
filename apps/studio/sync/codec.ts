// Y.Doc ↔ disk codecs for the bidirectional file sync agent (Phase 9 Task 4).
//
// The agent shuttles three classes of files between disk and the Y.Doc the
// HocuspocusProvider holds:
//
//   `.design/<canvas>.html`             -> Y.Text     (Y_SYNC_TYPES.html)
//   `.design/_comments/<slug>.json`     -> Y.Array    (Y_TYPES.comments  — Phase 6)
//   `.design/<slug>.annotations.svg`    -> Y.Map.svg  (Y_TYPES.annotations — Phase 5)
//
// v1.1 design decision (plan §"Key insight"): HTML body is treated as opaque
// Y.Text rather than structured Y.XmlFragment. Round-trip drift would
// otherwise cause infinite sync churn — every time we serialize the structured
// CRDT back to HTML the formatting whitespace would shift and re-enter the
// system as a new mutation. Structured CRDT (true element-level co-editing) is
// Phase 10 / v1.2.
//
// The "diff-aware" applyHtmlToDoc replaces the Y.Text contents using a
// longest-common-prefix + suffix elimination so other peers see a minimal
// op (e.g. "user changed character 42 only"). This isn't a true textual diff
// (no LCS), but it's drastically cheaper for typical edits than `delete-all +
// insert-all`, and crucially preserves cursor positions other peers may have
// in the unchanged regions.

import { hostname } from 'node:os';
import { diffChars } from 'diff';
import type * as Y from 'yjs';

import { Y_TYPES } from '../collab/persistence.ts';
import { commentKey } from './comment-identity.ts';
import {
  MAX_ANNOTATIONS_BYTES,
  MAX_COMMENTS_BYTES,
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_META_BYTES,
} from './limits.ts';

/**
 * Y.Doc shared-type names introduced by Task 4. Distinct namespace from
 * Y_TYPES so existing comments / annotations stay untouched; new fields
 * land here.
 */
export const Y_SYNC_TYPES = {
  /** The canvas HTML body, as opaque Y.Text. */
  html: 'html',
  /** The canvas's sibling `.css` (e.g. `Kanban App.css`), as opaque Y.Text.
   *  Edited via files (design:edit), not a live browser surface, so it mirrors
   *  wholesale like the body — no per-user keys, no room-clobber. Phase 9.1
   *  Gap 3. */
  css: 'css',
  /** The canvas `.meta.json` SHARED subset (layout/artboards/structure) as an
   *  opaque canonical-JSON Y.Text. Per-user keys (viewport pan/zoom) + the
   *  security opt-in (syncable) are stripped before sync — see META_LOCAL_KEYS
   *  + sharedMetaCanonical. Phase 9.1 Gap 2. */
  meta: 'meta',
  /** Doc-side sync bookkeeping (Y.Map, DDR-102): `bodyEditAt` ms-epoch stamp
   *  written by every peer that applies a LOCAL body into the doc, + `by` (a
   *  short peer label). The cold-start newest-wins decision compares it to the
   *  local file mtime. Deliberately a dedicated lane: `.meta.json`'s
   *  `last_modified` is in META_LOCAL_KEYS (per-machine, never syncs), so the
   *  meta codec CANNOT carry this. Never materialized to disk. */
  syncMeta: 'syncMeta',
} as const;

/**
 * Hard caps on hub-pushed content (DDR-054 §2d — closes attacker F7). yjs
 * has no upstream-enforced size cap; the codec is the consumer's guard.
 * Mirrors the existing /_api/annotations 1 MB cap (api.ts) so the sync path
 * doesn't bypass the HTTP-layer guard.
 *
 * Defined in `limits.ts` (a leaf) and re-exported here so every existing
 * importer is unchanged — see that file for why they had to move.
 */
export { MAX_ANNOTATIONS_BYTES, MAX_COMMENTS_BYTES, MAX_CSS_BYTES, MAX_HTML_BYTES, MAX_META_BYTES };

function byteLengthUtf8(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

// DDR-054 §2g — strip dangerous keys at parse time so a hostile hub-pushed (or
// planted-commit) payload can't seed `__proto__` / `constructor` / `prototype`
// own-properties that yjs then serializes to other peers / writes to disk that
// Claude reads. Mirrors the agent's comments reviver; applied to the `.meta.json`
// parse paths (Phase D security re-audit finding A3 — the reviver had been
// applied only to the comments lane, not the symmetric meta lane).
function parseJsonSafe(s: string): unknown {
  return JSON.parse(s, (key, value) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return value;
  });
}

/* ---------------------------------------------------------------- HTML */

export function htmlFromDoc(doc: Y.Doc): string {
  return doc.getText(Y_SYNC_TYPES.html).toString();
}

/**
 * Apply `next` as bounded text hunks, preserving unchanged interior CRDT
 * anchors as well as the common prefix/suffix (#121).
 *
 * THIS SHAPE IS A CONVERGENCE PROPERTY, NOT AN OPTIMIZATION (issue #114).
 * Collapsing a concurrency-duplicated lane — `X + X` back to `X` — comes out of
 * this diff as a PURE DELETE of the trailing run: no insert at all. Two peers
 * that independently decide to collapse therefore delete the SAME CRDT items,
 * and deletes are idempotent, so they converge.
 *
 * A wholesale `delete(0, len)` + `insert(0, next)` does not have that property.
 * Both peers' inserts are new items at the same position, and Yjs keeps both —
 * so the "repair" re-creates exactly the duplication it was meant to undo. The
 * css lane was written that way, which is why it was the lane that never came
 * out of a multi-peer cold start clean (measured: 0 of 43 lanes). Any lane whose
 * duplication is repairable MUST go through here.
 *
 * Pass `origin` as the transaction origin so a downstream observer can
 * distinguish self-originated updates from peer/remote ones.
 */
function applyTextLane(doc: Y.Doc, lane: string, next: string, origin?: unknown): boolean {
  const yText = doc.getText(lane);
  const current = yText.toString();
  if (current === next) return false;

  // Find longest common prefix.
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix++;
  }
  // Find longest common suffix that doesn't overlap the prefix.
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current.charCodeAt(current.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }

  // Y.Text offsets are UTF-16; never leave half a surrogate outside a hunk.
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(current[prefix - 1] ?? '')) prefix--;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(current[current.length - suffix] ?? '')) suffix--;
  const deleteLen = current.length - prefix - suffix;
  const insertStr = next.slice(prefix, next.length - suffix);

  // Keep pure inserts/deletes (especially repeat collapse) as one operation.
  // For replacements preserve interior anchors: one prefix/suffix splice can
  // move a concurrent insertion inside an unrelated JSX attribute (#121).
  const changes =
    deleteLen > 0 && insertStr.length > 0
      ? diffChars(current.slice(prefix, current.length - suffix), insertStr, {
          maxEditLength: 4096,
          timeout: 50,
        })
      : null;
  if (changes === undefined) throw new Error('Source diff exceeds the safe merge budget');
  doc.transact(() => {
    if (changes) {
      let offset = prefix;
      for (const change of changes) {
        if (change.removed) yText.delete(offset, change.value.length);
        else {
          if (change.added) yText.insert(offset, change.value);
          offset += change.value.length;
        }
      }
    } else {
      if (deleteLen > 0) yText.delete(prefix, deleteLen);
      if (insertStr.length > 0) yText.insert(prefix, insertStr);
    }
  }, origin);

  return true;
}

/**
 * Apply `next` to the canvas body Y.Text inside `doc`. See `applyTextLane`.
 */
export function applyHtmlToDoc(doc: Y.Doc, next: string, origin?: unknown): boolean {
  if (byteLengthUtf8(next) > MAX_HTML_BYTES) {
    console.warn(
      `[sync/codec] refusing HTML apply > ${MAX_HTML_BYTES} bytes (got ${byteLengthUtf8(next)}). DDR-054 §2d.`
    );
    return false;
  }
  return applyTextLane(doc, Y_SYNC_TYPES.html, next, origin);
}

/* ---------------------------------------------------------------- comments */

/**
 * Comments JSON payload — opaque to the codec, just the array of objects the
 * Y.Array holds.
 */
export type CommentsSnapshot = unknown[];

export function commentsFromDoc(doc: Y.Doc): CommentsSnapshot {
  const arr = doc.getArray(Y_TYPES.comments);
  return arr.toArray();
}

/**
 * Apply `next` to the comments Y.Array as a MINIMAL, IDENTITY-KEYED DIFF.
 *
 * THIS SHAPE IS A CONVERGENCE PROPERTY, NOT AN OPTIMIZATION (issue #112) —
 * the same law `applyTextLane` states for the text lanes, which this lane was
 * missing. It used to be `delete(0, len)` + `push(next)`, and under concurrency
 * that is not a replace at all: two peers delete the SAME items (idempotent)
 * but insert two runs at the same position, and Yjs keeps both. The array
 * becomes `list + list`, `persistJson` writes that to `_comments/<slug>.json`,
 * the file re-imports clean, and the duplication IS the new truth. Every
 * reconciliation round doubled it — 1 → 2 → 4 → 8, the count the #112 reporter
 * saw — and the cold-start union repair, published through the same wholesale
 * write, re-created the duplication it had just undone. Verbatim the css lesson
 * from issue #114, one lane later.
 *
 * The diff gives the lane the property the text lanes got:
 *
 *   - Collapsing a duplicated array is a PURE DELETE of items every peer holds,
 *     and concurrent deletes of the same items are idempotent — so two peers
 *     repairing at once converge instead of re-doubling.
 *   - Dedupe happens on EVERY apply, not only at cold start, so an array that
 *     doubled anyway (an older peer still on the wholesale write, a genuine
 *     concurrent edit of one entry) collapses at the next apply rather than
 *     compounding. Duplication became self-healing instead of exponential.
 *   - Untouched comments keep their CRDT items, so a peer replacing one entry
 *     no longer rewrites the whole list under everyone else's feet.
 *
 * Ordering follows the doc for surviving entries, with genuinely new ones
 * appended. Reordering is deliberately NOT synced: it would be a delete+insert
 * per moved entry — churn with the one shape this fix exists to avoid — and
 * comment order carries no meaning (pins are placed by selector, the sidebar
 * sorts by `created`).
 */
export function applyCommentsToDoc(doc: Y.Doc, next: CommentsSnapshot, origin?: unknown): boolean {
  const arr = doc.getArray<unknown>(Y_TYPES.comments);
  const after = JSON.stringify(next);
  if (byteLengthUtf8(after) > MAX_COMMENTS_BYTES) {
    console.warn(
      `[sync/codec] refusing comments apply > ${MAX_COMMENTS_BYTES} bytes (got ${byteLengthUtf8(after)}). DDR-054 §2d.`
    );
    return false;
  }

  // Desired state, keyed by comment identity. `next` can itself arrive
  // duplicated (a file written before this fix, a list pushed by an older
  // peer), so it is deduped on the way in — first occurrence wins, matching
  // `unionCommentsById` and `dedupeCommentsById`.
  const desired = new Map<string, unknown>();
  for (const c of next) {
    const k = commentKey(c);
    if (!desired.has(k)) desired.set(k, c);
  }

  // Classify every item currently in the array: keep it, replace it in place,
  // or delete it. Duplicates of an identity we already kept are deletes — that
  // is what makes EVERY apply a repair, not just the cold-start union.
  const current = arr.toArray();
  const deletes: number[] = [];
  const replaces: { index: number; value: unknown }[] = [];
  const kept = new Set<string>();
  for (let i = 0; i < current.length; i++) {
    const k = commentKey(current[i]);
    if (!desired.has(k) || kept.has(k)) {
      deletes.push(i);
      continue;
    }
    kept.add(k);
    const want = desired.get(k);
    if (JSON.stringify(current[i]) !== JSON.stringify(want))
      replaces.push({ index: i, value: want });
  }
  const appends: unknown[] = [];
  for (const [k, v] of desired) if (!kept.has(k)) appends.push(v);

  // No-op guard. Transactions fire `update` events even when they change
  // nothing, and an update re-enters the file→doc→file loop.
  if (deletes.length === 0 && replaces.length === 0 && appends.length === 0) return false;

  doc.transact(() => {
    // Replaces first, while the indices computed above are still valid.
    for (const r of replaces) {
      arr.delete(r.index, 1);
      arr.insert(r.index, [r.value]);
    }
    // Then deletes, descending, so each index stays valid as we go.
    for (let i = deletes.length - 1; i >= 0; i--) arr.delete(deletes[i]!, 1);
    if (appends.length > 0) arr.push(appends);
  }, origin);
  return true;
}

/* ---------------------------------------------------------------- annotations */

/** Returns the annotations SVG string, or null if unset. */
export function annotationsFromDoc(doc: Y.Doc): string | null {
  const map = doc.getMap<unknown>(Y_TYPES.annotations);
  const svg = map.get('svg');
  return typeof svg === 'string' ? svg : null;
}

/**
 * True when an annotations value carries ZERO strokes: null, `''`, or the bare
 * serialized wrapper `<svg …></svg>` with no child elements (what
 * `strokesToSvg([])` emits — 72 bytes, constant across peers).
 *
 * This distinction is load-bearing for cold start (the 2026-08-14 annotations
 * eraser): the wrapper is a non-empty STRING, so every `!== ''` emptiness
 * guard let a stale hub wrapper overwrite a peer's real strokes — and with the
 * strokes went the `assets/<sha8>` references the asset lane pulled by, so
 * freshly dropped images never crossed machines. Live delete-all still materializes
 * the wrapper through `writeAnnotationsIfChanged` (deletes must propagate);
 * only COLD-START decisions treat it as emptiness.
 */
export function isEmptyAnnotationsSvg(svg: string | null): boolean {
  if (svg === null) return true;
  if (svg.trim() === '') return true;
  return /^\s*<svg\b[^>]*>\s*<\/svg>\s*$/i.test(svg);
}

export function applyAnnotationsToDoc(doc: Y.Doc, next: string | null, origin?: unknown): boolean {
  if (next !== null && byteLengthUtf8(next) > MAX_ANNOTATIONS_BYTES) {
    console.warn(
      `[sync/codec] refusing annotations apply > ${MAX_ANNOTATIONS_BYTES} bytes (got ${byteLengthUtf8(next)}). DDR-054 §2d.`
    );
    return false;
  }
  const map = doc.getMap<unknown>(Y_TYPES.annotations);
  const current = map.get('svg');
  const currentStr = typeof current === 'string' ? current : null;
  if (currentStr === next) return false;

  doc.transact(() => {
    if (next === null || next === '') {
      map.delete('svg');
    } else {
      map.set('svg', next);
    }
  }, origin);
  return true;
}

/* ---------------------------------------------------------------- meta */

/**
 * Keys of a canvas `.meta.json` that are PER-MACHINE and MUST NOT cross the hub:
 *   - `viewport`      — this user's pan/zoom; syncing it would yank a
 *                        collaborator's camera around on every pan.
 *   - `last_modified` — a local write timestamp; syncing it churns with no signal.
 *   - `syncable`      — the security opt-in (DDR-054). A peer/hub must NEVER be
 *                        able to flip another repo's sync gate, so it stays local
 *                        and human-edited — same rationale that keeps it out of
 *                        the /_api/canvas-meta PATCH whitelist.
 * Everything else (title, sections/artboards, `layout` rects, css_mode, …) is
 * shared canvas structure and DOES sync — that's how an artboard move on one
 * machine reaches the other's disk.
 */
export const META_LOCAL_KEYS = ['viewport', 'last_modified', 'syncable'] as const;

/** Canonical JSON of the SHARED subset of a parsed meta object: local keys
 *  dropped, remaining keys sorted so equal content always serializes byte-equal
 *  (stable → the no-op guards stay quiet and sync doesn't churn). */
function sharedMetaCanonical(meta: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(meta).sort()) {
    if ((META_LOCAL_KEYS as readonly string[]).includes(k)) continue;
    out[k] = meta[k];
  }
  return JSON.stringify(out);
}

/**
 * THE META LANE CAN DUPLICATE ITSELF, SO IT HAS TO BE ABLE TO HEAL.
 *
 * Meta is a WHOLE VALUE carried in a Y.Text, written by delete-all +
 * insert-all. That is duplication-prone by construction, and the case is not
 * exotic — it is the normal one: every peer holding the file tries to publish
 * it, and two peers inserting the same string into an empty lane produce two
 * inserts Yjs has no reason to merge. The result is
 * `{"title":"Home"}{"title":"Home"}`: not a value, not empty, and — because
 * every consumer runs it through `JSON.parse` and bails — indistinguishable
 * from "this canvas has no meta".
 *
 * Observed live: nine canvases created on a laptop reached the hub with correct
 * bodies and doubled meta, so a third machine syncing the project got their
 * titles, kinds and design-system bindings dropped on the floor. Silently.
 *
 * Preventing every interleaving is not on offer while the lane is a Y.Text. So
 * the lane repairs instead: a stack of IDENTICAL copies is recognised for what
 * it is — one value, published twice — and collapses back to one. Anything else
 * unparseable stays `null`, which routes to the existing "the doc has no
 * opinion" path rather than to a guess.
 */
export function normalizeSharedMeta(raw: string | null): string | null {
  if (raw === null || raw.length === 0) return null;
  if (parsesAsObject(raw)) return raw;
  // Split only at a `}{` seam — the exact shape concurrent whole-value inserts
  // produce. A JSON string containing "}{" cannot create a false seam here,
  // because each resulting segment must itself parse as a complete object.
  const parts = raw.split(/(?<=\})(?=\{)/);
  if (parts.length < 2) return null;
  const first = parts[0] ?? '';
  if (!parts.every((p) => p === first) || !parsesAsObject(first)) return null;
  return first;
}

function parsesAsObject(s: string): boolean {
  try {
    const v = parseJsonSafe(s);
    return !!v && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

/** The synced shared-meta JSON string held in the doc, or null when unset. */
export function metaFromDoc(doc: Y.Doc): string | null {
  return normalizeSharedMeta(doc.getText(Y_SYNC_TYPES.meta).toString());
}

/** What the doc LITERALLY holds — for the repair path, which needs to know
 *  that the stored text differs from the value it normalises to. */
export function rawMetaFromDoc(doc: Y.Doc): string | null {
  const s = doc.getText(Y_SYNC_TYPES.meta).toString();
  return s.length > 0 ? s : null;
}

/**
 * Apply a FULL `.meta.json` string to the doc as its shared subset: parse, strip
 * per-user/security keys, store the canonical shared JSON in a Y.Text. Returns
 * false on parse error / over-cap / no change.
 */
export function applyMetaToDoc(doc: Y.Doc, fullMetaJson: string, origin?: unknown): boolean {
  let obj: unknown;
  try {
    obj = parseJsonSafe(fullMetaJson);
  } catch {
    return false;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const shared = sharedMetaCanonical(obj as Record<string, unknown>);
  if (byteLengthUtf8(shared) > MAX_META_BYTES) {
    console.warn(
      `[sync/codec] refusing meta apply > ${MAX_META_BYTES} bytes (got ${byteLengthUtf8(shared)}). DDR-054 §2d.`
    );
    return false;
  }
  const t = doc.getText(Y_SYNC_TYPES.meta);
  // Compare against the NORMALISED value, not the literal text: a lane holding
  // two identical copies already carries this exact meta, and treating it as a
  // difference would rewrite it on every pass forever.
  if (normalizeSharedMeta(t.toString()) === shared) return false;
  doc.transact(() => {
    if (t.length > 0) t.delete(0, t.length);
    t.insert(0, shared);
  }, origin);
  return true;
}

/**
 * Collapse a duplicated meta lane back to one copy.
 *
 * Repairing on APPLY alone is not enough — a canvas nobody edits again would
 * keep its doubled meta forever, and a machine that syncs the project
 * afterwards would keep dropping it. This runs on cold start, where the doc has
 * synced and "what it holds" is a fact rather than ignorance.
 *
 * Returns true when it changed something. A lane that is empty, already single,
 * or unparseable-in-some-other-way is left exactly as it is: this repairs the
 * one shape it can prove, and guesses at nothing.
 */
export function repairSharedMeta(doc: Y.Doc, origin?: unknown): boolean {
  const t = doc.getText(Y_SYNC_TYPES.meta);
  const raw = t.toString();
  const single = normalizeSharedMeta(raw);
  if (single === null || single === raw) return false;
  doc.transact(() => {
    t.delete(0, t.length);
    t.insert(0, single);
  }, origin);
  return true;
}

/**
 * Merge the synced shared-meta into a local `.meta.json` string, PRESERVING the
 * local per-user/security keys (META_LOCAL_KEYS). Shared keys become exactly
 * what the doc holds (so a deletion on the source propagates); the local keys
 * are layered back on top. Returns the merged JSON (2-space, trailing newline)
 * ready to write, or null when the shared payload is unparseable.
 */
export function mergeSharedMetaIntoLocal(
  localMetaJson: string | null,
  sharedJson: string
): string | null {
  let shared: unknown;
  try {
    shared = parseJsonSafe(sharedJson);
  } catch {
    return null;
  }
  if (!shared || typeof shared !== 'object' || Array.isArray(shared)) return null;
  let local: Record<string, unknown> = {};
  if (localMetaJson) {
    try {
      const parsed = parseJsonSafe(localMetaJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        local = parsed as Record<string, unknown>;
      }
    } catch {
      /* unparseable local meta — treat as empty; the shared subset becomes the base */
    }
  }
  const merged: Record<string, unknown> = { ...(shared as Record<string, unknown>) };
  for (const k of META_LOCAL_KEYS) {
    if (k in local) merged[k] = local[k];
  }
  return `${JSON.stringify(merged, null, 2)}\n`;
}

/* ---------------------------------------------------------------- syncMeta */

/** Short peer label for `syncMeta.by` — os.hostname() truncated. Informational
 *  only (status surfaces); never trusted for decisions. */
const PEER_LABEL_MAX = 32;
function peerLabel(): string {
  try {
    return hostname().slice(0, PEER_LABEL_MAX);
  } catch {
    return 'unknown';
  }
}

/**
 * Stamp `syncMeta.bodyEditAt` (+ `by`) on the doc. Call this in the SAME
 * transaction + origin as every local→doc body apply (agent applyFromFs html
 * branch, reconcile seed-up, migrate-seed adopt, projection file→doc body
 * import) so peers receive ONE update and origin-filtering stays intact.
 * yjs nests transactions — wrapping `applyHtmlToDoc` + `stampBodyEdit` in an
 * outer `doc.transact(fn, origin)` produces a single update.
 */
export function stampBodyEdit(doc: Y.Doc, origin?: unknown, nowMs?: number): void {
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  doc.transact(() => {
    map.set('bodyEditAt', nowMs ?? Date.now());
    map.set('by', peerLabel());
  }, origin);
}

/** The doc-side body-edit stamp, or null when no peer ever stamped (older
 *  peers don't write syncMeta → callers fall back to hub-wins, interop-safe). */
export function bodyEditAtFromDoc(doc: Y.Doc): number | null {
  const v = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('bodyEditAt');
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Stamp `syncMeta.annotationsEditAt` — the annotations lane's own newest-wins
 * timestamp (extends DDR-102's `bodyEditAt` per-lane). Call in the SAME
 * transaction + origin as every local→doc annotations apply (agent applyFromFs
 * annotations branch, cold-start local-wins seed, adopt) so peers receive ONE
 * update. Before this stamp existed, cold start resolved annotations by the
 * BODY winner — but annotation edits don't move the body's edit time, so a
 * hub with a newer body and a stale (empty) annotations lane erased newer
 * local strokes (the 2026-08-14 annotations eraser).
 *
 * `nowMs` override: cold-start seeding passes the local FILE's mtime so stale
 * content can't claim apply-time freshness.
 */
export function stampAnnotationsEdit(doc: Y.Doc, origin?: unknown, nowMs?: number): void {
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  doc.transact(() => {
    map.set('annotationsEditAt', nowMs ?? Date.now());
  }, origin);
}

/** The doc-side annotations-edit stamp, or null when no peer ever stamped
 *  (pre-annotationsEditAt docs → callers fall back to the body-winner
 *  coupling, interop-safe). */
export function annotationsEditAtFromDoc(doc: Y.Doc): number | null {
  const v = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('annotationsEditAt');
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Record THIS doc's clientID as the seeder in `syncMeta.seededBy` (F1). Call it
 * in the SAME transaction + origin as a `seed-local-up` body apply. The value is
 * a Yjs clientID, so when two peers seed the same empty hub simultaneously and
 * their maps merge, Y.Map's deterministic last-writer-wins resolution converges
 * `seededBy` to ONE clientID on EVERY peer — that elected peer is the
 * single-writer that performs the de-duplication repair, so the collapse op is
 * never emitted twice. Informational/bookkeeping only; never materialized to
 * disk (syncMeta is a sync-internal lane).
 */
export function markSeeded(doc: Y.Doc, origin?: unknown): void {
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  doc.transact(() => {
    map.set('seededBy', doc.clientID);
  }, origin);
}

/** The elected seeder's clientID (`syncMeta.seededBy`), or null when no peer
 *  ever seeded through the marker path (older peers / non-seed canvases). */
export function seededByFromDoc(doc: Y.Doc): number | null {
  const v = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('seededBy');
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Record WHERE this canvas lives, design-root-relative (`syncMeta.path`).
 *
 * The document name carries only the flattened slug, and `/`→`-` is not
 * reversible — so a receiver that has never seen this canvas cannot know which
 * folder it belongs in, and wrote it flat. This is the lane that fixes that.
 *
 * `syncMeta` is the right home rather than a new one: it is already per
 * document, already synced, already optional on the wire (an older peer simply
 * omits it), and — the part that matters here — NEVER MATERIALIZED TO DISK.
 * `.meta.json` could not carry this: a canvas's own path is per-machine-ish
 * bookkeeping about the sync lane, and putting it in the sidecar would both
 * commit a redundant fact to the tenant's repo and put it under `.meta.json`'s
 * shared-subset rules (META_LOCAL_KEYS governs a DIFFERENT lane and would not
 * keep it off disk).
 *
 * Only ever called with a path the caller DERIVED from a real local file — not
 * with a value read off the wire. Re-stamping something a receiver refused
 * would launder an invalid path into the project on the next hop.
 *
 * Idempotent: an unchanged value writes nothing, so this can sit in the same
 * transaction as every body apply without churning the wire.
 */
export function stampCanvasPath(doc: Y.Doc, rel: string, origin?: unknown): boolean {
  const next = String(rel ?? '').replace(/\\/g, '/');
  if (!next) return false;
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  if (map.get('path') === next) return false;
  doc.transact(() => {
    map.set('path', next);
  }, origin);
  return true;
}

/** The doc-side path stamp, or null when no peer ever stamped one (an older
 *  peer, or a document nobody has opened from a real local file). UNTRUSTED —
 *  every caller must put it through `validateCanvasPath` (canvas-path.ts). */
export function canvasPathFromDoc(doc: Y.Doc): string | null {
  const v = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('path');
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ------------------------------------------------------------- retirement */

/**
 * Mark this document RETIRED BY A MOVE: its canvas now lives at `toRel`, in a
 * DIFFERENT document (the slug is derived from the path, so a moved canvas is
 * a new document by construction — nothing can rename a Hocuspocus doc).
 *
 * Before this stamp existed, the pre-move document simply lived on: the hub
 * kept materialising it at the old path, every peer's cold start saw "doc has
 * a body, disk has no file" and resurrected it, and a moved canvas came back
 * as a duplicate on every machine that ever synced it. Observed live: moving
 * `shoj` into a folder on the desktop left BOTH `ui/dbucket/shoj.tsx` and a
 * re-materialised `ui/shoj.tsx` on both machines, plus two documents on the
 * hub.
 *
 * The stamp is a STATEMENT, deliberately not an empty body: emptiness is
 * ambiguous (a crash mid-write, an unseeded doc), and DDR-223 spent a whole
 * arc making emptiness weak. `movedTo` is unambiguous, carries WHERE the
 * content went, and — because the content provably lives at the new path in
 * the new document — quarantining the old file against it is safe in a way
 * that acting on a bare deletion never is (that one stays Increment 6).
 *
 * Consumers:
 *   - every materialise path treats a retired doc as WRITE-INERT — it never
 *     lands another byte on disk and never accepts another local edit;
 *   - the sync runtime, on SEEING the stamp arrive, releases the canvas and
 *     quarantines the stale local copy into `_trash/` (recoverable, DDR-102's
 *     spine) — except on the machine performing the move, which renames the
 *     file itself;
 *   - the hub's workspace agent quarantines the checkout copy and commits the
 *     deletion, so the cloud tree stops listing the ghost.
 */
export function stampMovedTo(doc: Y.Doc, toRel: string, origin?: unknown): boolean {
  const next = String(toRel ?? '').replace(/\\/g, '/');
  if (!next) return false;
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  if (map.get('movedTo') === next) return false;
  doc.transact(() => {
    map.set('movedTo', next);
    map.set('movedAt', Date.now());
    map.set('movedBy', peerLabel());
  }, origin);
  return true;
}

/**
 * Un-retire a document that says it moved to where it already is.
 *
 * A move renames the canvas's artifacts onto the new slug, and the retirement
 * stamp lives INSIDE the document — so any copy of the old document that reaches
 * the new slug arrives pre-stamped "I have moved away", and every peer that
 * opens it releases the canvas instead of syncing it. Clearing the stamp is the
 * correction, and because it is a doc edit it travels to every peer that already
 * believed the lie. The caller decides the "already is" part; this only writes.
 */
export function clearMovedTo(doc: Y.Doc, origin?: unknown): boolean {
  const map = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta);
  if (map.get('movedTo') === undefined) return false;
  doc.transact(() => {
    map.delete('movedTo');
    map.delete('movedAt');
    map.delete('movedBy');
  }, origin);
  return true;
}

/** Where a retired document says its canvas went, or null for a live one.
 *  UNTRUSTED — a consumer that turns this into a path must validate it the
 *  same way it validates `syncMeta.path`. Most consumers only need the
 *  null/non-null fact. */
export function movedToFromDoc(doc: Y.Doc): string | null {
  const v = doc.getMap<unknown>(Y_SYNC_TYPES.syncMeta).get('movedTo');
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ---------------------------------------------------------------- css */

/** The synced canvas CSS string held in the doc, or null when unset/empty. */
export function cssFromDoc(doc: Y.Doc): string | null {
  const s = doc.getText(Y_SYNC_TYPES.css).toString();
  return s.length > 0 ? s : null;
}

/**
 * Apply the canvas's `.css` to the doc as opaque Y.Text.
 *
 * Goes through `applyTextLane` — the same prefix/suffix diff the body uses —
 * and that is load-bearing, not tidiness (issue #114). This was a wholesale
 * `delete(0, len)` + `insert(0, next)`, whose comment argued it "can't churn"
 * because css round-trips byte-identically. True for a SINGLE writer, and the
 * reason the lane looked fine in every single-peer test. Under concurrency it
 * is the bug: two peers each replacing the lane keep both inserts, so the css
 * doubled on a concurrent cold seed AND doubled again every time a peer tried
 * to repair it. Measured in the field at 3×, 4× and 5×, while the body lane —
 * same collision, diffing codec — never exceeded 3× and mostly self-healed.
 *
 * Returns false on over-cap / no change.
 */
export function applyCssToDoc(doc: Y.Doc, next: string, origin?: unknown): boolean {
  if (byteLengthUtf8(next) > MAX_CSS_BYTES) {
    console.warn(
      `[sync/codec] refusing CSS apply > ${MAX_CSS_BYTES} bytes (got ${byteLengthUtf8(next)}). DDR-054 §2d.`
    );
    return false;
  }
  return applyTextLane(doc, Y_SYNC_TYPES.css, next, origin);
}
