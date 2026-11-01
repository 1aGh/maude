// r4 #18 - an existing object dragged into a section belongs to it (the section carries it; out un-parents).

import { describe, expect, test } from 'bun:test';
import { Scene } from '../annotations/scene.ts';
import { Containment } from '../annotations/ui/containment.ts';
import { strokesToElementMap } from '../annotations/v1-adapter.ts';
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
const parentOf = (strokes: readonly Stroke[], current: ReadonlyMap<string, never>, id: string) =>
  new Scene(strokesToElementMap(strokes, current as never).values()).get(id)?.parent;

describe('r4 #18 an object dragged into a section belongs to it', () => {
  // `old` was drawn first; the section (a template's, or one raised to the front) paints ABOVE it.
  const before: Stroke[] = [rect('old', 900, 900), section('S', 0, 0, 400, 300)];
  const committed = strokesToElementMap(before, new Map());

  test('dragging an older object in re-parents it, and moving the section carries it', () => {
    const dragged: Stroke[] = [rect('old', 100, 100), section('S', 0, 0, 400, 300)];
    expect(parentOf(dragged, committed as never, 'old')).toBe('S');
    const board = strokesToElementMap(dragged, committed);
    expect(new Containment(board.values()).contentsOf('S')).toEqual(['old']);
    // the section moves 50 px right: the object rides along (the whole subtree is the move)
    const moved: Stroke[] = [rect('old', 150, 100), section('S', 50, 0, 400, 300)];
    expect(parentOf(moved, board as never, 'old')).toBe('S');
  });

  test('dragging it back out un-parents it', () => {
    const inside: Stroke[] = [rect('old', 100, 100), section('S', 0, 0, 400, 300)];
    const board = strokesToElementMap(inside, committed);
    const out: Stroke[] = [rect('old', 900, 900), section('S', 0, 0, 400, 300)];
    expect(parentOf(out, board as never, 'old')).toBeUndefined();
  });

  test('an object that did not move is not adopted by a section painted over it', () => {
    // the legacy rule stays for what nobody touched: a section adopts what paints above it
    const still: Stroke[] = [rect('old', 100, 100), section('S', 0, 0, 400, 300)];
    expect(parentOf(still, new Map(), 'old')).toBeUndefined();
  });
});
