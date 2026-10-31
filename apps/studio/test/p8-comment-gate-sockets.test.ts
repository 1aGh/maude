// p8-comment-gate (final-3 attacker L4, decision `v2-p8-comment-gate-socket-lanes`) — the format gate
// covers every comment write, not only the HTTP door.
//
// `formatGateAllowsWrite` (format.ts) refuses `/_api/comments/op` while this build does not edit the
// project's format. The same comment writes also reach the design root over two sockets: the inspector
// socket's `comments-add` / `comments-patch` / `comments-delete` (canvas code in the active frame can post
// `dgn:'comment-submit'` and the shell relays it as `comments-add`) and the collab room's `comments` lane.
// Both stamped their gates from the ROLE only, so an editor's socket on a view-only project still wrote.
// The gate is read per frame: "Update project" lifts it while the sockets stay open, and a socket opened
// before that click honours the new state.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';
import * as Y from 'yjs';

import { canvasSlugFromRel } from '../canvas-slug.ts';
import { encodeEpochClaim, encodeSyncUpdate, MESSAGE_SYNC } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';
import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

function commentLane(key: string): Uint8Array {
  const d = new Y.Doc();
  d.getMap('comments').set(key, `note-${key}`);
  return encodeSyncUpdate(Y.encodeStateAsUpdate(d));
}

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

describe('room — the format gate closes every lane, per frame (unit)', () => {
  test('an editor conn writes no lane while gated; the same conn writes once the gate lifts, and stops when it returns', async () => {
    let gated = true;
    const callbacks: RoomCallbacks = {
      seed() {},
      persistJson() {},
      persistBinary() {},
      formatGated: () => gated,
    };
    const room = createRoom('format-gated', callbacks);
    const editor = makeConn('editor'); // main realm, not read-only, lanes open: an owner's shell
    const peer = makeConn('peer');
    await room.connect(editor);
    await room.connect(peer);
    peer.recv.length = 0;

    room.receive(editor, commentLane('a'));
    expect(room.doc.getMap('comments').size).toBe(0);
    const body = new Y.Doc();
    body.getText('source').insert(0, 'x');
    room.receive(editor, encodeSyncUpdate(Y.encodeStateAsUpdate(body)));
    expect(room.doc.getText('source').length).toBe(0);
    expect(room.gateRefusals()).toBe(2);
    expect(peer.recv.some((f) => f[0] === MESSAGE_SYNC)).toBe(false);

    gated = false; // "Update project" — the conn was opened before it
    room.receive(editor, commentLane('b'));
    expect(room.doc.getMap('comments').get('b')).toBe('note-b');

    gated = true; // the other direction (a hub raised the format under an open socket)
    room.receive(editor, commentLane('c'));
    expect(room.doc.getMap('comments').has('c')).toBe(false);
    await room.destroy();
  });
});

// ---------------------------------------------------------------------------
// A booted desktop studio on a format-1 project: view only until "Update project".

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(async () => {
  if (proc) await killProc(proc);
  if (box) rmSync(box.root, { recursive: true, force: true });
  proc = null;
  box = null;
});

const CARD = '.design/ui/card.tsx';
const SLUG = canvasSlugFromRel(CARD, '.design');

async function bootFormat1() {
  box = makeSandbox();
  const cfgPath = path.join(box.designRoot, 'config.json');
  const { formatVersion: _drop, ...cfg } = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  writeFileSync(
    path.join(box.designRoot, 'ui', 'card.tsx'),
    'export default function C() { return null; }\n'
  );
  writeFileSync(path.join(box.designRoot, 'ui', 'card.meta.json'), '{"layout":{"artboards":[]}}\n');
  // one existing note, for patch / delete
  const { mkdirSync } = await import('node:fs');
  mkdirSync(path.join(box.designRoot, '_comments'), { recursive: true });
  writeFileSync(
    path.join(box.designRoot, '_comments', `${SLUG}.json`),
    JSON.stringify([
      {
        id: 'c-seed',
        file: CARD,
        selector: 'img',
        text: 'seed note',
        status: 'open',
        created_at: '2026-10-30T10:00:00.000Z',
      },
    ])
  );
  const port = nextPort();
  proc = await bootServer(box.root, port, { MAUDE_NO_AUTOBUILD: '1', NO_OPEN: '1' });
  const base = `http://localhost:${port}`;
  return { base, port };
}

const sidecar = () => path.join(box!.designRoot, '_comments', `${SLUG}.json`);
const notes = (): Array<{ id?: string; text?: string; status?: string }> => {
  try {
    const j = JSON.parse(readFileSync(sidecar(), 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
};

interface Sock {
  ws: WebSocket;
  frames: Uint8Array[];
  texts: string[];
}
async function open(url: string): Promise<Sock> {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const frames: Uint8Array[] = [];
  const texts: string[] = [];
  ws.addEventListener('message', (e) => {
    if (e.data instanceof ArrayBuffer) frames.push(new Uint8Array(e.data));
    else if (typeof e.data === 'string') texts.push(e.data);
  });
  const ok = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    ws.addEventListener('open', () => {
      clearTimeout(t);
      resolve(true);
    });
    ws.addEventListener('error', () => resolve(false));
  });
  if (!ok) throw new Error(`socket never opened: ${url}`);
  return { ws, frames, texts };
}

async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await Bun.sleep(50);
  }
  return pred();
}

async function migrate(base: string) {
  const r = await fetch(`${base}/_api/project/migrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ direction: 'forward', apply: true }),
  });
  expect(r.status).toBe(200);
  for (let end = Date.now() + 5000; Date.now() < end; ) {
    const cfg = (await (await fetch(`${base}/_config`)).json()) as { formatGate?: unknown };
    if (cfg.formatGate === null) return;
    await Bun.sleep(100);
  }
  throw new Error('the gate never lifted');
}

const refusedFormat = (s: Sock) =>
  s.texts.some((t) => {
    try {
      const m = JSON.parse(t);
      return (
        m.type === 'refused' &&
        m.reason === 'read-only' &&
        m.detail === 'format' &&
        m.message === 'View only — this project still uses Maude 1.'
      );
    } catch {
      return false;
    }
  });

describe('a format-1 project: no comment write over a socket until "Update project"', () => {
  test('inspector: comments-add / -patch / -delete are refused with the HTTP words; after the click the same socket writes', async () => {
    const { base } = await bootFormat1();
    // control: the HTTP comment door refuses too (the gate this test mirrors)
    const http = await fetch(`${base}/_api/comments/op`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ op: 'add', file: CARD, text: 'over http' }),
    });
    expect(http.status).toBe(403);
    expect(await http.json()).toMatchObject({ detail: 'format' });

    const sock = await open(`${base.replace('http', 'ws')}/_ws`);
    sock.ws.send(
      JSON.stringify({
        type: 'comments-add',
        payload: { file: CARD, selector: 'img', text: 'gated note' },
      })
    );
    expect(await until(() => refusedFormat(sock))).toBe(true);
    sock.texts.length = 0;
    sock.ws.send(
      JSON.stringify({ type: 'comments-patch', id: 'c-seed', patch: { status: 'resolved' } })
    );
    expect(await until(() => refusedFormat(sock))).toBe(true);
    sock.texts.length = 0;
    sock.ws.send(JSON.stringify({ type: 'comments-delete', id: 'c-seed' }));
    expect(await until(() => refusedFormat(sock))).toBe(true);
    await Bun.sleep(300);
    expect(notes().map((c) => [c.id, c.text, c.status])).toEqual([['c-seed', 'seed note', 'open']]);

    await migrate(base);
    sock.ws.send(
      JSON.stringify({
        type: 'comments-add',
        payload: { file: CARD, selector: 'img', text: 'after update' },
      })
    );
    expect(await until(() => notes().some((c) => c.text === 'after update'), 5000)).toBe(true);
    sock.ws.close();
  }, 30_000);

  test('collab: an owner socket’s comment lane never reaches a peer; after the click the same sockets carry it', async () => {
    const { base } = await bootFormat1();
    const url = `${base.replace('http', 'ws')}/_ws/collab/${SLUG}`;
    const writer = await open(url);
    const peer = await open(url);
    writer.ws.send(encodeEpochClaim(''));
    peer.ws.send(encodeEpochClaim(''));
    await Bun.sleep(400);
    peer.frames.length = 0;
    writer.ws.send(commentLane('gated'));
    expect(await until(() => peer.frames.some((f) => f[0] === MESSAGE_SYNC), 1200)).toBe(false);

    await migrate(base);
    peer.frames.length = 0;
    writer.ws.send(commentLane('after'));
    expect(await until(() => peer.frames.some((f) => f[0] === MESSAGE_SYNC), 3000)).toBe(true);
    writer.ws.close();
    peer.ws.close();
  }, 30_000);
});
