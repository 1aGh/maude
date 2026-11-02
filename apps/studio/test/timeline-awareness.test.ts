// S7.17 — the awareness fields of working on one video together (07 · ve-together), and the strip that keeps
// them inside the project.
//
//   timeline  { artboardId, frame }                          a member's playhead
//   editing   { since, kind: 'caption-word', artboardId, wordKey }   the caption word a member is fixing
//
// This file pins:
//   - the trust boundary (DDR-054): forged / oversized / extra-key / non-int values drop the WHOLE field, and
//     the Phase 30 `{ since }` form still reads (a v1 peer reads `since` out of the caption form too);
//   - the studio room's strip: a presentation FOLLOWER (outside the project) never receives either field —
//     not in the handshake, not in a broadcast — and a read-only conn never publishes `editing`;
//   - the relay both ways, desktop → cloud and cloud → desktop (memory: they are not symmetric — the cell
//     child's room is where followers and read-only browsers live; every desktop tab is the Mac owner's).

import { describe, expect, test } from 'bun:test';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { bridgeAwareness } from '../collab/awareness-bridge.ts';
import { MESSAGE_AWARENESS } from '../collab/protocol.ts';
import { createRoom, type RoomCallbacks, type RoomConn } from '../collab/room.ts';
import {
  captionWordOf,
  sanitizeEditing,
  sanitizeTimeline,
  TIMELINE_FRAME_MAX,
  WORD_KEY_MAX,
} from '../collab/timeline-awareness.ts';
import { carryLocal, readForeignPeers, sanitizeForeignState } from '../use-collab.tsx';

const TIMELINE = { artboardId: 'nabor-16x9', frame: 222 };
const wordAt = (since = Date.now()) => ({
  since,
  kind: 'caption-word' as const,
  artboardId: 'nabor-16x9',
  wordKey: 'assets/huddle.mp4|w12|clip-3',
});

// ── the trust boundary ─────────────────────────────────────────────────────────────────────────────

describe('sanitizeTimeline — whole or null', () => {
  test('a well-formed playhead passes, rebuilt from the known keys', () => {
    expect(sanitizeTimeline(TIMELINE)).toEqual(TIMELINE);
    expect(sanitizeTimeline({ artboardId: 'a', frame: 0 })).toEqual({ artboardId: 'a', frame: 0 });
  });
  const bad: [string, unknown][] = [
    ['null', null],
    ['an array', [TIMELINE]],
    ['an extra key', { ...TIMELINE, html: '<img>' }],
    ['a fractional frame', { ...TIMELINE, frame: 1.5 }],
    ['a negative frame', { ...TIMELINE, frame: -1 }],
    ['a frame past the bound', { ...TIMELINE, frame: TIMELINE_FRAME_MAX + 1 }],
    ['a NaN frame', { ...TIMELINE, frame: Number.NaN }],
    ['a string frame', { ...TIMELINE, frame: '12' }],
    ['an id outside its grammar', { ...TIMELINE, artboardId: 'a b' }],
    ['an oversized id', { ...TIMELINE, artboardId: 'a'.repeat(65) }],
    ['no id', { frame: 3 }],
  ];
  for (const [why, v] of bad)
    test(`dropped whole: ${why}`, () => expect(sanitizeTimeline(v)).toBeNull());
});

describe('sanitizeEditing — the caption word, or the Phase 30 heads-up', () => {
  test('a caption word passes whole; `{ since }` alone is still the soft heads-up', () => {
    const w = wordAt();
    expect(sanitizeEditing(w)).toEqual(w);
    expect(captionWordOf(sanitizeEditing(w))).toEqual(w);
    expect(sanitizeEditing({ since: w.since })).toEqual({ since: w.since });
    expect(captionWordOf(sanitizeEditing({ since: w.since }))).toBeNull();
  });
  const bad: [string, unknown][] = [
    ['a future since', { ...wordAt(Date.now() + 60_000) }],
    ['no since', { kind: 'caption-word', artboardId: 'a', wordKey: 'x|y|z1' }],
    ['another kind', { ...wordAt(), kind: 'clip' }],
    ['an extra key', { ...wordAt(), name: 'Boss' }],
    ['a bad artboard', { ...wordAt(), artboardId: '../x' }],
    ['an oversized word key', { ...wordAt(), wordKey: `a|b|${'c'.repeat(WORD_KEY_MAX)}` }],
    ['a word key with a control character', { ...wordAt(), wordKey: 'a|b\u0000|c' }],
    ['a word key that is not src|word|clip', { ...wordAt(), wordKey: 'just-a-word' }],
    ['a numeric word key', { ...wordAt(), wordKey: 12345 }],
  ];
  for (const [why, v] of bad)
    test(`dropped whole: ${why}`, () => expect(sanitizeEditing(v)).toBeNull());

  test('sanitizeForeignState: a bad field drops the field, never the peer', () => {
    const peer = sanitizeForeignState(7, {
      name: 'Tereza',
      timeline: { ...TIMELINE, frame: 'x' },
      editing: { ...wordAt(), wordKey: 1 },
    });
    expect(peer?.name).toBe('Tereza');
    expect(peer?.timeline).toBeNull();
    expect(peer?.editing).toBeNull();
    const good = sanitizeForeignState(7, {
      name: 'Tereza',
      timeline: TIMELINE,
      editing: wordAt(5),
    });
    expect(good?.timeline).toEqual(TIMELINE);
    expect(captionWordOf(good?.editing)?.wordKey).toBe('assets/huddle.mp4|w12|clip-3');
  });

  test('carryLocal keeps the playhead across a cursor publish', () => {
    expect(carryLocal({ timeline: TIMELINE }).timeline).toEqual(TIMELINE);
    expect(carryLocal({}).timeline).toBeNull();
  });
});

// ── the studio room ────────────────────────────────────────────────────────────────────────────────

type Conn = RoomConn & { recv: Uint8Array[] };
function conn(
  id: string,
  opts: Partial<Pick<RoomConn, 'realm' | 'readOnly' | 'follow'>> = {}
): Conn {
  const recv: Uint8Array[] = [];
  return {
    id,
    ...opts,
    send(payload: Uint8Array) {
      recv.push(payload);
    },
    recv,
  };
}
const callbacks: RoomCallbacks = { seed() {}, persistJson() {}, persistBinary() {} };

/** One tab's awareness state as the frame its socket would send. */
function frameOf(state: Record<string, unknown>, peer = new Awareness(new Y.Doc())) {
  peer.setLocalState(state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
  return encoding.toUint8Array(enc);
}

/** Every awareness state a conn has been sent, as the far side would hold them. */
function heard(c: Conn): Record<string, unknown>[] {
  const a = new Awareness(new Y.Doc());
  for (const f of c.recv) {
    const dec = decoding.createDecoder(f);
    if (decoding.readVarUint(dec) !== MESSAGE_AWARENESS) continue;
    applyAwarenessUpdate(a, decoding.readVarUint8Array(dec), 'wire');
  }
  return [...a.getStates().entries()]
    .filter(([id]) => id !== a.clientID)
    .map(([, s]) => s as Record<string, unknown>);
}
const named = (c: Conn, name: string) => heard(c).find((s) => s.name === name);

describe('the room — followers are outside the project', () => {
  test('a follower never receives timeline or editing (broadcast); a member does', async () => {
    const room = createRoom('s7-17-follow', callbacks);
    const member = conn('member');
    const follower = conn('follower', { realm: 'canvas', readOnly: true, follow: true });
    const tereza = conn('tereza');
    await room.connect(member);
    await room.connect(follower);
    await room.connect(tereza);
    const word = wordAt();
    room.receive(tereza, frameOf({ name: 'Tereza', timeline: TIMELINE, editing: word }));
    expect(named(member, 'Tereza')).toMatchObject({ timeline: TIMELINE, editing: word });
    const seen = named(follower, 'Tereza');
    expect(seen?.name).toBe('Tereza');
    expect(seen && 'timeline' in seen).toBe(false);
    expect(seen && 'editing' in seen).toBe(false);
    await room.destroy();
  });

  test('a follower that joins late gets a handshake without them either', async () => {
    const room = createRoom('s7-17-follow-late', callbacks);
    const tereza = conn('tereza');
    await room.connect(tereza);
    room.receive(tereza, frameOf({ name: 'Tereza', timeline: TIMELINE, editing: wordAt() }));
    const follower = conn('follower', { realm: 'canvas', readOnly: true, follow: true });
    await room.connect(follower);
    const seen = named(follower, 'Tereza');
    expect(seen?.name).toBe('Tereza');
    expect(seen && ('timeline' in seen || 'editing' in seen)).toBe(false);
    await room.destroy();
  });

  test('a read-only conn may share its playhead but never claims a word', async () => {
    const room = createRoom('s7-17-ro', callbacks);
    const member = conn('member');
    const viewer = conn('viewer', { realm: 'canvas', readOnly: true });
    await room.connect(member);
    await room.connect(viewer);
    room.receive(viewer, frameOf({ name: 'Vera', timeline: TIMELINE, editing: wordAt() }));
    const seen = named(member, 'Vera');
    expect(seen?.timeline).toEqual(TIMELINE);
    expect(seen && 'editing' in seen).toBe(false);
    await room.destroy();
  });
});

// ── desktop ↔ hub ↔ cloud, both directions ─────────────────────────────────────────────────────────

/** The hub: a plain relay between two providers' awareness (its own strip is hub-tested). */
function hubLink(x: Awareness, y: Awareness) {
  const T = { hub: true };
  const fwd =
    (from: Awareness, to: Awareness) =>
    (c: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === T) return;
      const changed = c.added.concat(c.updated, c.removed);
      if (changed.length) applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), T);
    };
  x.on('update', fwd(x, y));
  y.on('update', fwd(y, x));
}

async function world() {
  // the Mac: one studio room, its tabs are the owner's (writable); bridged to its hub provider
  const desk = createRoom('s7-17-desk', callbacks);
  const deskProv = new Awareness(new Y.Doc());
  bridgeAwareness(desk.awareness, deskProv);
  // the cell child: its room holds browsers — a member, a viewer, a presentation follower
  const cell = createRoom('s7-17-cell', callbacks);
  const cellProv = new Awareness(new Y.Doc());
  bridgeAwareness(cell.awareness, cellProv);
  hubLink(deskProv, cellProv);
  const deskTab = conn('desk-tab');
  const cellMember = conn('cell-member', { realm: 'canvas' });
  const cellViewer = conn('cell-viewer', { realm: 'canvas', readOnly: true });
  const cellFollower = conn('cell-follower', { realm: 'canvas', readOnly: true, follow: true });
  await desk.connect(deskTab);
  for (const c of [cellMember, cellViewer, cellFollower]) await cell.connect(c);
  return { desk, cell, deskTab, cellMember, cellViewer, cellFollower };
}

describe('across the Mac and the cloud, both directions', () => {
  test('desktop → cloud: a cell member sees the playhead and the word; the follower sees neither', async () => {
    const w = await world();
    const word = wordAt();
    w.desk.receive(w.deskTab, frameOf({ name: 'Tereza', timeline: TIMELINE, editing: word }));
    expect(named(w.cellMember, 'Tereza')).toMatchObject({ timeline: TIMELINE, editing: word });
    const f = named(w.cellFollower, 'Tereza');
    expect(f?.name).toBe('Tereza');
    expect(f && ('timeline' in f || 'editing' in f)).toBe(false);
    await w.desk.destroy();
    await w.cell.destroy();
  });

  test('cloud → desktop: a cell member’s playhead and word reach the Mac; the follower next to them hears neither', async () => {
    const w = await world();
    const word = wordAt();
    w.cell.receive(w.cellMember, frameOf({ name: 'Jonas', timeline: TIMELINE, editing: word }));
    expect(named(w.deskTab, 'Jonas')).toMatchObject({ timeline: TIMELINE, editing: word });
    const f = named(w.cellFollower, 'Jonas');
    expect(f && ('timeline' in f || 'editing' in f)).toBe(false);
    await w.desk.destroy();
    await w.cell.destroy();
  });

  test('cloud → desktop: a cell viewer’s word claim stops at the cell; its playhead crosses', async () => {
    const w = await world();
    w.cell.receive(w.cellViewer, frameOf({ name: 'Vera', timeline: TIMELINE, editing: wordAt() }));
    const seen = named(w.deskTab, 'Vera');
    expect(seen?.timeline).toEqual(TIMELINE);
    expect(seen && 'editing' in seen).toBe(false);
    await w.desk.destroy();
    await w.cell.destroy();
  });

  test('a cleared word crosses both ways (leaving the word frees it)', async () => {
    const w = await world();
    const peer = new Awareness(new Y.Doc());
    w.desk.receive(
      w.deskTab,
      frameOf({ name: 'Tereza', timeline: TIMELINE, editing: wordAt() }, peer)
    );
    expect(captionWordOf(sanitizeEditing(named(w.cellMember, 'Tereza')?.editing))).not.toBeNull();
    w.desk.receive(w.deskTab, frameOf({ name: 'Tereza', timeline: TIMELINE, editing: null }, peer));
    expect(named(w.cellMember, 'Tereza')?.editing).toBeNull();
    const cellPeer = new Awareness(new Y.Doc());
    w.cell.receive(w.cellMember, frameOf({ name: 'Jonas', editing: wordAt() }, cellPeer));
    expect(named(w.deskTab, 'Jonas')?.editing).not.toBeNull();
    w.cell.receive(w.cellMember, frameOf({ name: 'Jonas', editing: null }, cellPeer));
    expect(named(w.deskTab, 'Jonas')?.editing).toBeNull();
    // and what a tab reads is sanitized
    const tab = new Awareness(new Y.Doc());
    tab.setLocalState({ name: 'me' });
    expect(readForeignPeers(tab)).toEqual([]);
    await w.desk.destroy();
    await w.cell.destroy();
  });
});
