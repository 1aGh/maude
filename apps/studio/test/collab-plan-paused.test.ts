// S9.15c — a paused project refuses comments on the studio's sockets too
// (lead decision `maude/v2-lead-paused-comments-refused`).
//
// While a trial project is paused the hub's proxy forwards the studio's sockets
// with `x-maude-readonly: plan` (S9.15b sent `1`). `1` keeps meaning what it
// always meant — read-only BY ROLE, where the comment lane stays writable (Can
// comment). Any other value (`plan`, or one this studio does not know) is the
// stricter "no writable lanes" mode: every lane update from the client is
// dropped, comments included, on the collab socket AND on the inspector socket
// (`comments-add`), while reading and presence stay live. An older studio reads
// `plan` as "not `0`" = read-only by role: no worse than before.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { lanesClosedFromProxy } from '../access/request.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { encodeSyncUpdate, MESSAGE_AWARENESS, MESSAGE_SYNC } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';
import {
  A_REL,
  type AclCell,
  asUser,
  bootAclCell,
  frameCap,
  MEMBER,
  OWNER,
  until,
  VIEWER,
  withFc,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

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

function laneUpdate(lane: string, key = 'k'): Uint8Array {
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

describe('the readonly projection (unit)', () => {
  test('`0` and `1` keep a lane open; `plan`, an unknown value or none closes every lane', () => {
    const h = (v?: string) => new Headers(v === undefined ? {} : { 'x-maude-readonly': v });
    expect(lanesClosedFromProxy(h('0'))).toBe(false);
    expect(lanesClosedFromProxy(h('1'))).toBe(false);
    for (const v of ['plan', 'paused', '2', 'true', '', undefined])
      expect(lanesClosedFromProxy(h(v))).toBe(true);
  });
});

describe('room — no writable lanes (unit)', () => {
  test('a lanes-closed conn’s comment never lands nor reaches a peer; presence does', async () => {
    const room = createRoom('paused-comments', callbacks);
    const owner = makeConn('owner');
    const paused = makeConn('paused', { realm: 'canvas', readOnly: true, lanesClosed: true });
    await room.connect(owner);
    await room.connect(paused);
    owner.recv.length = 0;

    room.receive(paused, laneUpdate('comments'));
    expect(room.doc.getMap('comments').size).toBe(0);
    expect(room.gateRefusals()).toBe(1);
    expect(owner.recv.length).toBe(0);

    const a = awarenessFrame({ user: { name: 'Pat' }, cursor: { x: 1, y: 2 } });
    room.receive(paused, a.frame);
    expect(room.awareness.getStates().get(a.clientID)).toEqual({
      user: { name: 'Pat' },
      cursor: { x: 1, y: 2 },
    });
    expect(owner.recv.some((f) => f[0] === MESSAGE_AWARENESS)).toBe(true);
    await room.destroy();
  });

  test('lanes closed even without readOnly (defence in depth); a role read-only conn still comments', async () => {
    const room = createRoom('paused-main', callbacks);
    const closed = makeConn('closed', { lanesClosed: true });
    const viewer = makeConn('viewer', { realm: 'canvas', readOnly: true });
    await room.connect(closed);
    await room.connect(viewer);
    room.receive(closed, laneUpdate('comments', 'a'));
    expect(room.doc.getMap('comments').size).toBe(0);
    room.receive(viewer, laneUpdate('comments', 'b'));
    expect(room.doc.getMap('comments').get('b')).toBe('from-comments');
    await room.destroy();
  });
});

// ---------------------------------------------------------------------------
// A booted cell: the listeners stamp the conn from the proxy's projection.

const A_SLUG = canvasSlugFromRel(A_REL, '.design');
const PAUSED_MEMBER = { ...MEMBER, 'x-maude-readonly': 'plan' };
const PAUSED_VIEWER = { ...VIEWER, 'x-maude-readonly': 'plan' };

interface BinSocket {
  ws: WebSocket;
  frames: Uint8Array[];
  texts: string[];
}

async function openSocket(url: string, headers: Record<string, string>): Promise<BinSocket | null> {
  const ws = new WebSocket(url, { headers } as unknown as string[]);
  ws.binaryType = 'arraybuffer';
  const frames: Uint8Array[] = [];
  const texts: string[] = [];
  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) frames.push(new Uint8Array(e.data));
    else if (typeof e.data === 'string') texts.push(e.data);
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
  return ok ? { ws, frames, texts } : null;
}

const isSync = (f: Uint8Array) => f[0] === MESSAGE_SYNC;
const isAwareness = (f: Uint8Array) => f[0] === MESSAGE_AWARENESS;

describe('booted cell — paused sockets', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  // gate-b-c4 — a canvas-origin socket is opened by a canvas FRAME, so it carries that frame's
  // capability (`?fc=`, minted under the session's own vouched member — the frame key's subject).
  // Each identity below is its own member with its own capability for A; the main origin needs none.
  const sessions = {
    owner: asUser(OWNER, 'owner@example.com'),
    paused: asUser(PAUSED_MEMBER, 'paused@example.com'),
    viewer: asUser(VIEWER, 'viewer@example.com'),
  };
  async function openAs(origin: 'canvas' | 'main', who: keyof typeof sessions) {
    const headers = sessions[who];
    const base = origin === 'canvas' ? cell.canvasBase : cell.base;
    const url = `${base.replace('http', 'ws')}/_ws/collab/${A_SLUG}`;
    if (origin === 'main') return openSocket(url, headers);
    return openSocket(withFc(url, await frameCap(cell, headers, A_REL)), headers);
  }

  test('canvas collab: a socket opened outside a frame (no `fc`) is refused', async () => {
    const url = `${cell.canvasBase.replace('http', 'ws')}/_ws/collab/${A_SLUG}`;
    expect(await openSocket(url, sessions.owner)).toBeNull();
  });

  for (const origin of ['canvas', 'main'] as const) {
    test(`${origin} collab: a paused member’s comment never reaches a peer; its presence does`, async () => {
      const owner = await openAs(origin, 'owner');
      const paused = await openAs(origin, 'paused');
      expect(owner).not.toBeNull();
      expect(paused).not.toBeNull();
      if (!owner || !paused) return;
      await Bun.sleep(300);
      owner.frames.length = 0;
      paused.ws.send(laneUpdate('comments', `paused-${origin}`));
      await Bun.sleep(600);
      expect(owner.frames.filter(isSync).length).toBe(0);
      // presence stays live
      paused.ws.send(awarenessFrame({ user: { name: 'Pat' } }).frame);
      expect(await until(() => owner.frames.some(isAwareness), 3000)).toBe(true);
      // control: a Can comment viewer on an unpaused project still comments over collab
      const viewer = await openAs(origin, 'viewer');
      expect(viewer).not.toBeNull();
      if (!viewer) return;
      await Bun.sleep(300);
      owner.frames.length = 0;
      viewer.ws.send(laneUpdate('comments', `viewer-${origin}`));
      expect(await until(() => owner.frames.some(isSync), 3000)).toBe(true);
      for (const s of [owner, paused, viewer]) s.ws.close();
    });
  }

  test('inspector: a paused session’s comments-add is refused and never stored', async () => {
    const url = `${cell.base.replace('http', 'ws')}/_ws`;
    const sidecar = join(cell.designRoot, '_comments', `${A_SLUG}.json`);
    const read = (): Array<{ text?: string }> => {
      try {
        const j = JSON.parse(readFileSync(sidecar, 'utf8'));
        return Array.isArray(j) ? j : (j.comments ?? []);
      } catch {
        return [];
      }
    };
    const add = (text: string) =>
      JSON.stringify({
        type: 'comments-add',
        payload: { file: `.design/${A_REL}`, selector: 'img', text },
      });
    const paused = await openSocket(url, PAUSED_VIEWER);
    expect(paused).not.toBeNull();
    if (!paused) return;
    paused.ws.send(add('paused note'));
    expect(
      await until(
        () => paused.texts.some((t) => t.includes('"refused"') && t.includes('plan')),
        3000
      )
    ).toBe(true);
    expect(read().some((c) => c.text === 'paused note')).toBe(false);
    // control: the same viewer on an unpaused project still comments
    const viewer = await openSocket(url, VIEWER);
    expect(viewer).not.toBeNull();
    if (!viewer) return;
    viewer.ws.send(add('viewer note'));
    expect(await until(() => read().some((c) => c.text === 'viewer note'), 5000)).toBe(true);
    expect(read().some((c) => c.text === 'paused note')).toBe(false);
    for (const s of [paused, viewer]) s.ws.close();
  });
});
