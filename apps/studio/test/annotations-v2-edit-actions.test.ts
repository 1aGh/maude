// annotations-v2 (DDR-242 AD4/AD8, Task 26) — UI edits as element op batches.

import { describe, expect, test } from 'bun:test';
import { applyOps, type Op } from '../annotations/ops.ts';
import { Scene } from '../annotations/scene.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { BoardStore } from '../annotations/ui/board.ts';
import {
  alignOps,
  arrowEndOp,
  createOp,
  deleteOps,
  distributeOps,
  duplicateOps,
  expandGroups,
  groupOps,
  moveOps,
  reorderOps,
  resizeOp,
  ungroupOps,
} from '../annotations/ui/edit-actions.ts';

function boardOf(raw: unknown[]) {
  return new Map(validateElements(raw).elements.map((e) => [e.id, e]));
}
const run = (b: Map<string, AnnotationElement>, ops: Op[]) => {
  const r = applyOps(b, ops);
  expect(r.rejected).toEqual([]);
  return r.state;
};

const BOARD = [
  { id: 'sec', type: 'section', index: 'a0', x: 100, y: 100, w: 400, h: 300 },
  { id: 'in', type: 'sticky', index: 'a0', parent: 'sec', x: 20, y: 20, w: 100, h: 100, text: 'x' },
  { id: 'r', type: 'shape', index: 'a1', x: 700, y: 100, w: 100, h: 60 },
  { id: 't', type: 'shape', index: 'a2', x: 900, y: 100, w: 100, h: 60 },
  { id: 'ar', type: 'arrow', index: 'a3', start: { el: 'r' }, end: { el: 't' } },
];

describe('create', () => {
  test('lands in the section its centre falls in, in that section’s coordinates', () => {
    const b = boardOf(BOARD);
    const { op, id } = createOp(new Scene(b.values()), {
      type: 'sticky',
      x: 300,
      y: 250,
      w: 60,
      h: 60,
    });
    const s = run(b, [op]);
    expect(s.get(id)).toMatchObject({ parent: 'sec', x: 200, y: 150 });
    expect(new Scene(s.values()).worldBox(id)).toEqual({ x: 300, y: 250, w: 60, h: 60 });
  });

  test('outside every section: top level, on top of its siblings', () => {
    const b = boardOf(BOARD);
    const scene = new Scene(b.values());
    const { op, id } = createOp(scene, { type: 'shape', x: 1200, y: 0, w: 10, h: 10 });
    const s = run(b, [op]);
    const order = new Scene(s.values()).paintOrder().map((e) => e.id);
    expect(order.at(-1)).toBe(id);
    expect(s.get(id)?.parent).toBeUndefined();
  });

  test('a section drawn inside a bigger one nests; one drawn around nothing stays top level', () => {
    const b = boardOf(BOARD);
    const { op, id } = createOp(
      new Scene(b.values()),
      { type: 'section', x: 150, y: 150, w: 100, h: 100 },
      { z: { above: 'in' } }
    );
    const s = run(b, [op]);
    expect(s.get(id)?.parent).toBe('sec');
  });
});

describe('move', () => {
  test('moving a section patches only the section; its contents follow (relative)', () => {
    const b = boardOf(BOARD);
    const ops = moveOps(new Scene(b.values()), ['sec', 'in'], 50, 10);
    expect(ops.map((o) => ('id' in o ? o.id : ''))).toEqual(['sec']);
    const s = run(b, ops);
    expect(new Scene(s.values()).worldBox('in')).toEqual({ x: 170, y: 130, w: 100, h: 100 });
  });

  test('a bound arrow needs no patch when its host moves', () => {
    const b = boardOf(BOARD);
    const ops = moveOps(new Scene(b.values()), ['r'], 0, 200);
    expect(ops.length).toBe(1);
    const s = run(b, ops);
    const a = new Scene(s.values()).arrowWorld(s.get('ar') as AnnotationElement);
    expect(a?.y1).toBeGreaterThan(200);
  });

  test('dropping into a section re-parents at the same world place; dragging out un-parents', () => {
    const b = boardOf(BOARD);
    let s = run(b, moveOps(new Scene(b.values()), ['r'], -450, 100, { reparent: true }));
    expect(s.get('r')?.parent).toBe('sec');
    expect(new Scene(s.values()).worldBox('r')).toEqual({ x: 250, y: 200, w: 100, h: 60 });
    s = run(s, moveOps(new Scene(s.values()), ['r'], 1000, 0, { reparent: true }));
    expect(s.get('r')?.parent).toBeUndefined();
    expect(new Scene(s.values()).worldBox('r')).toEqual({ x: 1250, y: 200, w: 100, h: 60 });
  });
});

describe('resize', () => {
  test('fits a child to a WORLD box through its registry def', () => {
    const b = boardOf(BOARD);
    const op = resizeOp(new Scene(b.values()), 'in', { x: 120, y: 120, w: 200, h: 150 }) as Op;
    const s = run(b, [op]);
    expect(s.get('in')).toMatchObject({ x: 20, y: 20, w: 200, h: 150 });
  });
});

describe('duplicate / delete', () => {
  test('a section is copied with its contents; copies point at copies', () => {
    const b = boardOf(BOARD);
    const { ops, idMap } = duplicateOps(new Scene(b.values()), ['sec', 'in'], 0, 500);
    const s = run(b, ops);
    const secCopy = idMap.get('sec') as string;
    const inCopy = idMap.get('in') as string;
    expect(s.get(inCopy)?.parent).toBe(secCopy);
    expect(s.get(inCopy)).toMatchObject({ x: 20, y: 20 });
    expect(new Scene(s.values()).worldBox(secCopy)).toMatchObject({ x: 100, y: 600 });
  });

  test('an arrow copied with both hosts binds the copies', () => {
    const b = boardOf(BOARD);
    const { ops, idMap } = duplicateOps(new Scene(b.values()), ['r', 't', 'ar'], 0, 300);
    const s = run(b, ops);
    expect(s.get(idMap.get('ar') as string)).toMatchObject({
      start: { el: idMap.get('r') },
      end: { el: idMap.get('t') },
    });
  });

  test('delete of a section with its contents', () => {
    const b = boardOf(BOARD);
    const s = run(b, deleteOps(['sec', 'in']));
    expect(s.has('sec') || s.has('in')).toBe(false);
  });
});

describe('z-order and groups', () => {
  test('front / back among siblings; a group moves as one unit', () => {
    let b = boardOf(BOARD);
    b = run(b, groupOps(new Scene(b.values()), ['r', 't'])?.ops ?? []);
    expect(expandGroups(new Scene(b.values()), ['r']).sort()).toEqual(['r', 't']);
    b = run(b, reorderOps(new Scene(b.values()), ['r'], 'back'));
    const order = new Scene(b.values()).childrenOf(null).map((e) => e.id);
    expect(order.slice(0, 2).sort()).toEqual(['r', 't']);
    b = run(b, ungroupOps(new Scene(b.values()), ['r']));
    expect(b.get('r')?.groups).toBeUndefined();
  });
});

describe('align / distribute', () => {
  test('align carries a section’s contents (they are relative)', () => {
    const b = boardOf(BOARD);
    const s = run(b, alignOps(new Scene(b.values()), ['sec', 'r'], 'top'));
    expect(s.get('r')?.y).toBe(100);
    const d = run(b, distributeOps(new Scene(b.values()), ['sec', 'r', 't'], 'h'));
    expect(d.get('in')).toMatchObject({ x: 20, y: 20 });
  });
});

describe('arrows', () => {
  test('re-bind an end, or free it at a world point', () => {
    const b = boardOf(BOARD);
    let s = run(b, [
      arrowEndOp(new Scene(b.values()), 'ar', 'end', { el: 'in', nx: 0.5, ny: 0 }) as Op,
    ]);
    expect(s.get('ar')?.end).toEqual({ el: 'in', nx: 0.5, ny: 0 });
    s = run(s, [arrowEndOp(new Scene(s.values()), 'ar', 'end', { x: 5, y: 6 }) as Op]);
    expect(s.get('ar')?.end).toEqual({ x: 5, y: 6 });
  });
});

describe('BoardStore', () => {
  test('preview overlays without touching the committed board; unchanged records keep identity', () => {
    const store = new BoardStore();
    store.setAll(boardOf(BOARD).values());
    const r0 = store.get('r');
    const v0 = store.version;
    store.setAll(boardOf(BOARD).values());
    expect(store.version).toBe(v0); // same content → no change
    expect(store.get('r')).toBe(r0);
    store.preview(new Map([['r', { ...(r0 as AnnotationElement), x: 1 }]]));
    expect(store.get('r')?.x).toBe(1);
    expect(store.committed.get('r')?.x).toBe(700);
    store.clearPreview();
    expect(store.get('r')?.x).toBe(700);
    const res = store.apply([{ op: 'patch', id: 'r', set: { x: 5 } }]);
    expect(store.get('r')?.x).toBe(5);
    expect(res.inverse.length).toBe(1);
  });
});
