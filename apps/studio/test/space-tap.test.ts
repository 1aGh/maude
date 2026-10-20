// S7.8 — tap Space plays, hold Space is the Hand (S7-slices Q10): a tap is a release inside 200 ms with no
// pointer drag between; a hold, a drag, a key repeat and a lost focus are never a tap.
import { describe, expect, test } from 'bun:test';
import { createSpaceTap, SPACE_TAP_MS } from '../editing/space-tap.ts';

describe('space tap vs hold', () => {
  test('the line is 200 ms', () => {
    expect(SPACE_TAP_MS).toBe(200);
  });

  test('released in 80 ms: a tap', () => {
    const s = createSpaceTap();
    s.down(1000);
    expect(s.up(1080)).toBe(true);
  });

  test('released at exactly 200 ms is a hold; 199 ms is still a tap', () => {
    const a = createSpaceTap();
    a.down(0);
    expect(a.up(199)).toBe(true);
    const b = createSpaceTap();
    b.down(0);
    expect(b.up(200)).toBe(false);
  });

  test('a drag while it is down cancels the tap, however short', () => {
    const s = createSpaceTap();
    s.down(0);
    s.drag();
    expect(s.up(60)).toBe(false);
  });

  test('a key repeat is not a new press: the hold keeps its first timestamp', () => {
    const s = createSpaceTap();
    s.down(0);
    s.down(150); // auto-repeat
    expect(s.up(260)).toBe(false);
  });

  test('a drag with no press down is ignored, and the next press starts clean', () => {
    const s = createSpaceTap();
    s.drag();
    s.down(0);
    expect(s.up(50)).toBe(true);
  });

  test('an up with no down is not a tap, and cancel forgets the press', () => {
    const s = createSpaceTap();
    expect(s.up(10)).toBe(false);
    s.down(0);
    s.cancel();
    expect(s.up(20)).toBe(false);
  });

  test('each press is judged alone', () => {
    const s = createSpaceTap();
    s.down(0);
    s.drag();
    expect(s.up(40)).toBe(false);
    s.down(500);
    expect(s.up(540)).toBe(true);
  });
});
