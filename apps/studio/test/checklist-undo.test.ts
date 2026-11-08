// #113 slice A — undo of checklist gestures (contract 113-checklist §5.3 "one batch = one action = one ⌘Z",
// §5.7 "Under an AI run the ops carry the run tag, so Undo this chat covers the AI's ticks"). The layer's
// undo stack replays `applyOps(...).inverse`; these prove the inverse of each gesture, and of an AI batch.
// The run tag itself is op-agnostic (annotate-run-binding.test.ts): what matters here is that an AI checklist
// write is ONE self-inverting batch.

import { describe, expect, test } from 'bun:test';
import { AiBatch } from '../annotations/ai-write.ts';
import { makeChecklist, tickItem } from '../annotations/checklist-ops.ts';
import { itemsOf } from '../annotations/elements/checkitem.model.ts';
import { applyOps } from '../annotations/ops.ts';
import { validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const AT = new Date('2026-11-08T10:12:00Z');
const mk = (rows: Record<string, unknown>[]): Map<string, AnnotationElement> =>
  new Map(validateElements(rows).elements.map((e) => [e.id, e]));
const sticky = (id: string, text: string) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text,
});
const item = (id: string, index: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'checkitem',
  index,
  list: 's1',
  text: id,
  ...extra,
});

describe('a person’s gestures', () => {
  test('tick → ⌘Z unticks', () => {
    const b = mk([sticky('s1', 'Launch'), item('c1', 'a0')]);
    const t = tickItem(b, 'c1', true, { by: 'Jonas', now: AT });
    if (!t.ok) throw new Error('unreachable');
    const done = applyOps(b, t.ops);
    expect(done.state.get('c1')?.done).toBeTruthy();
    const undone = applyOps(done.state, done.inverse);
    expect(undone.rejected).toEqual([]);
    expect(undone.state.get('c1')?.done).toBeUndefined();
    expect([...undone.state.values()]).toEqual([...b.values()]);
  });

  test('undo reverts YOUR tick and keeps a teammate’s later reword of the same entry', () => {
    const b = mk([sticky('s1', 'Launch'), item('c1', 'a0')]);
    const t = tickItem(b, 'c1', true, { by: 'Jonas', now: AT });
    if (!t.ok) throw new Error('unreachable');
    const mine = applyOps(b, t.ops);
    const theirs = applyOps(mine.state, [{ op: 'patch', id: 'c1', set: { text: 'Reworded' } }]);
    const undone = applyOps(theirs.state, mine.inverse);
    expect(undone.state.get('c1')?.done).toBeUndefined();
    expect(undone.state.get('c1')?.text).toBe('Reworded');
  });

  test('Turn into checklist → one ⌘Z restores the plain sticky text and removes every entry', () => {
    const b = mk([sticky('s1', 'Launch\n☐ one\n☑ two\n☐ three')]);
    const r = makeChecklist(b, 's1', { by: 'Jonas', now: AT });
    if (!r.ok) throw new Error('unreachable');
    const done = applyOps(b, r.ops);
    expect(done.state.get('s1')?.text).toBe('Launch');
    expect(itemsOf(done.state.values(), 's1')).toHaveLength(3);
    const undone = applyOps(done.state, done.inverse);
    expect(undone.rejected).toEqual([]);
    expect(undone.state.get('s1')?.text).toBe('Launch\n☐ one\n☑ two\n☐ three');
    expect(itemsOf(undone.state.values(), 's1')).toHaveLength(0);
    expect([...undone.state.keys()]).toEqual(['s1']);
  });
});

describe('the AI’s writes (one run = one action)', () => {
  test('a tick by the AI is a single patch whose inverse unticks', () => {
    const b = mk([sticky('s1', 'Launch'), item('c1', 'a0')]);
    const batch = new AiBatch(b.values(), { now: () => AT });
    batch.update({ id: 'c1', done: true });
    expect(batch.ops).toHaveLength(1);
    expect(batch.ops[0]).toMatchObject({
      op: 'patch',
      id: 'c1',
      set: { done: { by: 'AI', at: '2026-11-08T10:12:00Z' } },
    });
    const applied = applyOps(b, batch.ops);
    expect(applied.rejected).toEqual([]);
    const undone = applyOps(applied.state, applied.inverse);
    expect(undone.state.get('c1')?.done).toBeUndefined();
  });

  test('a whole AI checklist (sticky + items) is undone by one inverse batch', () => {
    const b = mk([]);
    const batch = new AiBatch(b.values(), { now: () => AT });
    batch.create('sticky', {
      text: 'Launch',
      x: 0,
      y: 0,
      items: ['one', { text: 'two', done: true }],
    });
    expect(batch.ops.length).toBe(3);
    const applied = applyOps(b, batch.ops);
    expect(applied.rejected).toEqual([]);
    expect(applied.state.size).toBe(3);
    const undone = applyOps(applied.state, applied.inverse);
    expect(undone.rejected).toEqual([]);
    expect(undone.state.size).toBe(0);
  });
});
