// p8-collab-epoch (decision v2-p8-collab-epoch) — the collab handshake epoch.
//
// A studio restart builds a NEW room doc (from `.ydoc.bin`, or from the files
// with fresh items when there is none). A page that stayed open (a tab, the
// canvas frame, a browser through a cell's proxy) still holds the previous
// instance's doc. Before this change it answered the new room's sync step 1
// with ALL of it: the old lineage merged in as new items — comments doubled,
// one deleted while the studio was down came back (the r10 cloud-lane red: a
// stale page "pushed an older Yjs doc that gained a copy per run").
//
// These tests run the REAL client session (use-collab.tsx, through
// CollabProvider) against a REAL room (collab/room.ts), bridged by an in-memory
// socket that delivers frames asynchronously like the network does.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync';
import * as Y from 'yjs';

import { createRoom, type Room, type RoomConn } from '../collab/room.ts';
import { CollabProvider, useCollab } from '../use-collab.tsx';

// ── The bridge: a fake WebSocket wired to whichever room is "the server" ────
let server: Room | null = null;
const open = new Set<BridgeWS>();
let nextId = 0;

class BridgeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  binaryType = 'arraybuffer';
  url: string;
  private handlers: Record<string, Array<(e: unknown) => void>> = {};
  private room: Room;
  private conn: RoomConn;
  constructor(url: string) {
    this.url = url;
    if (!server) throw new Error('no server up');
    this.room = server;
    const id = `c${++nextId}`;
    this.conn = {
      id,
      send: (p: Uint8Array) => {
        const copy = p.slice();
        queueMicrotask(() => {
          if (this.readyState === BridgeWS.OPEN) this.dispatch('message', { data: copy.buffer });
        });
      },
    };
    open.add(this);
    queueMicrotask(async () => {
      await this.room.connect(this.conn);
      this.readyState = BridgeWS.OPEN;
      this.dispatch('open', {});
    });
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const bucket = this.handlers[type] ?? [];
    bucket.push(fn);
    this.handlers[type] = bucket;
  }
  removeEventListener() {}
  send(p: Uint8Array) {
    const copy = new Uint8Array(p).slice();
    queueMicrotask(() => {
      if (this.readyState === BridgeWS.OPEN) this.room.receive(this.conn, copy);
    });
  }
  close() {
    if (this.readyState === BridgeWS.CLOSED) return;
    this.readyState = BridgeWS.CLOSED;
    open.delete(this);
    this.room.disconnect(this.conn);
    this.dispatch('close', {});
  }
  private dispatch(type: string, e: unknown) {
    for (const fn of this.handlers[type] ?? []) fn(e);
  }
}

const realWebSocket = globalThis.WebSocket;
const realFetch = globalThis.fetch;
beforeAll(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = BridgeWS;
  (globalThis as unknown as { fetch: unknown }).fetch = () =>
    Promise.resolve({ json: () => Promise.resolve({ name: 'Tester' }) });
});
afterAll(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = realWebSocket;
  (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function settle(ms = 30) {
  await act(async () => {
    await sleep(ms);
  });
}

type C = { id: string };
/** A studio instance. `seed` builds its room doc the way a boot does. */
function boot(epoch: string | undefined, seed: (doc: Y.Doc) => void): Room {
  return createRoom('board', {
    persistJson() {},
    persistBinary() {},
    seed: (_slug, doc) => seed(doc),
    ...(epoch !== undefined ? { epoch } : {}),
  });
}
/** Seeded from the files: fresh items every boot (no `.ydoc.bin`). */
const fromFiles =
  (...ids: string[]) =>
  (doc: Y.Doc) => {
    if (ids.length) doc.getArray<C>('comments').push(ids.map((id) => ({ id })));
  };
/** Seeded from the previous instance's `.ydoc.bin`: the same items. */
const fromCache = (state: Uint8Array) => (doc: Y.Doc) => Y.applyUpdate(doc, state);

/** Stop the studio: every socket drops (the page keeps its doc and reconnects in ~1 s). */
function stopServer(next: Room | null) {
  server = next;
  for (const ws of [...open]) ws.close();
}
const ids = (doc: Y.Doc) =>
  doc
    .getArray<C>('comments')
    .toArray()
    .map((c) => c.id);

// ── The page ────────────────────────────────────────────────────────────────
let captured: { doc: Y.Doc; clientID: number } | null = null;
function Probe() {
  const collab = useCollab();
  useEffect(() => {
    if (collab) captured = { doc: collab.doc, clientID: collab.awareness.clientID };
  });
  return null;
}
function mountPage(slug: string): Root {
  let root!: Root;
  const el = document.createElement('div');
  document.body.appendChild(el);
  act(() => {
    root = createRoot(el);
    root.render(createElement(CollabProvider, { slug }, createElement(Probe)));
  });
  return root;
}
type Session = {
  epoch: string | null;
  resyncs: number;
  unplaced: number;
  doc: Y.Doc;
  stop: () => void;
};
/** Close the page for good (no 4 s grace), so its session cannot reconnect into the next test. */
function endPage(root: Root, slug: string) {
  act(() => root.unmount());
  const map = (window as unknown as Record<symbol, Map<string, Session>>)[
    Symbol.for('maude.collab.sessions.v1')
  ];
  map?.get(slug)?.stop();
  map?.delete(slug);
}
function sessionOf(slug: string): Session {
  const map = (window as unknown as Record<symbol, Map<string, Session>>)[
    Symbol.for('maude.collab.sessions.v1')
  ];
  const s = map?.get(slug);
  if (!s) throw new Error(`no session for ${slug}`);
  return s;
}

describe('collab handshake epoch', () => {
  test('(a) a page that stayed open across a restart does not replay the old doc', async () => {
    server = boot('aA', fromFiles('c1', 'c2'));
    const roomA = server;
    const root = mountPage('epoch-a');
    await settle();
    expect(ids(captured?.doc as Y.Doc)).toEqual(['c1', 'c2']);
    const oldClient = captured?.clientID as number;

    // c2 is deleted on disk while the studio is down; the new instance has no
    // `.ydoc.bin` and seeds from the files — fresh items.
    const roomB = boot('aB', fromFiles('c1'));
    stopServer(roomB);
    await settle(1300);

    expect(ids(roomB.doc)).toEqual(['c1']); // no duplicate c1, no resurrected c2
    expect(ids(captured?.doc as Y.Doc)).toEqual(['c1']); // the page shows the server's state
    expect(sessionOf('epoch-a').resyncs).toBe(1);
    expect(sessionOf('epoch-a').epoch).toBe('aB');
    // The page's presence is in the new room under its fresh clientID only.
    const states = [...roomB.awareness.getStates().keys()];
    expect(states).toContain(captured?.clientID as number);
    expect(states).not.toContain(oldClient);
    endPage(root, 'epoch-a');
    await roomA.destroy();
    stopServer(null);
    await roomB.destroy();
  });

  test('(b) a fresh page joins normally; its live changes reach the room', async () => {
    server = boot('bB', fromFiles('c1'));
    const room = server;
    const root = mountPage('epoch-b');
    await settle();
    expect(ids(captured?.doc as Y.Doc)).toEqual(['c1']);
    const s = sessionOf('epoch-b');
    expect(s.epoch).toBe('bB');
    expect(s.resyncs).toBe(0);
    captured?.doc.getArray<C>('comments').push([{ id: 'live' }]);
    await settle();
    expect(ids(room.doc)).toEqual(['c1', 'live']);
    expect(room.epochRefusals()).toBe(0);
    endPage(root, 'epoch-b');
    stopServer(null);
    await room.destroy();
  });

  test('(b2) a reconnect to the SAME instance keeps the doc and delivers what changed meanwhile', async () => {
    server = boot('b2A', fromFiles('c1'));
    const room = server;
    const root = mountPage('epoch-b2');
    await settle();
    stopServer(room); // the socket drops (a proxy blip); the studio is still up
    captured?.doc.getArray<C>('comments').push([{ id: 'while-down' }]);
    await settle(1300);
    expect(ids(room.doc)).toEqual(['c1', 'while-down']);
    expect(sessionOf('epoch-b2').resyncs).toBe(0);
    endPage(root, 'epoch-b2');
    stopServer(null);
    await room.destroy();
  });

  test('(c) changes made while the studio was down survive the fresh join, once', async () => {
    server = boot('cA', fromFiles('c1', 'c2'));
    const roomA = server;
    const root = mountPage('epoch-c');
    await settle();
    // A change sent live under epochA reaches roomA (and so its `.ydoc.bin`).
    captured?.doc.getArray<C>('comments').push([{ id: 'sent' }]);
    await settle();
    expect(ids(roomA.doc)).toEqual(['c1', 'c2', 'sent']);

    // The restart restores roomA's cache — same items, a new epoch.
    const roomB = boot('cB', fromCache(Y.encodeStateAsUpdate(roomA.doc)));
    stopServer(roomB);
    // Made while no studio was up: no server ever received it.
    captured?.doc.getArray<C>('comments').push([{ id: 'unsent' }]);
    await settle(1300);

    expect(sessionOf('epoch-c').resyncs).toBe(1);
    expect(ids(roomB.doc)).toEqual(['c1', 'c2', 'sent', 'unsent']);
    expect(ids(captured?.doc as Y.Doc)).toEqual(['c1', 'c2', 'sent', 'unsent']);
    expect(sessionOf('epoch-c').unplaced).toBe(0);
    endPage(root, 'epoch-c');
    await roomA.destroy();
    stopServer(null);
    await roomB.destroy();
  });

  test('(c2) an unsent change that hangs off content the new instance lacks is kept, not replayed', async () => {
    server = boot('c2A', fromFiles('c1'));
    const roomA = server;
    const root = mountPage('epoch-c2');
    await settle();
    const roomB = boot('c2B', fromFiles('c1')); // fresh items: nothing to hang off
    stopServer(roomB);
    captured?.doc.getArray<C>('comments').push([{ id: 'after-old-c1' }]);
    await settle(1300);
    expect(ids(roomB.doc)).toEqual(['c1']); // the old lineage stays out
    expect(sessionOf('epoch-c2').unplaced).toBe(1); // the page says so, quietly
    endPage(root, 'epoch-c2');
    await roomA.destroy();
    stopServer(null);
    await roomB.destroy();
  });

  test('(d) a peer that sends no epoch (1.x) reads the room but never writes its doc into it', async () => {
    server = boot('dA', fromFiles('c1'));
    const roomA = server;
    // A 1.x page: plain y-websocket wire, no claim. It synced with roomA's
    // lineage through some earlier instance.
    const old = new Y.Doc();
    Y.applyUpdate(old, Y.encodeStateAsUpdate(roomA.doc));
    old.getArray<C>('comments').push([{ id: 'old-page' }]);
    const roomB = boot('dB', fromFiles('c1'));
    server = roomB;
    await roomA.destroy();

    const got: Uint8Array[] = [];
    const conn: RoomConn = { id: 'legacy', send: (p) => got.push(p.slice()) };
    await roomB.connect(conn);
    const step1 = encoding.createEncoder();
    encoding.writeVarUint(step1, 0);
    writeSyncStep1(step1, old);
    roomB.receive(conn, encoding.toUint8Array(step1));
    const replay = encoding.createEncoder();
    encoding.writeVarUint(replay, 0);
    writeUpdate(replay, Y.encodeStateAsUpdate(old));
    roomB.receive(conn, encoding.toUint8Array(replay));
    const aw = new Awareness(old);
    aw.setLocalState({ name: 'Old page' });
    const awe = encoding.createEncoder();
    encoding.writeVarUint(awe, 1);
    encoding.writeVarUint8Array(awe, encodeAwarenessUpdate(aw, [aw.clientID]));
    roomB.receive(conn, encoding.toUint8Array(awe));

    expect(ids(roomB.doc)).toEqual(['c1']); // nothing replayed
    expect(roomB.epochRefusals()).toBe(1);
    expect(roomB.awareness.getStates().has(aw.clientID)).toBe(true); // presence still shows
    // It was answered: the room's state reached it (a 1.x page keeps reading).
    const reader = new Y.Doc();
    for (const frame of got) {
      const d = decoding.createDecoder(frame);
      const type = decoding.readVarUint(d);
      if (type === 0) readSyncMessage(d, encoding.createEncoder(), reader, null);
      if (type === 1)
        applyAwarenessUpdate(new Awareness(reader), decoding.readVarUint8Array(d), null);
    }
    expect(ids(reader)).toEqual(['c1']);
    aw.destroy();
    await roomB.destroy();
    server = null;
  });

  test('a mismatched claim alone (no reset yet) writes nothing and hears nothing', async () => {
    const room = boot('epochB', fromFiles('c1'));
    const got: Uint8Array[] = [];
    const conn: RoomConn = { id: 'stale', send: (p) => got.push(p.slice()) };
    await room.connect(conn);
    const claim = encoding.createEncoder();
    encoding.writeVarUint(claim, 64);
    encoding.writeVarUint(claim, 0);
    encoding.writeVarString(claim, 'epochA');
    room.receive(conn, encoding.toUint8Array(claim));
    const stale = new Y.Doc();
    stale.getArray<C>('comments').push([{ id: 'stale' }]);
    const up = encoding.createEncoder();
    encoding.writeVarUint(up, 0);
    writeUpdate(up, Y.encodeStateAsUpdate(stale));
    room.receive(conn, encoding.toUint8Array(up));
    expect(ids(room.doc)).toEqual(['c1']);
    const before = got.length;
    room.doc.getArray<C>('comments').push([{ id: 'other' }]);
    expect(got.length).toBe(before); // a stale peer is not broadcast to
    await room.destroy();
  });

  test('a room without an epoch (pre-epoch callers) behaves as before', async () => {
    const room = boot(undefined, fromFiles('c1'));
    const got: Uint8Array[] = [];
    const conn: RoomConn = { id: 'plain', send: (p) => got.push(p.slice()) };
    await room.connect(conn);
    expect(got.some((f) => f[0] === 0)).toBe(true); // sync step 1 at connect, as before
    const peer = new Y.Doc();
    peer.getArray<C>('comments').push([{ id: 'p' }]);
    const up = encoding.createEncoder();
    encoding.writeVarUint(up, 0);
    writeUpdate(up, Y.encodeStateAsUpdate(peer));
    room.receive(conn, encoding.toUint8Array(up));
    expect(ids(room.doc).sort()).toEqual(['c1', 'p']);
    await room.destroy();
  });
});
