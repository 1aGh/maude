// S3.7b — the studio room's relay strip for Present (S3-present-session §2, D11).
//
// In a cell every browser follower joins the STUDIO CHILD's room (the hub only
// sees the child's own provider), so this is the hop that keeps a read-only
// link session from steering followers: a read-only collab conn's awareness
// loses `present` and `pointer` before the room applies it; `watching` and the
// rest pass. A writable conn (an editor in a cell, every desktop tab — the
// Mac's own, readOnly false) is untouched, presenter-view audience included.

import { describe, expect, test } from 'bun:test';

import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { MESSAGE_AWARENESS } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';
import { stripPresenterAwareness } from '../present/relay-strip.ts';

const PRESENT = {
  v: 1,
  sid: 'abcdefgh12',
  index: 2,
  total: 14,
  artboardId: 'slide-3',
  seq: 7,
  media: null,
};
const POINTER = { x: 1, y: 2, artboardId: 'slide-3' };

function makeConn(id: string, opts: { realm?: 'main' | 'canvas'; readOnly?: boolean } = {}) {
  const recv: Uint8Array[] = [];
  const conn: RoomConn & { recv: Uint8Array[] } = {
    id,
    ...(opts.realm ? { realm: opts.realm } : {}),
    ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
    send(payload: Uint8Array) {
      recv.push(payload);
    },
    recv,
  };
  return conn;
}

const callbacks: RoomCallbacks = { seed() {}, persistJson() {}, persistBinary() {} };

/** One peer's awareness state as the frame its socket would send. */
function awarenessFrame(state: Record<string, unknown>): { frame: Uint8Array; clientID: number } {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState(state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
  const frame = encoding.toUint8Array(enc);
  const clientID = peer.clientID;
  peer.destroy();
  return { frame, clientID };
}

const full = () => ({
  user: { name: 'Vera' },
  present: PRESENT,
  pointer: POINTER,
  watching: 'zzzzzzzz',
});

describe('room relay strip — present / pointer from a read-only conn', () => {
  test('a read-only canvas conn’s forged present never reaches the room; watching does', async () => {
    const room = createRoom('present-strip-ro', callbacks);
    const viewer = makeConn('viewer', { realm: 'canvas', readOnly: true });
    await room.connect(viewer);
    const { frame, clientID } = awarenessFrame(full());
    room.receive(viewer, frame);
    expect(room.awareness.getStates().get(clientID)).toEqual({
      user: { name: 'Vera' },
      watching: 'zzzzzzzz',
    });
    await room.destroy();
  });

  test('an editor (writable canvas conn) and a desktop tab keep present + pointer', async () => {
    for (const opts of [{ realm: 'canvas' as const, readOnly: false }, {}]) {
      const room = createRoom(`present-strip-rw-${opts.realm ?? 'main'}`, callbacks);
      const editor = makeConn('editor', opts);
      await room.connect(editor);
      const { frame, clientID } = awarenessFrame(full());
      room.receive(editor, frame);
      expect(room.awareness.getStates().get(clientID)).toEqual(full());
      await room.destroy();
    }
  });
});

describe('stripPresenterAwareness (unit)', () => {
  test('a frame without the fields comes back byte-identical', () => {
    const { frame } = awarenessFrame({ user: { name: 'x' }, watching: 'abcdefgh' });
    expect(stripPresenterAwareness(frame)).toBe(frame);
  });
  test('a sync frame and a removal (null state) pass through untouched; a malformed awareness frame is dropped', () => {
    const sync = new Uint8Array([0, 0, 1, 0]);
    expect(stripPresenterAwareness(sync)).toBe(sync);
    const peer = new Awareness(new Y.Doc());
    peer.setLocalState(null);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
    const removal = encoding.toUint8Array(enc);
    expect(stripPresenterAwareness(removal)).toBe(removal);
    const junk = new Uint8Array([1, 200]);
    expect(stripPresenterAwareness(junk)).toBeNull();
  });
});
