// S2.9 (artboard ed-ab-arrange) — what the canvas says while one artboard is dragged: the edge that lines up but
// was not the one snapped to (the soft guide), the equal gaps ("80" three times), and the words beside the pointer
// ("X 3480 · Y 0"). All pure; the overlay that draws them is test/artboard-arrange-client.test.tsx.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bubbleText,
  equalGapChips,
  GUIDE_EPS,
  GUIDES_CSS,
  softGuides,
} from '../editing/artboard-guides.tsx';

const r = (x: number, y: number, w = 238, h = 238) => ({ x, y, w, h });

describe('softGuides — the edges that line up besides the one snapped to', () => {
  // three posts on a line (y 150), the fourth dragged to the same top: top is the snapped edge, the bottom
  // (same height) lines up too and is drawn soft
  const others = [r(140, 150), r(395, 150), r(650, 150)];
  const leader = r(905, 150);
  const snapped = [{ axis: 'y' as const, pos: 150, from: 140, to: 1143 }];

  test('the snapped top is the engine’s (strong) guide; the bottom is returned soft', () => {
    const soft = softGuides(leader, others, snapped);
    expect(soft.map((g) => [g.axis, g.pos])).toEqual([['y', 388]]);
    expect(soft[0]?.from).toBe(140);
    expect(soft[0]?.to).toBe(905 + 238);
  });

  test('nothing lines up → nothing soft; an edge off by more than half a pixel does not count', () => {
    expect(softGuides(r(905, 150, 238, 200), others, snapped)).toEqual([]);
    expect(softGuides(r(905, 150.7, 238, 238), others, [])).toEqual([]);
  });

  test('only edges are soft (a centre that happens to match is the engine’s to draw, when it snapped to it)', () => {
    const tall = r(905, 100, 238, 338); // centre y 269 = the others' 269, no edge matches
    expect(softGuides(tall, others, [])).toEqual([]);
  });

  test('an engine guide is never doubled', () => {
    const lowered = r(905, 150, 238, 238);
    const both = softGuides(lowered, others, [
      { axis: 'y', pos: 150, from: 0, to: 1 },
      { axis: 'y', pos: 388, from: 0, to: 1 },
    ]);
    expect(both).toEqual([]);
  });

  test('the epsilon is half a world pixel', () => {
    expect(GUIDE_EPS).toBe(0.5);
  });
});

describe('equalGapChips — gaps that came out the same', () => {
  const row = [r(140, 150, 238), r(396, 150, 238), r(652, 150, 238)]; // gaps 18, 18
  test('the dragged board lands on the rhythm: one chip per equal gap, in world px', () => {
    const chips = equalGapChips(r(908, 150, 238), [...row, r(5000, 5000)]);
    // 140..378 | 396..634 | 652..890 | 908..1146 → three gaps of 18
    expect(chips.map((c) => c.gap)).toEqual([18, 18, 18]);
    expect(chips.every((c) => c.axis === 'x')).toBe(true);
    expect(chips[0]?.from).toBe(378);
    expect(chips[0]?.to).toBe(396);
    expect(chips[0]?.cross).toBe(150 + 119);
  });

  test('the "80" case: four posts, three gaps of 80', () => {
    const posts = [r(0, 0, 1080), r(1160, 0, 1080), r(2320, 0, 1080)];
    const chips = equalGapChips(r(3480, 0, 1080), posts);
    expect(chips.map((c) => c.gap)).toEqual([80, 80, 80]);
  });

  test('uneven gaps → no chips; two boards are not a rhythm', () => {
    expect(equalGapChips(r(1000, 150), row)).toEqual([]);
    expect(equalGapChips(r(500, 150), [r(100, 150)])).toEqual([]);
  });

  test('boards on other rows do not take part; a vertical stack reads on the y axis', () => {
    const elsewhere = [r(140, 900), r(396, 900), r(652, 900)];
    expect(equalGapChips(r(908, 150), elsewhere)).toEqual([]);
    const stack = [r(0, 0, 200, 100), r(0, 150, 200, 100), r(0, 300, 200, 100)];
    const chips = equalGapChips(r(0, 450, 200, 100), stack);
    expect(chips.map((c) => [c.axis, c.gap])).toEqual([
      ['y', 50],
      ['y', 50],
      ['y', 50],
    ]);
  });

  test('a gap that is not positive is not a gap', () => {
    expect(equalGapChips(r(236, 0), [r(0, 0), r(118, 0)])).toEqual([]);
  });
});

describe('bubbleText', () => {
  test('X and Y of the dragged board, whole pixels, a middle dot between', () => {
    expect(bubbleText({ x: 3480, y: 0 })).toBe('X 3480 · Y 0');
    expect(bubbleText({ x: 12.6, y: -4.4 })).toBe('X 13 · Y -4');
  });
});

describe('the colour is the guide colour, never the selection azure', () => {
  test('the stylesheet reads --guide / --guide-fg only', () => {
    expect(GUIDES_CSS).toContain('var(--guide');
    expect(GUIDES_CSS).not.toMatch(/--accent|--maude-hud-accent|azure/i);
  });
  test('the source never names an accent token', () => {
    const src = readFileSync(join(import.meta.dir, '../editing/artboard-guides.tsx'), 'utf8');
    expect(src).not.toMatch(/--maude-hud-accent|--accent\b/);
  });
});
