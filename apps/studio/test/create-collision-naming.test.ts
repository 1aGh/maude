// S6.13b — the free name a renamed offline create takes (C4, `nextFreeCanvasName`), and the words.

import { describe, expect, test } from 'bun:test';
import { createRenamedText, freeCreateRel } from '../sync/create-collision.ts';

describe('freeCreateRel', () => {
  test('the next C4 name in the same folder', () => {
    expect(freeCreateRel('ui/Untitled canvas.tsx', () => false)).toBe('ui/Untitled canvas 2.tsx');
    const taken = new Set(['ui/Poster 2.tsx', 'ui/Poster 3.tsx']);
    expect(freeCreateRel('ui/Poster.tsx', (c) => taken.has(c))).toBe('ui/Poster 4.tsx');
  });

  test('counts up from its own number, never down', () => {
    expect(freeCreateRel('ui/Untitled canvas 2.tsx', () => false)).toBe('ui/Untitled canvas 3.tsx');
  });

  test('a canvas at the design root stays there', () => {
    expect(freeCreateRel('Logo.tsx', () => false)).toBe('Logo 2.tsx');
  });
});

test('the notice says what happened and what it is called now (CONTRACT §3–§4)', () => {
  expect(createRenamedText('Untitled canvas', 'Untitled canvas 2')).toBe(
    '“Untitled canvas” was also made on another device — this one is now “Untitled canvas 2”.'
  );
});
