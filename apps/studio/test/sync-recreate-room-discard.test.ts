// fix/205 — the collab room of a canvas that left the project is thrown away, not kept.
//
// The runtime used to only UNPIN the room of a deleted canvas. The room — and its Y.Doc, the
// deleted canvas's whole lineage — lived on, and a canvas re-created at the same slug re-attached
// to it: the hub's new body merged onto the old one and doubled. `registry.discard` is the one way
// out: no flush (nothing of the deleted canvas is written back), the cache forgotten on request,
// and never a room a provider pins or a browser is in. The two-peer story is
// `sync-recreate-fresh-doc.test.ts`; this pins the registry's half of it.

import { describe, expect, test } from 'bun:test';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks, RoomConn } from '../collab/room.ts';

function recording() {
  const calls = { persistJson: 0, persistBinary: 0, forget: [] as string[] };
  const callbacks: RoomCallbacks = {
    seed() {},
    persistJson() {
      calls.persistJson++;
    },
    persistBinary() {
      calls.persistBinary++;
    },
    forget(slug) {
      calls.forget.push(slug);
    },
  };
  return { calls, callbacks };
}

const conn = (id: string): RoomConn => ({ id, send() {} });

describe('registry.discard — the room of a canvas that left the project', () => {
  test('throws an unpinned, empty room away without writing it back; the next doc is fresh', async () => {
    const { calls, callbacks } = recording();
    const registry = createRegistry(callbacks);
    const old = registry.getDoc('ui-re');
    old.getText('html').insert(0, 'export default function Re() {}\n');
    expect(await registry.discard('ui-re', { forgetCache: true })).toBe(true);
    expect(registry.peek('ui-re')).toBeNull();
    // The pending (dirty) flush never ran: the deleted canvas is not written back.
    await new Promise((r) => setTimeout(r, 900));
    expect(calls.persistJson).toBe(0);
    expect(calls.persistBinary).toBe(0);
    expect(calls.forget).toEqual(['ui-re']);
    const fresh = registry.getDoc('ui-re');
    expect(fresh).not.toBe(old);
    expect(fresh.getText('html').toString()).toBe('');
  });

  test('keeps the cache unless asked, and still forgets it when no room is mounted', async () => {
    const { calls, callbacks } = recording();
    const registry = createRegistry(callbacks);
    registry.getDoc('ui-a');
    expect(await registry.discard('ui-a')).toBe(true);
    expect(calls.forget).toEqual([]);
    expect(await registry.discard('ui-b', { forgetCache: true })).toBe(false);
    expect(calls.forget).toEqual(['ui-b']);
  });

  test('never a room a provider pins, nor one a browser is in', async () => {
    const { calls, callbacks } = recording();
    const registry = createRegistry(callbacks);
    const pinnedDoc = registry.getDoc('ui-pinned');
    registry.pin('ui-pinned');
    expect(await registry.discard('ui-pinned', { forgetCache: true })).toBe(false);
    expect(registry.getDoc('ui-pinned')).toBe(pinnedDoc);

    const room = registry.get('ui-open');
    await room.connect(conn('tab-1'));
    expect(await registry.discard('ui-open', { forgetCache: true })).toBe(false);
    expect(registry.peek('ui-open')).toBe(room);
    expect(calls.forget).toEqual([]);
    // The browser leaves: the room is an ordinary one again.
    room.disconnect(conn('tab-1'));
    expect(await registry.discard('ui-open')).toBe(true);
  });
});
