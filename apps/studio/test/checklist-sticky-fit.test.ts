// #113 slice A — contract 113-checklist §5.2: `fitSticky(cur, text, items?)` makes room for the entries
// (one row each, wrapped inside the indent) and the progress footer. Grows only; clips past the ceiling.

import { describe, expect, test } from 'bun:test';
import { STICKY_MAX_GROWN_H } from '../annotations/constants.ts';
import {
  CHECK_FOOTER_H,
  CHECK_INDENT,
  CHECK_ROW_GAP,
  fitSticky,
  hiddenCheckItems,
  wrapLines,
} from '../annotations/elements/sticky.model.ts';

const cur = { w: 220, h: 176, fontSize: 14 };
const rows = (n: number, text = 'An entry') => Array.from({ length: n }, () => ({ text }));

describe('fitSticky with entries', () => {
  test('no entries: the same answer as before (the existing rule is untouched)', () => {
    expect(fitSticky(cur, 'Launch', [])).toEqual(fitSticky(cur, 'Launch'));
    expect(fitSticky(cur, 'Launch', undefined)).toEqual(fitSticky(cur, 'Launch'));
  });

  test('a short list fits the roomy square it already has', () => {
    expect(fitSticky(cur, 'Launch', rows(2)).h).toBe(cur.h);
  });

  test('a longer list grows the sticky by its rows and footer', () => {
    const fitted = fitSticky(cur, 'Launch', rows(8));
    const lineH = cur.fontSize * 1.35;
    const title = 1 * lineH + 14 * 2;
    const need = title + 8 * (lineH + CHECK_ROW_GAP) + CHECK_FOOTER_H;
    expect(fitted.w).toBe(cur.w);
    expect(fitted.h).toBeGreaterThan(cur.h);
    expect(fitted.h).toBeGreaterThanOrEqual(Math.floor(need));
    expect(fitted.h).toBeLessThanOrEqual(Math.ceil(need) + 1);
  });

  test('a long entry wraps inside the indent and takes more than one line', () => {
    const long = 'word '.repeat(30).trim();
    const inner = cur.w - 16 * 2 - CHECK_INDENT;
    expect(wrapLines(long, cur.fontSize, inner)).toBeGreaterThan(1);
    expect(fitSticky(cur, 'Launch', rows(3, long)).h).toBeGreaterThan(
      fitSticky(cur, 'Launch', rows(3)).h
    );
  });

  test('an empty entry still takes a row (the placeholder)', () => {
    expect(fitSticky(cur, 'Launch', rows(12, '')).h).toBeGreaterThan(
      fitSticky(cur, 'Launch', []).h
    );
  });

  test('never shrinks, and is capped at the ceiling (the layer clips with "+N more")', () => {
    const roomy = { w: 220, h: 400, fontSize: 14 };
    expect(fitSticky(roomy, 'Launch', rows(2)).h).toBe(400);
    expect(fitSticky(cur, 'Launch', rows(200, 'word '.repeat(30).trim())).h).toBe(
      STICKY_MAX_GROWN_H
    );
  });
});

describe('hiddenCheckItems — the "+N more" count', () => {
  test('a sticky fitted to its list hides nothing', () => {
    const fitted = fitSticky(cur, 'Launch', rows(8));
    expect(hiddenCheckItems(fitted, 'Launch', rows(8))).toBe(0);
  });

  test('a list taller than the card hides the rows that no longer fit', () => {
    const hidden = hiddenCheckItems(cur, 'Launch', rows(8));
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(8);
    expect(hiddenCheckItems(cur, 'Launch', rows(12))).toBeGreaterThan(hidden);
  });

  test('past the ceiling the rest is counted, not drawn', () => {
    const long = rows(200, 'word '.repeat(30).trim());
    const fitted = fitSticky(cur, 'Launch', long);
    expect(fitted.h).toBe(STICKY_MAX_GROWN_H);
    expect(hiddenCheckItems(fitted, 'Launch', long)).toBeGreaterThan(0);
  });

  test('no entries, nothing hidden', () => {
    expect(hiddenCheckItems(cur, 'Launch', [])).toBe(0);
  });
});
