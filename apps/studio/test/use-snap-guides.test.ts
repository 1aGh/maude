// use-snap-guides — Phase 4.2 Task 1. Pure snap-math table tests.

import { describe, expect, test } from 'bun:test';

import { computeSnap, equalGapLandings, type Rect, type SnapOptions } from '../use-snap-guides.tsx';

const DEFAULTS: SnapOptions = { gridSize: 40, tolerance: 8, disabled: false };

const rect = (x: number, y: number, w = 100, h = 80): Rect => ({ x, y, w, h });

describe('computeSnap / disabled (Alt-held)', () => {
  test('returns proposed unchanged + zero guides', () => {
    const r = computeSnap(rect(37, 78), [rect(100, 100)], { ...DEFAULTS, disabled: true });
    expect(r.x).toBe(37);
    expect(r.y).toBe(78);
    expect(r.guides).toEqual([]);
  });
});

describe('computeSnap / grid', () => {
  test('snaps left edge to nearest grid line within tolerance', () => {
    const r = computeSnap(rect(37, 200), [], DEFAULTS);
    expect(r.x).toBe(40);
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 40 });
  });

  test('does NOT snap when outside tolerance', () => {
    const r = computeSnap(rect(27, 200), [], DEFAULTS);
    expect(r.x).toBe(27);
    expect(r.guides.find((g) => g.axis === 'x')).toBeUndefined();
  });

  test('snaps top edge independently of left edge', () => {
    const r = computeSnap(rect(200, 37), [], DEFAULTS);
    expect(r.y).toBe(40);
    expect(r.guides.find((g) => g.axis === 'y')).toMatchObject({ pos: 40 });
    expect(r.x).toBe(200);
  });

  test('exact grid boundary (delta = 0) snaps to itself + emits guide', () => {
    const r = computeSnap(rect(40, 80), [], DEFAULTS);
    expect(r.x).toBe(40);
    expect(r.y).toBe(80);
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 40 });
    expect(r.guides.find((g) => g.axis === 'y')).toMatchObject({ pos: 80 });
  });

  test("guide line spans proposed's perpendicular extent (no sibling)", () => {
    const r = computeSnap(rect(37, 200, 100, 80), [], DEFAULTS);
    const xg = r.guides.find((g) => g.axis === 'x');
    expect(xg).toMatchObject({ from: 200, to: 280 });
  });
});

describe('computeSnap / sibling edges (X-axis)', () => {
  test('left↔left snap', () => {
    const proposed = rect(503, 200);
    const sibling = rect(500, 50);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(500);
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 500 });
  });

  test('right↔right snap (proposed.right snaps to sibling.right)', () => {
    // proposed right = 503 + 100 = 603; sibling right = 500 + 100 = 600.
    // delta = 600 - 603 = -3 → snap x by -3.
    const proposed = rect(503, 300, 100, 80);
    const sibling = rect(500, 100, 100, 80);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(500);
  });

  test('left↔right (proposed.left snaps to sibling.right — abutment)', () => {
    // proposed.left = 597; sibling.right = 600. delta = +3.
    const proposed = rect(597, 300, 100, 80);
    const sibling = rect(500, 100, 100, 80);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(600);
  });

  test('centerX↔centerX snap', () => {
    // proposed center = 553 + 50 = 603; sibling center = 550 + 50 = 600.
    const proposed = rect(553, 300, 100, 80);
    const sibling = rect(550, 100, 100, 80);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(550);
  });

  test('does NOT snap when delta exceeds tolerance', () => {
    // proposed.x = 530 sits between grid lines 520 (Δ-10) and 560 (Δ+30) — both
    // outside tolerance=8. Sibling at 500 is also -30 away. Nothing snaps.
    const proposed = rect(530, 305);
    const sibling = rect(500, 105);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(530);
    expect(r.guides.find((g) => g.axis === 'x')).toBeUndefined();
  });

  test("guide line spans union of both rects' Y range", () => {
    const proposed = rect(503, 50, 100, 80); // y range [50, 130]
    const sibling = rect(500, 300, 100, 80); // y range [300, 380]
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    const xg = r.guides.find((g) => g.axis === 'x');
    expect(xg).toMatchObject({ from: 50, to: 380 });
  });
});

describe('computeSnap / sibling edges (Y-axis)', () => {
  test('top↔top snap', () => {
    const proposed = rect(300, 103, 100, 80);
    const sibling = rect(50, 100, 100, 80);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.y).toBe(100);
  });

  test('bottom↔top snap (proposed below sibling, abutting)', () => {
    // proposed.bottom = 177; sibling.top = 180. delta = +3 → shift y by +3.
    const proposed = rect(300, 97, 100, 80);
    const sibling = rect(50, 180, 100, 80);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.y).toBe(100);
    expect(proposed.y + 100 - 97).toBe(100);
    const yg = r.guides.find((g) => g.axis === 'y');
    expect(yg).toMatchObject({ pos: 180 });
  });

  test('centerY↔centerY snap', () => {
    const proposed = rect(300, 103, 100, 80); // centerY = 143
    const sibling = rect(50, 100, 100, 80); // centerY = 140
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.y).toBe(100);
  });
});

describe('computeSnap / closest wins', () => {
  test('when sibling and grid both within tolerance, closer wins', () => {
    // proposed.x = 37; grid candidate at 40 (delta 3); sibling.left at 38 (delta 1).
    const proposed = rect(37, 300);
    const sibling = rect(38, 100);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(38);
  });

  test('when grid is closer, grid wins', () => {
    // proposed.x = 39; grid candidate at 40 (delta 1); sibling at 35 (delta -4).
    const proposed = rect(39, 300);
    const sibling = rect(35, 100);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(40);
  });
});

describe('computeSnap / X and Y axes are independent', () => {
  test('snaps X to sibling AND Y to grid simultaneously', () => {
    // proposed at (503, 37): X snaps to sibling.left=500; Y snaps to grid 40.
    const proposed = rect(503, 37);
    const sibling = rect(500, 300);
    const r = computeSnap(proposed, [sibling], DEFAULTS);
    expect(r.x).toBe(500);
    expect(r.y).toBe(40);
    expect(r.guides.length).toBe(2);
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 500 });
    expect(r.guides.find((g) => g.axis === 'y')).toMatchObject({ pos: 40 });
  });
});

describe('computeSnap / multiple siblings at same pos merge into one guide', () => {
  test('two siblings with the same left edge produce a single merged guide', () => {
    const proposed = rect(503, 300, 100, 80);
    const sibA = rect(500, 100, 100, 80); // y range [100, 180]
    const sibB = rect(500, 500, 100, 80); // y range [500, 580]
    const r = computeSnap(proposed, [sibA, sibB], DEFAULTS);
    const xGuides = r.guides.filter((g) => g.axis === 'x');
    expect(xGuides.length).toBe(1);
    expect(xGuides[0]).toMatchObject({
      pos: 500,
      from: 100,
      to: 580,
    });
  });
});

describe('computeSnap / no candidates', () => {
  test('empty others + outside grid tolerance → identity, no guides', () => {
    const r = computeSnap(rect(27, 27), [], DEFAULTS);
    expect(r.x).toBe(27);
    expect(r.y).toBe(27);
    expect(r.guides).toEqual([]);
  });
});

// feature-1-artboard-kinds-foundation, T7 — generic-layout-guide-line candidates.
describe('computeSnap / guide lines (T5 guides fed in as snap candidates)', () => {
  test('left edge snaps to a guide line within tolerance, kind "guide"', () => {
    const r = computeSnap(rect(503, 200), [], {
      ...DEFAULTS,
      guideLines: [{ axis: 'x', pos: 500, from: 0, to: 1000 }],
    });
    expect(r.x).toBe(500);
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 500, kind: 'guide' });
  });

  test('right edge and center also test against the same guide line', () => {
    // proposed right edge (137+100=237) is within tolerance of the guide at 240.
    const r = computeSnap(rect(137, 200), [], {
      ...DEFAULTS,
      guideLines: [{ axis: 'x', pos: 240, from: 0, to: 1000 }],
    });
    expect(r.x).toBe(140); // shifted so right edge lands exactly on 240
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ pos: 240, kind: 'guide' });
  });

  test('a closer sibling wins over a farther guide line on the same axis', () => {
    const r = computeSnap(rect(503, 200), [rect(500, 500)], {
      ...DEFAULTS,
      guideLines: [{ axis: 'x', pos: 507, from: 0, to: 1000 }],
    });
    // sibling delta = -3 (|3|), guide delta = +4 (|4|) — sibling is closer.
    expect(r.guides.find((g) => g.axis === 'x')).toMatchObject({ kind: 'sibling', pos: 500 });
  });

  test('outside tolerance, a guide line is ignored', () => {
    const r = computeSnap(rect(100, 200), [], {
      ...DEFAULTS,
      guideLines: [{ axis: 'x', pos: 500, from: 0, to: 1000 }],
    });
    expect(r.x).toBe(100);
  });

  test('y-axis guide lines snap independently of x-axis', () => {
    const r = computeSnap(rect(200, 303), [], {
      ...DEFAULTS,
      guideLines: [{ axis: 'y', pos: 300, from: 0, to: 1000 }],
    });
    expect(r.y).toBe(300);
    expect(r.x).toBe(200);
  });
});

describe('computeSnap / intent presets (T7 Design Decision 4)', () => {
  test('"pixel" intent ignores siblings AND guide lines — grid only', () => {
    const r = computeSnap(rect(503, 201), [rect(500, 500)], {
      ...DEFAULTS,
      intent: 'pixel',
      guideLines: [{ axis: 'x', pos: 502, from: 0, to: 1000 }],
    });
    // Neither the sibling (delta -3) nor the guide (delta -1) fire under
    // "pixel" — only the grid pass, out of tolerance from both 503 and 201.
    expect(r.x).toBe(503);
    expect(r.guides.some((g) => g.kind === 'sibling' || g.kind === 'guide')).toBe(false);
  });

  test('"pixel" intent still snaps to the grid', () => {
    const r = computeSnap(rect(37, 200), [], { ...DEFAULTS, intent: 'pixel' });
    expect(r.x).toBe(40);
  });

  test('omitting `intent` defaults to "layout" (back-compat with every pre-T7 call site)', () => {
    const r = computeSnap(rect(503, 200), [rect(500, 500)], DEFAULTS);
    expect(r.x).toBe(500);
  });

  test('"layout" intent (explicit) still snaps to siblings + guides', () => {
    const r = computeSnap(rect(503, 200), [], {
      ...DEFAULTS,
      intent: 'layout',
      guideLines: [{ axis: 'x', pos: 500, from: 0, to: 1000 }],
    });
    expect(r.x).toBe(500);
  });
});

// S2.22 (ed-ab-arrange) — the equal-gap landing beats the grid; a tie goes to the sibling edge, not the grid.
describe('computeSnap / equal gaps (S2.22)', () => {
  // three 1000-wide boards with gaps of 94: the next one belongs at x 3794
  const row = [rect(512, 0, 1000, 1000), rect(1606, 0, 1000, 1000), rect(2700, 0, 1000, 1000)];
  const OPTS: SnapOptions = { gridSize: 40, tolerance: 8, disabled: false };

  test('the landings: one gap past the last, one before the first', () => {
    expect(equalGapLandings(rect(3797, 0, 1000, 1000), row, 'x')).toEqual([3794, -582]);
  });

  test('3794 wins over the grid line 3800 when both are within tolerance', () => {
    const r = computeSnap(rect(3797, 0, 1000, 1000), row, OPTS);
    expect(r.x).toBe(3794);
  });

  test('it wins even where the grid is the nearer one', () => {
    const r = computeSnap(rect(3799, 0, 1000, 1000), row, OPTS);
    expect(r.x).toBe(3794);
  });

  test('out of reach it does nothing, and the grid keeps its say', () => {
    expect(computeSnap(rect(3836, 0, 1000, 1000), row, OPTS).x).toBe(3840);
  });

  test('one board is not a rhythm; a board in another row does not count', () => {
    expect(equalGapLandings(rect(3797, 0, 1000, 1000), [row[0] as Rect], 'x')).toEqual([]);
    expect(equalGapLandings(rect(3797, 5000, 1000, 1000), row, 'x')).toEqual([]);
  });

  test('a rhythm landing draws no guide line of its own (the chips are its picture)', () => {
    const r = computeSnap(rect(3797, 0, 1000, 1000), row, OPTS);
    expect(r.guides.find((g) => g.axis === 'x')).toBeUndefined();
  });

  test('a tie between the grid and a board edge goes to the board edge (its guide is the one drawn)', () => {
    // top 0: the grid line AND the siblings' tops are both a delta of 0 away
    const r = computeSnap(rect(3797, 0, 1000, 1000), [row[0] as Rect], OPTS);
    expect(r.guides.find((g) => g.axis === 'y')?.kind).toBe('sibling');
  });
});
