// T2.5 (#163) — accepted-replica mode is CONFIRMED as built (Michal): with `acceptedMode()` on, every persistent
// lane is the hub's to change (an editor's sync frame is refused), but an EDITOR socket's awareness passes to the
// room unstripped — its `holding` and `editing` included, because editors may hold and fix a caption word. The
// strips that apply in every mode still apply here: a read-only or lanes-closed socket loses both.
import { describe, expect, test } from 'bun:test';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { personHoldsOf } from '../collab/holds.ts';
import { createRoom, type RoomConn } from '../collab/room.ts';

const NOW = 1_800_000_000_000;
const HOLD = { artboard: 'post', element: 'hero-title', at: NOW - 1000 };
const EDITING = { since: NOW - 500 };

function awarenessFrame(state: Record<string, unknown>) {
  const a = new Awareness(new Y.Doc());
  a.setLocalState(state);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(a, [a.clientID]));
  return { frame: encoding.toUint8Array(e), clientID: a.clientID };
}

function syncUpdateFrame(): Uint8Array {
  const d = new Y.Doc();
  d.getMap('annotations').set('x', 1);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 0 /* MESSAGE_SYNC */);
  encoding.writeVarUint(e, 2 /* sync update */);
  encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(d));
  return encoding.toUint8Array(e);
}

async function inAcceptedRoom(name: string, conn: Partial<RoomConn>) {
  const room = createRoom(`accepted-${name}`, {
    seed() {},
    persistJson() {},
    persistBinary() {},
    acceptedMode: () => true,
  });
  const c: RoomConn = { id: `conn-${name}`, send() {}, ...conn };
  await room.connect(c);
  const { frame, clientID } = awarenessFrame({
    name,
    holding: HOLD,
    editing: EDITING,
    pointer: { x: 1, y: 2 },
  });
  room.receive(c, frame);
  const state = room.awareness.getStates().get(clientID) as Record<string, unknown>;
  const holds = personHoldsOf(
    { peek: () => room } as never,
    () => 'post',
    () => NOW
  )('.design/post.tsx');
  return { room, c, state, holds };
}

describe('accepted-replica mode: an editor socket’s awareness passes unstripped (confirmed, #163)', () => {
  test('holding and editing reach the room, and the hold denies the AI', async () => {
    const { room, state, holds } = await inAcceptedRoom('Eda', {});
    expect(state.holding).toEqual(HOLD);
    expect(state.editing).toEqual(EDITING);
    expect(state.pointer).toEqual({ x: 1, y: 2 });
    expect(holds).toEqual([{ canvas: '.design/post.tsx', element: 'hero-title', name: 'Eda' }]);
    await room.destroy();
  });

  test('its sync frames are still the hub’s: a lane write is refused', async () => {
    const { room, c } = await inAcceptedRoom('Eda2', {});
    room.receive(c, syncUpdateFrame());
    expect(room.doc.getMap('annotations').get('x')).toBeUndefined();
    await room.destroy();
  });

  test('a read-only socket still loses both in accepted mode', async () => {
    const { room, state, holds } = await inAcceptedRoom('Vera', { readOnly: true });
    expect('holding' in state).toBe(false);
    expect('editing' in state).toBe(false);
    expect(holds).toEqual([]);
    await room.destroy();
  });

  test('a lanes-closed socket still loses both in accepted mode', async () => {
    const { room, state } = await inAcceptedRoom('Lana', { lanesClosed: true });
    expect('holding' in state).toBe(false);
    expect('editing' in state).toBe(false);
    await room.destroy();
  });
});
