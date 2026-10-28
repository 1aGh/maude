// P8 G2 co-twelve — a connection writes only its OWN presence in the room.
//
// The finding: twelve people on one canvas each saw 3–4 of the other eleven. A peer whose awareness timed the
// others out locally (a laptop waking from sleep, a throttled tab, an idle tab's clock jumping) told the room
// "these eleven are gone" — y-protocols encodes every changed client, not only its own — and the room believed it:
// it removed eleven people for everybody, and their next renewal (same clock) was ignored. The room now drops an
// entry for a clientID another connection owns (or the hub relayed): a connection may write the clientIDs it
// claimed first and nothing else. Its own entries still apply, and a reconnect (same clientID) claims it again.

import { describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';

const callbacks = (): RoomCallbacks => ({ seed() {}, persistJson() {}, persistBinary() {} });

function conn(id: string, realm?: 'main' | 'canvas'): RoomConn {
  return { id, ...(realm ? { realm } : {}), send() {} };
}

function frame(a: Awareness, clients: number[]): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(a, clients));
  return encoding.toUint8Array(e);
}

function person(name: string) {
  const a = new Awareness(new Y.Doc());
  a.setLocalState({ name });
  return a;
}

describe.each(['main', 'canvas'] as const)('awareness ownership in the room (%s realm)', (realm) => {
  test('a peer that timed the others out cannot remove them for everybody', async () => {
    const room = createRoom(`own-${realm}`, callbacks());
    const [ct, cj, cm] = [conn('t', realm), conn('j', realm), conn('m', realm)];
    for (const c of [ct, cj, cm]) await room.connect(c);
    const [tereza, jonas, michal] = [person('Tereza'), person('Jonas'), person('Michal')];
    room.receive(ct, frame(tereza, [tereza.clientID]));
    room.receive(cj, frame(jonas, [jonas.clientID]));
    room.receive(cm, frame(michal, [michal.clientID]));

    // Michal's awareness learns the others (what the room relays), then its clock jumps and it times them out.
    room.receive(cm, frame(michal, [michal.clientID])); // a renewal of his own — still fine
    const heard = new Awareness(michal.doc);
    heard.setLocalState({ name: 'Michal' });
    for (const p of [tereza, jonas]) {
      const e = encodeAwarenessUpdate(p, [p.clientID]);
      const { applyAwarenessUpdate } = await import('y-protocols/awareness');
      applyAwarenessUpdate(heard, e, 'room');
    }
    removeAwarenessStates(heard, [tereza.clientID, jonas.clientID], 'timeout');
    // …and, as y-protocols encodes every changed client, says so to the room.
    room.receive(cm, frame(heard, [tereza.clientID, jonas.clientID, heard.clientID]));

    const states = room.awareness.getStates();
    expect(states.get(tereza.clientID)).toEqual({ name: 'Tereza' });
    expect(states.get(jonas.clientID)).toEqual({ name: 'Jonas' });
    expect(states.get(michal.clientID)).toEqual({ name: 'Michal' });
    await room.destroy();
  });

  test('nor write a state under someone else’s clientID; its own still applies; a reconnect claims it again', async () => {
    const room = createRoom(`spoof-${realm}`, callbacks());
    const [ct, cx] = [conn('t', realm), conn('x', realm)];
    await room.connect(ct);
    await room.connect(cx);
    const tereza = person('Tereza');
    room.receive(ct, frame(tereza, [tereza.clientID]));

    // conn x forges Tereza's clientID with a higher clock
    const forged = new Awareness(new Y.Doc());
    forged.clientID = tereza.clientID;
    forged.setLocalState({ name: 'not Tereza' });
    forged.setLocalState({ name: 'not Tereza', x: 1 });
    forged.setLocalState({ name: 'not Tereza', x: 2 });
    room.receive(cx, frame(forged, [tereza.clientID]));
    expect(room.awareness.getStates().get(tereza.clientID)).toEqual({ name: 'Tereza' });

    // Tereza's own update still lands
    tereza.setLocalState({ name: 'Tereza', artboard: 'poster' });
    room.receive(ct, frame(tereza, [tereza.clientID]));
    expect(room.awareness.getStates().get(tereza.clientID)).toEqual({
      name: 'Tereza',
      artboard: 'poster',
    });

    // she drops and comes back on a new socket with the same clientID
    room.disconnect(ct);
    expect(room.awareness.getStates().has(tereza.clientID)).toBe(false);
    const ct2 = conn('t2', realm);
    await room.connect(ct2);
    tereza.setLocalState({ name: 'Tereza', artboard: 'story' });
    room.receive(ct2, frame(tereza, [tereza.clientID]));
    expect(room.awareness.getStates().get(tereza.clientID)).toEqual({
      name: 'Tereza',
      artboard: 'story',
    });
    await room.destroy();
  });
});
