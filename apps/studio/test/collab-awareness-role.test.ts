// P8 G2 lead decision (b) — the presence role word ("· Can edit") comes from the room, never the client.
//
// The collab room stamps each connection's role (the socket's own access, ws.ts) onto the awareness states that
// connection owns, in the same place it strips `summon`, overwriting whatever the client sent. A connection with no
// stamped role (a hand-built test socket, a loopback peer without access) publishes no role at all: a client can
// never name its own role. The shell's `roleOf` reads the stamped field (presence/model.ts `roleWord`).

import { describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';

const callbacks = (): RoomCallbacks => ({ seed() {}, persistJson() {}, persistBinary() {} });

function frame(a: Awareness): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(a, [a.clientID]));
  return encoding.toUint8Array(e);
}

function person(state: Record<string, unknown>) {
  const a = new Awareness(new Y.Doc());
  a.setLocalState(state);
  return a;
}

describe('the room stamps each connection’s role onto its awareness', () => {
  test('the socket’s role is stamped; a client-sent role is overwritten', async () => {
    const room = createRoom('role-stamp', callbacks());
    const heard: Uint8Array[] = [];
    const tc: RoomConn = { id: 't', role: 'member', send() {} };
    const pc: RoomConn = { id: 'p', role: 'viewer', send: (b) => heard.push(b) };
    await room.connect(tc);
    await room.connect(pc);
    const tereza = person({ name: 'Tereza' });
    const petra = person({ name: 'Petra', role: 'owner' }); // claims more than she holds
    room.receive(tc, frame(tereza));
    room.receive(pc, frame(petra));
    const states = room.awareness.getStates();
    expect(states.get(tereza.clientID)).toEqual({ name: 'Tereza', role: 'member' });
    expect(states.get(petra.clientID)).toEqual({ name: 'Petra', role: 'viewer' });
    // a later update keeps the stamp, whatever it says
    petra.setLocalState({ name: 'Petra', role: 'owner', artboard: 'post' });
    room.receive(pc, frame(petra));
    expect(room.awareness.getStates().get(petra.clientID)).toEqual({
      name: 'Petra',
      role: 'viewer',
      artboard: 'post',
    });
    await room.destroy();
  });

  test('a connection with no stamped role publishes none, even when the client sends one', async () => {
    const room = createRoom('role-none', callbacks());
    const c: RoomConn = { id: 'x', send() {} };
    await room.connect(c);
    const jonas = person({ name: 'Jonas', role: 'owner' });
    room.receive(c, frame(jonas));
    expect(room.awareness.getStates().get(jonas.clientID)).toEqual({ name: 'Jonas' });
    await room.destroy();
  });
});
