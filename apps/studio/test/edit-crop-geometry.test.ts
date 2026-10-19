// S2.15 — the arithmetic of crop mode: a picture's rectangle inside its box from object-position + zoom, a drag back to
// X / Y, a corner drag back to the zoom. Pure goldens (ed-img: "drag it, or its corners").

import { describe, expect, test } from 'bun:test';

import {
  coverSize,
  cropFromStyle,
  cropParams,
  dragCorner,
  pan,
  pictureRect,
  positionFor,
} from '../editing/crop-geometry.ts';

const BOX = { w: 300, h: 400 };
const NAT = { w: 4032, h: 3024 };
const close = (a: number, b: number, places = 2) => expect(a).toBeCloseTo(b, places);

describe('the picture inside its box', () => {
  test('cover: the smallest size with the picture’s own ratio that fills the box', () => {
    const c = coverSize(BOX, NAT);
    close(c.w, 533.33);
    close(c.h, 400);
  });

  test('object-position 50 % 50 % centres it; 0 % / 100 % align its edges with the box', () => {
    const mid = pictureRect(BOX, NAT, { zoom: 1, x: 50, y: 50 });
    close(mid.left, -116.67);
    close(mid.top, 0);
    close(pictureRect(BOX, NAT, { zoom: 1, x: 0, y: 50 }).left, 0);
    close(pictureRect(BOX, NAT, { zoom: 1, x: 100, y: 50 }).left, -233.33);
  });

  test('zoom about the same point is object-position at the zoomed size', () => {
    const r = pictureRect(BOX, NAT, { zoom: 2, x: 25, y: 75 });
    close(r.w, 1066.67);
    close(r.h, 800);
    close(r.left, (300 - 1066.67) * 0.25);
    close(r.top, (400 - 800) * 0.75);
  });
});

describe('dragging the picture', () => {
  test('to the right shows more of its left: X falls; an axis with no room keeps its value', () => {
    const c = pan(BOX, NAT, { zoom: 1, x: 50, y: 50 }, 50, 30);
    expect(c).toEqual({ zoom: 1, x: 28.6, y: 50 });
  });

  test('X and Y stop at 0 and 100: the picture always covers the box', () => {
    expect(pan(BOX, NAT, { zoom: 1, x: 50, y: 50 }, 500, 0).x).toBe(0);
    expect(pan(BOX, NAT, { zoom: 1, x: 50, y: 50 }, -500, 0).x).toBe(100);
    expect(pan(BOX, NAT, { zoom: 2, x: 50, y: 50 }, 0, 9999).y).toBe(0);
  });

  test('positionFor: no room on an axis → keep', () => {
    expect(positionFor(BOX, { w: 300, h: 800 }, 0, -100, { x: 40, y: 50 })).toEqual({
      x: 40,
      y: 25,
    });
  });
});

describe('dragging a corner', () => {
  test('the opposite corner stays, the ratio stays, the zoom is what the pointer asks for', () => {
    const from = { zoom: 1, x: 50, y: 50 };
    // south-east corner dragged out to double the width: the north-west corner (−116.67, 0) must not move
    const c = dragCorner(BOX, NAT, from, 'se', 950, 800);
    expect(c.zoom).toBe(2);
    const r = pictureRect(BOX, NAT, c);
    // X is kept to a tenth of a percent, so the corner holds to within a fraction of a pixel
    close(r.left, -116.67, 0);
    close(r.top, 0, 0);
    expect(c.x).toBeCloseTo(15.2, 1);
    expect(c.y).toBe(0);
  });

  test('the zoom stays between 100 % and 800 %', () => {
    const from = { zoom: 2, x: 50, y: 50 };
    expect(dragCorner(BOX, NAT, from, 'se', 0, 0).zoom).toBe(1);
    expect(dragCorner(BOX, NAT, from, 'se', 99999, 99999).zoom).toBe(8);
  });

  test('a north-west drag fixes the south-east corner', () => {
    const from = { zoom: 2, x: 50, y: 50 };
    const before = pictureRect(BOX, NAT, from);
    const c = dragCorner(BOX, NAT, from, 'nw', before.left + 200, before.top + 150);
    const after = pictureRect(BOX, NAT, c);
    expect(c.zoom).toBeLessThan(2);
    // the picture is still big enough to cover the box
    expect(after.left).toBeLessThanOrEqual(0.01);
    expect(after.left + after.w).toBeGreaterThanOrEqual(BOX.w - 0.01);
  });
});

describe('the op’s params and the element’s own style', () => {
  test('cropParams rounds zoom to two places and the point to one', () => {
    expect(cropParams({ zoom: 1.28456, x: 40.04, y: 29.96 })).toEqual({
      fit: 'crop',
      zoom: 1.28,
      x: 40,
      y: 30,
    });
  });

  test('cropFromStyle reads what image.crop wrote; anything else is the centre at 100 %', () => {
    expect(cropFromStyle({ objectPosition: '40% 30%', transform: 'scale(1.28)' })).toEqual({
      zoom: 1.28,
      x: 40,
      y: 30,
    });
    expect(cropFromStyle({})).toEqual({ zoom: 1, x: 50, y: 50 });
    expect(cropFromStyle({ objectPosition: 'left top', transform: 'rotate(4deg)' })).toEqual({
      zoom: 1,
      x: 50,
      y: 50,
    });
  });
});
