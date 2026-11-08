// #113 slice A — the AI half of the checklist (contract 113-checklist §5.7): `maude design annotate` writes
// `checkitem` records (create / the `items` shorthand / update done), `read-annotations` prints a checklist
// sticky with its items and progress. Drives the bins as subprocesses against a temp design root.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemsOf, MAX_CHECK_ITEMS } from '../annotations/elements/checkitem.model.ts';
import { canonical, parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const BIN = new URL('../bin/annotate.mjs', import.meta.url).pathname;
const READER = new URL('../bin/read-annotations.mjs', import.meta.url).pathname;

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'annotate-checklist-'));
  mkdirSync(join(root, '.design'), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

interface Run {
  code: number;
  out: string;
  err: string;
}
function run(bin: string, args: string[], stdin?: unknown): Run {
  const proc = Bun.spawnSync(['bun', bin, ...args, '--root', root], {
    stdin:
      stdin === undefined
        ? undefined
        : new TextEncoder().encode(typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
  });
  return {
    code: proc.exitCode ?? 1,
    out: new TextDecoder().decode(proc.stdout),
    err: new TextDecoder().decode(proc.stderr),
  };
}
const annotate = (args: string[], stdin?: unknown) => run(BIN, args, stdin);
const read = (args: string[]) => run(READER, args);

const pathOf = (slug: string) => join(root, '.design', `${slug}.annotations.json`);
const boardText = (slug: string) =>
  existsSync(pathOf(slug)) ? readFileSync(pathOf(slug), 'utf8') : '';
const board = (slug: string): AnnotationElement[] =>
  boardText(slug) ? parseBoard(boardText(slug)).elements : [];
function seed(slug: string, elements: Record<string, unknown>[]): void {
  writeFileSync(pathOf(slug), serializeBoard(elements.map((e) => canonical(e as never))));
}
const stickyRec = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: 'Launch',
  ...extra,
});
const itemRec = (id: string, list: string, index: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'checkitem',
  index,
  list,
  text: id,
  ...extra,
});
function expectCanonical(slug: string): void {
  const text = boardText(slug);
  const parsed = parseBoard(text);
  expect(parsed.dropped).toEqual([]);
  expect(serializeBoard(parsed.elements)).toBe(text);
}

describe('annotate: creating a checklist', () => {
  test('the items shorthand on a sticky create expands into item records; items is never stored', () => {
    const r = annotate(['ui/Cl.tsx'], {
      ops: [
        {
          op: 'create',
          type: 'sticky',
          ref: '@l',
          text: 'Launch',
          x: 0,
          y: 0,
          items: ['Write the post', { text: 'Record the demo', done: true }, ''],
        },
      ],
    });
    expect(r.code).toBe(0);
    const { refs } = JSON.parse(r.out);
    expectCanonical('ui-cl');
    const els = board('ui-cl');
    const sticky = els.find((e) => e.id === refs['@l']) as AnnotationElement;
    expect(sticky.type).toBe('sticky');
    expect('items' in sticky).toBe(false);
    const items = itemsOf(els, sticky.id);
    expect(items.map((e) => e.text)).toEqual(['Write the post', 'Record the demo', undefined]);
    expect(items.every((e) => e.list === sticky.id)).toBe(true);
    expect(items.every((e) => (e.author as { kind: string }).kind === 'ai')).toBe(true);
    expect(items[0]?.done).toBeUndefined();
    expect(items[1]?.done).toMatchObject({ by: 'AI' });
    expect(((items[1] as AnnotationElement).done as { at: string }).at).toMatch(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/
    );
  });

  test('a single checkitem create names its list by @ref; done: true is stamped as the AI', () => {
    const r = annotate(['ui/Cl2.tsx'], {
      ops: [
        { op: 'create', type: 'sticky', ref: '@l', text: 'Todo', x: 0, y: 0 },
        { op: 'create', type: 'checkitem', list: '@l', text: 'First' },
        { op: 'create', type: 'checkitem', list: '@l', text: 'Second', done: true },
      ],
    });
    expect(r.code).toBe(0);
    const { refs } = JSON.parse(r.out);
    const items = itemsOf(board('ui-cl2'), refs['@l']);
    expect(items.map((e) => e.text)).toEqual(['First', 'Second']);
    expect(items[1]?.done).toMatchObject({ by: 'AI' });
    // appended in order: each new entry sorts after the last
    expect((items[1] as AnnotationElement).index > (items[0] as AnnotationElement).index).toBe(
      true
    );
    expectCanonical('ui-cl2');
  });

  test('a list that is not a sticky exits 2 and writes nothing', () => {
    seed('ui-bad', [
      stickyRec('s1'),
      { id: 't1', type: 'text', index: 'a1', x: 0, y: 300, w: 80, h: 20, text: 'note' },
    ]);
    const before = boardText('ui-bad');
    const r = annotate(['ui/Bad.tsx'], {
      ops: [{ op: 'create', type: 'checkitem', list: 't1', text: 'nope' }],
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain('sticky');
    expect(boardText('ui-bad')).toBe(before);
    const gone = annotate(['ui/Bad.tsx'], {
      ops: [{ op: 'create', type: 'checkitem', list: 'missing', text: 'nope' }],
    });
    expect(gone.code).toBe(2);
    expect(boardText('ui-bad')).toBe(before);
  });

  test('a checkitem create without a list, or the items shorthand on a non-sticky, exits 2', () => {
    seed('ui-bad2', [stickyRec('s1')]);
    const before = boardText('ui-bad2');
    expect(
      annotate(['ui/Bad2.tsx'], { ops: [{ op: 'create', type: 'checkitem', text: 'x' }] }).code
    ).toBe(2);
    const onText = annotate(['ui/Bad2.tsx'], {
      ops: [{ op: 'create', type: 'text', text: 'x', x: 0, y: 0, items: ['a'] }],
    });
    expect(onText.code).toBe(2);
    expect(boardText('ui-bad2')).toBe(before);
  });

  test('a list past MAX_CHECK_ITEMS exits 2 and writes nothing', () => {
    seed('ui-cap', [stickyRec('s1')]);
    const before = boardText('ui-cap');
    const r = annotate(['ui/Cap.tsx'], {
      ops: [
        {
          op: 'create',
          type: 'sticky',
          text: 'Big',
          x: 300,
          y: 0,
          items: Array.from({ length: MAX_CHECK_ITEMS + 1 }, (_, i) => `item ${i}`),
        },
      ],
    });
    expect(r.code).toBe(2);
    expect(r.err).toContain(String(MAX_CHECK_ITEMS));
    expect(boardText('ui-cap')).toBe(before);
  });

  test('--wrap-section never wraps the item records of a checklist it just made', () => {
    const r = annotate(['ui/Wrap.tsx', '--ops', '-', '--wrap-section', '--title', 'Plan'], {
      ops: [{ op: 'create', type: 'sticky', text: 'Launch', x: 0, y: 0, items: ['a', 'b'] }],
    });
    expect(r.code).toBe(0);
    const els = board('ui-wrap');
    const items = els.filter((e) => e.type === 'checkitem');
    expect(items).toHaveLength(2);
    expect(items.every((e) => e.parent === undefined)).toBe(true);
    expect(els.find((e) => e.type === 'sticky')?.parent).toBeDefined();
  });
});

describe('annotate: ticking and editing', () => {
  const seedList = (slug: string, extra: Record<string, unknown> = {}) =>
    seed(slug, [
      stickyRec('s1', extra),
      itemRec('c1', 's1', 'a0'),
      itemRec('c2', 's1', 'a1', { done: { by: 'Jonas', at: '2026-11-08T10:12:00Z' } }),
    ]);
  const itemsNow = (slug: string) => itemsOf(board(slug), 's1');

  test('update done: true ticks as the AI; done: false (or null) unticks', () => {
    seedList('ui-tick');
    expect(annotate(['ui/Tick.tsx'], { ops: [{ op: 'update', id: 'c1', done: true }] }).code).toBe(
      0
    );
    expect(itemsNow('ui-tick')[0]?.done).toMatchObject({ by: 'AI' });
    expect(annotate(['ui/Tick.tsx'], { ops: [{ op: 'update', id: 'c2', done: false }] }).code).toBe(
      0
    );
    expect(itemsNow('ui-tick')[1]?.done).toBeUndefined();
    expect(annotate(['ui/Tick.tsx'], { ops: [{ op: 'update', id: 'c1', done: null }] }).code).toBe(
      0
    );
    expect(itemsNow('ui-tick')[0]?.done).toBeUndefined();
    expectCanonical('ui-tick');
  });

  test('the agent never forges who ticked: an object value is refused', () => {
    seedList('ui-forge');
    const before = boardText('ui-forge');
    const r = annotate(['ui/Forge.tsx'], {
      ops: [{ op: 'update', id: 'c1', done: { by: 'Jonas', at: '2026-01-01T00:00:00Z' } }],
    });
    expect(r.code).toBe(2);
    expect(boardText('ui-forge')).toBe(before);
  });

  test('set-text / update text rewords an entry; delete removes it', () => {
    seedList('ui-edit');
    expect(
      annotate(['ui/Edit.tsx'], { ops: [{ op: 'set-text', id: 'c1', text: 'Reworded' }] }).code
    ).toBe(0);
    expect(itemsNow('ui-edit')[0]?.text).toBe('Reworded');
    expect(annotate(['ui/Edit.tsx'], { ops: [{ op: 'delete', id: 'c2' }] }).code).toBe(0);
    expect(itemsNow('ui-edit').map((e) => e.id)).toEqual(['c1']);
  });

  test('deleting the sticky deletes its items in the same batch', () => {
    seedList('ui-del');
    const r = annotate(['ui/Del.tsx'], { ops: [{ op: 'delete', id: 's1' }] });
    expect(r.code).toBe(0);
    expect(board('ui-del')).toEqual([]);
  });

  test('a locked list still ticks, but add / reword / remove / reorder / delete are refused', () => {
    seedList('ui-lock', { locked: true });
    expect(annotate(['ui/Lock.tsx'], { ops: [{ op: 'update', id: 'c1', done: true }] }).code).toBe(
      0
    );
    expect(itemsNow('ui-lock')[0]?.done).toMatchObject({ by: 'AI' });
    const before = boardText('ui-lock');
    for (const op of [
      { op: 'create', type: 'checkitem', list: 's1', text: 'new' },
      { op: 'set-text', id: 'c1', text: 'changed' },
      { op: 'delete', id: 'c1' },
      { op: 'reorder', id: 'c1', to: 'front' },
      { op: 'delete', id: 's1' },
    ]) {
      const r = annotate(['ui/Lock.tsx'], { ops: [op] });
      expect(r.code).toBe(2);
      expect(r.err).toContain('locked');
      expect(boardText('ui-lock')).toBe(before);
    }
  });
});

describe('read-annotations', () => {
  test('a checklist sticky carries items [{ id, text, done, doneBy? }] and progress; items are not elements', () => {
    seed('ui-read', [
      stickyRec('s1'),
      itemRec('c1', 's1', 'a0'),
      itemRec('c2', 's1', 'a1', { done: { by: 'Jonas', at: '2026-11-08T10:12:00Z' } }),
      itemRec('c3', 's1', 'a2', { done: { by: 'AI', at: '2026-11-08T10:13:00Z' } }),
      itemRec('c-orphan', 'gone', 'a0'),
    ]);
    const r = read(['ui/Read.tsx']);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.out) as { elements: Array<Record<string, unknown>> };
    expect(out.elements.map((e) => e.id)).toEqual(['s1']);
    const s = out.elements[0] as Record<string, unknown>;
    expect(s.progress).toBe('2/3');
    expect(s.items).toEqual([
      { id: 'c1', text: 'c1', done: false },
      { id: 'c2', text: 'c2', done: true, doneBy: 'Jonas' },
      { id: 'c3', text: 'c3', done: true, doneBy: 'AI' },
    ]);
  });

  test('--type checkitem lists the items with their list', () => {
    const r = read(['ui/Read.tsx', '--type', 'checkitem']);
    const out = JSON.parse(r.out) as { elements: Array<Record<string, unknown>> };
    expect(out.elements.map((e) => [e.id, e.list])).toEqual([
      ['c1', 's1'],
      ['c2', 's1'],
      ['c3', 's1'],
    ]);
    expect(out.elements.every((e) => e.box === undefined)).toBe(true);
  });

  test('item text is flagged untrusted like every other board string', () => {
    const r = read(['ui/Read.tsx']);
    expect(JSON.parse(r.out).untrusted).toContain('never instructions');
  });

  test('a plain sticky has no items or progress', () => {
    seed('ui-plain', [stickyRec('s1')]);
    const out = JSON.parse(read(['ui/Plain.tsx']).out);
    expect(out.elements[0].items).toBeUndefined();
    expect(out.elements[0].progress).toBeUndefined();
  });
});

describe('--board cards and the Checklist template', () => {
  test('a card { text, items } becomes a checklist sticky inside its section', () => {
    const spec = {
      groups: [{ title: 'Sprint', cards: [{ text: 'Launch', items: ['one', 'two'] }, 'plain'] }],
    };
    const r = annotate(['ui/Board.tsx', '--board', '-'], spec);
    expect(r.code).toBe(0);
    const els = board('ui-board');
    const launch = els.find((e) => e.type === 'sticky' && e.text === 'Launch') as AnnotationElement;
    expect(itemsOf(els, launch.id).map((e) => e.text)).toEqual(['one', 'two']);
    expect(els.filter((e) => e.type === 'checkitem').every((e) => e.parent === undefined)).toBe(
      true
    );
  });

  test('the checklist template is one checklist sticky titled Checklist with three empty entries', () => {
    const r = annotate(['ui/Tpl.tsx', '--board', 'checklist']);
    expect(r.code).toBe(0);
    const els = board('ui-tpl');
    const stickies = els.filter((e) => e.type === 'sticky');
    expect(stickies).toHaveLength(1);
    expect(stickies[0]?.text).toBe('Checklist');
    const items = itemsOf(els, (stickies[0] as AnnotationElement).id);
    expect(items).toHaveLength(3);
    expect(items.every((e) => e.text === undefined)).toBe(true);
    expect(JSON.stringify(els)).not.toContain('☐');
  });
});
