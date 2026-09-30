// annotations-v2 Milestone B — the v1 Stroke[] adapter (removed in Task 26).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateSvg } from '../annotations/migrate-v1.ts';
import { applyOps, diffToOps } from '../annotations/ops.ts';
import { Scene } from '../annotations/scene.ts';
import { serializeBoard, validateElements } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  elementsToStrokes,
  labelStrokeId,
  strokesToElementMap,
  strokesToElements,
} from '../annotations/v1-adapter.ts';
import { translateOne } from '../annotations-model.ts';

const FIX = join(import.meta.dir, 'fixtures');
const toMap = (els: AnnotationElement[]) => new Map(els.map((e) => [e.id, e]));

describe.each([
  ['phase-21', join(FIX, 'phase-21-annotations.svg')],
  ['figjam-v3', join(FIX, 'figjam-v3-groups-bindings.svg')],
  ['mixed-200', join(FIX, 'annotations-v2', 'mixed-200.v1.svg')],
])('%s', (_n, path) => {
  const board = migrateSvg(readFileSync(path, 'utf8')).elements;

  test('elements → strokes → elements is the identity (no diff, no ops)', () => {
    const current = toMap(board);
    const back = strokesToElements(elementsToStrokes(board), current);
    expect(serializeBoard(back)).toBe(serializeBoard(board));
    expect(diffToOps(current, toMap(back))).toEqual([]);
  });

  test('a no-op UI commit produces zero ops', () => {
    const strokes = elementsToStrokes(board);
    const cur = toMap(board);
    expect(
      diffToOps(strokesToElementMap(strokes, cur), strokesToElementMap([...strokes], cur))
    ).toEqual([]);
  });
});

describe('UI edits become minimal ops', () => {
  const base = validateElements([
    { id: 'sec', type: 'section', index: 'a0', x: 100, y: 100, w: 400, h: 300 },
    {
      id: 'st',
      type: 'sticky',
      index: 'a0',
      parent: 'sec',
      x: 20,
      y: 20,
      w: 100,
      h: 100,
      text: 'in',
    },
    { id: 'free', type: 'sticky', index: 'a1', x: 900, y: 900, w: 100, h: 100, text: 'out' },
    {
      id: 'r',
      type: 'shape',
      index: 'a2',
      x: 700,
      y: 100,
      w: 100,
      h: 60,
      label: { text: 'Label' },
    },
  ]).elements;
  const cur = toMap(base);
  const before = elementsToStrokes(base);

  test('dragging a section with its content (v1 moves both) writes only the section', () => {
    const next = before.map((s) => (s.id === 'sec' || s.id === 'st' ? translateOne(s, 50, 10) : s));
    const ops = diffToOps(strokesToElementMap(before, cur), strokesToElementMap(next, cur));
    expect(ops).toEqual([
      { op: 'patch', id: 'sec', set: { x: 150, y: 110 }, expect: { x: 100, y: 100 } },
    ]);
  });

  test('dropping an element into a section reparents it, world position kept', () => {
    const next = before.map((s) => (s.id === 'free' ? translateOne(s, -700, -700) : s));
    const r = applyOps(
      cur,
      diffToOps(strokesToElementMap(before, cur), strokesToElementMap(next, cur))
    );
    expect(r.state.get('free')).toMatchObject({ parent: 'sec', x: 100, y: 100 });
    expect(new Scene(r.state.values()).worldBox('free')).toEqual({
      x: 200,
      y: 200,
      w: 100,
      h: 100,
    });
  });

  test('editing a label stroke patches the shape label', () => {
    const next = before.map((s) =>
      s.id === labelStrokeId('r') && s.tool === 'text' ? { ...s, text: 'Renamed' } : s
    );
    const ops = diffToOps(strokesToElementMap(before, cur), strokesToElementMap(next, cur));
    expect(ops).toEqual([
      {
        op: 'patch',
        id: 'r',
        set: { label: { text: 'Renamed' } },
        expect: { label: { text: 'Label' } },
      },
    ]);
  });

  test('send-to-back mints one key, neighbours keep theirs', () => {
    const moved = [before.find((s) => s.id === 'r'), ...before.filter((s) => s.id !== 'r')].filter(
      Boolean
    ) as typeof before;
    const ops = diffToOps(strokesToElementMap(before, cur), strokesToElementMap(moved, cur));
    expect(ops.length).toBe(1);
    expect(ops[0]).toMatchObject({ op: 'patch', id: 'r' });
    const keys = Object.keys((ops[0] as { set: Record<string, unknown> }).set);
    expect(keys).toEqual(['index']);
  });

  test('unknown element types survive every UI commit', () => {
    const withUnknown = toMap([
      ...base,
      { id: 'u1', type: 'stamp', index: 'a9', emoji: '🔥' } as AnnotationElement,
    ]);
    const out = strokesToElementMap(elementsToStrokes(withUnknown.values()), withUnknown);
    expect(out.get('u1')).toMatchObject({ type: 'stamp', emoji: '🔥' });
  });
});
