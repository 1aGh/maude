// S4.12 (canvas 15 `an-sticky`, `an-place`) — a sticky up close: a stable tilt from the id, the size
// it needs for its words (five lines, then wider, smaller type only past 120 words), the 12 px stack,
// Fan out, the author line and where an imported one came from.

import { describe, expect, test } from 'bun:test';

import {
  authorLine,
  fanOut,
  fitSticky,
  provenanceLine,
  relativeTime,
  STICKY_MAX_LINES,
  STICKY_MAX_W,
  STICKY_STACK_STEP,
  STICKY_TILT_MAX,
  stackLanding,
  stackMembers,
  tiltOf,
  wrapLines,
} from '../annotations/elements/sticky.model.ts';

describe('tilt from the id (cell 2)', () => {
  test('the same id always tilts the same; every tilt is within ±2°', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `s_${(i * 7919).toString(36)}${i}`);
    for (const id of ids) {
      const t = tiltOf(id);
      expect(t).toBe(tiltOf(id));
      expect(Math.abs(t)).toBeLessThanOrEqual(STICKY_TILT_MAX);
      expect(Math.round(t * 10) / 10).toBe(t); // tenths of a degree
    }
  });
  test('ids spread over the range — not one angle for all', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => tiltOf(`n${i}`)));
    expect(seen.size).toBeGreaterThan(15);
    expect([...seen].some((t) => t < -1)).toBe(true);
    expect([...seen].some((t) => t > 1)).toBe(true);
  });
});

describe('grows with its words (cell 1)', () => {
  const sq = { w: 200, h: 200, fontSize: 14 };
  test('"Yes" fits the square as it is', () => {
    expect(fitSticky(sq, 'Yes')).toEqual(sq);
  });
  test('a short note keeps the square (never smaller)', () => {
    expect(fitSticky(sq, 'Headline on one line?')).toEqual(sq);
  });
  test('a small paper grows taller to five lines before it widens', () => {
    const small = { w: 96, h: 96, fontSize: 14 };
    const next = fitSticky(small, 'Headline on one line? It wraps');
    expect(next.w).toBe(96);
    expect(next.h).toBeGreaterThan(96);
    expect(wrapLines('Headline on one line? It wraps', 14, 96 - 32)).toBeLessThanOrEqual(
      STICKY_MAX_LINES
    );
  });
  test('past five lines it gets wider, and the type keeps its size', () => {
    const text =
      'Mobile hero crops the hill — show all of it, or pick another photo from the shoot, please';
    const small = { w: 128, h: 128, fontSize: 14 };
    expect(wrapLines(text, 14, 128 - 32)).toBeGreaterThan(STICKY_MAX_LINES);
    const next = fitSticky(small, text);
    expect(next.w).toBeGreaterThan(128);
    expect(next.fontSize).toBe(14);
    expect(wrapLines(text, 14, next.w - 32)).toBeLessThanOrEqual(STICKY_MAX_LINES);
  });
  test('it never shrinks the paper', () => {
    const big = { w: 300, h: 300, fontSize: 14 };
    expect(fitSticky(big, 'ok')).toEqual(big);
  });
  test('the type gets smaller only past 120 words', () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
    expect(fitSticky(sq, words(120)).fontSize).toBe(14);
    const long = fitSticky(sq, words(240));
    expect(long.fontSize).toBeLessThan(14);
    expect(long.fontSize).toBeGreaterThanOrEqual(10);
    // widening stops at the ceiling; it never runs off the board
    expect(long.w).toBeLessThanOrEqual(STICKY_MAX_W);
  });
});

describe('a drop on a sticky stacks 12 px down-right (cell 3)', () => {
  const a = { id: 'a', x: 100, y: 100, w: 128, h: 128 };
  test('a point outside every sticky does not stack', () => {
    expect(stackLanding({ x: 10, y: 10 }, [a])).toBeNull();
  });
  test('over a sticky: 12 px down and right of its corner', () => {
    expect(stackLanding({ x: 150, y: 150 }, [a])).toEqual({
      x: 100 + STICKY_STACK_STEP,
      y: 100 + STICKY_STACK_STEP,
    });
  });
  test('a third one steps again, so every paper still shows', () => {
    const b = { id: 'b', x: 112, y: 112, w: 128, h: 128 };
    expect(stackLanding({ x: 150, y: 150 }, [a, b])).toEqual({ x: 124, y: 124 });
  });
  test('the sticky being moved does not stack on itself', () => {
    expect(stackLanding({ x: 150, y: 150 }, [a], 'a')).toBeNull();
  });
});

describe('Fan out (cell 3)', () => {
  const stack = [
    { id: 'a', x: 40, y: 30, w: 128, h: 128 },
    { id: 'b', x: 54, y: 44, w: 128, h: 128 },
    { id: 'c', x: 68, y: 58, w: 128, h: 128 },
  ];
  const far = { id: 'z', x: 900, y: 900, w: 128, h: 128 };
  test('finds the stack, not the sticky far away', () => {
    expect(stackMembers([...stack, far], 'c')).toEqual(['a', 'b', 'c']);
    expect(stackMembers([...stack, far], 'z')).toEqual(['z']);
  });
  test('spreads the stack into a row in paint order, from the leftmost corner', () => {
    const out = fanOut(stack);
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(out[0]).toEqual({ id: 'a', x: 40, y: 30 });
    expect(out[1]?.x).toBeGreaterThan(40 + 128);
    expect(out.every((p) => p.y === 30)).toBe(true);
  });
  test('one sticky has nothing to fan out', () => {
    expect(fanOut([stack[0] as (typeof stack)[number]])).toEqual([]);
  });
});

describe('the author line (cell 5)', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  test('relative first', () => {
    expect(relativeTime('2026-10-19T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-10-19T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-19T10:00:00Z', now)).toBe('2 h ago');
    expect(relativeTime('2026-10-18T09:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-10-16T09:00:00Z', now)).toBe('3 d ago');
  });
  test('"Jonas · 2 h ago"; You for yourself; AI for the assistant; no time when none is known', () => {
    expect(authorLine({ name: 'Jonas' }, '2026-10-19T10:00:00Z', now)).toBe('Jonas · 2 h ago');
    expect(authorLine({ name: 'Jonas', me: true }, '2026-10-19T11:59:50Z', now)).toBe(
      'You · just now'
    );
    expect(authorLine({ ai: true }, null, now)).toBe('AI');
    expect(authorLine({ name: 'Tereza' }, undefined, now)).toBe('Tereza');
    expect(authorLine({}, null, now)).toBe('');
  });
  test('an imported sticky says where it came from; a template says nothing', () => {
    expect(provenanceLine({ kind: 'figjam', author: 'Tereza' })).toBe('From FigJam · Tereza');
    expect(provenanceLine({ kind: 'comment' })).toBe('From a comment');
    expect(provenanceLine({ kind: 'template' })).toBeNull();
    expect(provenanceLine(null)).toBeNull();
  });
});
