// p8-holding-strip — final-4 security recheck, info I1.
//
// `holding` (V2-1.15 §5.12) is editor-only in meaning: `personHoldsOf` reads every awareness state in
// a canvas room, and the agent route refuses an AI write to a held element as `soft-locked`. No strip
// set covered it, so a viewer (read-only socket), a lanes-closed socket or a format-gated session
// could keep refreshing a hold and block AI edits on one element at a time. `holding` is now in
// EDITOR_ONLY_FIELDS, so it falls into the read-only strip AND the format-gated strip. An editor's
// own hold still reaches the room.
// A presentation follower (outside the project) never receives anyone's hold either — nor the name
// the hub stamps onto it: `holding` is in MEMBER_ONLY_FIELDS too (`toFollower`).

import { describe, expect, test } from 'bun:test';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { personHoldsOf } from '../collab/holds.ts';
import { createRoom, type Room, type RoomConn, toFollower } from '../collab/room.ts';
import { EDITOR_ONLY_FIELDS, MEMBER_ONLY_FIELDS } from '../collab/timeline-awareness.ts';

const NOW = 1_800_000_000_000;
const HOLD = { artboard: 'post', element: 'hero-title', at: NOW - 1000 };

function awarenessFrame(state: Record<string, unknown>): { frame: Uint8Array; clientID: number } {
  const a = new Awareness(new Y.Doc());
  a.setLocalState(state);
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, 1 /* MESSAGE_AWARENESS */);
  encoding.writeVarUint8Array(e, encodeAwarenessUpdate(a, [a.clientID]));
  return { frame: encoding.toUint8Array(e), clientID: a.clientID };
}

async function publishHold(
  name: string,
  conn: Partial<RoomConn>,
  gated = false
): Promise<{ room: Room; state: Record<string, unknown>; holds: unknown[] }> {
  const room = createRoom(`holding-${name}`, {
    seed() {},
    persistJson() {},
    persistBinary() {},
    formatGated: () => gated,
  });
  const c: RoomConn = { id: `conn-${name}`, send() {}, ...conn };
  await room.connect(c);
  const { frame, clientID } = awarenessFrame({ name, holding: HOLD, pointer: { x: 1, y: 2 } });
  room.receive(c, frame);
  const state = room.awareness.getStates().get(clientID) as Record<string, unknown>;
  const holds = personHoldsOf(
    { peek: () => room } as never,
    () => 'post',
    () => NOW
  )('.design/post.tsx');
  return { room, state, holds };
}

describe('holding is an editor-only awareness field (I1)', () => {
  test('EDITOR_ONLY_FIELDS names holding', () => {
    expect(EDITOR_ONLY_FIELDS).toContain('holding');
    expect(EDITOR_ONLY_FIELDS).toContain('editing');
  });

  test('a read-only socket cannot hold an element', async () => {
    const { room, state, holds } = await publishHold('Vera', { readOnly: true });
    expect(state).toBeDefined();
    expect(state.name).toBe('Vera');
    expect('holding' in state).toBe(false);
    expect(holds).toEqual([]);
    await room.destroy();
  });

  test('a lanes-closed socket cannot hold an element', async () => {
    const { room, state, holds } = await publishHold('Lana', { lanesClosed: true });
    expect('holding' in state).toBe(false);
    expect(holds).toEqual([]);
    await room.destroy();
  });

  test('a format-gated session cannot hold an element (pointer stays)', async () => {
    const { room, state, holds } = await publishHold('Fero', {}, true);
    expect('holding' in state).toBe(false);
    expect(state.pointer).toEqual({ x: 1, y: 2 });
    expect(holds).toEqual([]);
    await room.destroy();
  });

  test("an editor's hold still reaches the room and denies the AI", async () => {
    const { room, state, holds } = await publishHold('Eda', {});
    expect(state.holding).toEqual(HOLD);
    expect(holds).toEqual([{ canvas: '.design/post.tsx', element: 'hero-title', name: 'Eda' }]);
    await room.destroy();
  });

  test("a canvas-realm editor conn's hold is not stripped", async () => {
    const { room, state } = await publishHold('Cleo', { realm: 'canvas' });
    expect(state.holding).toEqual(HOLD);
    await room.destroy();
  });
});

describe('studio and hub EDITOR_ONLY_FIELDS agree', () => {
  test('the hub twin (present-strip.mjs) names the same fields', async () => {
    const hub = (await import('../../hub/src/present-strip.mjs')) as {
      EDITOR_ONLY_FIELDS: readonly string[];
    };
    expect([...hub.EDITOR_ONLY_FIELDS]).toEqual([...EDITOR_ONLY_FIELDS]);
  });
});

describe('a presentation follower never receives a hold', () => {
  test('MEMBER_ONLY_FIELDS names holding', () => {
    expect(MEMBER_ONLY_FIELDS).toContain('holding');
  });

  test('toFollower drops holding (and its stamped actor), keeps the rest', () => {
    const held = { ...HOLD, actor: 'eda@example.com' };
    const { frame, clientID } = awarenessFrame({ name: 'Eda', holding: held, watching: 's1' });
    const out = toFollower(frame);
    expect(out).not.toBeNull();
    const dec = decoding.createDecoder(out as Uint8Array);
    expect(decoding.readVarUint(dec)).toBe(1 /* MESSAGE_AWARENESS */);
    const seen = new Awareness(new Y.Doc());
    applyAwarenessUpdate(seen, decoding.readVarUint8Array(dec), 'test');
    const state = seen.getStates().get(clientID) as Record<string, unknown>;
    expect(state).toBeDefined();
    expect('holding' in state).toBe(false);
    expect(state.name).toBe('Eda');
    expect(state.watching).toBe('s1');
  });
});
