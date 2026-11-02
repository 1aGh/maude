// P8 C7 — a pasted artboard with nothing selected lands BESIDE THE LAST artboard (its row, one gap right of the row's
// last board), not at a default-grid slot and not on the first board's line.
import { describe, expect, test } from 'bun:test';

import { pasteSpot } from '../editing/clipboard-actions.ts';

const boards = [
  { id: 'a', x: 0, y: 0, w: 1000 },
  { id: 'b', x: 1080, y: 0, w: 1000 },
  { id: 'c', x: 0, y: 1400, w: 600 },
];

describe('pasteSpot', () => {
  test('nothing selected: on the last board’s row, right of that row', () => {
    expect(pasteSpot(boards, undefined)).toEqual({ x: 680, y: 1400 });
  });
  test('a selected board: right of the rightmost board, on the selected board’s line (unchanged)', () => {
    expect(pasteSpot(boards, 'a')).toEqual({ x: 2160, y: 0 });
  });
  test('no boards: nothing to say (the server places it)', () => {
    expect(pasteSpot([], undefined)).toBeUndefined();
  });
});
