// Per-server registry of active collab rooms.
//
// Rooms are lazy: created on first connection for a given slug, retained while
// any peer is connected, torn down (with a final flush) when the last peer
// disconnects. The registry is also the surface the git-lifecycle handler will
// call into (Phase 8 Task 7) to force-snapshot every dirty room before a reload
// prompt — see DDR-051 §3.

import type { Awareness } from 'y-protocols/awareness';

import { ANNOTATION_WRITE_ID, validAnnotationWriteId } from '../annotations-sync.ts';
import { applyCommentsToDoc } from '../sync/codec.ts';
import { bridgeAwareness } from './awareness-bridge.ts';
import { Y_TYPES } from './persistence.ts';
import type { Room, RoomCallbacks } from './room.ts';
import { createRoom } from './room.ts';

export interface Registry {
  /** Get-or-create. Reuses an existing room for the same slug. */
  get(slug: string): Room;
  /** Existence check — returns the live room if any, else null. NEVER creates. */
  peek(slug: string): Room | null;
  /**
   * Phase 9.2 (DDR-064) — the single cached `Y.Doc` for a slug, creating the
   * owning Room if necessary. This is the seam the shared-doc path attaches its
   * hub-facing `HocuspocusProvider` to (Phase B): the doc must exist
   * independent of a live browser connection so the provider can attach at
   * serve start. Repeated calls return the SAME instance (the room's doc) —
   * the y-websocket-server `getYDoc(name)` single-cache pattern.
   *
   * Phase A: defined but unused (the flag-OFF two-doc path never calls it), so
   * adding it is behavior-neutral. NOTE: a room created via `getDoc` (no
   * browser conn) is NOT auto-dropped by the `size()===0` check in `drop` until
   * Phase B teaches the lifecycle that an attached provider keeps it alive;
   * for Phase A nothing calls `getDoc`, so no room leaks.
   */
  getDoc(slug: string): import('yjs').Doc;
  /**
   * Phase 8 Task 3 bridge — inspector-channel writes (REST `/_api/comments*`
   * or the legacy WS comments-add path) call this so the live Y.Array sees
   * the change and broadcasts it to collab peers. No-op when no room is
   * live; the next cold open will seed from the freshly-written JSON anyway.
   *
   * `comments` is the post-mutation JSON list (the same shape persistJson
   * writes back). We replace the Y.Array contents wholesale inside a
   * transaction tagged `'inspector-write'` so the doc.update broadcaster
   * downstreams it to peers but skips the in-flight debounce loop.
   */
  syncRoomFromComments(slug: string, comments: readonly unknown[]): void;
  /**
   * Phase 8 Task 5 bridge — same shape as syncRoomFromComments but for the
   * `annotations` Y.Map. The PUT /_api/annotations endpoint passes the
   * post-write SVG; the room replaces `Y.Map.svg` so collab peers see the
   * updated stroke set without waiting for a cold-open re-seed.
   */
  syncRoomFromAnnotations(slug: string, svg: string, writeId?: string): void;
  /**
   * Phase 30 — project agent editing-presence onto a slug's room awareness so
   * it crosses the hub (the loopback `ai-activity` bus event does not). `null`
   * clears it. No-op when no room is live for the slug — a peer that joins
   * later will see the agent on the next ai-activity heartbeat. Soft heads-up;
   * never a lock.
   */
  setAgentEditing(slug: string, state: { name: string; since: number } | null): void;
  /**
   * Phase 9 Task 5 — attach the hub-side Awareness (from a sync provider) for
   * a slug so the Room's Awareness (browser peers) is bridged bidirectionally
   * to the hub. While attached, cursors / selections / viewport relay
   * cross-machine through Hocuspocus. Idempotent per slug; returns a detach
   * fn. If a room is already live the bridge wires immediately, otherwise it
   * wires when the room is next created. Awareness is ephemeral — this writes
   * no files (see awareness-bridge.ts on why F14 is untouched).
   */
  attachHubAwareness(slug: string, awareness: Awareness): () => void;
  /**
   * Phase 9.2 (DDR-064) — pin a room so `drop` won't destroy it when the last
   * browser leaves. The shared-doc path pins a slug while a hub
   * `HocuspocusProvider` is attached to its `getDoc(slug)`: destroying the
   * room (→ `doc.destroy()`) would pull the doc out from under the live
   * provider. Self-gating — only the flag-ON sync runtime calls `pin`, so the
   * flag-OFF `drop` lifecycle is byte-for-byte unchanged. Idempotent.
   */
  pin(slug: string): void;
  /** Release a pin (provider detached on runtime stop). Idempotent. */
  unpin(slug: string): void;
  /** True when a slug is pinned (a shared-doc provider is attached). Used to
   *  disable the room's local file-seed for that slug under sharedDoc — the
   *  migrate-seed + provider own initial population, so a duplicate file-seed
   *  can't re-introduce items (DDR-064 Risk 1). */
  isPinned(slug: string): boolean;
  /** Flush every dirty room synchronously. DDR-051 branch-switch path. */
  flushAll(): Promise<void>;
  /** Tear down everything (e.g. on server shutdown). */
  destroyAll(): Promise<void>;
  /** Tear down a single room when its last peer leaves. */
  drop(slug: string): Promise<void>;
  /**
   * feature-file-tree-drag-drop-folders (Task 3) — flush + tear down a room
   * for a canvas move, REGARDLESS of live connections (unlike `drop`, which
   * leaves an active room alone). The move already refused when
   * `isPinned(slug)` is true (a hub provider owns the doc); this is a plain
   * best-effort teardown so the rename doesn't leave a room keyed to a slug
   * that no longer resolves to a file. A peer connected mid-move reconnects
   * under the new slug via `get()`. No-op if no room is live for the slug.
   */
  forceDrop(slug: string): Promise<void>;
  /** Test/introspection. */
  size(): number;
}

export function createRegistry(callbacks: RoomCallbacks): Registry {
  const rooms = new Map<string, Room>();
  // Hub-side Awareness per slug (lives as long as the sync provider). Rooms
  // churn as browser tabs come and go; the bridge is re-wired each time a room
  // is (re)created for a slug that has an attached hub Awareness.
  const hubAwareness = new Map<string, Awareness>();
  const bridges = new Map<string, () => void>();
  // Phase 9.2 (DDR-064) — slugs whose room must survive the last-browser-leaves
  // drop because a shared-doc hub provider is attached to its doc. Only the
  // flag-ON sync runtime ever adds to this; flag-OFF leaves it empty so `drop`
  // is unchanged.
  const pinned = new Set<string>();

  function wireBridge(slug: string, room: Room): void {
    if (bridges.has(slug)) return;
    const hub = hubAwareness.get(slug);
    if (!hub) return;
    bridges.set(slug, bridgeAwareness(room.awareness, hub));
  }

  function teardownBridge(slug: string): void {
    const detach = bridges.get(slug);
    if (detach) {
      detach();
      bridges.delete(slug);
    }
  }

  function get(slug: string): Room {
    let room = rooms.get(slug);
    if (!room) {
      room = createRoom(slug, callbacks);
      rooms.set(slug, room);
      wireBridge(slug, room);
    }
    return room;
  }

  function attachHubAwareness(slug: string, awareness: Awareness): () => void {
    hubAwareness.set(slug, awareness);
    const room = rooms.get(slug);
    if (room) wireBridge(slug, room);
    return () => {
      teardownBridge(slug);
      if (hubAwareness.get(slug) === awareness) hubAwareness.delete(slug);
    };
  }

  function peek(slug: string): Room | null {
    return rooms.get(slug) ?? null;
  }

  function getDoc(slug: string): import('yjs').Doc {
    // Reuse get-or-create so the doc, awareness, persistence schedule, and
    // (idempotent) awareness-bridge wiring are all set up exactly once. The
    // room's doc IS the single shared doc for this slug.
    return get(slug).doc;
  }

  function pin(slug: string): void {
    pinned.add(slug);
  }

  function unpin(slug: string): void {
    pinned.delete(slug);
  }

  function isPinned(slug: string): boolean {
    return pinned.has(slug);
  }

  function syncRoomFromComments(slug: string, comments: readonly unknown[]): void {
    const room = rooms.get(slug);
    if (!room) return;
    // Through the codec's identity-keyed diff, NOT a local delete-all + push
    // (issue #112). This bridge fires after EVERY comment mutation, so it was
    // one of the three writers that could collide with an in-flight hub update
    // and leave the array holding both runs. The codec keeps the no-op guard
    // this function used to carry inline — an unchanged list emits no
    // transaction, so re-seeding the live room from a disk change (sync-agent
    // or design:edit write — see createCollab's fs hook) still can't spin the
    // 800 ms persist storm the old equality short-circuit existed to prevent.
    applyCommentsToDoc(room.doc, comments as unknown[], 'inspector-write');
  }

  function syncRoomFromAnnotations(slug: string, svg: string, writeId?: string): void {
    const room = rooms.get(slug);
    if (!room) return;
    const map = room.doc.getMap<string>(Y_TYPES.annotations);
    // Identical disk notifications remain no-ops. A new UI operation may
    // deliberately restore identical content while an author has pending work.
    const id = validAnnotationWriteId(writeId) ? writeId : undefined;
    if (map.get('svg') === svg && (!id || map.get(ANNOTATION_WRITE_ID) === id)) return;
    room.doc.transact(() => {
      map.set('svg', svg);
      if (id) map.set(ANNOTATION_WRITE_ID, id);
      else map.delete(ANNOTATION_WRITE_ID);
    }, 'inspector-write');
  }

  function setAgentEditing(slug: string, state: { name: string; since: number } | null): void {
    rooms.get(slug)?.setAgentEditing(state);
  }

  async function flushAll(): Promise<void> {
    await Promise.all(Array.from(rooms.values(), (r) => r.flush()));
  }

  async function drop(slug: string): Promise<void> {
    const room = rooms.get(slug);
    if (!room) return;
    if (room.size() > 0) return; // still active, leave it
    // Phase 9.2 (DDR-064) — a pinned room has a shared-doc hub provider attached
    // to its doc; destroying it would yank the doc out from under the provider.
    // Leave it (with zero browser conns) until runtime stop / server shutdown.
    // Empty in the flag-OFF path → no behavior change.
    if (pinned.has(slug)) return;
    // Tear the bridge down before room.destroy() runs awareness.destroy() —
    // a late relay must not fire against a dead Awareness. The hub Awareness
    // stays registered, so a reconnecting browser re-wires via get().
    teardownBridge(slug);
    rooms.delete(slug);
    await room.destroy();
  }

  async function forceDrop(slug: string): Promise<void> {
    const room = rooms.get(slug);
    if (!room) return;
    // Safety net — the caller (moveCanvas) already refuses the move when
    // pinned, but never yank a doc out from under an attached hub provider.
    if (pinned.has(slug)) return;
    await room.flush();
    teardownBridge(slug);
    rooms.delete(slug);
    await room.destroy();
  }

  async function destroyAll(): Promise<void> {
    for (const slug of Array.from(bridges.keys())) teardownBridge(slug);
    hubAwareness.clear();
    const all = Array.from(rooms.values());
    rooms.clear();
    await Promise.all(all.map((r) => r.destroy()));
  }

  return {
    get,
    peek,
    getDoc,
    syncRoomFromComments,
    syncRoomFromAnnotations,
    setAgentEditing,
    attachHubAwareness,
    pin,
    unpin,
    isPinned,
    flushAll,
    destroyAll,
    drop,
    forceDrop,
    size: () => rooms.size,
  };
}
