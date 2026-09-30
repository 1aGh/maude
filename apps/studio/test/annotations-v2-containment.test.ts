// annotations-v2 (DDR-242 AD8, Task 20) — every operation on a section acts on
// its subtree. These are the "known bugs (Milestone D flips these)" todos from
// annotations-characterization.test.ts, as real assertions.

import { describe, expect, test } from 'bun:test';
import { Scene } from '../annotations/scene.ts';
import {
  Containment,
  expandForOp,
  insertSection,
  marqueeHits,
} from '../annotations/ui/containment.ts';
import { strokesToElementMap } from '../annotations/v1-adapter.ts';
import { alignStrokes, distributeStrokes } from '../annotations-align.ts';
import { duplicateStrokes, expandIdsToGroups } from '../annotations-groups.ts';
import type { RectStroke, SectionStroke, Stroke } from '../annotations-model.ts';

const section = (id: string, x: number, y: number, w: number, h: number): SectionStroke => ({
  id,
  tool: 'section',
  x,
  y,
  w,
  h,
  label: id,
  color: '#8a8a8a',
});
const rect = (id: string, x: number, y: number, w = 40, h = 40): RectStroke => ({
  id,
  tool: 'rect',
  x,
  y,
  w,
  h,
  color: '#1a1a1a',
  width: 2,
  fill: null,
});

/** outer ⊃ inner ⊃ deep; `on` sits in outer only; `free` is outside. Paint order = array order. */
const outer = section('outer', 0, 0, 600, 400);
const inner = section('inner', 50, 50, 250, 250);
const deep = rect('deep', 100, 100);
const on = rect('on', 400, 300);
const free = rect('free', 900, 900);
const board: Stroke[] = [outer, inner, deep, on, free];

const containmentOf = (strokes: readonly Stroke[]) =>
  new Containment(strokesToElementMap(strokes, new Map()).values());
const expand = (ids: string[], strokes: readonly Stroke[] = board) =>
  new Set(expandForOp(ids, (x) => expandIdsToGroups(x, strokes), containmentOf(strokes)));

describe('a section operation acts on its subtree', () => {
  test('nudge / drag of the outer section carries the nested section and its contents', () => {
    const ids = expand(['outer']);
    expect(ids).toEqual(new Set(['outer', 'inner', 'deep', 'on']));
    expect(ids.has('free')).toBe(false);
  });

  test('delete / copy / duplicate of a section include its contents', () => {
    expect(expand(['inner'])).toEqual(new Set(['inner', 'deep']));
    const res = duplicateStrokes(board, [...expand(['inner'])], 20, 20);
    const clones = res.strokes.slice(board.length);
    expect(clones.map((c) => c.tool).sort()).toEqual(['rect', 'section']);
    // Originals untouched; the clone is selected through the id map.
    expect(res.strokes.slice(0, board.length)).toEqual(board);
    expect(res.idMap.get('inner')).toBeDefined();
  });

  test('Alt-duplicate moves only the copy: the copied contents belong to the copied section', () => {
    const res = duplicateStrokes(board, [...expand(['inner'])], 0, 0);
    const innerCopy = res.idMap.get('inner') as string;
    const deepCopy = res.idMap.get('deep') as string;
    // What the drag then carries: the copy's subtree, never the original contents.
    const carried = containmentOf(res.strokes).withContents([innerCopy]);
    expect(carried.has(deepCopy)).toBe(true);
    expect(carried.has('deep')).toBe(false);
  });

  test('align carries a section’s contents with its frame', () => {
    const c = containmentOf(board);
    const out = alignStrokes(board, c.roots(['inner', 'free']), 'left', (id) => c.contentsOf(id));
    const byId = new Map(out.map((s) => [s.id, s]));
    // inner moves from x=50 to x=50 (it is the left-most) and free moves left to 50.
    expect((byId.get('free') as RectStroke).x).toBe(50);
    const moved = alignStrokes(board, c.roots(['inner', 'free']), 'right', (id) =>
      c.contentsOf(id)
    );
    const m = new Map(moved.map((s) => [s.id, s]));
    const dx = (m.get('inner') as SectionStroke).x - inner.x;
    expect(dx).not.toBe(0);
    expect((m.get('deep') as RectStroke).x - deep.x).toBe(dx); // the content moved with it
  });

  test('distribute carries contents too, and a selected child rides its selected section', () => {
    const extra = section('extra', 1200, 0, 100, 100);
    const strokes = [...board, extra];
    const c = containmentOf(strokes);
    // `deep` is selected together with its container: it must move ONCE (with inner).
    const roots = c.roots(['inner', 'deep', 'free', 'extra']);
    expect(roots.includes('deep')).toBe(false);
    const out = distributeStrokes(strokes, roots, 'h', (id) => c.contentsOf(id));
    const m = new Map(out.map((s) => [s.id, s]));
    expect((m.get('deep') as RectStroke).x - deep.x).toBe(
      (m.get('inner') as SectionStroke).x - inner.x
    );
  });
});

describe('marquee', () => {
  const items = board.map((s) => ({
    id: s.id,
    box:
      s.tool === 'section' || s.tool === 'rect'
        ? { x: s.x, y: s.y, w: s.w, h: s.h }
        : { x: 0, y: 0, w: 0, h: 0 },
    container: s.tool === 'section',
  }));

  test('a marquee over content inside a section selects the content, not the section', () => {
    expect(marqueeHits(items, { x1: 90, y1: 90, x2: 150, y2: 150 })).toEqual(['deep']);
  });

  test('a marquee enclosing the section selects it too', () => {
    expect(marqueeHits(items, { x1: 40, y1: 40, x2: 320, y2: 320 }).sort()).toEqual([
      'deep',
      'inner',
    ]);
  });
});

describe('nesting', () => {
  test('a section drawn inside another renders in front of it and adopts what sits on it', () => {
    const base: Stroke[] = [outer, rect('a', 100, 100), rect('b', 450, 300)];
    const drawn = section('drawn', 60, 60, 200, 200);
    const outerId = containmentOf(base).containerAt(160, 160);
    expect(outerId).toBe('outer');
    const next = insertSection(base, drawn, outerId);
    expect(next.map((s) => s.id)).toEqual(['outer', 'drawn', 'a', 'b']);
    const scene = new Scene(strokesToElementMap(next, new Map()).values());
    const order = scene.paintOrder().map((e) => e.id);
    expect(order.indexOf('drawn')).toBeGreaterThan(order.indexOf('outer'));
    expect(scene.get('a')?.parent).toBe('drawn'); // adopted
    expect(scene.get('b')?.parent).toBe('outer'); // outside the new section: stays
    expect(scene.get('drawn')?.parent).toBe('outer');
  });

  test('a top-level section goes to the back', () => {
    const next = insertSection([rect('x', 0, 0)], section('s', -10, -10, 100, 100), null);
    expect(next.map((s) => s.id)).toEqual(['s', 'x']);
  });
});
