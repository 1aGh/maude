import { describe, expect, test } from 'bun:test';

import { placeMenu } from '../client/tree-row-menu.jsx';

// A row near the bottom of a long tree opened its menu below the viewport —
// the items existed but nobody could reach them (T31 L01, hub browser).
const viewport = { width: 1440, height: 1000 };
const size = { width: 180, height: 120 };

describe('tree row menu placement', () => {
  test('opens below the row when it fits', () => {
    const p = placeMenu({ top: 100, bottom: 124, left: 40 }, size, viewport);
    expect(p.top).toBe(128);
    expect(p.left).toBe(40);
  });

  test('flips above a row at the bottom of the window', () => {
    const p = placeMenu({ top: 944, bottom: 968, left: 222 }, size, viewport);
    expect(p.top + size.height).toBeLessThanOrEqual(944);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  test('pins to the edge when it fits neither above nor below', () => {
    const tall = { width: 180, height: 900 };
    const p = placeMenu({ top: 60, bottom: 84, left: 40 }, tall, viewport);
    expect(p.top).toBe(88);
    expect(p.top + tall.height).toBeLessThanOrEqual(viewport.height - 8);
    const q = placeMenu({ top: 500, bottom: 524, left: 40 }, { width: 180, height: 990 }, viewport);
    expect(q.top).toBe(8);
    expect(q.maxHeight).toBe(984);
  });

  test('never runs off the right edge', () => {
    const p = placeMenu({ top: 100, bottom: 124, left: 1400 }, size, viewport);
    expect(p.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
  });
});
