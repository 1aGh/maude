// S2.22 — the gap chip prints whole px when the value is whole within 0.05 ("24", not "23.95").
import { describe, expect, test } from 'bun:test';

import { computeBands, worldWords } from '../editing/gap-bands.tsx';

describe('worldWords', () => {
  test('whole within 0.05 → whole', () => {
    expect(worldWords(23.95)).toBe('24');
    expect(worldWords(24.04)).toBe('24');
    expect(worldWords(24)).toBe('24');
    expect(worldWords(0)).toBe('0');
  });

  test('a real fraction stays, two decimals at most', () => {
    expect(worldWords(23.9)).toBe('23.9');
    expect(worldWords(12.5)).toBe('12.5');
    expect(worldWords(7.333)).toBe('7.33');
  });
});

describe('the band chip', () => {
  test('a gap measured at 23.95 world px reads "24"', () => {
    const r = (left: number) => ({ left, top: 0, width: 100, height: 50 });
    const bands = computeBands(
      { left: 0, top: 0, width: 400, height: 50 },
      [r(0), r(123.95), r(247.9)],
      { top: 0, right: 0, bottom: 0, left: 0 },
      'x',
      1
    );
    expect(bands.filter((b) => b.kind === 'gap').map((b) => b.label)).toEqual(['24', '24']);
  });
});
