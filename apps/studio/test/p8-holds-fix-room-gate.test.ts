// p8-holds-fix — the format gate on collab sockets, two leftovers from the V2-8.9 final-3 recheck.
//
// Info A: under `formatGated` the room refused every sync lane but passed awareness untouched, so a
// view-only session could still claim a caption word (`editing`, which needs `edit`). The editing
// claim is stripped under the gate; `present`/`pointer` stay (the HTTP gate does not restrict them).
// Info B: `formatGate` reads a file, and the room asked it up to three times per gated sync frame.
// It is asked once per frame now.

import { describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { encodeSyncUpdate } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';

function awarenessFrame(state: Record<string, unknown>): { frame: Uint8Array; clientID: number } {
  const a = new Awareness(new Y.Doc());
  a.setLocalState(state);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(a, [a.clientID]));
  return { frame: encoding.toUint8Array(e), clientID: a.clientID };
}

const conn = (id: string): RoomConn => ({ id, send() {} });

describe('room — the format gate and awareness (Info A)', () => {
  test('a gated session keeps presence and pointer but cannot claim a caption word', async () => {
    const callbacks: RoomCallbacks = {
      seed() {},
      persistJson() {},
      persistBinary() {},
      formatGated: () => true,
    };
    const room = createRoom('gated-awareness', callbacks);
    const c = conn('viewer-by-format');
    await room.connect(c);
    const { frame, clientID } = awarenessFrame({
      name: 'Jonas',
      present: { artboard: 'post' },
      pointer: { x: 1, y: 2 },
      editing: { since: 1, kind: 'caption', artboardId: 'post', wordKey: 'w1' },
    });
    room.receive(c, frame);
    const state = room.awareness.getStates().get(clientID) as Record<string, unknown>;
    expect(state).toBeDefined();
    expect(state.editing).toBeUndefined();
    expect(state.present).toEqual({ artboard: 'post' });
    expect(state.pointer).toEqual({ x: 1, y: 2 });
    await room.destroy();
  });

  test('without the gate the same session keeps its editing claim', async () => {
    const room = createRoom('ungated-awareness', {
      seed() {},
      persistJson() {},
      persistBinary() {},
      formatGated: () => false,
    });
    const c = conn('editor');
    await room.connect(c);
    const editing = { since: 1, kind: 'caption', artboardId: 'post', wordKey: 'w1' };
    const { frame, clientID } = awarenessFrame({ name: 'Tereza', editing });
    room.receive(c, frame);
    const state = room.awareness.getStates().get(clientID) as Record<string, unknown>;
    expect(state.editing).toEqual(editing);
    await room.destroy();
  });
});

describe('room — the format gate is asked once per frame (Info B)', () => {
  test('a refused sync frame and an awareness frame each read the gate once', async () => {
    let asked = 0;
    const room = createRoom('gate-once', {
      seed() {},
      persistJson() {},
      persistBinary() {},
      formatGated: () => {
        asked += 1;
        return true;
      },
    });
    const c = conn('editor');
    await room.connect(c);
    asked = 0;
    const d = new Y.Doc();
    d.getMap('comments').set('k', 'v');
    room.receive(c, encodeSyncUpdate(Y.encodeStateAsUpdate(d)));
    expect(room.gateRefusals()).toBe(1);
    expect(asked).toBe(1);
    asked = 0;
    room.receive(c, awarenessFrame({ name: 'Jonas' }).frame);
    expect(asked).toBe(1);
    await room.destroy();
  });
});
