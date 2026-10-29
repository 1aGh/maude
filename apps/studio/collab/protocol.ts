// y-websocket binary protocol — message routing for the collab WS.
//
// Mirrors the reference implementation in y-websocket/bin/utils.js (140 lines),
// adapted to Bun's native ServerWebSocket. Two message types per the y-protocols
// spec: 0 = sync (Y.Doc state), 1 = awareness (cursors / presence). Both ride a
// varint framing of (messageType, payload).
//
// The functions are pure transport — Y.Doc lifecycle + persistence + room
// registry live in `room.ts` and `registry.ts`.

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import type * as Y from 'yjs';

export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
/**
 * p8-collab-epoch — the handshake epoch (decision `v2-p8-collab-epoch`). Outside
 * the y-websocket range (0 sync, 1 awareness, 2 auth, 3 query-awareness), so a
 * 1.x peer or server ignores it as an unknown type.
 *
 *   client → server  [64, 0, varString claim]   the epoch its doc was last synced
 *                                               under; '' = a doc that never synced
 *   server → client  [64, 1, varString epoch, varUint accepted]
 *
 * `accepted` 0 tells the client its doc belongs to an earlier server instance:
 * it starts a fresh doc and claims again (use-collab.tsx). Not a security
 * boundary — the epoch is sent to every peer; it keeps honest peers consistent.
 */
export const MESSAGE_EPOCH = 64;
export const EPOCH_CLAIM = 0;
export const EPOCH_VERDICT = 1;
/** An epoch claim's charset; anything else reads as no claim. */
const EPOCH_RE = /^[A-Za-z0-9_-]{0,64}$/;

/** The client's claim frame. */
export function encodeEpochClaim(claim: string): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_EPOCH);
  encoding.writeVarUint(e, EPOCH_CLAIM);
  encoding.writeVarString(e, claim);
  return encoding.toUint8Array(e);
}

/** The server's verdict frame. */
export function encodeEpochVerdict(epoch: string, accepted: boolean): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, MESSAGE_EPOCH);
  encoding.writeVarUint(e, EPOCH_VERDICT);
  encoding.writeVarString(e, epoch);
  encoding.writeVarUint(e, accepted ? 1 : 0);
  return encoding.toUint8Array(e);
}

/** A claim frame's epoch, or null when `payload` is not a well-formed claim. */
export function readEpochClaim(payload: Uint8Array): string | null {
  try {
    const d = decoding.createDecoder(payload);
    if (decoding.readVarUint(d) !== MESSAGE_EPOCH) return null;
    if (decoding.readVarUint(d) !== EPOCH_CLAIM) return null;
    const claim = decoding.readVarString(d);
    return EPOCH_RE.test(claim) ? claim : null;
  } catch {
    return null;
  }
}

/** A verdict frame, or null when `payload` is not one. */
export function readEpochVerdict(payload: Uint8Array): { epoch: string; accepted: boolean } | null {
  try {
    const d = decoding.createDecoder(payload);
    if (decoding.readVarUint(d) !== MESSAGE_EPOCH) return null;
    if (decoding.readVarUint(d) !== EPOCH_VERDICT) return null;
    const epoch = decoding.readVarString(d);
    const accepted = decoding.readVarUint(d) === 1;
    return EPOCH_RE.test(epoch) && epoch !== '' ? { epoch, accepted } : null;
  } catch {
    return null;
  }
}

export interface CollabConn {
  /** Push a frame to this single peer. */
  send(payload: Uint8Array): void;
}

/**
 * Encode the initial sync handshake (sync step 1) + current awareness state for
 * a freshly connected peer. The peer replies with sync step 2 (their missing
 * updates) which we hand back to `handleMessage`.
 */
export function encodeHandshake(doc: Y.Doc, awareness: awarenessProtocol.Awareness): Uint8Array[] {
  const frames: Uint8Array[] = [];

  const sync = encoding.createEncoder();
  encoding.writeVarUint(sync, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(sync, doc);
  frames.push(encoding.toUint8Array(sync));

  const states = awareness.getStates();
  if (states.size > 0) {
    const aw = encoding.createEncoder();
    encoding.writeVarUint(aw, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      aw,
      awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(states.keys()))
    );
    frames.push(encoding.toUint8Array(aw));
  }

  return frames;
}

/** Encode a sync update frame (broadcast after a Y.Doc local update). */
export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** Encode an awareness update frame (broadcast after applyAwarenessUpdate). */
export function encodeAwarenessFrame(
  awareness: awarenessProtocol.Awareness,
  changedClients: number[]
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
  );
  return encoding.toUint8Array(encoder);
}

/**
 * Peek the message type of a frame without consuming it. Lets a caller route
 * sync vs awareness before deciding *which doc* to apply the frame to — the
 * origin gate (`collab/origins.ts`) validates sync frames against a mirror doc
 * first, and needs to know a frame is a sync frame to do so.
 */
export function readMessageType(payload: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(payload));
}

/**
 * Apply one MESSAGE_SYNC frame to `doc` with `origin` as the Y transaction
 * origin, returning the reply frame (sync step 2 / ack) if there is one.
 *
 * Split out of `handleMessage` so the same bytes can be applied to a throwaway
 * mirror doc under a probe origin (the origin gate) before they are allowed
 * anywhere near the real room doc. Non-sync payloads return `null` untouched.
 */
export function applySyncMessage(
  payload: Uint8Array,
  doc: Y.Doc,
  origin: unknown
): Uint8Array | null {
  const decoder = decoding.createDecoder(payload);
  if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  // readSyncMessage applies the peer's update to the doc and writes the
  // response (sync step 2 / sync step 2 ack) into encoder.
  syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
  if (encoding.length(encoder) > 1) return encoding.toUint8Array(encoder);
  return null;
}

/**
 * Decode and dispatch one incoming binary frame. Returns an optional reply
 * frame the caller MUST send back to the originating peer (sync step 2 from
 * the server, in response to the peer's sync step 1).
 *
 * `conn` is the origin token threaded into awarenessProtocol so the awareness
 * registry can attribute states to the right peer.
 */
export function handleMessage(
  payload: Uint8Array,
  doc: Y.Doc,
  awareness: awarenessProtocol.Awareness,
  conn: CollabConn
): Uint8Array | null {
  const decoder = decoding.createDecoder(payload);
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case MESSAGE_SYNC:
      return applySyncMessage(payload, doc, conn);
    case MESSAGE_AWARENESS: {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), conn);
      return null;
    }
    default:
      return null;
  }
}
