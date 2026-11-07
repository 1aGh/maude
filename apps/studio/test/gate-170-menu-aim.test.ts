// #170 F34 — a submenu forgives the diagonal: the pointer heading from File toward its open submenu is not read as a
// hover on Edit / View on the way.
import { describe, expect, test } from 'bun:test';
import { AIM_DELAY_MS, aimingAtSub, inTriangle } from '../client/v2/shell/menu-aim.js';

// the project menu is 200 wide; File's submenu opens to its right, 100 → 300 tall, at x 204
const SUB = { left: 204, right: 404, top: 100, bottom: 300 };
const MENU_RIGHT = 200;

describe('inTriangle', () => {
  test('inside, on a corner and outside', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    const c = { x: 0, y: 10 };
    expect(inTriangle({ x: 2, y: 2 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 0, y: 0 }, a, b, c)).toBe(true);
    expect(inTriangle({ x: 9, y: 9 }, a, b, c)).toBe(false);
  });
});

describe('aimingAtSub (submenu on the right)', () => {
  const prev = { x: 150, y: 110 }; // on the File row, near its right end
  test('a diagonal toward the submenu, passing over the row below, is aiming', () => {
    expect(aimingAtSub(prev, { x: 175, y: 140 }, SUB, MENU_RIGHT)).toBe(true);
  });
  test('straight down the menu (to View) is not aiming', () => {
    expect(aimingAtSub(prev, { x: 150, y: 180 }, SUB, MENU_RIGHT)).toBe(false);
  });
  test('moving away from the submenu is not aiming', () => {
    expect(aimingAtSub(prev, { x: 100, y: 120 }, SUB, MENU_RIGHT)).toBe(false);
  });
  test('already at the submenu edge: nothing to wait for', () => {
    expect(aimingAtSub(prev, { x: 204, y: 120 }, SUB, MENU_RIGHT)).toBe(false);
  });
  test('no previous point, or no submenu box, never aims', () => {
    expect(aimingAtSub(null, { x: 175, y: 140 }, SUB, MENU_RIGHT)).toBe(false);
    expect(aimingAtSub(prev, { x: 175, y: 140 }, null, MENU_RIGHT)).toBe(false);
    expect(aimingAtSub(prev, { x: 175, y: 140 }, { ...SUB, right: SUB.left }, MENU_RIGHT)).toBe(
      false
    );
  });
});

describe('aimingAtSub (submenu flipped to the left)', () => {
  const LEFT = { left: -204, right: -4, top: 100, bottom: 300 };
  test('a diagonal toward it is aiming; away from it is not', () => {
    const prev = { x: 40, y: 110 };
    expect(aimingAtSub(prev, { x: 15, y: 140 }, LEFT, 200)).toBe(true);
    expect(aimingAtSub(prev, { x: 90, y: 120 }, LEFT, 200)).toBe(false);
  });
});

test('the wait is short enough to feel instant on a stop', () => {
  expect(AIM_DELAY_MS).toBeGreaterThan(100);
  expect(AIM_DELAY_MS).toBeLessThanOrEqual(300);
});
