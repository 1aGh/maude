// annotations-v2 (DDR-242 §4) — ops, the one merge rule, inverse (undo), fix-ups.
import { describe, expect, test } from 'bun:test';
import { applyOps, diffToOps, type Op } from '../annotations/ops.ts';
import '../annotations/ops-merge.ts'; // the server merge rule (browser: ours wins)
import { Scene } from '../annotations/scene.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

function board(raw: unknown[]): Map<string, AnnotationElement> {
  return new Map(validateElements(raw).elements.map((e) => [e.id, e]));
}

const s1 = {
  id: 's1',
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: 'hello world',
};
const s2 = { id: 's2', type: 'sticky', index: 'a1', x: 300, y: 0, w: 200, h: 200, text: 'two' };

/** Two peers edit the same base; the second op batch is applied on top of the first (acceptance order). */
function concurrently(base: Map<string, AnnotationElement>, a: Op[], b: Op[]) {
  const first = applyOps(base, a);
  return applyOps(first.state, b);
}

describe('merge rule', () => {
  test('different elements never conflict', () => {
    const base = board([s1, s2]);
    const r = concurrently(
      base,
      [{ op: 'patch', id: 's1', set: { x: 50 }, expect: { x: 0 } }],
      [{ op: 'patch', id: 's2', set: { fill: '#ffffff' }, expect: {} }]
    );
    expect(r.state.get('s1')?.x).toBe(50);
    expect(r.state.get('s2')?.fill).toBe('#ffffff');
  });

  test('different fields of one element never conflict', () => {
    const r = concurrently(
      board([s1]),
      [{ op: 'patch', id: 's1', set: { x: 50 }, expect: { x: 0 } }],
      [{ op: 'patch', id: 's1', set: { fill: '#ffffff' }, expect: { fill: undefined } }]
    );
    expect(r.state.get('s1')?.x).toBe(50);
    expect(r.state.get('s1')?.fill).toBe('#ffffff');
  });

  test('same scalar field: acceptance order (last wins)', () => {
    const r = concurrently(
      board([s1]),
      [{ op: 'patch', id: 's1', set: { x: 50 }, expect: { x: 0 } }],
      [{ op: 'patch', id: 's1', set: { x: 90 }, expect: { x: 0 } }]
    );
    expect(r.state.get('s1')?.x).toBe(90);
  });

  test('same text field: both edits survive (3-way character merge)', () => {
    const r = concurrently(
      board([s1]),
      [{ op: 'patch', id: 's1', set: { text: 'Hello world' }, expect: { text: 'hello world' } }],
      [{ op: 'patch', id: 's1', set: { text: 'hello world!!' }, expect: { text: 'hello world' } }]
    );
    expect(r.state.get('s1')?.text).toBe('Hello world!!');
  });

  test('shape label text merges; other label fields by acceptance order', () => {
    const shape = {
      id: 'r',
      type: 'shape',
      index: 'a0',
      x: 0,
      y: 0,
      w: 100,
      h: 60,
      label: { text: 'abc' },
    };
    const r = concurrently(
      board([shape]),
      [
        {
          op: 'patch',
          id: 'r',
          set: { label: { text: 'Xabc' } },
          expect: { label: { text: 'abc' } },
        },
      ],
      [
        {
          op: 'patch',
          id: 'r',
          set: { label: { text: 'abcY', bold: true } },
          expect: { label: { text: 'abc' } },
        },
      ]
    );
    expect(r.state.get('r')?.label).toEqual({ text: 'XabcY', bold: true });
  });

  test('patch after delete → gone, never a silent re-create', () => {
    const r = concurrently(
      board([s1]),
      [{ op: 'delete', id: 's1' }],
      [{ op: 'patch', id: 's1', set: { text: 'late' } }]
    );
    expect(r.state.has('s1')).toBe(false);
    expect(r.rejected[0]?.reason).toBe('gone');
  });

  test('invalid values are rejected, state untouched', () => {
    const r = applyOps(board([s1]), [{ op: 'patch', id: 's1', set: { x: 'nope' } }]);
    expect(r.state.get('s1')?.x).toBe(0);
    expect(r.rejected[0]?.reason).toBe('invalid');
  });
});

describe('undo (inverse)', () => {
  test('inverse restores the before-state', () => {
    const base = board([s1, s2]);
    const r = applyOps(base, [
      { op: 'patch', id: 's1', set: { x: 10, text: 'x' } },
      { op: 'delete', id: 's2' },
      { op: 'put', el: { id: 's3', type: 'sticky', index: 'a2', x: 0, y: 0, w: 50, h: 50 } },
    ]);
    const back = applyOps(r.state, r.inverse);
    expect([...back.state.values()]).toEqual(
      [...base.values()].map((e) => expect.objectContaining(e))
    );
    expect(back.state.has('s3')).toBe(false);
  });

  test('undo is peer-safe: a field a peer changed since is not reverted', () => {
    const mine = applyOps(board([s1]), [
      { op: 'patch', id: 's1', set: { x: 10, fill: '#ffffff' } },
    ]);
    const peer = applyOps(mine.state, [{ op: 'patch', id: 's1', set: { x: 99 } }]);
    const undo = applyOps(peer.state, mine.inverse);
    expect(undo.state.get('s1')?.x).toBe(99); // peer's later value kept
    expect(undo.state.get('s1')?.fill).toBeUndefined(); // my change reverted
    expect(undo.rejected[0]).toMatchObject({ reason: 'stale', fields: ['x'] });
  });
});

describe('structural fix-ups', () => {
  test('deleting a host freezes bound arrow ends where they were drawn', () => {
    const base = board([
      { id: 'r', type: 'shape', index: 'a0', x: 100, y: 100, w: 100, h: 50 },
      { id: 'a', type: 'arrow', index: 'a1', start: { x: 0, y: 125 }, end: { el: 'r' } },
    ]);
    const before = new Scene(base.values()).arrowWorld(base.get('a') as AnnotationElement);
    const r = applyOps(base, [{ op: 'delete', id: 'r' }]);
    expect(r.state.get('a')?.end).toEqual({ x: before?.x2, y: before?.y2 });
    const back = applyOps(r.state, r.inverse);
    expect(back.state.get('a')?.end).toEqual({ el: 'r' });
    expect(back.state.has('r')).toBe(true);
  });

  test('deleting a section alone re-parents its children without moving them', () => {
    const base = board([
      { id: 'out', type: 'section', index: 'a0', x: 1000, y: 1000, w: 800, h: 800 },
      { id: 'sec', type: 'section', index: 'a0', parent: 'out', x: 100, y: 100, w: 400, h: 300 },
      { ...s1, parent: 'sec', x: 10, y: 20 },
    ]);
    const world = new Scene(base.values()).worldBox('s1');
    const r = applyOps(base, [{ op: 'delete', id: 'sec' }]);
    expect(r.state.get('s1')?.parent).toBe('out');
    expect(new Scene(r.state.values()).worldBox('s1')).toEqual(world);
  });

  test('deleting nested sections parent-first keeps a surviving grandchild in place (review M1)', () => {
    const base = board([
      { id: 'outer', type: 'section', index: 'a0', x: 100, y: 100, w: 800, h: 800 },
      { id: 'inner', type: 'section', index: 'a0', parent: 'outer', x: 50, y: 50, w: 400, h: 400 },
      { ...s1, parent: 'inner', x: 10, y: 10 },
    ]);
    const world = new Scene(base.values()).worldBox('s1');
    const r = applyOps(base, [
      { op: 'delete', id: 'outer' },
      { op: 'delete', id: 'inner' },
    ]);
    expect(r.rejected.map((x) => `${x.reason}:${'id' in x.op ? x.op.id : ''}`)).toEqual([]);
    expect(r.state.get('s1')?.parent).toBeUndefined();
    expect(new Scene(r.state.values()).worldBox('s1')).toEqual(world);
    // …and undo restores the nesting exactly.
    const back = applyOps(r.state, r.inverse);
    expect(back.state.get('s1')).toMatchObject({ parent: 'inner', x: 10, y: 10 });
  });

  test('deleting a subtree together deletes all of it', () => {
    const base = board([
      { id: 'sec', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 300 },
      { ...s1, parent: 'sec' },
    ]);
    const r = applyOps(base, [
      { op: 'delete', id: 's1' },
      { op: 'delete', id: 'sec' },
    ]);
    expect(r.state.size).toBe(0);
  });

  test('a parent cycle or non-container parent is rejected', () => {
    const base = board([
      { id: 'a', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 300 },
      { id: 'b', type: 'section', index: 'a1', parent: 'a', x: 0, y: 0, w: 100, h: 100 },
      s1,
    ]);
    expect(
      applyOps(base, [{ op: 'patch', id: 'a', set: { parent: 'b' } }]).rejected[0]?.reason
    ).toBe('invalid');
    expect(
      applyOps(base, [{ op: 'patch', id: 'b', set: { parent: 's1' } }]).rejected[0]?.reason
    ).toBe('invalid');
  });

  test('a child put before its parent in one batch is accepted', () => {
    const r = applyOps(new Map(), [
      { op: 'put', el: { ...s1, parent: 'sec' } as AnnotationElement },
      { op: 'put', el: { id: 'sec', type: 'section', index: 'a0', x: 0, y: 0, w: 400, h: 300 } },
    ]);
    expect(r.rejected).toEqual([]);
    expect(r.state.get('s1')?.parent).toBe('sec');
  });
});

describe('batch cost (security review: CPU amplification)', () => {
  test('5 000 deletes on a full 20 000-element board (with arrows) stay linear', () => {
    const raw: unknown[] = [];
    for (let i = 0; i < 18_000; i++) {
      raw.push({ id: `s${i}`, type: 'sticky', index: 'a0', x: i, y: 0, w: 50, h: 50 });
    }
    for (let i = 0; i < 2000; i++) {
      raw.push({
        id: `a${i}`,
        type: 'arrow',
        index: 'a1',
        start: { el: `s${i}` },
        end: { el: `s${i + 1}` },
      });
    }
    const base = new Map(validateElements(raw).elements.map((e) => [e.id, e]));
    const ops: Op[] = Array.from({ length: 5000 }, (_, i) => ({ op: 'delete', id: `s${i}` }));
    const t0 = performance.now();
    const r = applyOps(base, ops);
    const ms = performance.now() - t0;
    expect(r.state.has('s0')).toBe(false);
    expect(r.state.get('a10')?.start).toMatchObject({ x: expect.any(Number) }); // frozen, not dropped
    expect(ms).toBeLessThan(1500);
  });

  test('character merges per batch are budgeted', () => {
    const els = Array.from({ length: 200 }, (_, i) => ({ ...s1, id: `t${i}`, text: 'base text' }));
    const base = board(els);
    const head = applyOps(
      base,
      els.map((e) => ({ op: 'patch' as const, id: e.id, set: { text: 'base text!' } }))
    ).state;
    const t0 = performance.now();
    const r = applyOps(
      head,
      els.map((e) => ({
        op: 'patch' as const,
        id: e.id,
        set: { text: 'Base text' },
        expect: { text: 'base text' },
      }))
    );
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.state.get('t0')?.text).toBe('Base text!'); // within budget: merged
    expect(r.state.get('t199')?.text).toBe('Base text'); // past budget: acceptance order
  });
});

describe('diffToOps', () => {
  test('diff → apply reproduces the target', () => {
    const before = board([s1, s2]);
    const after = board([
      { ...s1, x: 5, text: 'changed' },
      { id: 's4', type: 'sticky', index: 'a3', x: 1, y: 1, w: 50, h: 50 },
    ]);
    const ops = diffToOps(before, after);
    const r = applyOps(before, ops);
    expect(new Map([...r.state])).toEqual(after);
    const patch = ops.find((o) => o.op === 'patch');
    expect(patch).toMatchObject({ expect: { x: 0, text: 'hello world' } });
  });
});
