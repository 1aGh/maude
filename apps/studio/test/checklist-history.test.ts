// #113 slice A — Version history words for a checklist (history/describe-annotations.ts): an entry is a
// "Checklist item", a tick is "ticked", not a bare "Checklist item: Done changed".

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, serializeBoard } from '../annotations/schema';
import { describeChanges } from '../history/describe';
import { annotationsLane } from '../history/describe-annotations';

const tsx = readFileSync(
  join(import.meta.dir, 'fixtures', 'describe-corpus', 'canvas.tsx'),
  'utf8'
);
const board = (...els: Array<Record<string, unknown>>) =>
  serializeBoard(els.map((e, i) => canonical({ index: `a${i}`, ...e })));
const stk = { id: 's1', type: 'sticky', x: 10, y: 10, w: 220, h: 176, text: 'Launch' };
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'checkitem',
  list: 's1',
  text: `Entry ${id}`,
  ...extra,
});
const tick = { done: { by: 'Jonas', at: '2026-11-08T10:12:00Z' } };

const words = (before: string, after: string) =>
  describeChanges(
    'fixture.tsx',
    { tsx, annotations: before },
    { tsx, annotations: after },
    { lanes: [annotationsLane] }
  ).changes.map((c) => c.words);

describe('checklist words', () => {
  test('added and removed entries', () => {
    expect(words(board(stk), board(stk, item('c1')))).toEqual(['Checklist item added']);
    expect(words(board(stk, item('c1')), board(stk))).toEqual(['Checklist item removed']);
    expect(words(board(stk), board(stk, item('c1'), item('c2'), item('c3')))).toEqual([
      '3 checklist items added',
    ]);
  });

  test('ticked and unticked', () => {
    expect(words(board(stk, item('c1')), board(stk, item('c1', tick)))).toEqual([
      'Checklist item ticked',
    ]);
    expect(words(board(stk, item('c1', tick)), board(stk, item('c1')))).toEqual([
      'Checklist item unticked',
    ]);
    expect(
      words(board(stk, item('c1'), item('c2')), board(stk, item('c1', tick), item('c2', tick)))
    ).toEqual(['2 checklist items ticked']);
  });

  test('reworded', () => {
    expect(
      words(board(stk, item('c1')), board(stk, item('c1', { text: 'Write the post' })))
    ).toEqual(['Checklist item: “Entry c1” → “Write the post”']);
  });

  test('reordering alone is nothing (z-order housekeeping)', () => {
    expect(
      words(board(stk, item('c1', { index: 'a1' })), board(stk, item('c1', { index: 'a5' })))
    ).toEqual([]);
  });
});
