// #113 slice A — the `checkitem` element (contract 113-checklist §5.1): a checklist is a sticky with
// one record per entry. Validation, the canonical bytes, the pure helpers and the registry/schema wiring.

import { describe, expect, test } from 'bun:test';
import { annotationsJsonSchema } from '../annotations/board-schema.ts';
import {
  fromTaskLines,
  isChecklist,
  itemsByList,
  itemsOf,
  MAX_CHECK_ITEMS,
  MAX_CHECK_TEXT,
  progressOf,
  toTaskLines,
} from '../annotations/elements/checkitem.model.ts';
import { FORMAT2_TYPES, REGISTRY, validateElement } from '../annotations/registry.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const AT = '2026-11-08T10:12:00Z';
const stk = (id = 's1', extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 220,
  h: 176,
  text: 'Launch',
  ...extra,
});
const item = (id: string, list: string, index: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'checkitem',
  index,
  list,
  text: id,
  ...extra,
});
const els = (...raw: Record<string, unknown>[]): AnnotationElement[] => {
  const r = validateElements(raw);
  expect(r.dropped).toEqual([]);
  return r.elements;
};

describe('the checkitem record', () => {
  test('is a registered format-2 type with no geometry', () => {
    const def = REGISTRY.get('checkitem');
    expect(def).toBeDefined();
    expect(FORMAT2_TYPES.has('checkitem')).toBe(true);
    expect(def?.caps.metadata).toBe(true);
    expect(def?.caps.box).toBe(false);
    expect(def?.bounds(item('a', 's1', 'a0') as never, {} as never)).toBeNull();
  });

  test('list is required; done must be { by, at }', () => {
    expect(validateElement({ id: 'c1', type: 'checkitem', index: 'a0', text: 'x' }).ok).toBe(false);
    const ok = validateElement(item('c1', 's1', 'a0', { done: { by: 'Jonas', at: AT } }));
    expect(ok.ok && ok.el.done).toEqual({ by: 'Jonas', at: AT });
    // a malformed done is dropped (an invalid field never poisons the record), the entry stays open
    const bad = validateElement(item('c2', 's1', 'a0', { done: { by: 'Jonas' } }));
    expect(bad.ok && bad.el.done).toBeUndefined();
    const flat = validateElement(item('c3', 's1', 'a0', { done: true }));
    expect(flat.ok && flat.el.done).toBeUndefined();
  });

  test('text is one line; an empty entry is valid and stored without text', () => {
    const multi = validateElement(item('c1', 's1', 'a0', { text: 'one\ntwo' }));
    expect(multi.ok && multi.el.text).toBe('onetwo');
    const empty = validateElement(item('c2', 's1', 'a0', { text: '' }));
    expect(empty.ok && empty.el.text === undefined).toBe(true);
    const long = validateElement(item('c3', 's1', 'a0', { text: 'x'.repeat(MAX_CHECK_TEXT + 50) }));
    expect(long.ok && (long.el.text as string).length).toBe(MAX_CHECK_TEXT);
  });

  test('canonical bytes: head, then every other key sorted (a format-1 reader writes the same)', () => {
    const text = serializeBoard(
      els(stk(), item('c1', 's1', 'a0', { done: { by: 'Jonas', at: AT } }))
    );
    const line = text.split('\n').find((l) => l.includes('"checkitem"')) as string;
    expect(Object.keys(JSON.parse(line.replace(/,$/, '')))).toEqual([
      'id',
      'type',
      'index',
      'done',
      'list',
      'text',
    ]);
    // a board round trip is the identity
    expect(serializeBoard(parseBoard(text).elements)).toBe(text);
  });
});

describe('itemsOf / isChecklist / progressOf', () => {
  const board = els(
    stk('s1'),
    stk('s2', { x: 400 }),
    { id: 't1', type: 'text', index: 'a2', x: 0, y: 300, w: 80, h: 20, text: 'note' },
    item('c-b', 's1', 'a1'),
    item('c-a', 's1', 'a0', { done: { by: 'Jonas', at: AT } }),
    item('c-c', 's1', 'a2'),
    item('c-other', 's2', 'a0'),
    item('c-orphan', 'gone', 'a0'),
    item('c-not-sticky', 't1', 'a0')
  );

  test('genuine items of a list, in index order; ties by id', () => {
    expect(itemsOf(board, 's1').map((e) => e.id)).toEqual(['c-a', 'c-b', 'c-c']);
    expect(itemsOf(board, 's2').map((e) => e.id)).toEqual(['c-other']);
    const tied = els(stk(), item('z', 's1', 'a0'), item('y', 's1', 'a0'));
    expect(itemsOf(tied, 's1').map((e) => e.id)).toEqual(['y', 'z']);
  });

  test('orphans (list gone, or not a sticky) are inert', () => {
    expect(itemsOf(board, 'gone')).toEqual([]);
    expect(itemsOf(board, 't1')).toEqual([]);
    const byList = itemsByList(board);
    expect([...byList.keys()].sort()).toEqual(['s1', 's2']);
  });

  test('a sticky with at least one genuine item is a checklist', () => {
    expect(isChecklist(board, 's1')).toBe(true);
    expect(isChecklist(board, 's2')).toBe(true);
    expect(isChecklist(board, 't1')).toBe(false);
    expect(isChecklist(els(stk()), 's1')).toBe(false);
  });

  test('progress counts the open and the done', () => {
    expect(progressOf(itemsOf(board, 's1'))).toEqual({ done: 1, total: 3 });
    expect(progressOf([])).toEqual({ done: 0, total: 0 });
  });

  test('a list is capped at MAX_CHECK_ITEMS', () => {
    const many = els(
      stk(),
      ...Array.from({ length: MAX_CHECK_ITEMS + 5 }, (_, i) =>
        item(`c${String(i).padStart(4, '0')}`, 's1', `a${String(i).padStart(4, '0')}`)
      )
    );
    expect(itemsOf(many, 's1')).toHaveLength(MAX_CHECK_ITEMS);
  });
});

describe('task lines', () => {
  test('fromTaskLines reads ☐ ☑ ✓ and Markdown task lines; the rest is the title', () => {
    const r = fromTaskLines(
      [
        'Launch',
        '☐ Write the post',
        '☑ Record the demo',
        '- [ ] Ship',
        '- [x] Tell people',
        '* [ ] Rest',
        '✓ Done',
      ].join('\n')
    );
    expect(r.title).toBe('Launch');
    expect(r.items).toEqual([
      { text: 'Write the post', done: false },
      { text: 'Record the demo', done: true },
      { text: 'Ship', done: false },
      { text: 'Tell people', done: true },
      { text: 'Rest', done: false },
      { text: 'Done', done: true },
    ]);
  });

  test('the old template text (a lone ☐) is one empty open entry', () => {
    expect(fromTaskLines('☐')).toEqual({ title: '', items: [{ text: '', done: false }] });
  });

  test('plain prose has a title and no entries', () => {
    expect(fromTaskLines('just a note\nwith two lines')).toEqual({
      title: 'just a note\nwith two lines',
      items: [],
    });
  });

  test('toTaskLines is the Markdown form and round-trips', () => {
    const md = toTaskLines('Launch', [
      { text: 'Write the post', done: false },
      { text: 'Record the demo', done: true },
    ]);
    expect(md).toBe('Launch\n- [ ] Write the post\n- [x] Record the demo');
    expect(fromTaskLines(md)).toEqual({
      title: 'Launch',
      items: [
        { text: 'Write the post', done: false },
        { text: 'Record the demo', done: true },
      ],
    });
    expect(toTaskLines('', [{ text: 'a', done: false }])).toBe('- [ ] a');
  });
});

describe('registry and schema wiring', () => {
  test('the generated board schema carries el-checkitem', () => {
    const s = JSON.stringify(annotationsJsonSchema());
    expect(s).toContain('el-checkitem');
  });
});
