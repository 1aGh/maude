// Phase 9 Task 5 — awareness over WSS.
//
// Unit-tests the in-process Awareness bridge (collab Room ↔ sync provider) and
// the registry wiring that owns its lifecycle, plus an end-to-end cross-peer
// cursor relay through a simulated hub.

import { describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';

import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { bridgeAwareness, DEPARTED } from '../collab/awareness-bridge.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';

function noopCallbacks(): RoomCallbacks {
  return {
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  };
}

function mkAwareness(): Awareness {
  return new Awareness(new Y.Doc());
}

// Simulate the Hocuspocus hub relay: two Awareness instances cross-linked so a
// change on one appears on the other (keyed by the originating clientID).
function linkAwareness(x: Awareness, y: Awareness): () => void {
  const T = { transport: true };
  function fwd(from: Awareness, to: Awareness) {
    return (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === T) return;
      const changed = added.concat(updated, removed);
      if (changed.length === 0) return;
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), T);
    };
  }
  const xy = fwd(x, y);
  const yx = fwd(y, x);
  x.on('update', xy);
  y.on('update', yx);
  return () => {
    x.off('update', xy);
    y.off('update', yx);
  };
}

describe('bridgeAwareness', () => {
  test('relays a local state set on a → b', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    bridgeAwareness(a, b);

    a.setLocalState({ name: 'Alice', color: '#f00', cursor: { x: 1, y: 2 } });

    const seen = b.getStates().get(a.clientID) as { name?: string; color?: string } | undefined;
    expect(seen?.name).toBe('Alice');
    expect(seen?.color).toBe('#f00');
  });

  test('relays both directions', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    bridgeAwareness(a, b);

    b.setLocalState({ name: 'Bob' });
    expect((a.getStates().get(b.clientID) as { name?: string } | undefined)?.name).toBe('Bob');
  });

  // Plan T31/L19 — the hub (Hocuspocus 4) drops null awareness states on the
  // way in, so a departure crosses from room to hub as a DEPARTED marker with
  // a newer clock, and back from hub to room as a real removal.
  test('a client leaving the room reaches the hub side as a departure, not a presence', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    bridgeAwareness(a, b);

    a.setLocalState({ name: 'Alice' });
    expect(b.getStates().has(a.clientID)).toBe(true);

    a.setLocalState(null);
    expect(b.getStates().get(a.clientID)).toEqual(DEPARTED);
  });

  test('a departure arriving from the hub removes the client from the room', () => {
    const room = mkAwareness();
    const hub = mkAwareness();
    bridgeAwareness(room, hub);
    const peer = mkAwareness();
    peer.setLocalState({ name: 'Bob' });
    applyAwarenessUpdate(hub, encodeAwarenessUpdate(peer, [peer.clientID]), 'hub');
    expect(room.getStates().has(peer.clientID)).toBe(true);
    // What another studio's bridge sent when Bob's tab closed.
    const leftClock = (hub.meta.get(peer.clientID)?.clock ?? 0) + 1;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint(enc, peer.clientID);
    encoding.writeVarUint(enc, leftClock);
    encoding.writeVarString(enc, JSON.stringify(DEPARTED));
    applyAwarenessUpdate(hub, encoding.toUint8Array(enc), 'hub');
    expect(room.getStates().has(peer.clientID)).toBe(false);
  });

  test('a departed marker is never offered to a room as a presence at wire time', () => {
    const room = mkAwareness();
    const hub = mkAwareness();
    const peer = mkAwareness();
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint(enc, peer.clientID);
    encoding.writeVarUint(enc, 5);
    encoding.writeVarString(enc, JSON.stringify(DEPARTED));
    applyAwarenessUpdate(hub, encoding.toUint8Array(enc), 'hub');
    bridgeAwareness(room, hub);
    expect(room.getStates().has(peer.clientID)).toBe(false);
  });

  test('exchanges pre-existing states at wire time', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    a.setLocalState({ name: 'Alice' });
    b.setLocalState({ name: 'Bob' });

    bridgeAwareness(a, b);

    expect((b.getStates().get(a.clientID) as { name?: string } | undefined)?.name).toBe('Alice');
    expect((a.getStates().get(b.clientID) as { name?: string } | undefined)?.name).toBe('Bob');
  });

  test('does not echo — a single update yields a single foreign state, no storm', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    bridgeAwareness(a, b);

    let bUpdates = 0;
    b.on('update', () => {
      bUpdates++;
    });

    a.setLocalState({ name: 'Alice' });

    // Exactly one relayed update; a's own state count stays 1 (no bounce-back
    // creating phantom clients).
    expect(bUpdates).toBe(1);
    expect(a.getStates().size).toBe(1);
    expect(b.getStates().size).toBe(2); // a (relayed) + b's own
  });

  test('detach stops further relay', () => {
    const a = mkAwareness();
    const b = mkAwareness();
    const detach = bridgeAwareness(a, b);

    detach();
    a.setLocalState({ name: 'Alice' });
    expect(b.getStates().has(a.clientID)).toBe(false);
  });
});

describe('Registry.attachHubAwareness', () => {
  test('attach-then-create wires the bridge so room state reaches the hub', () => {
    const r = createRegistry(noopCallbacks());
    const hub = mkAwareness();
    r.attachHubAwareness('s', hub);

    const room = r.get('s');
    room.awareness.setLocalState({ name: 'Alice' });

    expect((hub.getStates().get(room.awareness.clientID) as { name?: string })?.name).toBe('Alice');
  });

  test('create-then-attach wires immediately', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('s');
    room.awareness.setLocalState({ name: 'Alice' });

    const hub = mkAwareness();
    r.attachHubAwareness('s', hub);

    // Pre-existing room state is exchanged at wire time.
    expect((hub.getStates().get(room.awareness.clientID) as { name?: string })?.name).toBe('Alice');
  });

  test('detach stops relaying and prevents re-wire on a fresh room', async () => {
    const r = createRegistry(noopCallbacks());
    const hub = mkAwareness();
    const detach = r.attachHubAwareness('s', hub);
    r.get('s');

    detach();
    await r.drop('s'); // room had no conns → destroyed

    const room2 = r.get('s');
    room2.awareness.setLocalState({ name: 'Alice' });
    expect(hub.getStates().has(room2.awareness.clientID)).toBe(false);
  });

  test('room churn re-wires the bridge (hub awareness persists)', async () => {
    const r = createRegistry(noopCallbacks());
    const hub = mkAwareness();
    r.attachHubAwareness('s', hub);

    const room1 = r.get('s');
    room1.awareness.setLocalState({ name: 'Alice' });
    expect(hub.getStates().has(room1.awareness.clientID)).toBe(true);

    await r.drop('s'); // last browser left

    const room2 = r.get('s'); // browser reconnects
    room2.awareness.setLocalState({ name: 'Alice2' });
    expect((hub.getStates().get(room2.awareness.clientID) as { name?: string })?.name).toBe(
      'Alice2'
    );
  });

  test('destroyAll tears down bridges without throwing', async () => {
    const r = createRegistry(noopCallbacks());
    const hub = mkAwareness();
    r.attachHubAwareness('s', hub);
    r.get('s').awareness.setLocalState({ name: 'Alice' });

    await r.destroyAll();
    // Hub Awareness is no longer relayed-to; setting a fresh room would not
    // re-wire because destroyAll cleared the attachment.
    const room = r.get('s');
    room.awareness.setLocalState({ name: 'Bob' });
    expect(hub.getStates().has(room.awareness.clientID)).toBe(false);
  });
});

describe('cross-peer cursor relay (Room A → hub → Room B)', () => {
  test('a cursor published in one peer reaches the other peer', () => {
    // Peer A: room A ↔ hubA. Peer B: room B ↔ hubB. hubA ↔ hubB is the
    // Hocuspocus relay (simulated by linkAwareness).
    const regA = createRegistry(noopCallbacks());
    const regB = createRegistry(noopCallbacks());
    const hubA = mkAwareness();
    const hubB = mkAwareness();
    linkAwareness(hubA, hubB);
    regA.attachHubAwareness('canvas', hubA);
    regB.attachHubAwareness('canvas', hubB);

    const roomA = regA.get('canvas');
    const roomB = regB.get('canvas');

    roomA.awareness.setLocalState({ name: 'Alice', cursor: { x: 10, y: 20 } });

    const onB = roomB.awareness.getStates().get(roomA.awareness.clientID) as
      | { name?: string; cursor?: { x: number; y: number } }
      | undefined;
    expect(onB?.name).toBe('Alice');
    expect(onB?.cursor).toEqual({ x: 10, y: 20 });
  });
});
