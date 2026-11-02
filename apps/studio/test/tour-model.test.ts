// V2-7.3 — the tour engine's step arithmetic: an optional step whose target is absent is skipped, and
// Back, the counter and Done all step over it.
import { describe, expect, test } from 'bun:test';
import { afterSkip, isLastVisible, position, stepFrom } from '../client/tour/tour-model.js';

describe('tour-model', () => {
  test('stepFrom steps over skipped indices in both directions', () => {
    expect(stepFrom(0, 1, 5, [])).toBe(1);
    expect(stepFrom(0, 1, 5, [1, 2])).toBe(3);
    expect(stepFrom(4, -1, 5, [3])).toBe(2);
    expect(stepFrom(1, -1, 5, [0])).toBe(-1);
    expect(stepFrom(3, 1, 5, [4])).toBe(5);
  });

  test('isLastVisible is true when every later step is skipped', () => {
    expect(isLastVisible(2, 4, [])).toBe(false);
    expect(isLastVisible(2, 4, [3])).toBe(true);
    expect(isLastVisible(3, 4, [])).toBe(true);
  });

  test('position takes skipped steps out of both numbers', () => {
    expect(position(0, 5, [])).toEqual({ n: 1, total: 5 });
    expect(position(3, 5, [1, 2])).toEqual({ n: 2, total: 3 });
    // a skipped step AFTER the current one shrinks the total only
    expect(position(1, 5, [3])).toEqual({ n: 2, total: 4 });
  });

  test('afterSkip goes on the way it was travelling; past the end is len (finish)', () => {
    expect(afterSkip(1, 1, 4, [])).toBe(2);
    expect(afterSkip(3, 1, 4, [])).toBe(4);
    expect(afterSkip(2, -1, 4, [])).toBe(1);
    // skipped at the very start, travelling back: turn round to the next showable step
    expect(afterSkip(0, -1, 4, [])).toBe(1);
    expect(afterSkip(1, -1, 4, [0])).toBe(2);
  });
});
