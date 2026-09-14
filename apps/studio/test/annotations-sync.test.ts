import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { createAnnotationEchoGuard, observeAnnotationSnapshots } from '../annotations-sync.ts';
import { createRegistry } from '../collab/registry.ts';
import { applyAnnotationsToDoc } from '../sync/codec.ts';

const empty = '<svg></svg>';
const first = '<svg><rect id="first"/></svg>';
const second = '<svg><rect id="second"/></svg>';

function fixture() {
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const room = registry.get('canvas');
  const viewer = new Y.Doc();
  const guard = createAnnotationEchoGuard();
  const rendered: string[] = [];
  room.doc.on('update', (update: Uint8Array) => Y.applyUpdate(viewer, update));
  const stop = observeAnnotationSnapshots(viewer, (svg, id) => {
    if (!guard.isOwn(svg, id)) rendered.push(svg);
  });
  return { registry, room, viewer, guard, rendered, stop };
}

describe('annotation operation echoes over real Yjs updates', () => {
  test('peer create/delete/create/delete and undo/redo can return to identical SVG', () => {
    const f = fixture();
    for (const [i, svg] of [first, empty, second, empty, second, empty].entries()) {
      f.registry.syncRoomFromAnnotations('canvas', svg, `peer-${i}`);
    }
    expect(f.rendered).toEqual([first, empty, second, empty, second, empty]);
    f.stop();
  });

  test('delayed own writes cannot roll back later optimistic media inserts', () => {
    const f = fixture();
    f.guard.remember('self-1', first);
    f.guard.remember('self-2', second);
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.registry.syncRoomFromAnnotations('canvas', second, 'self-2');
    expect(f.rendered).toEqual([]);
    // A peer undo to our earlier content is a different operation.
    f.registry.syncRoomFromAnnotations('canvas', first, 'peer-undo');
    expect(f.rendered).toEqual([first]);
    f.stop();
  });

  test('a peer operation with unchanged canonical SVG still reaches an optimistic author', () => {
    const f = fixture();
    f.guard.remember('self-1', first);
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.registry.syncRoomFromAnnotations('canvas', first, 'peer-undo');
    expect(f.rendered).toEqual([first]);
    f.stop();
  });

  test('filesystem restoration clears old authorship and deletion clears the viewer', () => {
    const f = fixture();
    f.guard.remember('self-1', first);
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    applyAnnotationsToDoc(f.room.doc, second, 'fs');
    expect(f.room.doc.getMap('annotations').has('writeId')).toBe(false);
    applyAnnotationsToDoc(f.room.doc, first, 'fs');
    applyAnnotationsToDoc(f.room.doc, null, 'fs');
    expect(f.rendered).toEqual([second, first, '']);
    f.stop();
  });

  test('legacy svg-only writes cannot borrow a previous local operation id', () => {
    const f = fixture();
    f.guard.remember('self-1', first);
    f.registry.syncRoomFromAnnotations('canvas', first, 'self-1');
    f.room.doc.getMap('annotations').set('svg', second);
    f.room.doc.getMap('annotations').set('svg', first);
    expect(f.rendered).toEqual([second, first]);
    f.stop();
  });

  test('sanitized content and failed requests are never mistaken for successful echoes', () => {
    const guard = createAnnotationEchoGuard();
    guard.remember('self-1', first);
    expect(guard.isOwn(second, 'self-1')).toBe(false);
    guard.forget('self-1');
    expect(guard.isOwn(first, 'self-1')).toBe(false);
  });
});
