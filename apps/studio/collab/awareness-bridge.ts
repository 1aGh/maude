// Bidirectional Awareness relay — Phase 9 Task 5 (awareness over WSS).
//
// In linked mode each canvas has TWO Awareness instances in this process:
//
//   - the collab Room's Awareness (browser tabs ↔ dev-server, loopback WS)
//   - the sync provider's Awareness (dev-server ↔ hub, HocuspocusProvider)
//
// Hocuspocus relays awareness frames between connected peers on a document out
// of the box, so the provider's Awareness already reaches cross-continent
// peers. The only missing link is in-process: this bridge wires the Room's
// Awareness to the provider's Awareness so a browser cursor published into the
// Room reaches the hub (and back) without either side knowing about the other.
//
// Awareness is EPHEMERAL — it is never persisted to disk. That is why this
// bridge is decoupled from the file-ownership question (DDR-054 F14): relaying
// cursors/selections/viewport touches no `.json` / `.svg` / `.html` file, so
// it neither introduces nor resolves the comments/annotations write race. The
// doc-content bridge (Room doc ↔ provider doc) is intentionally NOT built here
// — disk stays the medium between the two docs (Task 4), and F14 remains a
// documented risk for the doc-content bridge work.
//
// Echo prevention: every cross relay applies the update to the far side tagged
// with a shared BRIDGE origin. Each direction's listener skips updates carrying
// that origin, so a relayed state never bounces back to where it came from.
// This is the same pattern y-websocket uses to relay awareness across a fan-out
// hub. State identity is preserved because awareness updates are keyed by the
// originating clientID — the random 32-bit ids make local↔remote collisions
// negligible.

import * as encoding from 'lib0/encoding';
import type { Awareness } from 'y-protocols/awareness';
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

/**
 * A departed relayed client, as the hub can carry it.
 *
 * A peer leaving is a REMOVAL — a null awareness state. The hub (Hocuspocus 4)
 * runs every incoming awareness frame through a scratch Awareness for its
 * `beforeHandleAwareness` hook and re-encodes only the states that scratch
 * still HOLDS, so a null state is dropped on the way in: a tab closing behind
 * this studio never left anyone else's presence until the 30 s awareness
 * timeout (plan T31/L19). The one thing it forwards is a state, so a departure
 * crosses as this marker with a newer clock; every bridge turns it back into a
 * real removal on its room. It carries no `name`, so a client that predates
 * the marker drops it at the trust boundary (`sanitizeForeignState`) instead
 * of drawing a nameless avatar.
 */
export const DEPARTED = Object.freeze({ __left: true });

function isDeparted(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { __left?: unknown }).__left === true;
}

/** Encode a departure for each of `clients`, one clock past what `from` knows. */
function encodeDepartures(from: Awareness, clients: readonly number[]): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, clients.length);
  for (const clientID of clients) {
    encoding.writeVarUint(enc, clientID);
    encoding.writeVarUint(enc, (from.meta.get(clientID)?.clock ?? 0) + 1);
    encoding.writeVarString(enc, JSON.stringify(DEPARTED));
  }
  return encoding.toUint8Array(enc);
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Wire `a` ↔ `b` bidirectionally. Existing states on each side are exchanged
 * immediately so a peer that connected before the bridge existed still shows
 * up. Returns a detach fn that removes both listeners — call it BEFORE either
 * Awareness is destroyed, otherwise a late relay would apply to a dead
 * instance.
 */
export function bridgeAwareness(a: Awareness, b: Awareness): () => void {
  // A single shared origin for both directions. A genuine local change carries
  // some other origin (a browser conn, the provider's internal token, or null),
  // so it relays; a change this bridge applied carries BRIDGE, so it stops.
  const BRIDGE = { awarenessBridge: true };

  // Room → hub. A client that left the room leaves as a DEPARTED marker (see
  // above) — never as the null state the hub would drop. Everything else
  // relays as it is.
  const aToB = ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    if (origin === BRIDGE) return;
    const present = added.concat(updated);
    if (present.length > 0) applyAwarenessUpdate(b, encodeAwarenessUpdate(a, present), BRIDGE);
    const gone = removed.filter((id) => id !== b.clientID && b.getStates().has(id));
    if (gone.length > 0) applyAwarenessUpdate(b, encodeDepartures(b, gone), BRIDGE);
  };
  // Hub → room. A DEPARTED marker is a removal here; a real removal (the hub's
  // own timeout, a peer's socket closing) relays as ever.
  const bToA = ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
    if (origin === BRIDGE) return;
    const states = b.getStates();
    const departed = added.concat(updated).filter((id) => isDeparted(states.get(id)));
    const live = added.concat(updated).filter((id) => !isDeparted(states.get(id)));
    const changed = live.concat(removed);
    if (changed.length > 0) applyAwarenessUpdate(a, encodeAwarenessUpdate(b, changed), BRIDGE);
    const leaving = departed.filter((id) => a.getStates().has(id));
    if (leaving.length > 0) removeAwarenessStates(a, leaving, BRIDGE);
  };

  // Initial state exchange — push each side's current states to the other
  // (departed markers are not a presence).
  const aClients = Array.from(a.getStates().keys());
  if (aClients.length > 0) applyAwarenessUpdate(b, encodeAwarenessUpdate(a, aClients), BRIDGE);
  const bClients = Array.from(b.getStates().entries())
    .filter(([, state]) => !isDeparted(state))
    .map(([id]) => id);
  if (bClients.length > 0) applyAwarenessUpdate(a, encodeAwarenessUpdate(b, bClients), BRIDGE);

  a.on('update', aToB);
  b.on('update', bToA);

  return () => {
    a.off('update', aToB);
    b.off('update', bToA);
  };
}
