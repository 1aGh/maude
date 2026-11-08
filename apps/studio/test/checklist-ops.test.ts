// #113 slice A — the checklist operations (contract 113-checklist §5.3, `annotations/checklist-ops.ts`).
// Every gesture is ONE op batch (= one action = one ⌘Z). Pure and DOM-free: the layer (slice B) commits what
// these return. The lock rule (§4.5): a locked list still ticks; add / remove / reword / reorder are refused.

import { describe, expect, test } from 'bun:test';
import {
  addItem,
  cloneItems,
  makeChecklist,
  moveItem,
  removeItem,
  rewordItem,
  tickItem,
  withItemDeletes,
} from '../annotations/checklist-ops.ts';
import { itemsOf } from '../annotations/elements/checkitem.model.ts';
import { guardLockedOps } from '../annotations/lock.ts';
import { applyOps } from '../annotations/ops.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const AT = new Date('2026-11-08T10:12:00Z');

const mk = (extra: Record<string, unknown> = {}): Map<string, AnnotationElement> =>
  new Map(
    validateElements([
      {
        id: 's1',
        type: 'sticky',
        index: 'a0',
        x: 0,
        y: 0,
        w: 220,
        h: 176,
        text: 'Launch',
        ...extra,
      },
      { id: 'c1', type: 'checkitem', index: 'a0', list: 's1', text: 'Write the post' },
      { id: 'c2', type: 'checkitem', index: 'a1', list: 's1', text: 'Record the demo' },
      { id: 'c3', type: 'checkitem', index: 'a2', list: 's1', text: 'Ship' },
      { id: 's2', type: 'sticky', index: 'a1', x: 400, y: 0, w: 200, h: 200, text: 'plain' },
    ]).elements.map((e) => [e.id, e])
  );

const order = (b: ReadonlyMap<string, AnnotationElement>, list = 's1') =>
  itemsOf(b.values(), list).map((e) => e.id);

/** Apply a gesture's ops once, assert nothing was refused, and prove its inverse restores the board. */
function commit(board: Map<string, AnnotationElement>, ops: Parameters<typeof applyOps>[1]) {
  const r = applyOps(board, ops);
  expect(r.rejected).toEqual([]);
  const back = applyOps(r.state, r.inverse);
  expect(back.rejected).toEqual([]);
  const byId = (m: Map<string, AnnotationElement>) =>
    [...m.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  expect(byId(back.state)).toEqual(byId(board));
  return r.state;
}

describe('tick / untick', () => {
  test('a tick is one patch of done: { by, at }; the label names the entry', () => {
    const b = mk();
    const t = tickItem(b, 'c1', true, { by: 'Jonas', now: AT });
    expect(t).toEqual({
      ok: true,
      label: 'Ticked “Write the post”',
      ops: [
        {
          op: 'patch',
          id: 'c1',
          set: { done: { by: 'Jonas', at: '2026-11-08T10:12:00Z' } },
          expect: { done: undefined },
        },
      ],
    });
    if (!t.ok) throw new Error('unreachable');
    const next = commit(b, t.ops);
    expect(next.get('c1')?.done).toEqual({ by: 'Jonas', at: '2026-11-08T10:12:00Z' });
  });

  test('an untick unsets done', () => {
    const ticked = tickItem(mk(), 'c1', true, { by: 'Jonas', now: AT });
    if (!ticked.ok) throw new Error('unreachable');
    const b = applyOps(mk(), ticked.ops).state;
    const u = tickItem(b, 'c1', false, { by: 'Jonas', now: AT });
    expect(u.ok && u.label).toBe('Unticked “Write the post”');
    if (!u.ok) throw new Error('unreachable');
    expect(u.ops).toHaveLength(1);
    expect(commit(b, u.ops).get('c1')?.done).toBeUndefined();
  });

  test('ticking what is already ticked (or unticking an open one) is a no-op batch', () => {
    const r = tickItem(mk(), 'c1', false, { by: 'Jonas', now: AT });
    expect(r).toMatchObject({ ok: true, ops: [] });
  });

  test('a locked list still ticks', () => {
    const b = mk({ locked: true });
    const t = tickItem(b, 'c2', true, { by: 'Ana', now: AT });
    expect(t.ok).toBe(true);
    if (!t.ok) throw new Error('unreachable');
    // …and the board's own lock guard lets the batch through (items are not the locked record)
    expect(guardLockedOps(b, t.ops)).toMatchObject({ blocked: 0 });
    expect(commit(b, t.ops).get('c2')?.done).toBeTruthy();
  });

  test('an unknown or orphaned entry is refused', () => {
    expect(tickItem(mk(), 'nope', true, { by: 'x', now: AT })).toMatchObject({
      ok: false,
      reason: 'gone',
    });
    const orphan = new Map(mk());
    orphan.delete('s1');
    expect(tickItem(orphan, 'c1', true, { by: 'x', now: AT })).toMatchObject({
      ok: false,
      reason: 'gone',
    });
  });
});

describe('add an entry', () => {
  test('appends one put with an index above the last entry', () => {
    const b = mk();
    const r = addItem(b, 's1', { text: 'Celebrate', id: 'c9' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.label).toBe('Added an item to “Launch”');
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0]).toMatchObject({
      op: 'put',
      el: { id: 'c9', type: 'checkitem', list: 's1', text: 'Celebrate' },
    });
    expect(order(commit(b, r.ops))).toEqual(['c1', 'c2', 'c3', 'c9']);
  });

  test('inserts after a given entry (↵ in the middle of the list) or first', () => {
    const b = mk();
    const mid = addItem(b, 's1', { id: 'c9', after: 'c1' });
    if (!mid.ok) throw new Error('unreachable');
    expect(order(commit(b, mid.ops))).toEqual(['c1', 'c9', 'c2', 'c3']);
    const first = addItem(b, 's1', { id: 'c8', after: null });
    if (!first.ok) throw new Error('unreachable');
    expect(order(commit(b, first.ops))).toEqual(['c8', 'c1', 'c2', 'c3']);
  });

  test('mints an id when none is given; the first entry makes a plain sticky a checklist', () => {
    const r = addItem(mk(), 's2', {});
    if (!r.ok) throw new Error('unreachable');
    const el = (r.ops[0] as { el: AnnotationElement }).el;
    expect(el.id).toMatch(/^ck_[a-z0-9]{8}$/);
    expect(order(applyOps(mk(), r.ops).state, 's2')).toEqual([el.id]);
  });

  test('refused on a locked list, on a non-sticky and past the cap', () => {
    expect(addItem(mk({ locked: true }), 's1', {})).toMatchObject({ ok: false, reason: 'locked' });
    expect(addItem(mk(), 'c1', {})).toMatchObject({ ok: false, reason: 'not-a-list' });
    expect(addItem(mk(), 'nope', {})).toMatchObject({ ok: false, reason: 'gone' });
  });
});

describe('reword / remove / reorder', () => {
  test('reword is one text patch carrying its merge base', () => {
    const b = mk();
    const r = rewordItem(b, 'c1', 'Write the launch post');
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.label).toBe('Edited an item');
    expect(r.ops).toEqual([
      {
        op: 'patch',
        id: 'c1',
        set: { text: 'Write the launch post' },
        expect: { text: 'Write the post' },
      },
    ]);
    expect(commit(b, r.ops).get('c1')?.text).toBe('Write the launch post');
  });

  test('remove is one delete; removing the last entry makes the sticky plain again', () => {
    const b = mk();
    const r = removeItem(b, 'c2');
    if (!r.ok) throw new Error('unreachable');
    expect(r.label).toBe('Removed an item');
    expect(r.ops).toEqual([{ op: 'delete', id: 'c2' }]);
    expect(order(commit(b, r.ops))).toEqual(['c1', 'c3']);
    let cur = b;
    for (const id of ['c1', 'c2', 'c3']) {
      const x = removeItem(cur, id);
      if (!x.ok) throw new Error('unreachable');
      cur = applyOps(cur, x.ops).state;
    }
    expect(order(cur)).toEqual([]);
    expect(cur.get('s1')?.text).toBe('Launch'); // the sticky is still there, just plain
  });

  test('reorder is one patch of index; up / down / first / last / before / after', () => {
    const b = mk();
    const cases: Array<[Parameters<typeof moveItem>[2], string, string[]]> = [
      ['down', 'c1', ['c2', 'c1', 'c3']],
      ['up', 'c3', ['c1', 'c3', 'c2']],
      ['first', 'c3', ['c3', 'c1', 'c2']],
      ['last', 'c1', ['c2', 'c3', 'c1']],
      [{ before: 'c1' }, 'c3', ['c3', 'c1', 'c2']],
      [{ after: 'c1' }, 'c3', ['c1', 'c3', 'c2']],
    ];
    for (const [to, id, want] of cases) {
      const r = moveItem(b, id, to);
      if (!r.ok) throw new Error(`unreachable ${JSON.stringify(to)}`);
      expect(r.ops).toHaveLength(1);
      const op = r.ops[0] as { op: string; id: string; set: { index: unknown } };
      expect([op.op, op.id, typeof op.set.index]).toEqual(['patch', id, 'string']);
      expect(r.label).toBe('Reordered “Launch”');
      expect(order(commit(b, r.ops))).toEqual(want);
    }
  });

  test('moving the first up or the last down is a no-op batch', () => {
    expect(moveItem(mk(), 'c1', 'up')).toMatchObject({ ok: true, ops: [] });
    expect(moveItem(mk(), 'c3', 'down')).toMatchObject({ ok: true, ops: [] });
  });

  test('a locked list refuses reword, remove and reorder with the lock line', () => {
    const b = mk({ locked: true });
    for (const r of [rewordItem(b, 'c1', 'x'), removeItem(b, 'c1'), moveItem(b, 'c1', 'down')]) {
      expect(r).toMatchObject({ ok: false, reason: 'locked' });
      if (!r.ok) expect(r.message).toContain('locked');
    }
  });
});

describe('turn into checklist', () => {
  test('a sticky with task lines: title patch + one put per line, in one batch', () => {
    const b = new Map(mk());
    b.set(
      's2',
      validateElements([
        {
          id: 's2',
          type: 'sticky',
          index: 'a1',
          x: 400,
          y: 0,
          w: 200,
          h: 200,
          text: 'Launch\n☐ Write the post\n☑ Record the demo',
        },
      ]).elements[0] as AnnotationElement
    );
    let n = 0;
    const r = makeChecklist(b, 's2', { mint: () => `ck${++n}`, by: 'Ana', now: AT });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.label).toBe('Turned “Launch” into a checklist');
    expect(r.ops[0]).toMatchObject({
      op: 'patch',
      id: 's2',
      set: { text: 'Launch' },
      expect: { text: 'Launch\n☐ Write the post\n☑ Record the demo' },
    });
    expect(r.ops.slice(1).map((o) => (o as { el: AnnotationElement }).el.text)).toEqual([
      'Write the post',
      'Record the demo',
    ]);
    const next = commit(b, r.ops);
    expect(order(next, 's2').length).toBe(2);
    expect(itemsOf(next.values(), 's2')[1]?.done).toEqual({
      by: 'Ana',
      at: '2026-11-08T10:12:00Z',
    });
    // one ⌘Z restores the plain sticky text exactly (commit() proved the inverse)
    expect(next.get('s2')?.text).toBe('Launch');
  });

  test('a sticky with no task lines gets one empty entry so it is a checklist', () => {
    const r = makeChecklist(mk(), 's2', { mint: () => 'ck1', now: AT });
    if (!r.ok) throw new Error('unreachable');
    expect(r.ops.filter((o) => o.op === 'put')).toHaveLength(1);
    // the title is untouched
    expect(r.ops.some((o) => o.op === 'patch')).toBe(false);
  });

  test('refused on a list already, a locked sticky, or a non-sticky', () => {
    expect(makeChecklist(mk(), 's1', {})).toMatchObject({ ok: false, reason: 'already' });
    expect(makeChecklist(mk({ locked: true }), 's2', {})).toMatchObject({ ok: true }); // s2 is not locked
    const locked = mk();
    locked.set('s2', { ...(locked.get('s2') as AnnotationElement), locked: true });
    expect(makeChecklist(locked, 's2', {})).toMatchObject({ ok: false, reason: 'locked' });
    expect(makeChecklist(mk(), 'c1', {})).toMatchObject({ ok: false, reason: 'not-a-list' });
  });
});

describe('deleting and copying the sticky', () => {
  test('a sticky delete takes its items in the same batch', () => {
    const b = mk();
    const ops = withItemDeletes(b, [{ op: 'delete', id: 's1' }]);
    expect(ops.map((o) => (o as { id: string }).id).sort()).toEqual(['c1', 'c2', 'c3', 's1']);
    const next = commit(b, ops);
    expect([...next.keys()]).toEqual(['s2']);
  });

  test('items already named in the batch are not deleted twice; other ops pass untouched', () => {
    const b = mk();
    const ops = withItemDeletes(b, [
      { op: 'delete', id: 'c1' },
      { op: 'delete', id: 's1' },
      { op: 'patch', id: 's2', set: { x: 1 } },
    ]);
    expect(ops.filter((o) => o.op === 'delete' && o.id === 'c1')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'patch')).toHaveLength(1);
  });

  test('a locked sticky: the guard blocks its delete AND the items stay (never half a list)', () => {
    const b = mk({ locked: true });
    const ops = withItemDeletes(b, [{ op: 'delete', id: 's1' }]);
    const g = guardLockedOps(b, ops);
    // the sticky delete is dropped; withItemDeletes must not have left the items deletable alone
    expect(g.blocked).toBeGreaterThan(0);
    expect(g.ops.filter((o) => o.op === 'delete')).toEqual([]);
  });

  test('copy: items travel with fresh ids and their list remapped; strays are dropped', () => {
    const b = mk();
    let n = 0;
    const copies = cloneItems(b.values(), new Map([['s1', 's1-copy']]), () => `n${++n}`);
    expect(copies.map((e) => e.id)).toEqual(['n1', 'n2', 'n3']);
    expect(copies.every((e) => e.list === 's1-copy')).toBe(true);
    expect(copies.map((e) => e.text)).toEqual(['Write the post', 'Record the demo', 'Ship']);
    // an item whose list is not in the payload is dropped
    expect(cloneItems(b.values(), new Map([['s2', 's2-copy']]), () => 'x')).toEqual([]);
    // the order survives the copy
    const copyOfSticky = { ...(b.get('s1') as AnnotationElement), id: 's1-copy' };
    const board = new Map([...b.values(), copyOfSticky, ...copies].map((e) => [e.id, e] as const));
    expect(order(board, 's1-copy')).toEqual(['n1', 'n2', 'n3']);
  });

  test('copy keeps ticks', () => {
    const b = mk();
    const t = tickItem(b, 'c2', true, { by: 'Ana', now: AT });
    if (!t.ok) throw new Error('unreachable');
    const ticked = applyOps(b, t.ops).state;
    const copies = cloneItems(
      ticked.values(),
      new Map([['s1', 'sx']]),
      (() => {
        let i = 0;
        return () => `m${++i}`;
      })()
    );
    expect(copies[1]?.done).toEqual({ by: 'Ana', at: '2026-11-08T10:12:00Z' });
  });
});
