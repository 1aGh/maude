// Per-canvas Y.Doc room — registry, connection set, persistence schedule.
//
// One Room per canvas slug. Holds the Y.Doc + Awareness + the set of connected
// peers, broadcasts updates, debounces JSON snapshot writes to disk
// (DDR-051 — JSON is canonical, `.ydoc.bin` is a cache).
//
// The Room is transport-agnostic — it accepts CollabConn objects from the WS
// layer (ws.ts). Tests construct rooms directly without booting Bun.serve.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  PRESENTER_ONLY_FIELDS,
  stripAwarenessFields,
  stripToWatching,
} from '../present/relay-strip.ts';
import { stampRole, stripUnheldFields } from './awareness-bridge.ts';
import { isBodyLane, rootTypesTouched } from './origins.ts';
import {
  applySyncMessage,
  type CollabConn,
  encodeAwarenessFrame,
  encodeEpochVerdict,
  encodeHandshake,
  encodeSyncUpdate,
  handleMessage,
  MESSAGE_AWARENESS,
  MESSAGE_EPOCH,
  MESSAGE_SYNC,
  readEpochClaim,
  readMessageType,
} from './protocol.ts';
import { EDITOR_ONLY_FIELDS, MEMBER_ONLY_FIELDS } from './timeline-awareness.ts';

export interface RoomConn extends CollabConn {
  /** Stable id for this connection (UUID from ws.data.id). */
  id: string;
  /**
   * Which server origin upgraded this socket (DDR-063 canvas-origin split).
   * `'canvas'` = the untrusted canvas iframe origin — its sync frames go
   * through the origin gate (DDR-122 follow-up) and may never write a body
   * lane. Absent or `'main'` = the privileged shell origin, ungated.
   *
   * Absent defaults to trusted ON PURPOSE: every pre-existing caller (tests,
   * the shell socket) is main-origin, and the two canvas-origin call sites
   * (`server.ts`'s `startCanvasServer` upgrade → `ws.ts`'s `bindCollab`) set
   * it explicitly. `test/collab-origin-gate.test.ts` pins that wiring so the
   * default can't silently swallow a future canvas path.
   */
  realm?: 'main' | 'canvas';
  /**
   * Cloud collab lane (RCA issue-cloud-live-collaboration-dead) — true when
   * this socket was opened under a read-only role (a cell's `viewer`, or a
   * cell socket the proxy did not vouch). A read-only conn still receives every
   * broadcast and publishes awareness — presence for viewers is the point of
   * the channel — but its SYNC writes are gated to the comment lane, mirroring
   * the role matrix (`viewer.comment === true`) the same way the inspector
   * channel's `comments-patch`/`comments-delete` gate does. Absent defaults to
   * writable ON PURPOSE, for the same reason `realm` defaults to trusted:
   * every pre-existing caller is a loopback desktop peer.
   */
  readOnly?: boolean;
  /**
   * S9.15c — read-only with NO writable lane: the comment lane closes too. Set
   * when the proxy's readonly projection is anything but `0`/`1` — `plan` (the
   * project is paused, lead decision `v2-lead-paused-comments-refused`) or a
   * value this studio does not know (the stricter reading). Every sync write
   * from the conn is refused; its sync step 1 is answered and its awareness
   * (presence) still applies. Absent = the `readOnly` rule above alone.
   */
  lanesClosed?: boolean;
  /**
   * S9.11 (V2-1.7 §5.5) — may this conn publish `summon` (Bring everyone here)? Absent =
   * yes, for the same reason `readOnly` defaults to writable; ws.ts sets it from the
   * socket's access (`summon`: owner + member).
   */
  summon?: boolean;
  /**
   * P8 G2 lead decision (b) — the project role this socket's access holds on the canvas
   * (ws.ts, `access.roleFor`). The room stamps it onto every awareness state the conn owns,
   * overwriting a client-sent `role`; absent = the conn's states carry no role at all.
   */
  role?: 'owner' | 'member' | 'viewer' | 'observer';
  /**
   * V2-8.9 round B A2 — WHO opened this socket, as verified at the upgrade (a cell's proxy-vouched
   * user; `''`/absent on a desktop, where every socket is the one person). A clientID a conn claimed
   * stays bound to this person after the conn goes (`CLIENT_TOMBSTONE_MS`): only the same person
   * reclaims it, so nobody else squats a freed id with its owner's name and locks them out.
   */
  person?: string;
  /**
   * S3.7c — a presentation FOLLOWER (a socket opened on the hub's receive-only
   * `follow` capability; server.ts stamps it from the proxy's injected
   * `x-maude-collab-follow`, canvas listener + workspace only). It receives
   * everything; it writes NOTHING — every sync update is dropped (only its sync
   * step 1, the request for the doc, is answered) — and its awareness reaches
   * the room as `{ watching }` only. Absent = not a follower.
   */
  follow?: boolean;
}

/** y-protocols sync sub-message: the peer's state vector, asking for the doc (writes nothing). */
const SYNC_STEP_1 = 0;

export interface RoomCallbacks {
  /**
   * Persist the JSON projection of `doc` for this slug. Called debounced — the
   * Room batches Y.Doc updates within 800 ms windows and fires this once at
   * quiescence. Implementations MUST be idempotent.
   */
  persistJson(slug: string, doc: Y.Doc): Promise<void> | void;

  /**
   * Persist the binary Y.Doc state cache (`.ydoc.bin`). Called on the same
   * debounce schedule as persistJson. Separate hook so tests can stub one
   * without the other.
   */
  persistBinary(slug: string, state: Uint8Array): Promise<void> | void;

  /**
   * Seed the Y.Doc from on-disk persistence — `.ydoc.bin` first, JSON
   * snapshots second. Called once at room construction. MUST be synchronous
   * with respect to the Y.Doc passed in so the first peer's handshake sees
   * the seeded state.
   */
  seed(slug: string, doc: Y.Doc): Promise<void> | void;

  /**
   * Accepted revisions (DDR-241 §7): while true, this room's document is a
   * replica of the project's accepted state — no browser connection may write
   * a persistent lane into it (the hub would drop it and the replica would
   * diverge). Comments and annotations go through the API as proposals.
   * Awareness is unaffected. Optional; absent means false.
   */
  acceptedMode?: () => boolean;

  /**
   * p8-comment-gate (decision `v2-p8-comment-gate-socket-lanes`) — while true,
   * this build does not edit the project's FORMAT (format.ts `formatGate`: a
   * format-1 project until it converts, a newer one, a linked one that still
   * saves the old way). The HTTP gate refuses every write then, comments
   * included; this is the same gate on the socket: no conn writes any lane.
   * Asked per frame — "Update project" lifts it while sockets stay open.
   * Awareness is unaffected. Optional; absent means false.
   */
  formatGated?: () => boolean;

  /**
   * p8-collab-epoch (decision `v2-p8-collab-epoch`) — this server instance's
   * epoch. When set, a peer's sync writes are taken only once it has claimed
   * this epoch (or '' — a doc that never synced): a doc synced under an earlier
   * instance is never replayed into this room. Absent = no check (rooms built
   * directly by tests, the pre-epoch behaviour).
   */
  epoch?: string;
}

/** Where a conn stands on the epoch check (only while `RoomCallbacks.epoch` is set). */
type EpochStanding = 'unknown' | 'ok' | 'stale' | 'legacy';

export interface Room {
  readonly slug: string;
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  connect(conn: RoomConn): Promise<void>;
  disconnect(conn: RoomConn): void;
  receive(conn: RoomConn, payload: Uint8Array): void;
  /**
   * Phase 30 — project an agent's "editing" activity onto this room's awareness
   * using the room's own (otherwise-unused) local awareness slot, so the soft
   * editing-presence crosses the hub to remote peers (the loopback `ai-activity`
   * bus event does not). `null` clears it. Idempotent — a re-set of the same
   * `{name, since}` is a no-op (ai-activity heartbeats re-emit every 10 s).
   * NOT a lock; never blocks a peer.
   */
  setAgentEditing(state: { name: string; since: number } | null): void;
  /** Force the debounced flush to fire now. DDR-051 §3 (branch-switch). */
  flush(): Promise<void>;
  /** Tear down — clears timers + removes awareness. */
  destroy(): Promise<void>;
  /** Test/inspection: connection count. */
  size(): number;
  /**
   * Test/inspection: how many canvas-realm sync frames the origin gate has
   * refused for touching a body lane. Non-zero in production means untrusted
   * canvas script tried to write source — worth surfacing, never expected.
   */
  gateRefusals(): number;
  /** Test/inspection: sync writes refused because the peer's doc is from an earlier instance. */
  epochRefusals(): number;
}

const DEBOUNCE_MS = 800;

/** What a read-only conn's awareness loses before the room applies it (S3.7b + S7.17; `holding` since p8-holding-strip). */
const READ_ONLY_STRIP: readonly string[] = Object.freeze([
  ...PRESENTER_ONLY_FIELDS,
  ...EDITOR_ONLY_FIELDS,
]);

/** A frame as a presentation follower may receive it: awareness without the member-only fields. */
export function toFollower(frame: Uint8Array): Uint8Array | null {
  return stripAwarenessFields(frame, MEMBER_ONLY_FIELDS);
}

/**
 * V2-8.9 round B A2 — how long a freed clientID stays bound to its person. Past it the id is free again
 * (a person away that long is not shown anyway); the map is also capped.
 */
export const CLIENT_TOMBSTONE_MS = 10 * 60_000;
const MAX_CLIENT_BINDINGS = 4096;

export function createRoom(slug: string, callbacks: RoomCallbacks): Room {
  const doc = new Y.Doc();
  // Awareness needs a clientID; reuse the Y.Doc's so peers can attribute updates.
  const awareness = new Awareness(doc);

  const conns = new Map<string, RoomConn>();
  // clientID → owning conn.id, learned from the origin of each awareness update.
  // Server-authoritative: we do NOT trust a client-supplied `__connId` (awareness
  // is attacker-influenceable through a semi-trusted hub — DDR-054). On disconnect
  // we remove exactly the clientIDs this conn published so other peers drop the
  // avatar immediately, instead of waiting out the ~30s awareness timeout (which
  // let phantom peers pile up on rapid reconnects — the cross-origin repro that
  // surfaced this latent bug).
  const connByClient = new Map<number, string>();
  // V2-8.9 round B A2 — clientID → the person who held it, kept for CLIENT_TOMBSTONE_MS after its
  // conn went, so a reconnect by the same person reclaims it and nobody else can.
  const personByClient = new Map<number, { person: string; freedAt: number | null }>();
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let seedPromise: Promise<void> | null = null;

  function scheduleFlush() {
    dirty = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, DEBOUNCE_MS);
  }

  async function flush(): Promise<void> {
    if (!dirty || destroyed) return;
    dirty = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      await callbacks.persistJson(slug, doc);
      await callbacks.persistBinary(slug, Y.encodeStateAsUpdate(doc));
    } catch (err) {
      // Re-arm so the next mutation retries. Loud-log; persistence loss is a
      // user-visible bug if it stays silent.
      dirty = true;
      console.error(`[collab/${slug}] flush failed:`, err);
    }
  }

  function broadcast(payload: Uint8Array, except?: RoomConn) {
    // S7.17 — a presentation follower is outside the project: it never hears where a member's playhead
    // is or which caption word they are fixing. Stripped once per frame, only when a follower listens.
    let forFollower: Uint8Array | null | undefined;
    for (const c of conns.values()) {
      if (except && c.id === except.id) continue;
      // p8-collab-epoch — a stale peer is about to drop its doc; it hears nothing until it rejoins.
      if (epochOf.get(c.id) === 'stale') continue;
      let out: Uint8Array | null = payload;
      if (c.follow === true) {
        if (forFollower === undefined) forFollower = toFollower(payload);
        out = forFollower;
      }
      if (!out) continue;
      try {
        c.send(out);
      } catch {
        /* close handler will clean up dead sockets */
      }
    }
  }

  // --- Origin gate (DDR-122 follow-up) -------------------------------------
  //
  // A canvas-realm sync frame is applied to `mirror` FIRST, under a probe
  // origin, so `transaction.changed` tells us which root lanes it targets.
  // Only if it touches no body lane do the same bytes reach `doc`. See
  // `collab/origins.ts` for why the update bytes alone can't answer this.
  const GATE_PROBE_ORIGIN = Object.freeze({ maudeOrigin: 'collab-gate-probe' });
  const GATE_MIRROR_SYNC = Object.freeze({ maudeOrigin: 'collab-gate-mirror-sync' });
  let mirror: Y.Doc | null = null;
  let probeRoots: Set<string> | null = null;
  let gateRefusalCount = 0;

  function ensureMirror(): Y.Doc {
    if (mirror) return mirror;
    const m = new Y.Doc();
    Y.applyUpdate(m, Y.encodeStateAsUpdate(doc), GATE_MIRROR_SYNC);
    m.on('afterTransaction', (tr: Y.Transaction) => {
      if (tr.origin === GATE_PROBE_ORIGIN) probeRoots = rootTypesTouched(tr);
    });
    mirror = m;
    return m;
  }

  /** Drop a mirror that has been poisoned by a refused frame. Rebuilt lazily
   *  from the (still clean) room doc on the next canvas-realm frame. */
  function discardMirror(): void {
    const m = mirror;
    mirror = null;
    if (m) {
      try {
        m.destroy();
      } catch {
        /* best effort */
      }
    }
  }

  /**
   * Which lanes this conn's sync writes may not touch.
   *
   * Two independent dimensions, both fail-closed on `<unresolved>`:
   *   - realm 'canvas' (DDR-122): body lanes are never writable from the
   *     untrusted canvas origin, whoever is connected.
   *   - readOnly (cloud collab lane): only the comment lane is writable — the
   *     WS mirror of the role matrix's viewer capability.
   *   - lanesClosed (S9.15c, a paused project): no lane is writable.
   */
  function refusedLanes(
    conn: RoomConn,
    roots: ReadonlySet<string>,
    formatGated: boolean
  ): string[] {
    const refused: string[] = [];
    // Accepted revisions: every persistent lane is the hub's to change.
    if (callbacks.acceptedMode?.()) return [...roots];
    if (conn.lanesClosed === true) return [...roots];
    // p8-comment-gate — the format gate refuses every lane, the comments one too.
    if (formatGated) return [...roots];
    for (const r of roots) {
      if (conn.realm === 'canvas' && (isBodyLane(r) || r === '<unresolved>')) {
        refused.push(r);
        continue;
      }
      if (conn.readOnly === true && r !== 'comments') refused.push(r);
    }
    return refused;
  }

  /**
   * Gated frame path — canvas-realm and/or read-only conns. Awareness frames
   * are unchanged (cursors/presence are ephemeral and already
   * server-attributed). Sync frames are gated.
   *
   * `formatGated` is the caller's ONE read of the format gate for this frame
   * (p8-holds-fix, recheck info B — `formatGate` reads a file).
   */
  function receiveGated(conn: RoomConn, payload: Uint8Array, formatGated: boolean): void {
    if (readMessageType(payload) !== MESSAGE_SYNC) {
      // S3.7b (D11) — a read-only conn may watch, never broadcast a
      // presentation: `present` + `pointer` are stripped before the apply.
      // S7.17 — nor claim a caption word: `editing` needs `edit` too.
      // p8-holds-fix (recheck info A) — a format-gated session is view-only
      // too: no caption word, no hold (p8-holding-strip, I1 — holding is in EDITOR_ONLY_FIELDS).
      // Presence and pointer stay, as over HTTP.
      const frame =
        conn.readOnly === true || conn.lanesClosed === true
          ? stripAwarenessFields(payload, READ_ONLY_STRIP)
          : formatGated
            ? stripAwarenessFields(payload, EDITOR_ONLY_FIELDS)
            : payload;
      if (!frame) return;
      const reply = handleMessage(frame, doc, awareness, conn);
      if (reply) conn.send(reply);
      return;
    }

    const m = ensureMirror();
    probeRoots = null;
    let probeThrew = false;
    try {
      applySyncMessage(payload, m, GATE_PROBE_ORIGIN);
    } catch (err) {
      probeThrew = true;
      console.error(`[collab/${slug}] origin gate: probe apply failed:`, err);
    }
    // Fail closed on anything we could not positively classify — a probe that
    // threw, or a root type we could not resolve to a name.
    const roots = probeRoots ?? new Set<string>();
    const refused = refusedLanes(conn, roots, formatGated);
    if (probeThrew || refused.length > 0) {
      gateRefusalCount += 1;
      discardMirror();
      console.warn(
        `[collab/${slug}] origin gate REFUSED a ${callbacks.acceptedMode?.() ? 'accepted-replica' : conn.lanesClosed ? 'lanes-closed' : formatGated ? 'format-gated' : conn.readOnly ? 'read-only' : 'canvas-realm'} ` +
          `sync frame (lanes: ${refused.join(', ') || 'unclassifiable'}). ` +
          (conn.lanesClosed
            ? 'Editing is paused for this project — no lane is writable (S9.15c).'
            : formatGated
              ? "This build does not edit this project's format — view only, no lane is writable."
              : conn.readOnly
                ? 'A viewer-role socket may only write comments — role matrix, cloud collab lane.'
                : 'Untrusted canvas script may not write canvas source — see DDR-122 follow-up / collab/origins.ts.')
      );
      // Re-assert server truth to that peer so it converges on the authoritative
      // state instead of silently diverging. Their locally-authored body items
      // stay in their own realm (they made them) but never reach disk or a peer.
      try {
        conn.send(encodeSyncUpdate(Y.encodeStateAsUpdate(doc)));
      } catch {
        /* close handler will clean up */
      }
      return;
    }

    const reply = applySyncMessage(payload, doc, conn);
    if (reply) conn.send(reply);
  }

  // Y.Doc update -> broadcast to all peers + schedule debounced flush.
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (destroyed) return;
    // Keep the gate mirror in lockstep with the room doc, so the next probe is
    // evaluated against current truth. Idempotent — a re-applied update is a
    // no-op in yjs, which is what makes the "probe then apply for real" double
    // application safe.
    if (mirror) {
      try {
        Y.applyUpdate(mirror, update, GATE_MIRROR_SYNC);
      } catch {
        discardMirror();
      }
    }
    // Don't echo back to the origin — they already have it; reduces noise.
    const except =
      origin && typeof origin === 'object' && 'id' in origin ? (origin as RoomConn) : undefined;
    broadcast(encodeSyncUpdate(update), except);
    scheduleFlush();
  });

  // Awareness changes -> broadcast (NOT persisted; ephemeral by design).
  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (destroyed) return;
      const changed = added.concat(updated, removed);
      if (changed.length === 0) return;
      const except =
        origin && typeof origin === 'object' && 'id' in origin ? (origin as RoomConn) : undefined;
      // Learn which clientIDs belong to which conn from the update origin, so
      // disconnect() can evict them precisely.
      if (except) {
        // S9.11 — a conn without `summon` never publishes it (stripped before anyone hears).
        if (except.summon === false)
          stripUnheldFields(awareness, added.concat(updated), (cap) => cap !== 'summon');
        // P8 G2 (b) — the role word comes from the socket's access, never from the client.
        stampRole(awareness, added.concat(updated), except.role);
        for (const id of added) connByClient.set(id, except.id);
        for (const id of updated) connByClient.set(id, except.id);
        for (const id of added.concat(updated))
          personByClient.set(id, { person: except.person ?? '', freedAt: null });
        for (const id of removed) {
          connByClient.delete(id);
          const held = personByClient.get(id);
          if (held) held.freedAt = Date.now();
        }
      }
      broadcast(encodeAwarenessFrame(awareness, changed), except);
    }
  );

  function getOrStartSeed(): Promise<void> {
    if (!seedPromise) {
      const result = callbacks.seed(slug, doc);
      seedPromise = Promise.resolve(result).catch((err) => {
        console.error(`[collab/${slug}] seed failed:`, err);
      });
    }
    return seedPromise;
  }

  async function connect(conn: RoomConn): Promise<void> {
    await getOrStartSeed();
    conns.set(conn.id, conn);
    // p8-collab-epoch — with the check on, this room asks for the peer's state
    // (sync step 1) only after the peer claimed this epoch (`receiveClaim`), so
    // a doc from an earlier instance is never asked for. Awareness goes now.
    let frames = encodeHandshake(doc, awareness);
    if (callbacks.epoch !== undefined) {
      if (!epochOf.has(conn.id)) epochOf.set(conn.id, 'unknown');
      frames = frames.filter((f) => readMessageType(f) !== MESSAGE_SYNC);
    }
    for (const frame of frames) {
      const out = conn.follow === true ? toFollower(frame) : frame;
      if (out) conn.send(out);
    }
  }

  function disconnect(conn: RoomConn): void {
    conns.delete(conn.id);
    epochOf.delete(conn.id);
    // Remove the awareness states this conn published (tracked by update origin
    // in connByClient) so other peers' cursor renderers drop the avatar now,
    // not after the ~30s awareness timeout.
    const stale: number[] = [];
    for (const [clientId, connId] of connByClient) {
      if (connId === conn.id) stale.push(clientId);
    }
    for (const clientId of stale) connByClient.delete(clientId);
    const now = Date.now();
    for (const clientId of stale) {
      const held = personByClient.get(clientId);
      if (held) held.freedAt = now;
    }
    pruneTombstones(now);
    if (stale.length) removeAwarenessStates(awareness, stale, conn);
  }

  /**
   * S3.7c — a follower's frames: awareness reduced to `watching`, its sync step 1
   * answered with the doc, every other sync message (step 2, update — comments
   * included) and every other frame type dropped unapplied.
   */
  function receiveFollow(conn: RoomConn, payload: Uint8Array): void {
    let type: number;
    let sub = -1;
    try {
      const dec = decoding.createDecoder(payload);
      type = decoding.readVarUint(dec);
      if (type === MESSAGE_SYNC) sub = decoding.readVarUint(dec);
    } catch {
      return;
    }
    if (type === MESSAGE_SYNC) {
      if (sub !== SYNC_STEP_1) return;
      const reply = applySyncMessage(payload, doc, conn);
      if (reply) conn.send(reply);
      return;
    }
    if (type !== MESSAGE_AWARENESS) return;
    const frame = stripToWatching(payload);
    if (!frame) return;
    handleMessage(frame, doc, awareness, conn);
  }

  /**
   * P8 G2 co-twelve — a connection writes only its OWN presence. y-protocols encodes every changed client, so a
   * peer that timed the others out locally (a laptop waking from sleep, a throttled tab) used to tell the room
   * "they are gone" — and the room removed them for everybody, then ignored their next renewal (same clock).
   * An entry passes when this conn already owns the clientID, or claims one nobody holds (not owned by another
   * conn, not a hub-relayed or the room's own state). Everything else is dropped before the apply; a frame left
   * with no entry is dropped whole. Non-awareness frames pass untouched.
   */
  function ownAwareness(conn: RoomConn, payload: Uint8Array): Uint8Array | null {
    let entries: { clientID: number; clock: number; json: string }[];
    let dropped = false;
    try {
      const outer = decoding.createDecoder(payload);
      if (decoding.readVarUint(outer) !== MESSAGE_AWARENESS) return payload;
      const dec = decoding.createDecoder(decoding.readVarUint8Array(outer));
      const count = decoding.readVarUint(dec);
      entries = [];
      const states = awareness.getStates();
      for (let i = 0; i < count; i++) {
        const clientID = decoding.readVarUint(dec);
        const clock = decoding.readVarUint(dec);
        const json = decoding.readVarString(dec);
        const owner = connByClient.get(clientID);
        const mine =
          owner === conn.id ||
          (owner === undefined && !states.has(clientID) && personMayClaim(conn, clientID));
        if (mine) entries.push({ clientID, clock, json });
        else dropped = true;
      }
    } catch {
      return null;
    }
    if (!dropped) return payload;
    if (entries.length === 0) return null;
    const inner = encoding.createEncoder();
    encoding.writeVarUint(inner, entries.length);
    for (const e of entries) {
      encoding.writeVarUint(inner, e.clientID);
      encoding.writeVarUint(inner, e.clock);
      encoding.writeVarString(inner, e.json);
    }
    const out = encoding.createEncoder();
    encoding.writeVarUint(out, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(out, encoding.toUint8Array(inner));
    return encoding.toUint8Array(out);
  }

  /** A2 — may `conn` claim the unowned `clientID`? Not while it is bound to someone else. */
  function personMayClaim(conn: RoomConn, clientID: number): boolean {
    const held = personByClient.get(clientID);
    if (!held) return true;
    if (held.person === (conn.person ?? '')) return true;
    return held.freedAt !== null && Date.now() - held.freedAt > CLIENT_TOMBSTONE_MS;
  }

  function pruneTombstones(now: number): void {
    for (const [id, held] of personByClient)
      if (held.freedAt !== null && now - held.freedAt > CLIENT_TOMBSTONE_MS)
        personByClient.delete(id);
    // bounded: the oldest freed ids go first
    if (personByClient.size <= MAX_CLIENT_BINDINGS) return;
    for (const [id, held] of personByClient) {
      if (personByClient.size <= MAX_CLIENT_BINDINGS) break;
      if (held.freedAt !== null) personByClient.delete(id);
    }
  }

  // --- Handshake epoch (p8-collab-epoch) -----------------------------------
  //
  // A server restart builds a NEW room doc (from `.ydoc.bin`, or from the files
  // when there is none — fresh items). A peer that stayed open still holds the
  // previous instance's doc and answered the new room's sync step 1 with ALL of
  // it: the old lineage merged in as new items — comments doubled, an element
  // deleted while the studio was down came back, a body copied once per restart.
  // So the room asks a peer for its state only under this instance's epoch.
  const epochOf = new Map<string, EpochStanding>();
  let epochRefusalCount = 0;

  /** A claim frame: answer the verdict; on a match, ask for the peer's state. */
  function receiveClaim(conn: RoomConn, claim: string | null): void {
    const epoch = callbacks.epoch ?? '';
    const accepted = claim !== null && (claim === epoch || claim === '');
    epochOf.set(conn.id, accepted ? 'ok' : 'stale');
    try {
      conn.send(encodeEpochVerdict(epoch, accepted));
    } catch {
      /* close handler will clean up */
    }
    if (!accepted) return;
    // The handshake connect() held back: sync step 1 (now the peer's state may
    // come) and the room's presence again (a fresh join has a fresh awareness).
    void getOrStartSeed().then(() => {
      if (destroyed || epochOf.get(conn.id) !== 'ok') return;
      for (const frame of encodeHandshake(doc, awareness)) {
        const out = conn.follow === true ? toFollower(frame) : frame;
        if (out) conn.send(out);
      }
    });
  }

  /**
   * May this frame pass the epoch check? A stale peer (claimed an earlier epoch)
   * is about to start a fresh doc: nothing from it applies. A peer that sent no
   * claim at all (a 1.x client) is a legacy peer: it may read (its sync step 1
   * is answered) and keep its presence, but its doc is never written into this
   * room — the same as a mismatch, minus the reset it cannot do.
   */
  function epochAdmits(conn: RoomConn, payload: Uint8Array): boolean {
    let standing = epochOf.get(conn.id) ?? 'unknown';
    if (standing === 'unknown') {
      standing = 'legacy';
      epochOf.set(conn.id, standing);
      try {
        conn.send(encodeEpochVerdict(callbacks.epoch ?? '', false));
      } catch {
        /* close handler will clean up */
      }
    }
    if (standing === 'ok') return true;
    if (standing === 'stale') {
      if (readMessageType(payload) === MESSAGE_SYNC) epochRefusalCount += 1;
      return false;
    }
    // legacy
    let type = -1;
    let sub = -1;
    try {
      const dec = decoding.createDecoder(payload);
      type = decoding.readVarUint(dec);
      if (type === MESSAGE_SYNC) sub = decoding.readVarUint(dec);
    } catch {
      return false;
    }
    if (type !== MESSAGE_SYNC || sub === SYNC_STEP_1) return true;
    epochRefusalCount += 1;
    return false;
  }

  function receive(conn: RoomConn, raw: Uint8Array): void {
    if (callbacks.epoch !== undefined) {
      let type = -1;
      try {
        type = readMessageType(raw);
      } catch {
        return;
      }
      if (type === MESSAGE_EPOCH) {
        receiveClaim(conn, readEpochClaim(raw));
        return;
      }
      if (!epochAdmits(conn, raw)) return;
    }
    const payload = ownAwareness(conn, raw);
    if (!payload) return;
    if (conn.follow === true) {
      receiveFollow(conn, payload);
      return;
    }
    // Asked ONCE per frame and handed down (recheck info B).
    const formatGated = callbacks.formatGated?.() === true;
    if (
      conn.realm === 'canvas' ||
      conn.readOnly === true ||
      conn.lanesClosed === true ||
      callbacks.acceptedMode?.() ||
      formatGated
    ) {
      receiveGated(conn, payload, formatGated);
      return;
    }
    const reply = handleMessage(payload, doc, awareness, conn);
    if (reply) conn.send(reply);
  }

  // Phase 30 — agent editing-presence projected onto the room's own awareness
  // slot. The key short-circuits redundant re-sets (ai-activity heartbeats
  // re-emit the same entry every 10 s). The awareness `update` handler above
  // broadcasts the change to local conns AND relays it to the hub via
  // bridgeAwareness, so a remote peer's overlay attributes the edit.
  let agentEditingKey: string | null = null;
  function setAgentEditing(state: { name: string; since: number } | null): void {
    if (destroyed) return;
    const key = state ? `${state.name} ${state.since}` : null;
    if (key === agentEditingKey) return;
    agentEditingKey = key;
    if (state === null) {
      awareness.setLocalState(null);
      return;
    }
    awareness.setLocalState({
      name: state.name,
      color: '', // re-derived client-side from name; wire value is discarded
      cursor: null,
      selection: null,
      annotationSelection: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      editing: { since: state.since },
    });
  }

  async function destroy(): Promise<void> {
    destroyed = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (dirty) await flush();
    conns.clear();
    discardMirror();
    awareness.destroy();
    doc.destroy();
  }

  return {
    slug,
    doc,
    awareness,
    connect,
    disconnect,
    receive,
    setAgentEditing,
    flush,
    destroy,
    size: () => conns.size,
    gateRefusals: () => gateRefusalCount,
    epochRefusals: () => epochRefusalCount,
  };
}

/**
 * Ensure `<designRoot>/_state/` exists. Idempotent; safe to call on every
 * room construction (mkdir recursive returns the path or noop).
 */
export function ensureStateDir(designRoot: string): string {
  const dir = path.join(designRoot, '_state');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
