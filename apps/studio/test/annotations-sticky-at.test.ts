// S4.13 (lead decision v2-lead-sticky-created-at-ext-field) — a sticky carries WHEN it was made as a
// format-2 extension field `at` (ISO time, local clock, stamped on create). The author line reads
// "Jonas · 2 h ago"; a sticky without `at` shows the name only. A 1.x peer keeps the field verbatim.

import { describe, expect, test } from 'bun:test';

import { annotationsJsonSchema } from '../annotations/board-schema.ts';
import { authorLine, relativeTime } from '../annotations/elements/sticky.model.ts';
import { extSpecOf, withFormat1Reader } from '../annotations/registry.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { elementsToStrokes, strokesToElements } from '../annotations/v1-adapter.ts';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const AT = '2026-10-19T10:00:00.000Z'; // two hours before NOW

const sticky = (extra: Record<string, unknown> = {}): AnnotationElement =>
  ({
    id: 's1',
    type: 'sticky',
    index: 'a0',
    x: 10,
    y: 20,
    w: 200,
    h: 120,
    text: 'make it bigger',
    author: { kind: 'human', name: 'Jonas' },
    ...extra,
  }) as AnnotationElement;

describe('the author line with a time', () => {
  test('Jonas · 2 h ago', () => {
    expect(authorLine({ name: 'Jonas' }, AT, NOW)).toBe('Jonas · 2 h ago');
    expect(authorLine({ me: true }, '2026-10-19T11:59:40.000Z', NOW)).toBe('You · just now');
  });
  test('a sticky without `at` shows the name only', () => {
    expect(authorLine({ name: 'Jonas' }, undefined, NOW)).toBe('Jonas');
    expect(authorLine({ name: 'Jonas' }, 'not a time', NOW)).toBe('Jonas');
  });
  test('past a week the time is absolute, 24-hour: "6 Oct, 14:05"', () => {
    const local = new Date(2026, 9, 6, 14, 5).toISOString();
    expect(relativeTime(local, NOW)).toBe('6 Oct, 14:05');
    expect(relativeTime('2026-10-12T12:00:00.000Z', NOW)).toBe('7 d ago');
  });
});

describe('`at` is a format-2 extension field of a sticky', () => {
  test('it is a typed ext spec and in the generated schema', () => {
    expect(extSpecOf('sticky')?.at).toBeDefined();
    const schema = JSON.stringify(annotationsJsonSchema());
    expect(schema).toContain('"at"');
  });
  test('a bad time is dropped by the typed reader, a good one kept', () => {
    const board = serializeBoard([
      sticky({ at: AT }),
      { ...sticky({ at: 'yesterday' }), id: 's2' },
    ]);
    const back = parseBoard(board).elements;
    expect(back.find((e) => e.id === 's1')?.at).toBe(AT);
    expect(back.find((e) => e.id === 's2')?.at).toBeUndefined();
  });
  test('it rides through the stroke view and back (the layer stamps it on create)', () => {
    const els = [sticky({ at: AT })];
    const strokes = elementsToStrokes(els);
    expect((strokes[0] as { at?: string }).at).toBe(AT);
    const back = strokesToElements(strokes, new Map(els.map((e) => [e.id, e])));
    expect(back[0]?.at).toBe(AT);
    // a NEW sticky stroke (no committed element yet) writes `at` too
    const fresh = strokesToElements(
      [{ ...(strokes[0] as object), id: 'fresh', at: AT } as never],
      new Map()
    );
    expect(fresh[0]?.at).toBe(AT);
  });
  test('a 1.x peer keeps the field verbatim and writes the same bytes', () => {
    const v2 = serializeBoard([sticky({ at: AT })]);
    const v1 = withFormat1Reader(() => serializeBoard(parseBoard(v2).elements));
    expect(v1).toBe(v2);
    expect(JSON.parse(v1).elements[0].at).toBe(AT);
  });
});
