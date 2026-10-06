// Unit: Task 5 — Registry.syncRoomFromAnnotations bridges PUT /_api/annotations
// writes into the live replica (DDR-242 'annotations2') so collab peers see
// the board without cold-open.

import { describe, expect, test } from 'bun:test';

import { readReplica, replicaActionId, replicaBoardText } from '../annotations/replica.ts';
import { Y_TYPES } from '../collab/persistence.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { annotationsEditAtFromDoc } from '../sync/codec.ts';
import { board, EMPTY_BOARD, sticky, v1, v1Sticky } from './fixtures/annotations-v2/boards.ts';

function noopCallbacks(): RoomCallbacks {
  return {
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  };
}

describe('Registry.syncRoomFromAnnotations', () => {
  const B1 = board(sticky('s1', 'one'));
  const B2 = board(sticky('s1', 'two'), sticky('s2', 'new', { x: 300, index: 'a1' }));

  test('populates the annotations replica (DDR-242), never the v1 svg key', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('canvas-slug');
    expect(readReplica(room.doc)).toBeNull();

    r.syncRoomFromAnnotations('canvas-slug', B1, 'act-1');
    expect(replicaBoardText(room.doc)).toBe(B1);
    expect(replicaActionId(room.doc)).toBe('act-1');
    expect(room.doc.getMap(Y_TYPES.annotations).has('svg')).toBe(false);
  });

  test('each call makes the replica hold exactly the new board (latest write wins)', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('canvas-slug');
    r.syncRoomFromAnnotations('canvas-slug', B1);
    r.syncRoomFromAnnotations('canvas-slug', B2);
    expect(replicaBoardText(room.doc)).toBe(B2);
    r.syncRoomFromAnnotations('canvas-slug', EMPTY_BOARD);
    expect(replicaBoardText(room.doc)).toBe(EMPTY_BOARD);
  });

  test('a legacy SVG write (v1 PUT) is converted into the replica', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('canvas-slug');
    const legacy = v1([v1Sticky('a', 'x')]);
    r.syncRoomFromAnnotations('canvas-slug', legacy.svg);
    expect(replicaBoardText(room.doc)).toBe(legacy.board);
  });

  test('no-op when no room exists for slug', () => {
    const r = createRegistry(noopCallbacks());
    r.syncRoomFromAnnotations('absent', board(sticky('s1')));
    expect(r.peek('absent')).toBeNull();
    expect(r.size()).toBe(0);
  });

  test('inspector-write origin propagates through doc.update', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('echo-slug');
    let lastOrigin: unknown;
    room.doc.on('update', (_update, origin) => {
      lastOrigin = origin;
    });
    r.syncRoomFromAnnotations('echo-slug', board(sticky('s1')));
    expect(lastOrigin).toBe('inspector-write');
  });
});

describe('Registry.applyOpsToRoom (code review H1)', () => {
  test('applies the batch to the live replica, keeping a peer edit the file has not seen', () => {
    const r = createRegistry(noopCallbacks());
    const room = r.get('live');
    // The room holds a peer's edit (s2) that no flush has written to disk yet.
    const peer = sticky('s2', 'peer', { x: 300, index: 'a1' });
    r.syncRoomFromAnnotations('live', board(sticky('s1', 'one'), peer));
    const res = r.applyOpsToRoom(
      'live',
      [{ op: 'patch', id: 's1', set: { text: 'ONE' } }],
      'act-h1'
    );
    expect(res !== null && res !== 'too-large' && res.touched.has('s1')).toBe(true);
    expect(replicaBoardText(room.doc)).toBe(board(sticky('s1', 'ONE'), peer));
    expect(replicaActionId(room.doc)).toBe('act-h1');
    expect(annotationsEditAtFromDoc(room.doc)).toBeNumber();
  });

  test('no room, or a never-populated one, is null — the caller takes the disk path', () => {
    const r = createRegistry(noopCallbacks());
    expect(r.applyOpsToRoom('absent', [{ op: 'delete', id: 'x' }])).toBeNull();
    r.get('cold');
    expect(r.applyOpsToRoom('cold', [{ op: 'delete', id: 'x' }])).toBeNull();
  });
});
