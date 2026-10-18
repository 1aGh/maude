// S9.11 — V2-1.16 L11 (studio half): presence.
//   - an A-only session's collab upgrade to B is refused (403 not-in-scope) on the MAIN
//     origin before it upgrades; A's room is joinable; project sessions join every room;
//   - a person on B therefore never reaches an A-only socket (rooms are per canvas);
//   - `summon` (Bring everyone here, V2-1.7 §5.5) is stripped from awareness published by a
//     connection lacking it, before any peer — or the hub bridge — hears it.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { seesSlug } from '../access/filters.ts';
import { resolveAccess } from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { bridgeAwareness } from '../collab/awareness-bridge.ts';
import { MESSAGE_AWARENESS } from '../collab/protocol.ts';
import { createRoom, type RoomConn } from '../collab/room.ts';
import {
  A_ONLY,
  A_REL,
  type AclCell,
  B_REL,
  bootAclCell,
  get,
  OWNER,
  VIEWER,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const B_SLUG = canvasSlugFromRel(B_REL, '.design');
const A_SLUG = canvasSlugFromRel(A_REL, '.design');

describe('collab upgrades (booted cell, main origin)', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test("A-only → B's room: 403 not-in-scope, before any upgrade", async () => {
    const r = await get(`${cell.base}/_ws/collab/${B_SLUG}`, A_ONLY);
    expect(r.status).toBe(403);
    expect(JSON.parse(r.text)).toEqual({ error: 'not-in-scope', reason: 'not-in-scope' });
  });

  test("A-only → A's room and project roles → B's room reach the upgrade", async () => {
    // a plain GET reaches `srv.upgrade` and fails it (not a handshake): 400, never 403
    expect((await get(`${cell.base}/_ws/collab/${A_SLUG}`, A_ONLY)).status).toBe(400);
    for (const who of [OWNER, VIEWER])
      expect((await get(`${cell.base}/_ws/collab/${B_SLUG}`, who)).status).toBe(400);
  });
});

test('seesSlug: grants by slug; a project role sees every room; nothing sees nothing', () => {
  const aOnly = resolveAccess({ v: 1, role: null, grants: [{ c: A_REL, r: 'viewer' }] });
  expect(seesSlug(aOnly, A_SLUG, '.design')).toBe(true);
  expect(seesSlug(aOnly, B_SLUG, '.design')).toBe(false);
  expect(seesSlug(resolveAccess({ v: 1, role: 'observer' }), B_SLUG, '.design')).toBe(true);
  expect(seesSlug(resolveAccess({ v: 1, role: null }), A_SLUG, '.design')).toBe(false);
});

// ---------------------------------------------------------------------------
// summon

function conn(id: string, summon?: boolean): RoomConn & { recv: Uint8Array[] } {
  const recv: Uint8Array[] = [];
  return {
    id,
    ...(summon !== undefined ? { summon } : {}),
    send: (p: Uint8Array) => recv.push(p),
    recv,
  };
}

function awarenessFrame(state: Record<string, unknown>): Uint8Array {
  const peer = new Awareness(new Y.Doc());
  peer.setLocalState(state);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(peer, [peer.clientID]));
  return encoding.toUint8Array(enc);
}

const callbacks = { seed() {}, persistJson() {}, persistBinary() {} };
const summonOf = (aw: Awareness) =>
  [...aw.getStates().values()].map((s) => (s as { summon?: unknown }).summon ?? null);

describe('summon is stripped from a connection lacking it', () => {
  const SUMMON = { id: 'x', at: 1 };

  test('a viewer conn: peers and the hub bridge never hear `summon`; the rest arrives', async () => {
    const room = createRoom('ui-a', callbacks);
    const hub = new Awareness(new Y.Doc());
    bridgeAwareness(room.awareness, hub);
    const viewer = conn('viewer', false);
    const peer = conn('peer');
    await room.connect(viewer);
    await room.connect(peer);
    room.receive(viewer, awarenessFrame({ name: 'Petra', summon: SUMMON }));
    const states = [...room.awareness.getStates().values()] as Array<Record<string, unknown>>;
    expect(states.some((s) => s.name === 'Petra')).toBe(true);
    expect(summonOf(room.awareness)).not.toContainEqual(SUMMON);
    expect(summonOf(hub)).not.toContainEqual(SUMMON);
    await room.destroy();
  });

  test('a member conn (or one without the field, today) keeps `summon`', async () => {
    for (const held of [true, undefined]) {
      const room = createRoom(`ui-a-${held}`, callbacks);
      const hub = new Awareness(new Y.Doc());
      bridgeAwareness(room.awareness, hub);
      const member = conn('member', held);
      await room.connect(member);
      room.receive(member, awarenessFrame({ name: 'Ana', summon: SUMMON }));
      expect(summonOf(room.awareness)).toContainEqual(SUMMON);
      expect(summonOf(hub)).toContainEqual(SUMMON);
      await room.destroy();
    }
  });
});
