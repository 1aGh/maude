// S3.5 — present/meta-schema.ts: strict for our writer, tolerant of what a peer wrote, and in
// agreement with schema/canvas-meta.v2.schema.json (V2-1.12 R1/R2/R6; S3-present-session §7).

import { describe, expect, test } from 'bun:test';

import { validateMeta } from '../check/meta.ts';
import {
  applyPresentPatch,
  type PresentPatch,
  parsePresentPatch,
  readPresentState,
} from '../present/meta-schema.ts';

const FILE = '.design/ui/Deck.tsx';
const KNOWN = new Set(['a', 'b', 'c', 'd']);
const patchOf = (body: Record<string, unknown>): PresentPatch => {
  const r = parsePresentPatch({ file: FILE, ...body });
  if (!r.ok) throw new Error(`${r.error} ${r.field}`);
  return r.patch;
};
const apply = (current: Record<string, unknown>, body: Record<string, unknown>, known = KNOWN) => {
  const r = applyPresentPatch(current, patchOf(body), known);
  if (!r.ok) throw new Error(`${r.error} ${r.ids}`);
  return r;
};

describe('parsePresentPatch — the body, exactly', () => {
  test('the documented shape parses', () => {
    const r = parsePresentPatch({
      file: FILE,
      present: { order: ['b', 'a'], skip: null },
      notes: { a: 'Hello', b: null },
      expected: 'm-1',
    });
    expect(r).toEqual({
      ok: true,
      patch: {
        file: FILE,
        present: { order: ['b', 'a'], skip: null },
        notes: { a: 'Hello', b: null },
        expected: 'm-1',
      },
    });
  });

  test('an unknown key anywhere is refused, never ignored', () => {
    expect(parsePresentPatch({ file: FILE, layout: {} })).toEqual({
      ok: false,
      error: 'unknown-key',
      field: 'layout',
    });
    expect(parsePresentPatch({ file: FILE, present: { order: [], loop: true } })).toEqual({
      ok: false,
      error: 'unknown-key',
      field: 'present.loop',
    });
  });

  test('bad values are refused', () => {
    const bad = (body: unknown) => {
      const r = parsePresentPatch(body);
      return r.ok ? 'ok' : `${r.error}:${r.field}`;
    };
    expect(bad(null)).toBe('bad-body:');
    expect(bad([])).toBe('bad-body:');
    expect(bad({})).toBe('bad-field:file');
    expect(bad({ file: 7 })).toBe('bad-field:file');
    expect(bad({ file: FILE, present: [] })).toBe('bad-field:present');
    expect(bad({ file: FILE, present: { order: 'a' } })).toBe('bad-field:present.order');
    expect(bad({ file: FILE, present: { skip: ['a b'] } })).toBe('bad-field:present.skip');
    expect(bad({ file: FILE, present: { order: [7] } })).toBe('bad-field:present.order');
    expect(bad({ file: FILE, notes: [] })).toBe('bad-field:notes');
    expect(bad({ file: FILE, notes: { 'no/id': 'x' } })).toBe('bad-field:notes');
    expect(bad({ file: FILE, notes: { a: 7 } })).toBe('bad-field:notes.a');
    expect(bad({ file: FILE, notes: { a: 'x'.repeat(20001) } })).toBe('bad-field:notes.a');
    expect(bad({ file: FILE, expected: 1 })).toBe('bad-field:expected');
    expect(bad({ file: FILE, present: { order: Array(2001).fill('a') } })).toBe(
      'bad-field:present.order'
    );
  });
});

describe('applyPresentPatch — writes only what it names', () => {
  const base = () => ({
    title: 'Deck',
    layout: { artboards: [{ id: 'a', x: 0, y: 0 }] },
    present: { order: ['a', 'b'] },
    critic: { score: 4 }, // an older writer's key: kept as is
    artboardMeta: { a: { poster: 12, notes: 'old' }, c: { madeBy: { kind: 'ai' } } },
    tail: 1,
  });

  test('every other key keeps its value and its place', () => {
    const r = apply(base(), { present: { skip: ['c'] } });
    expect(Object.keys(r.next)).toEqual(Object.keys(base()));
    expect(r.next.present).toEqual({ order: ['a', 'b'], skip: ['c'] });
    for (const k of ['title', 'layout', 'critic', 'artboardMeta', 'tail'])
      expect(JSON.stringify(r.next[k])).toBe(
        JSON.stringify(base()[k as keyof ReturnType<typeof base>])
      );
  });

  test('null removes a member, an empty list removes it too, and an empty present goes', () => {
    expect(apply(base(), { present: { order: null } }).next.present).toBeUndefined();
    expect(apply(base(), { present: { order: [] } }).next.present).toBeUndefined();
    expect('present' in apply(base(), { present: null }).next).toBe(false);
  });

  test('a member a newer peer added inside present is kept', () => {
    const cur = { ...base(), present: { order: ['a'], loop: true } };
    expect(apply(cur, { present: { order: ['b'] } }).next.present).toEqual({
      order: ['b'],
      loop: true,
    });
  });

  test('notes: set, replace, remove; other artboardMeta fields stay; an empty entry goes', () => {
    const r = apply(base(), { notes: { a: '', b: 'New', c: 'Third' } });
    expect(r.next.artboardMeta).toEqual({
      a: { poster: 12 },
      c: { madeBy: { kind: 'ai' }, notes: 'Third' },
      b: { notes: 'New' },
    });
    const gone = apply({ title: 'x', artboardMeta: { a: { notes: 'n' } } }, { notes: { a: null } });
    expect('artboardMeta' in gone.next).toBe(false);
  });

  test('a note can be removed from an artboard the canvas no longer has', () => {
    const r = apply({ artboardMeta: { zz: { notes: 'stale' } } }, { notes: { zz: null } });
    expect(r.next).toEqual({});
  });

  test('an id that is not an artboard of the canvas is refused, with the ids', () => {
    expect(applyPresentPatch(base(), patchOf({ present: { order: ['a', 'x'] } }), KNOWN)).toEqual({
      ok: false,
      error: 'unknown-artboard',
      ids: ['x'],
    });
    expect(applyPresentPatch(base(), patchOf({ notes: { y: 'n' } }), KNOWN)).toEqual({
      ok: false,
      error: 'unknown-artboard',
      ids: ['y'],
    });
    // a canvas whose artboards a parse cannot list: only the grammar is checked
    expect(applyPresentPatch(base(), patchOf({ present: { order: ['x'] } }), null).ok).toBe(true);
  });

  test('a duplicate in an order or a skip list is refused', () => {
    expect(
      applyPresentPatch(base(), patchOf({ present: { order: ['a', 'b', 'a'] } }), KNOWN)
    ).toEqual({ ok: false, error: 'duplicate', ids: ['a'] });
  });

  test('a patch that changes nothing says so, and the input is never mutated', () => {
    const cur = base();
    const before = JSON.stringify(cur);
    expect(apply(cur, { present: { order: ['a', 'b'] } }).changed).toBe(false);
    expect(apply(cur, { notes: { b: null } }).changed).toBe(false);
    apply(cur, { present: null, notes: { a: 'z' } });
    expect(JSON.stringify(cur)).toBe(before);
  });

  test('what it writes passes the canvas-meta v2 schema (strict reading)', () => {
    const r = apply(base(), {
      present: { order: ['d', 'c', 'b', 'a'], skip: ['b'] },
      notes: { a: 'One', d: 'Two' },
    });
    expect(validateMeta(r.next, base())).toEqual([]);
    expect(validateMeta(r.next, null).map((i) => i.field)).toEqual(['/critic', '/tail']);
  });
});

describe('readPresentState — tolerant of any writer', () => {
  test('absent = canvas order, nothing skipped, no notes', () => {
    expect(readPresentState(null)).toEqual({ order: null, skip: [], notes: {} });
    expect(readPresentState({ title: 'x' })).toEqual({ order: null, skip: [], notes: {} });
  });

  test('malformed members are dropped, never thrown on', () => {
    expect(
      readPresentState({
        present: { order: ['a', 7, 'a', 'b c', 'b'], skip: 'c' },
        artboardMeta: { a: { notes: 'Hi' }, b: 'garbage', 'x/y': { notes: 'n' }, c: { notes: 3 } },
      })
    ).toEqual({ order: ['a', 'b'], skip: [], notes: { a: 'Hi' } });
    expect(readPresentState({ present: [], artboardMeta: [] })).toEqual({
      order: null,
      skip: [],
      notes: {},
    });
  });
});
