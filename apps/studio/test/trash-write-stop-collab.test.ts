// S9.21b — a canvas trashed while a tab has it open takes no collab writes either
// (decision maude/v2-S9.21b-collab-stop-via-bus).
//
//   · the room reads a conn's `readOnly` / `lanesClosed` on EVERY frame, so ws.ts's getters (backed by the
//     `trash:write-stop` set) stop an already-open socket at once — comments included — while presence flows,
//     and a restored canvas takes writes again on the same socket;
//   · ws.ts keys the stopped set by the socket's own room slug (designRoot-relative stem → slug).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { encodeSyncUpdate, MESSAGE_AWARENESS } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';

const callbacks: RoomCallbacks = { seed() {}, persistJson() {}, persistBinary() {} };

function laneUpdate(lane: string, key: string): Uint8Array {
  const d = new Y.Doc();
  d.getMap(lane).set(key, `from-${lane}`);
  return encodeSyncUpdate(Y.encodeStateAsUpdate(d));
}

function awarenessFrame(state: Record<string, unknown>) {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState(state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
  const out = { frame: encoding.toUint8Array(enc), clientID: peer.clientID };
  peer.destroy();
  return out;
}

describe('a collab socket on a canvas trashed under it', () => {
  test('stops at the next frame, comments included; presence flows; Restore opens it again', async () => {
    const stopped = new Set<string>();
    const slug = 'ui-Combine-cisla';
    const recv: Uint8Array[] = [];
    // the shape ws.ts bindCollab builds: getters over the trash:write-stop set
    const editor: RoomConn = {
      id: 'tereza',
      get readOnly() {
        return stopped.has(slug);
      },
      get lanesClosed() {
        return stopped.has(slug);
      },
      send() {},
    };
    const peer: RoomConn = { id: 'jonas', send: (p: Uint8Array) => void recv.push(p) };
    const room = createRoom('trash-stop-room', callbacks);
    await room.connect(editor);
    await room.connect(peer);

    room.receive(editor, laneUpdate('main', 'before'));
    expect(room.doc.getMap('main').get('before')).toBe('from-main');

    stopped.add(slug); // the canvas went to the trash while the socket stayed open
    recv.length = 0;
    room.receive(editor, laneUpdate('main', 'during'));
    room.receive(editor, laneUpdate('comments', 'during'));
    expect(room.doc.getMap('main').has('during')).toBe(false);
    expect(room.doc.getMap('comments').has('during')).toBe(false);
    expect(room.gateRefusals()).toBe(2);
    const a = awarenessFrame({ user: { name: 'Tereza' } });
    room.receive(editor, a.frame);
    expect(room.awareness.getStates().get(a.clientID)).toEqual({ user: { name: 'Tereza' } });
    expect(recv.some((f) => f[0] === MESSAGE_AWARENESS)).toBe(true);

    stopped.delete(slug); // restored
    room.receive(editor, laneUpdate('main', 'after'));
    expect(room.doc.getMap('main').get('after')).toBe('from-main');
    await room.destroy();
  });

  test('ws.ts reads the stopped set per frame, keyed like the socket’s room', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'ws.ts'), 'utf8');
    expect(src.includes("ctx.bus.on('trash:write-stop'")).toBe(true);
    expect(
      /get readOnly\(\) \{\s*return readOnly \|\| lanesClosed \|\| trashStopped\.has\(slug\);/.test(
        src
      )
    ).toBe(true);
    expect(
      /get lanesClosed\(\) \{\s*return lanesClosed \|\| trashStopped\.has\(slug\);/.test(src)
    ).toBe(true);
    // the write stop's stems are designRoot-relative; the socket's room slug comes from the repo path
    expect(canvasSlugFromRel('ui/Combine-cisla.tsx', '.design')).toBe(
      canvasSlugFromRel('.design/ui/Combine-cisla.tsx', '.design')
    );
  });
});
