// Annotation operation echoes over real Yjs updates (DDR-242 §4/§5).
//
// v1 recognised its own echo by (writeId, whole-SVG) pairs in
// `annotations-sync.ts`. v2 keys the echo guard on the ACTION id alone: every
// write records its action under the replica's '~action' key, and
// `observeReplica` hands it to the canvas, which skips actions it authored
// (annotations-layer.tsx `ownActionsRef`). These tests drive the real room →
// viewer update stream and reproduce the layer's guard exactly, so the
// user-facing guarantees are the same as before:
//   - every peer operation reaches the viewer, including returns to content
//     the viewer itself authored earlier (A → B → A);
//   - the author's own delayed echoes never roll back its later edits;
//   - a filesystem import is a new operation, never an old author's echo.

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { LEGACY_TYPE, observeReplica, replicaActionId } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { createRegistry } from '../collab/registry.ts';
import { applyAnnotationsToDoc } from '../sync/codec.ts';
import { board, EMPTY_BOARD, sticky } from './fixtures/annotations-v2/boards.ts';

const empty = EMPTY_BOARD;
const first = board(sticky('first', 'one'));
const second = board(sticky('second', 'two'));

function fixture() {
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const room = registry.get('canvas');
  const viewer = new Y.Doc();
  // The layer's guard: action ids this canvas authored and still expects.
  let own: string[] = [];
  const remember = (id: string) => {
    own = [...own.slice(-63), id];
  };
  const forget = (id: string) => {
    own = own.filter((a) => a !== id);
  };
  const rendered: string[] = [];
  room.doc.on('update', (update: Uint8Array) => Y.applyUpdate(viewer, update));
  const stop = observeReplica(viewer, (elements, _changed, actionId) => {
    if (actionId && own.includes(actionId)) return;
    rendered.push(serializeBoard(elements));
  });
  return { registry, room, viewer, remember, forget, rendered, stop };
}

describe('annotation operation echoes over real Yjs updates', () => {
  test('peer create/delete/create/delete and undo/redo can return to an identical board', () => {
    const f = fixture();
    for (const [i, b] of [first, empty, second, empty, second, empty].entries()) {
      f.registry.syncRoomFromAnnotations('canvas', b, `peer-${i}`);
    }
    expect(f.rendered).toEqual([first, empty, second, empty, second, empty]);
    f.stop();
  });

  test('delayed own writes cannot roll back later optimistic media inserts', () => {
    const f = fixture();
    f.remember('self-1');
    f.remember('self-2');
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.registry.syncRoomFromAnnotations('canvas', second, 'self-2');
    expect(f.rendered).toEqual([]);
    // A peer undo to our earlier content is a different operation.
    f.registry.syncRoomFromAnnotations('canvas', first, 'peer-undo');
    expect(f.rendered).toEqual([first]);
    f.stop();
  });

  test('a peer operation producing content the author wrote before still reaches the author', () => {
    // v1 pinned "a peer op with unchanged canonical SVG still reaches an
    // optimistic author": identity, not content, decides the echo. In v2 a
    // byte-identical batch is literally no operation (nothing to deliver — see
    // the next assertion), so the same guarantee is pinned on the case that
    // still exists: content equal to one of the author's OWN earlier actions.
    const f = fixture();
    f.remember('self-0');
    f.remember('self-1');
    f.registry.syncRoomFromAnnotations('canvas', second, 'self-0');
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.registry.syncRoomFromAnnotations('canvas', second, 'peer-undo');
    expect(f.rendered).toEqual([second]);
    expect(replicaActionId(f.viewer)).toBe('peer-undo');

    // Identical content under a new action id changes nothing and emits
    // nothing — the author's optimistic state already equals the board.
    let updates = 0;
    f.room.doc.on('update', () => {
      updates++;
    });
    f.registry.syncRoomFromAnnotations('canvas', second, 'peer-noop');
    expect(updates).toBe(0);
    expect(f.rendered).toEqual([second]);
    f.stop();
  });

  test('a per-element peer edit reaches the author even on the element it just wrote', () => {
    const f = fixture();
    f.remember('self-1');
    f.registry.syncRoomFromAnnotations('canvas', board(sticky('s', 'mine')), 'self-1');
    f.registry.syncRoomFromAnnotations(
      'canvas',
      board(sticky('s', 'mine, edited by peer')),
      'peer-1'
    );
    expect(f.rendered).toEqual([board(sticky('s', 'mine, edited by peer'))]);
    f.stop();
  });

  test('filesystem restoration clears old authorship and deletion clears the viewer', () => {
    const f = fixture();
    f.remember('self-1');
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    applyAnnotationsToDoc(f.room.doc, second, 'fs');
    expect(replicaActionId(f.room.doc)).toBeUndefined();
    applyAnnotationsToDoc(f.room.doc, first, 'fs');
    applyAnnotationsToDoc(f.room.doc, null, 'fs');
    expect(f.rendered).toEqual([second, first, empty]);
    f.stop();
  });

  test('a failed request is forgotten, so a later write under that id is not swallowed', () => {
    const f = fixture();
    f.remember('self-1');
    f.forget('self-1'); // the POST was refused
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    expect(f.rendered).toEqual([first]);
    f.stop();
  });

  test('a stale v1 peer writing the legacy svg key cannot change a v2 board', () => {
    // v1 pinned "svg-only writes cannot borrow a previous local operation id".
    // In v2 a v1 peer's write lands in the legacy map, which v2 never reads
    // once a v2 writer has written — the stronger guarantee (DDR-242 §5).
    const f = fixture();
    f.remember('self-1');
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.room.doc.getMap(LEGACY_TYPE).set('svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(f.rendered).toEqual([]);
    f.stop();
  });

  test('before any v2 write, a legacy peer value is rendered as an unattributed write', () => {
    const f = fixture();
    f.room.doc
      .getMap(LEGACY_TYPE)
      .set(
        'svg',
        '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"><g data-id="a" data-tool="sticky" data-r="8" data-fs="14" fill="#fce8a6"><rect x="0" y="0" width="100" height="100" rx="8" ry="8"/></g></svg>'
      );
    expect(f.rendered.length).toBe(1);
    expect(f.rendered[0]).not.toBe(empty);
    f.stop();
  });
});
