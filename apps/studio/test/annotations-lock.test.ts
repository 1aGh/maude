// #137 — annotation lock: the `locked` field, its Stroke-view round-trip and
// the commit guard that keeps a locked element where it is.
import { describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { projectBoard } from '../annotations/ai-read.ts';
import { AiBatch } from '../annotations/ai-write.ts';
import { guardLockedOps, isAllLocked, lockedStrokeIds } from '../annotations/lock.ts';
import { applyOps, diffToOps, type Op } from '../annotations/ops.ts';
import { validateElement } from '../annotations/registry.ts';
import { applyOpsToReplica, readReplica, writeReplica } from '../annotations/replica.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { elementsToStrokes, strokesToElements } from '../annotations/v1-adapter.ts';
import { strokesToSvg, svgToStrokes } from '../annotations-model.ts';

const board = (raw: Record<string, unknown>[]) =>
  new Map(validateElements(raw).elements.map((e) => [e.id, e]));

const sticky = (over: Record<string, unknown> = {}) => ({
  id: 'st1',
  type: 'sticky',
  index: 'a0',
  x: 10,
  y: 20,
  w: 200,
  h: 200,
  text: 'hi',
  ...over,
});

describe('locked field', () => {
  test('canonical: kept when true, omitted when false, last in key order', () => {
    const on = validateElement(sticky({ locked: true }));
    expect(on.ok && on.el.locked).toBe(true);
    if (on.ok) expect(Object.keys(on.el).at(-1)).toBe('locked');
    const off = validateElement(sticky({ locked: false }));
    expect(off.ok && 'locked' in off.el).toBe(false);
  });

  test('non-boolean values are rejected or dropped, never kept', () => {
    const r = validateElement(sticky({ locked: 'yes' }));
    if (r.ok) expect(r.el.locked).toBeUndefined();
  });
});

describe('Stroke view round-trip', () => {
  const els = board([
    sticky({ locked: true }),
    {
      id: 'r1',
      type: 'shape',
      index: 'a1',
      x: 300,
      y: 20,
      w: 100,
      h: 60,
      label: { text: 'L' },
      locked: true,
    },
    sticky({ id: 'st2', index: 'a2', x: 600 }),
  ]);

  test('element → strokes → elements is lossless', () => {
    const strokes = elementsToStrokes(els.values());
    expect(strokes.find((s) => s.id === 'st1')?.locked).toBe(true);
    expect(strokes.find((s) => s.id === 'st2')?.locked).toBeUndefined();
    const back = strokesToElements(strokes, els);
    expect(JSON.stringify(back)).toBe(JSON.stringify([...els.values()]));
  });

  test("a locked shape's anchored label counts as locked", () => {
    const ids = lockedStrokeIds(elementsToStrokes(els.values()));
    expect([...ids].sort()).toEqual(['r1', 'r1~label', 'st1']);
  });

  test('legacy SVG keeps the flag (paste / fixtures)', async () => {
    // svgToStrokes reads through DOMParser, which only happy-dom provides here.
    GlobalRegistrator.register();
    const strokes = elementsToStrokes(els.values());
    const parsed = svgToStrokes(strokesToSvg(strokes));
    expect(parsed.find((s) => s.id === 'st1')?.locked).toBe(true);
    await GlobalRegistrator.unregister();
    expect(parsed.find((s) => s.id === 'st1')?.locked).toBe(true);
    expect(parsed.find((s) => s.id === 'st2')?.locked).toBeUndefined();
  });
});

describe('guardLockedOps', () => {
  const prev = board([
    sticky({ locked: true }),
    sticky({ id: 'st2', index: 'a1', x: 400 }),
    { id: 'sec', type: 'section', index: 'a2', x: 0, y: 600, w: 800, h: 400 },
    sticky({ id: 'in', parent: 'sec', index: 'a0', x: 20, y: 20, locked: true }),
  ]);
  const edit = (id: string, set: Record<string, unknown>) => {
    const next = new Map(prev);
    next.set(id, { ...(prev.get(id) as AnnotationElement), ...set });
    return diffToOps(prev, next);
  };

  test('a move, resize, rotate or text edit of a locked element is dropped', () => {
    for (const set of [{ x: 99 }, { w: 50, h: 50 }, { rot: 45 }, { text: 'changed' }]) {
      const res = guardLockedOps(prev, edit('st1', set));
      expect(res.ops).toEqual([]);
      expect(res.blocked).toBe(1);
    }
  });

  test('an unlocked element in the same batch still moves', () => {
    const ops = [...edit('st1', { x: 99 }), ...edit('st2', { x: 1 })];
    const res = guardLockedOps(prev, ops);
    expect(res.ops.map((o) => (o.op === 'patch' ? o.id : ''))).toEqual(['st2']);
  });

  test('z-order and grouping pass on a locked element', () => {
    const res = guardLockedOps(prev, edit('st1', { index: 'a5', groups: ['g1'] }));
    expect(res.blocked).toBe(0);
    expect(res.ops).toHaveLength(1);
  });

  test('mixed patch keeps only the exempt fields', () => {
    const res = guardLockedOps(prev, edit('st1', { index: 'a5', x: 500 }));
    expect(res.blocked).toBe(1);
    const op = res.ops[0] as Extract<Op, { op: 'patch' }>;
    expect(op.set).toEqual({ index: 'a5' });
    expect(op.expect).toEqual({ index: 'a0' });
  });

  test('a batch that unlocks may also move', () => {
    const next = new Map(prev);
    const { locked: _l, ...rest } = prev.get('st1') as AnnotationElement;
    next.set('st1', { ...rest, x: 99 } as AnnotationElement);
    const ops = diffToOps(prev, next);
    const res = guardLockedOps(prev, ops);
    expect(res.blocked).toBe(0);
    expect(applyOps(prev, res.ops).state.get('st1')?.x).toBe(99);
  });

  test('delete of a locked element, or of a section holding one, is dropped', () => {
    const del: Op[] = [
      { op: 'delete', id: 'st1' },
      { op: 'delete', id: 'sec' },
      { op: 'delete', id: 'in' },
      { op: 'delete', id: 'st2' },
    ];
    const res = guardLockedOps(prev, del);
    expect(res.ops).toEqual([{ op: 'delete', id: 'st2' }]);
    expect(res.blocked).toBe(3);
  });

  test('a put replacing a locked record is reduced to its exempt fields', () => {
    const el = { ...(prev.get('st1') as AnnotationElement), x: 999, index: 'a9' };
    const res = guardLockedOps(prev, [{ op: 'put', el }]);
    expect(res.blocked).toBe(1);
    expect(res.ops).toEqual([{ op: 'patch', id: 'st1', set: { index: 'a9' } }]);
  });

  test('no locked elements → the batch is returned as is', () => {
    const plain = board([sticky()]);
    const ops: Op[] = [{ op: 'delete', id: 'st1' }];
    expect(guardLockedOps(plain, ops)).toEqual({ ops, blocked: 0 });
  });
});

describe('isAllLocked (the Lock / Unlock toggle)', () => {
  const strokes = elementsToStrokes(
    board([
      sticky({ locked: true, groups: ['g1'] }),
      sticky({ id: 'st2', index: 'a1', x: 400, groups: ['g1'] }),
      sticky({ id: 'st3', index: 'a2', x: 800, locked: true }),
    ]).values()
  );

  test('all locked → true; a mixed group → false (the toggle locks the rest)', () => {
    expect(isAllLocked(['st3'], strokes)).toBe(true);
    // st1 is grouped with the unlocked st2: the selection expands to both.
    expect(isAllLocked(['st1'], strokes)).toBe(false);
    expect(isAllLocked([], strokes)).toBe(false);
  });
});

describe('AI contract', () => {
  const els = () =>
    validateElements([
      sticky({ locked: true }),
      sticky({ id: 'st2', index: 'a1', x: 400 }),
      { id: 'sec', type: 'section', index: 'a2', x: 0, y: 600, w: 800, h: 400 },
      sticky({ id: 'in', parent: 'sec', index: 'a0', x: 20, y: 20, locked: true }),
    ]).elements;

  test('read: a locked element says so', () => {
    const p = projectBoard(els());
    const flat = JSON.stringify(p.elements);
    expect(p.elements.find((e) => e.id === 'st1')?.locked).toBe(true);
    expect(p.elements.find((e) => e.id === 'st2')?.locked).toBeUndefined();
    expect(flat).toContain('"locked":true');
  });

  test('write: move / update / delete of a locked element is refused with a reason', () => {
    const b = new AiBatch(els());
    expect(() => b.move({ id: 'st1', dx: 10, dy: 0 })).toThrow(/locked/);
    expect(() => b.update({ id: 'st1', text: 'x' })).toThrow(/locked/);
    expect(() => b.delete({ id: 'st1' })).toThrow(/locked/);
    expect(() => b.delete({ id: 'sec' })).toThrow(/locked/);
    expect(b.ops).toEqual([]);
  });

  test('write: unlocking is allowed, and then the element can move', () => {
    const b = new AiBatch(els());
    b.update({ id: 'st1', locked: false });
    expect(b.state.get('st1')?.locked).toBeUndefined();
    b.move({ id: 'st1', dx: 10, dy: 0 });
    expect(b.state.get('st1')?.x).toBe(20);
  });

  test('write: reorder and group still work; a section holding a locked element still moves', () => {
    const b = new AiBatch(els());
    b.reorder({ id: 'st1', after: 'st2' });
    b.group({ ids: ['st1', 'st2'] });
    b.move({ id: 'sec', dx: 50, dy: 0 });
    expect(b.state.get('sec')?.x).toBe(50);
    // The locked child rides along: its parent-relative position is unchanged.
    expect(b.state.get('in')?.x).toBe(20);
    expect(() => b.reparent({ id: 'st1', parent: 'sec' })).toThrow(/locked/);
  });

  test('write: an agent can create a locked element and lock an existing one', () => {
    const b = new AiBatch(els());
    b.update({ id: 'st2', locked: true });
    expect(b.state.get('st2')?.locked).toBe(true);
  });
});

describe('sync (field-level replica, both directions)', () => {
  // Two peers on one Yjs doc pair: every update one makes reaches the other.
  const pair = () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(b, u, 'remote');
    });
    b.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(a, u, 'remote');
    });
    return { a, b };
  };
  const lockedOf = (doc: Y.Doc, id: string) =>
    readReplica(doc)?.elements.find((e) => e.id === id)?.locked;

  test('A locks → B sees it; B edits another element → A keeps the lock', () => {
    const { a, b } = pair();
    writeReplica(a, validateElements([sticky(), sticky({ id: 'st2', index: 'a1' })]).elements);
    applyOpsToReplica(a, [{ op: 'patch', id: 'st1', set: { locked: true } }]);
    expect(lockedOf(b, 'st1')).toBe(true);
    applyOpsToReplica(b, [{ op: 'patch', id: 'st2', set: { x: 999 } }]);
    expect(lockedOf(a, 'st1')).toBe(true);
    expect(lockedOf(b, 'st1')).toBe(true);
  });

  test('B unlocks → A sees it unlocked; the board text round-trips the flag', () => {
    const { a, b } = pair();
    writeReplica(b, validateElements([sticky({ locked: true })]).elements);
    expect(lockedOf(a, 'st1')).toBe(true);
    expect(parseBoard(serializeBoard(readReplica(a)?.elements ?? [])).elements[0]?.locked).toBe(
      true
    );
    applyOpsToReplica(b, [{ op: 'patch', id: 'st1', unset: ['locked'] }]);
    expect(lockedOf(a, 'st1')).toBeUndefined();
  });
});
