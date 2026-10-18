// S3.2a (md-present-lift, D5 / C31) — the order Present walks. Canvas order is computed from the live
// artboard world rects (rows banded at half the smallest artboard height, left to right), overridden by
// `meta.present.order`; `meta.present.skip[]` drops artboards from the run and the counter. Ids the
// canvas no longer has are dropped, never thrown on.
import { describe, expect, test } from 'bun:test';
import { canvasOrder, presentRun, startIndex } from '../present/order.ts';

const R = (id: string, x: number, y: number, w = 400, h = 600) => ({ id, x, y, w, h });

describe('canvas order: rows banded at half the smallest artboard height', () => {
  test('row by row, left to right, whatever order the rects come in', () => {
    const rects = [R('d', 500, 800), R('b', 500, 0), R('c', 0, 800), R('a', 0, 0)];
    expect(canvasOrder(rects)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a small vertical jitter stays in the same row (under half the smallest height)', () => {
    // smallest height 600 -> band 300: b sits 120 px lower than a but is still row 1
    const rects = [R('b', 500, 120), R('a', 0, 0), R('c', 1000, 40)];
    // x decides inside the row: a (0), b (500), c (1000)
    expect(canvasOrder(rects)).toEqual(['a', 'b', 'c']);
  });

  test('a drop of half the smallest height or more is the next row, even when further left', () => {
    const rects = [R('a', 0, 0), R('b', 500, 0), R('c', 0, 300), R('d', 500, 300)];
    expect(canvasOrder(rects)).toEqual(['a', 'b', 'c', 'd']);
    // early starts exactly at the band edge (300) so it is row 2 even though it is further left
    const rects2 = [R('late', 900, 0), R('early', 100, 300)];
    expect(canvasOrder(rects2)).toEqual(['late', 'early']);
  });

  test('the band comes from the SMALLEST artboard, not the first', () => {
    // heights 1000 and 200 -> band 100. y 150 is a new row; with a 1000 band it would share the row
    // and the left-most (short) would come first.
    const rects = [R('tall', 900, 0, 400, 1000), R('short', 0, 150, 400, 200)];
    expect(canvasOrder(rects)).toEqual(['tall', 'short']);
  });

  test('equal positions fall back to id so the order is stable', () => {
    expect(canvasOrder([R('b', 0, 0), R('a', 0, 0)])).toEqual(['a', 'b']);
  });

  test('empty, and rects with broken numbers, never throw', () => {
    expect(canvasOrder([])).toEqual([]);
    const bad = [R('ok', 0, 0), { id: 'nan', x: Number.NaN, y: 0, w: 1, h: 1 }];
    expect(canvasOrder(bad)).toEqual(['ok']);
  });
});

describe('the run: explicit order, skip, stale ids', () => {
  const rects = [R('a', 0, 0), R('b', 500, 0), R('c', 1000, 0), R('d', 0, 800)];

  test('no meta: the run is the canvas order', () => {
    expect(presentRun(rects, undefined)).toEqual({
      all: ['a', 'b', 'c', 'd'],
      run: ['a', 'b', 'c', 'd'],
      skipped: [],
    });
  });

  test('an explicit order wins; artboards it does not name follow in canvas order', () => {
    const r = presentRun(rects, { order: ['c', 'a'] });
    expect(r.run).toEqual(['c', 'a', 'b', 'd']);
    expect(r.all).toEqual(['a', 'b', 'c', 'd']);
  });

  test('stale ids in order and skip are dropped; duplicates and non-strings too', () => {
    const r = presentRun(rects, {
      order: ['gone', 'b', 'b', 7, null, 'a'],
      skip: ['also-gone', 9],
    });
    expect(r.run).toEqual(['b', 'a', 'c', 'd']);
    expect(r.skipped).toEqual([]);
  });

  test('skip removes artboards from the run (and so from the counter total)', () => {
    const r = presentRun(rects, { skip: ['b', 'd'] });
    expect(r.run).toEqual(['a', 'c']);
    expect(r.skipped).toEqual(['b', 'd']);
  });

  test('skip applies to an explicit order too', () => {
    const r = presentRun(rects, { order: ['d', 'c', 'b', 'a'], skip: ['c'] });
    expect(r.run).toEqual(['d', 'b', 'a']);
    expect(r.skipped).toEqual(['c']);
  });

  test('garbage meta is ignored: it is a file a peer wrote', () => {
    for (const meta of [null, 'x', 4, [], { order: 'a', skip: { 0: 'a' } }]) {
      expect(presentRun(rects, meta as never).run).toEqual(['a', 'b', 'c', 'd']);
    }
  });

  test('everything skipped is an empty run, not an error', () => {
    expect(presentRun(rects, { skip: ['a', 'b', 'c', 'd'] }).run).toEqual([]);
  });
});

describe('where Present starts', () => {
  const rects = [R('a', 0, 0), R('b', 500, 0), R('c', 1000, 0)];

  test("'start' and nothing is the first artboard", () => {
    const run = presentRun(rects, undefined);
    expect(startIndex(run, 'start')).toBe(0);
    expect(startIndex(run, undefined)).toBe(0);
  });

  test('an artboard id starts there, in run order', () => {
    const run = presentRun(rects, { order: ['c', 'b', 'a'] });
    expect(startIndex(run, 'b')).toBe(1);
    expect(startIndex(run, 'a')).toBe(2);
  });

  test('a skipped artboard starts at the next presentable one after it in canvas order', () => {
    const run = presentRun(rects, { skip: ['b'] });
    expect(startIndex(run, 'b')).toBe(1); // run is [a, c]; c follows b
    const last = presentRun(rects, { skip: ['c'] });
    expect(startIndex(last, 'c')).toBe(0); // nothing follows c: the start
  });

  test('an id the canvas does not have starts at the first', () => {
    expect(startIndex(presentRun(rects, undefined), 'nope')).toBe(0);
  });
});
