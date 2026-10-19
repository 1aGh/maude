// annotations-eraser-scope — S4.8: the Eraser is a Marker tip (CONTRACT D2), and canvas 15 an-marker
// says what it rubs out: "strokes only, never stickies". It used to take the topmost anything.
//
//   new — `eraseTargetIndex`: Marker and Highlighter strokes yes; a sticky, a shape, text, a section no
//   kept — a locked stroke is passed over (#137), and the stroke UNDER a sticky is still reachable

import { describe, expect, test } from 'bun:test';
import { eraseTargetIndex, isErasable } from '../annotations/ui/tool-state.ts';
import type { PenStroke, StickyStroke, Stroke } from '../annotations-model.ts';

const pen = (id: string, over: Partial<PenStroke> = {}): PenStroke => ({
  id,
  tool: 'pen',
  color: '#1f1f1f',
  width: 3,
  points: [
    [0, 0],
    [100, 0],
  ],
  ...over,
});
const sticky = (id: string): StickyStroke => ({
  id,
  tool: 'sticky',
  color: '#fce8a6',
  x: -20,
  y: -20,
  w: 200,
  h: 200,
  text: 'Logo',
  fontSize: 14,
});
const none = new Set<string>();

describe('the Eraser rubs out Marker strokes only', () => {
  test('a Marker stroke and a Highlighter stroke are rubbed out', () => {
    expect(isErasable(pen('a'))).toBe(true);
    expect(isErasable(pen('h', { highlighter: true, width: 18 }))).toBe(true);
    expect(eraseTargetIndex([pen('a')], none, 50, 0, 8)).toBe(0);
    expect(eraseTargetIndex([pen('h', { highlighter: true, width: 18 })], none, 50, 0, 8)).toBe(0);
  });

  test('a sticky is never erased, even with nothing else under the pointer', () => {
    expect(isErasable(sticky('s'))).toBe(false);
    expect(eraseTargetIndex([sticky('s')], none, 50, 50, 8)).toBe(-1);
  });

  test('every other element is deleted, not rubbed out', () => {
    const others = [
      { id: 'r', tool: 'rect', color: '#000', width: 3, x: 0, y: 0, w: 100, h: 100 },
      { id: 'e', tool: 'ellipse', color: '#000', width: 3, cx: 50, cy: 50, rx: 50, ry: 50 },
      { id: 't', tool: 'text', color: '#000', x: 0, y: 0, w: 100, h: 20, text: 'Hi', fontSize: 14 },
      { id: 'a', tool: 'arrow', color: '#000', width: 3, x1: 0, y1: 0, x2: 100, y2: 0 },
      { id: 'sec', tool: 'section', x: 0, y: 0, w: 300, h: 300, color: '#cfc4ec', label: 'Notes' },
    ] as unknown as Stroke[];
    for (const s of others) expect(isErasable(s)).toBe(false);
    expect(eraseTargetIndex(others, none, 50, 0, 8)).toBe(-1);
  });

  test('a sticky on top does not shadow the stroke under it: the stroke goes, the sticky stays', () => {
    const strokes: Stroke[] = [pen('under'), sticky('on-top')];
    expect(eraseTargetIndex(strokes, none, 50, 0, 8)).toBe(0);
  });

  test('the topmost Marker stroke goes first; a locked one is passed over', () => {
    const strokes: Stroke[] = [pen('low'), pen('high')];
    expect(eraseTargetIndex(strokes, none, 50, 0, 8)).toBe(1);
    expect(eraseTargetIndex(strokes, new Set(['high']), 50, 0, 8)).toBe(0);
    expect(eraseTargetIndex(strokes, new Set(['high', 'low']), 50, 0, 8)).toBe(-1);
  });

  test('a miss erases nothing', () => {
    expect(eraseTargetIndex([pen('a')], none, 50, 80, 8)).toBe(-1);
    expect(eraseTargetIndex([], none, 0, 0, 8)).toBe(-1);
  });
});
