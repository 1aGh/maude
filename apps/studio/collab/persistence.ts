// DDR-051 persistence wiring — bridges Room callbacks to the existing JSON
// snapshots (Phase 6 _comments/<slug>.json) + Phase 5 annotations.svg + the
// new `.ydoc.bin` cache under _state/<slug>.ydoc.bin.

import path from 'node:path';

import * as Y from 'yjs';

import type { Api } from '../api.ts';
import type { Context } from '../context.ts';
// From the LEAF, never from `sync/codec.ts` — codec imports `Y_TYPES` from this
// file, so reaching for it here would close a cycle (see sync/limits.ts).
import { commentKey } from '../sync/comment-identity.ts';
import { MAX_ANNOTATIONS_BYTES, MAX_COMMENTS_BYTES, withinByteCap } from '../sync/limits.ts';
import { ensureStateDir, type RoomCallbacks } from './room.ts';

/**
 * Y.Doc shared-type names. Frozen on Task 1 so client + server agree even
 * before they're populated. Task 3 added `comments`; Task 5 adds `annotations`
 * (a Y.Map holding the SVG string under the `svg` key — LWW shape, mirrors
 * the current /_api/annotations PUT semantics).
 */
export const Y_TYPES = {
  comments: 'comments',
  annotations: 'annotations',
  presentation: 'presentation',
} as const;

export interface PersistenceDeps {
  ctx: Context;
  api: Api;
  /**
   * Resolve a canvas slug back to the repo-relative `file` path the api
   * expects. The collab WS sends slugs (URL-safe), the comments path
   * round-trips through Api.fileSlug. Persistence callers may also call
   * `noteFile(file)` to populate the lookup table — server-side write paths
   * (comments + annotations) call this so the room can locate the canvas
   * even when no prior JSON file existed.
   */
  fileForSlug: (slug: string) => Promise<string | null>;
  /** Best-effort cache primer — see fileForSlug above. */
  noteFile?: (file: string) => void;
  /**
   * Phase 9.2 (DDR-064) — when this returns false for a slug, `seed` is a no-op
   * for it. The shared-doc path passes a predicate that returns false for
   * pinned (provider-attached) slugs, so the local file-seed can't push fresh
   * Y.Array items that would DUPLICATE the hub's canonical items on merge
   * (Risk 1). The migrate-seed + provider own initial population for those
   * slugs. Absent → always seed (flag-OFF behavior, unchanged).
   */
  shouldSeed?: (slug: string) => boolean;
}

/**
 * Build the RoomCallbacks the registry plugs into createRoom().
 *
 * persistJson now serializes BOTH `comments` (Y.Array) and `annotations`
 * (Y.Map → `svg` string) back to their existing on-disk formats. Each is
 * skipped when the Y type is empty / unset — the JSON file stays whatever
 * the prior legacy write produced.
 */
/**
 * DDR-064 pre-cutover checklist — cap the doc→disk lane for comments and
 * annotations.
 *
 * The codec's `MAX_*_BYTES` guard the FILE→DOC direction. This is the other
 * one, and until shared-doc it barely mattered: the room's doc was populated
 * only by browsers on this machine. Under a shared doc it is populated by the
 * hub, so an oversized array pushed by a peer (or by a hostile hub — DDR-054's
 * threat model, §2d) would be materialized to this disk unbounded. Same ceiling
 * as the import lane, so a value that could never be imported can never be
 * written either.
 *
 * Refuses the WRITE, not the sync: the doc keeps the value and the peers keep
 * converging. What is withheld is turning somebody else's blob into our disk.
 * Shared with `sync/projection.ts`'s equivalent guard via `sync/limits.ts`.
 */
function withinCap(slug: string, lane: string, value: string, max: number): boolean {
  return withinByteCap(`collab/${slug}`, lane, Buffer.byteLength(value, 'utf8'), max);
}

export function createPersistence(deps: PersistenceDeps): RoomCallbacks {
  const { ctx, api, fileForSlug } = deps;
  const stateDir = ensureStateDir(ctx.paths.designRoot);

  // Per-slug: every comment identity this doc has EVER carried (issue #111).
  //
  // This subsumes the old `seenComments` latch — "have we ever projected a
  // NON-empty array for this canvas", which gated the delete-all write so a
  // never-populated doc could not clobber a non-empty local file with `[]`
  // (DDR-064's receiving-peer gap). Same question, better evidence.
  //
  // It also answers the question the projection could not ask at all before,
  // and the one this issue is about: is the doc AHEAD of the file (a real
  // change, write it) or BEHIND it (a write the doc has not caught up with —
  // writing would erase it)?
  //
  // Identity settles it without a wire-format change. An id on disk that the
  // doc has held and dropped is a genuine delete and must materialize. An id on
  // disk the doc has NEVER held is something the doc has not seen yet, and
  // dropping it is silent data loss — the reporter's "add a second comment and
  // it disappears after a few seconds". `Room.flush()` fires on ANY doc update
  // and every hub update re-arms it, so on a linked project a flush lands in
  // that window constantly; on a local one it essentially never does, which is
  // exactly the scoping the reporter gave ("connected to a custom hub").
  const docSeenComments = new Map<string, Set<string>>();

  /**
   * Ceiling on identities remembered per canvas — DDR-054 §2d applied to a set
   * rather than a byte length.
   *
   * The doc is populated by the hub, so what lands in this set is peer-supplied
   * and the set only ever grows: without a bound, a hostile hub streaming
   * distinct comment ids is unbounded memory on every linked peer. Eviction is
   * oldest-first (JS sets keep insertion order), and it degrades in the SAFE
   * direction — an evicted id reads as "never seen", so the projection defers
   * the write instead of deleting. The cost is that a delete of a very old
   * comment on a canvas that has carried more than this many distinct comments
   * may not materialize, which is a far better failure than losing one.
   */
  const MAX_SEEN_COMMENT_IDS = 10_000;

  /**
   * Docs already wired to their slug's identity set.
   *
   * WEAK on purpose: a room dropped when its last browser leaves destroys its
   * doc, and a strong reference here would keep every doc of every canvas the
   * user ever opened alive for the process's lifetime. The observer closes over
   * the SET, not the other way round, so nothing else pins the doc either.
   */
  const observedCommentDocs = new WeakSet<Y.Doc>();

  /**
   * The identity set for `slug`, observing `doc` so it records an id the moment
   * it ENTERS the array.
   *
   * Sampling at flush time alone is not enough, and the gap is a real delete
   * bug rather than a theoretical one: an id that arrives and is deleted again
   * between two flushes (a local add, then a remote delete inside the same
   * 800 ms debounce — every doc update re-arms the timer, so this is the common
   * shape, not a rare one) would never be recorded, the guard below would read
   * the surviving disk copy as "never seen", and the delete could never
   * materialize. The observer only ever ADDS, which is what makes it a record
   * of what the doc has held rather than of what it holds.
   *
   * The set is per SLUG and the wiring is per DOC: a slug's room can be rebuilt
   * on a fresh doc, and the ids carry over because this peer did see them.
   */
  function commentIdsSeenBy(slug: string, doc: Y.Doc): Set<string> {
    let ids = docSeenComments.get(slug);
    if (!ids) {
      ids = new Set<string>();
      docSeenComments.set(slug, ids);
    }
    if (observedCommentDocs.has(doc)) return ids;
    observedCommentDocs.add(doc);

    const seen = ids;
    const arr = doc.getArray<unknown>(Y_TYPES.comments);
    const absorb = () => {
      for (const c of arr.toArray()) seen.add(commentKey(c));
      for (const stale of seen) {
        if (seen.size <= MAX_SEEN_COMMENT_IDS) break;
        seen.delete(stale); // oldest first — insertion order
      }
    };
    absorb();
    arr.observe(absorb);
    return ids;
  }

  function ydocBinPath(slug: string): string {
    return path.join(stateDir, `${slug}.ydoc.bin`);
  }

  async function readBinary(slug: string): Promise<Uint8Array | null> {
    try {
      const file = Bun.file(ydocBinPath(slug));
      if (!(await file.exists())) return null;
      const buf = await file.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async function seed(slug: string, doc: Y.Doc): Promise<void> {
    // Start recording comment identities at ROOM MOUNT, before anything can
    // gate out (issue #111). `persistJson` would otherwise be the first thing
    // to observe this doc, which is one flush too late: an id added and deleted
    // before that flush would never be recorded, and its delete could never
    // materialize. This is the earliest callback that sees the doc.
    commentIdsSeenBy(slug, doc);

    // Phase 9.2 (DDR-064) — under sharedDoc the migrate-seed + hub provider own
    // initial population for a pinned slug; a local file-seed here would push
    // fresh Y.Array items that DUPLICATE the hub's canonical items on merge
    // (Risk 1). Skip seeding when the predicate says so. Flag-OFF / unpinned →
    // always seeds (predicate absent or returns true).
    if (deps.shouldSeed && !deps.shouldSeed(slug)) return;

    // Step 1 — try the binary cache.
    const binary = await readBinary(slug);
    if (binary && binary.byteLength > 0) {
      Y.applyUpdate(doc, binary);
      return;
    }

    // Step 2 — seed each Y type from its existing on-disk source.
    const file = await fileForSlug(slug);
    if (!file) return;

    const [comments, svg] = await Promise.all([
      api.loadCommentsForFile(file),
      api.loadAnnotations(file),
    ]);

    if (comments.length === 0 && !svg) return;

    doc.transact(() => {
      if (comments.length > 0) {
        const arr = doc.getArray<unknown>(Y_TYPES.comments);
        // Push only what the array does not already hold (issue #112). This was
        // an unconditional `arr.push(comments)`, which concatenates whenever the
        // doc is NOT empty at seed time — the DDR-064 Risk 1 window that
        // `shouldSeed`/`isPinned` closes only when the pin already exists, i.e.
        // not when a room is mounted a beat before the hub provider attaches.
        // The identity rule is `commentKey`, shared with the codec's diff and
        // the cold-start union; the leaf import is deliberate — this file owns
        // `Y_TYPES`, so it can never import `sync/codec.ts` back (see above).
        const present = new Set(arr.toArray().map(commentKey));
        const missing = comments.filter((c) => {
          const k = commentKey(c);
          if (present.has(k)) return false;
          present.add(k);
          return true;
        });
        if (missing.length > 0) arr.push(missing);
      }
      if (svg && typeof svg === 'string') {
        const map = doc.getMap<string>(Y_TYPES.annotations);
        map.set('svg', svg);
      }
    }, 'seed');
  }

  async function persistJson(slug: string, doc: Y.Doc): Promise<void> {
    const file = await fileForSlug(slug);
    if (!file) return;

    // Comments — Y.Array projection back to JSON. Write whenever the doc holds
    // comments, OR when it just emptied after previously holding some (so a
    // delete-all materializes on EVERY peer's disk, not just the originator's),
    // and never from a doc that was never populated at all (cold start before
    // seed/migrate completes), which would clobber a non-empty local file.
    //
    // `everSeen` is that latch as well as the freshness oracle below — one
    // notion of "this doc has held comments" instead of two that can disagree.
    // It replaces a per-slug flag sampled HERE, which could not see a comment
    // that arrived and was deleted again between two flushes: the flag stayed
    // unset, so the delete-all read as "never populated" and never reached
    // disk. Both readings need the same fact, and only the observer has it.
    const arr = doc.getArray(Y_TYPES.comments);
    const list = arr.toArray() as Parameters<Api['saveCommentsForFile']>[1];
    const everSeen = commentIdsSeenBy(slug, doc);
    if (list.length > 0 || everSeen.size > 0) {
      // Issue #111 — refuse to project a doc that is BEHIND the file. An id on
      // disk this doc has never carried is a write still in flight towards it
      // (a mutation whose file→doc import has not landed, an external edit to
      // `_comments/<slug>.json`); overwriting it deletes a real comment with no
      // error and no recovery. Deferring is safe and self-clearing: whatever
      // brings that id into the doc is itself a doc update, which re-arms the
      // flush, and the next pass writes the merged state. A delete still
      // materializes — its id IS in `everSeen`, so the write proceeds.
      const onDisk = await api.loadCommentsForFile(file);
      const behind = onDisk.some((c) => !everSeen.has(commentKey(c)));
      if (!behind && withinCap(slug, 'comments', JSON.stringify(list), MAX_COMMENTS_BYTES)) {
        await api.saveCommentsForFile(file, list);
      }
    }

    // Annotations — Y.Map.svg → annotations.svg file. Task 5.
    const map = doc.getMap<unknown>(Y_TYPES.annotations);
    const svg = map.get('svg');
    if (typeof svg === 'string' && svg) {
      if (withinCap(slug, 'annotations', svg, MAX_ANNOTATIONS_BYTES)) {
        // Projection must never re-enter onAnnotationsChanged: an old flush
        // finishing after a new edit otherwise republishes the old SVG and
        // rolls back every peer. The API checks freshness after async IO and
        // before its atomic rename; a later doc update schedules a new flush.
        await api.projectAnnotations(file, svg, () => map.get('svg') === svg);
      }
    }
  }

  async function persistBinary(slug: string, state: Uint8Array): Promise<void> {
    await Bun.write(ydocBinPath(slug), state);
  }

  return { seed, persistJson, persistBinary };
}
