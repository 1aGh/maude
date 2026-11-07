// T2.5 (#163) — only a DRAG adopts an object into a section. A move that is not a drag (Fan out, align,
// distribute, the arrow keys) never puts an object into a section it lands on; it keeps the section it is in
// while it still sits in it, and leaves one it is moved out of. A drag is r4 #18 as before.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Scene } from '../annotations/scene.ts';
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
type Board = ReturnType<typeof strokesToElementMap>;
const parentOf = (strokes: readonly Stroke[], current: Board, id: string, drag: boolean) =>
  new Scene(strokesToElementMap(strokes, current, { adoptOnMove: drag }).values()).get(id)?.parent;

describe('#163 only a drag adopts', () => {
  // the section is drawn first, so the object paints above it (the old rule would adopt it on ANY move)
  const before: Stroke[] = [section('S', 0, 0, 400, 300), rect('a', 900, 900)];
  const board = strokesToElementMap(before, new Map());
  const onto: Stroke[] = [section('S', 0, 0, 400, 300), rect('a', 100, 100)];

  test('a move that is not a drag (Fan out, keys, align) lands on a section without joining it', () => {
    expect(parentOf(onto, board, 'a', false)).toBeUndefined();
  });
  test('a drag onto it still adopts (r4 #18)', () => {
    expect(parentOf(onto, board, 'a', true)).toBe('S');
  });
  test('a member moved within its section by keys stays in it; moved out, it leaves', () => {
    const inS = strokesToElementMap(onto, board, { adoptOnMove: true });
    const nudged: Stroke[] = [section('S', 0, 0, 400, 300), rect('a', 110, 100)];
    expect(parentOf(nudged, inS, 'a', false)).toBe('S');
    const out: Stroke[] = [section('S', 0, 0, 400, 300), rect('a', 900, 100)];
    expect(parentOf(out, inS, 'a', false)).toBeUndefined();
  });
  test('the layer passes the drag flag only from the move-drag commit', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'annotations-layer.tsx'), 'utf8');
    expect(src.match(/\{ drag: true \}/g)?.length).toBe(1);
    expect(src).toContain('adoptOnMove: opts?.drag === true');
  });
});
