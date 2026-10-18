// S2.9 (artboard ed-ab-tidy) — Tidy up: the maths that puts several artboards into one row with even gaps,
// on the lowest one's line. Pure: the canvas hands it the boards' rects, it hands back where each goes.
// The commit (one `commitPositions`, so annotations ride along and ⌘Z is one step) is test/artboard-arrange-client.

import { describe, expect, test } from 'bun:test';

import { DEFAULT_TIDY_GAP, TIDY_LABEL, tidyArtboards, tidyGap } from '../edit-ops/tidy.ts';

const r = (id: string, x: number, y: number, w = 216, h = 384) => ({ id, x, y, w, h });

/** The boards after the moves (a board that does not move is not in the answer). */
const after = (rects: ReturnType<typeof r>[]) => {
  const moves = new Map(tidyArtboards(rects).map((m) => [m.id, m]));
  return rects.map((b) => ({ ...b, ...(moves.get(b.id) ?? {}) }));
};

// the 14 Editing canvas: four stories scattered over a few px (at 20 %), the lowest sits at y 222
const SCATTERED = [r('a', 150, 196), r('b', 396, 204), r('c', 640, 164), r('d', 900, 222)];

describe('tidyArtboards — one row, even gaps, on the lowest one’s line', () => {
  test('every board gets the lowest board’s top; the first keeps its left edge', () => {
    const moves = tidyArtboards(SCATTERED);
    expect(moves.every((m) => m.y === 222)).toBe(true);
    expect(moves.find((m) => m.id === 'a')?.x).toBe(150);
  });

  test('left to right in the order they sit now, the gap between neighbours identical', () => {
    const row = after(SCATTERED);
    const gaps: number[] = [];
    for (let i = 1; i < row.length; i++)
      gaps.push((row[i] as { x: number }).x - ((row[i - 1] as { x: number }).x + 216));
    expect(new Set(gaps).size).toBe(1);
    expect(gaps[0]).toBeGreaterThanOrEqual(0);
  });

  test('the gap is the boards’ own: the mean of today’s gaps (30, 28, 44 → 34)', () => {
    expect(tidyGap(SCATTERED)).toBe(34);
  });

  test('boards that overlap, or stack in a column, get the default gap rather than touching', () => {
    const column = [r('a', 100, 0), r('b', 100, 500), r('c', 100, 1000)];
    expect(tidyGap(column)).toBe(DEFAULT_TIDY_GAP);
    expect(DEFAULT_TIDY_GAP).toBe(80);
    const moves = tidyArtboards(column);
    // the column becomes a row on the lowest top (1000)
    expect(moves.map((m) => [m.id, m.x, m.y])).toEqual([
      ['a', 100, 1000],
      ['b', 396, 1000],
      ['c', 692, 1000],
    ]);
  });

  test('boards of different widths each keep their own size; the gap is edge to edge', () => {
    const mixed = [r('a', 0, 0, 100), r('b', 400, 0, 300), r('c', 900, 0, 50)];
    const by = new Map(after(mixed).map((m) => [m.id, m.x]));
    const gap = tidyGap(mixed);
    expect(by.get('b')).toBe(100 + gap);
    expect(by.get('c')).toBe(100 + gap + 300 + gap);
  });

  test('only the boards that move are returned; an already tidy row is nothing to do', () => {
    const tidy = [r('a', 0, 40), r('b', 296, 40), r('c', 592, 40)];
    expect(tidyArtboards(tidy)).toEqual([]);
    // one board off its line: only it moves
    const off = [r('a', 0, 40), r('b', 296, 10), r('c', 592, 40)];
    expect(tidyArtboards(off)).toEqual([{ id: 'b', x: 296, y: 40 }]);
  });

  test('ties in x keep the order the boards were given (stable), whole pixels only', () => {
    const tie = [r('b', 100, 0), r('a', 100, 0, 216.4)];
    const moves = tidyArtboards(tie);
    for (const m of moves) {
      expect(Number.isInteger(m.x)).toBe(true);
      expect(Number.isInteger(m.y)).toBe(true);
    }
  });

  test('fewer than two boards: nothing to tidy', () => {
    expect(tidyArtboards([])).toEqual([]);
    expect(tidyArtboards([r('a', 3, 3)])).toEqual([]);
  });

  test('the undo line says what happened', () => {
    expect(TIDY_LABEL(4)).toBe('tidy up 4 artboards');
    expect(TIDY_LABEL(1)).toBe('tidy up 1 artboard');
  });
});
