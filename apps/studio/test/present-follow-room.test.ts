// S3.7c — a presentation follower is receive-only in the studio room
// (lead decision `v2-lead-cloud-follow-capability`).
//
// The hub's canvas door opens a follower's collab socket on the `follow`
// capability and injects `x-maude-collab-follow: 1` (apps/hub/src/
// follow-capability.mjs); the canvas listener stamps the conn `follow`. The
// room then:
//   - answers its sync step 1 (it receives the doc and every update),
//   - drops EVERY sync update from it — body lanes AND the comment lane,
//   - reduces its awareness to `{ watching }` (on top of the present/pointer strip),
// while the presenter's `present` still reaches it. A read-only conn that is
// not a follower keeps today's behaviour (comments pass).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import {
  encodeEpochClaim,
  encodeSyncUpdate,
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
} from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';
import { stripToWatching } from '../present/relay-strip.ts';
import {
  A_REL,
  type AclCell,
  asUser,
  bootAclCell,
  frameCap,
  OWNER,
  until,
  withFc,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const PRESENT = {
  v: 1,
  sid: 'abcdefgh12',
  index: 2,
  total: 14,
  artboardId: 's3',
  seq: 7,
  media: null,
};
const callbacks: RoomCallbacks = { seed() {}, persistJson() {}, persistBinary() {} };

function makeConn(id: string, opts: Partial<RoomConn> = {}) {
  const recv: Uint8Array[] = [];
  const conn: RoomConn & { recv: Uint8Array[] } = {
    id,
    ...opts,
    send(payload: Uint8Array) {
      recv.push(payload);
    },
    recv,
  };
  return conn;
}

function awarenessFrame(state: Record<string, unknown> | null) {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState(state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
  const out = { frame: encoding.toUint8Array(enc), clientID: peer.clientID };
  peer.destroy();
  return out;
}

/** A sync update writing `lane` (a Y.Map) — `comments` or a body lane. */
function laneUpdate(lane: string): Uint8Array {
  const d = new Y.Doc();
  d.getMap(lane).set('k', `from-${lane}`);
  return encodeSyncUpdate(Y.encodeStateAsUpdate(d));
}

/** A sync step 2 carrying the same write (a peer answering the server's step 1). */
function laneStep2(lane: string): Uint8Array {
  const d = new Y.Doc();
  d.getMap(lane).set('k', `from-${lane}`);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(enc, d);
  return encoding.toUint8Array(enc);
}

function step1(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, new Y.Doc());
  return encoding.toUint8Array(enc);
}

const FOLLOWER = { realm: 'canvas' as const, readOnly: true, follow: true };
const FULL = {
  user: { name: 'Vera', color: '#f00' },
  cursor: { x: 1, y: 2 },
  present: PRESENT,
  watching: 'abcdefgh12',
};

describe('the room — a follower conn is receive-only', () => {
  test('every sync write from a follower is dropped: body lanes, comments, step 2', async () => {
    const room = createRoom('follow-drop', callbacks);
    const follower = makeConn('f', FOLLOWER);
    const other = makeConn('o');
    await room.connect(follower);
    await room.connect(other);
    other.recv.length = 0;
    for (const frame of [
      laneUpdate('comments'),
      laneUpdate('annotations'),
      laneStep2('comments'),
    ]) {
      room.receive(follower, frame);
    }
    expect(room.doc.getMap('comments').size).toBe(0);
    expect(room.doc.getMap('annotations').size).toBe(0);
    expect(other.recv.length).toBe(0);
    await room.destroy();
  });

  test('a read-only conn that is NOT a follower still writes the comment lane (unchanged)', async () => {
    const room = createRoom('follow-ro-control', callbacks);
    const viewer = makeConn('v', { realm: 'canvas', readOnly: true });
    await room.connect(viewer);
    room.receive(viewer, laneUpdate('comments'));
    expect(room.doc.getMap('comments').get('k')).toBe('from-comments');
    await room.destroy();
  });

  test('its sync step 1 is answered with the doc; it hears later updates', async () => {
    const room = createRoom('follow-recv', callbacks);
    room.doc.getMap('comments').set('seed', 1);
    const follower = makeConn('f', FOLLOWER);
    const editor = makeConn('e');
    await room.connect(follower);
    await room.connect(editor);
    follower.recv.length = 0;
    room.receive(follower, step1());
    expect(follower.recv.length).toBe(1);
    const mirror = new Y.Doc();
    const dec = decoding.createDecoder(follower.recv[0] as Uint8Array);
    expect(decoding.readVarUint(dec)).toBe(MESSAGE_SYNC);
    syncProtocol.readSyncMessage(dec, encoding.createEncoder(), mirror, null);
    expect(mirror.getMap('comments').get('seed')).toBe(1);
    follower.recv.length = 0;
    room.receive(editor, laneUpdate('annotations'));
    expect(follower.recv.length).toBeGreaterThan(0);
    await room.destroy();
  });

  test('its awareness reaches the room as { watching } only; the presenter’s present reaches it', async () => {
    const room = createRoom('follow-aw', callbacks);
    const follower = makeConn('f', FOLLOWER);
    const presenter = makeConn('p');
    await room.connect(follower);
    await room.connect(presenter);
    const f = awarenessFrame(FULL);
    room.receive(follower, f.frame);
    expect(room.awareness.getStates().get(f.clientID)).toEqual({ watching: 'abcdefgh12' });
    const p = awarenessFrame({ user: { name: 'Pia' }, present: PRESENT });
    follower.recv.length = 0;
    room.receive(presenter, p.frame);
    expect(room.awareness.getStates().get(p.clientID)).toEqual({
      user: { name: 'Pia' },
      present: PRESENT,
    });
    expect(follower.recv.length).toBeGreaterThan(0);
    await room.destroy();
  });
});

describe('stripToWatching (unit)', () => {
  test('keeps a valid sid only; junk watching → {}; a removal passes; a sync frame passes; junk is dropped', () => {
    const decodeOne = (frame: Uint8Array) => {
      const dec = decoding.createDecoder(frame);
      decoding.readVarUint(dec);
      const inner = decoding.createDecoder(decoding.readVarUint8Array(dec));
      decoding.readVarUint(inner);
      decoding.readVarUint(inner);
      decoding.readVarUint(inner);
      return JSON.parse(decoding.readVarString(inner));
    };
    expect(decodeOne(stripToWatching(awarenessFrame(FULL).frame) as Uint8Array)).toEqual({
      watching: 'abcdefgh12',
    });
    expect(
      decodeOne(stripToWatching(awarenessFrame({ watching: '<script>' }).frame) as Uint8Array)
    ).toEqual({});
    expect(decodeOne(stripToWatching(awarenessFrame(null).frame) as Uint8Array)).toBeNull();
    const sync = new Uint8Array([0, 0, 1, 0]);
    expect(stripToWatching(sync)).toBe(sync);
    expect(stripToWatching(new Uint8Array([1, 200]))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The canvas listener stamps the conn from the proxy's injected header.

const A_SLUG = canvasSlugFromRel(A_REL, '.design');
// A Can comment member of A (`viewer`). Since gate-b-c4i a Can view (`observer`) socket writes no
// comment at all, so only a Can comment socket shows what the follow mark suppresses.
const A_COMMENTER: Record<string, string> = {
  'x-maude-access': Buffer.from(
    JSON.stringify({ v: 1, role: null, grants: [{ c: A_REL, r: 'viewer' }] })
  ).toString('base64url'),
  'x-maude-role': 'viewer',
  'x-maude-readonly': '1',
};

interface BinSocket {
  ws: WebSocket;
  frames: Uint8Array[];
}

async function openBin(url: string, headers: Record<string, string>): Promise<BinSocket | null> {
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  ws.binaryType = 'arraybuffer';
  const frames: Uint8Array[] = [];
  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) frames.push(new Uint8Array(e.data));
  });
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    const done = (v: boolean) => () => {
      clearTimeout(t);
      resolve(v);
    };
    ws.addEventListener('open', done(true));
    ws.addEventListener('error', done(false));
    ws.addEventListener('close', done(false));
  });
  // p8-collab-epoch — a current client claims first ('' = a doc that never synced).
  if (ok && url.includes('/_ws/collab/')) ws.send(encodeEpochClaim(''));
  return ok ? { ws, frames } : null;
}

const isSync = (f: Uint8Array) => f[0] === MESSAGE_SYNC;

describe('booted cell — canvas listener', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test('a follow-marked socket’s comment write never reaches a peer; an unmarked one’s does', async () => {
    const base = `${cell.canvasBase.replace('http', 'ws')}/_ws/collab/${A_SLUG}`;
    // gate-b-c4: a canvas-listener socket answers as a frame narrowed to its canvas, so each one
    // carries the capability the shell appends (`?fc=`); frameless it is refused before the room.
    const open = async (headers: Record<string, string>, user: string) => {
      const as = asUser(headers, user); // the frame key's subject is the proxy-vouched user
      return openBin(withFc(base, await frameCap(cell, as, A_REL)), as);
    };
    const owner = await open(OWNER, 'owner@example.com');
    const follower = await open(
      { ...A_COMMENTER, 'x-maude-collab-follow': '1' },
      'commenter@example.com'
    );
    expect(owner).not.toBeNull();
    expect(follower).not.toBeNull();
    if (!owner || !follower) return;
    await Bun.sleep(300);
    owner.frames.length = 0;
    follower.ws.send(laneUpdate('comments'));
    await Bun.sleep(600);
    expect(owner.frames.filter(isSync).length).toBe(0);
    // control: the same claim WITHOUT the follow mark is today's read-only conn — comments pass
    const viewer = await open(A_COMMENTER, 'commenter@example.com');
    expect(viewer).not.toBeNull();
    if (!viewer) return;
    await Bun.sleep(300);
    owner.frames.length = 0;
    const d = new Y.Doc();
    d.getMap('comments').set('k2', 'v');
    viewer.ws.send(encodeSyncUpdate(Y.encodeStateAsUpdate(d)));
    expect(await until(() => owner.frames.some(isSync), 3000)).toBe(true);
    for (const s of [owner, follower, viewer]) s.ws.close();
  });
});
