// S3.2a (md-present-lift, D6) — Present fit by kind, one rule per kind, no settings:
//   web     fills the width, starts at the top, scrolls inside the stage
//   print   fits the trim; the bleed is off screen
//   digital / video  contain on the dark stage: 9:16 pillarboxed, a banner letterboxed, 1:1 fits the
//                    height, never cropped
// `place` is where the artboard's top-left lands inside the stage, `window` the part of the artboard the
// audience sees (artboard px), `maxScroll` how far a web artboard can scroll (artboard px).
import { describe, expect, test } from 'bun:test';
import { cameraFor, fitForKind } from '../present/fit.ts';

const STAGE = { w: 1600, h: 900 };
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

describe('digital and video: contain, never cropped', () => {
  test('a 1:1 post fits the height and is centred (pillars left and right)', () => {
    const f = fitForKind({ kind: 'digital', art: { w: 1080, h: 1080 }, stage: STAGE });
    near(f.scale, 900 / 1080);
    near(f.place.y, 0);
    near(f.place.x, (1600 - 1080 * f.scale) / 2);
    expect(f.window).toEqual({ x: 0, y: 0, w: 1080, h: 1080 });
    expect(f.fill).toBe('pillarbox');
    expect(f.maxScroll).toBe(0);
  });

  test('a 9:16 story is pillarboxed', () => {
    const f = fitForKind({ kind: 'video', art: { w: 1080, h: 1920 }, stage: STAGE });
    near(f.scale, 900 / 1920);
    expect(f.fill).toBe('pillarbox');
    near(f.place.x, (1600 - 1080 * f.scale) / 2);
  });

  test('a banner is letterboxed (fits the width, centred vertically)', () => {
    const f = fitForKind({ kind: 'digital', art: { w: 1500, h: 250 }, stage: STAGE });
    near(f.scale, 1600 / 1500);
    near(f.place.x, 0);
    near(f.place.y, (900 - 250 * f.scale) / 2);
    expect(f.fill).toBe('letterbox');
  });

  test('a 16:9 video fills the stage exactly', () => {
    const f = fitForKind({ kind: 'video', art: { w: 1920, h: 1080 }, stage: STAGE });
    near(f.scale, 1600 / 1920);
    near(f.place.x, 0);
    near(f.place.y, 0);
    expect(f.fill).toBe('none');
  });

  test('the whole artboard is always inside the stage', () => {
    for (const art of [
      { w: 400, h: 900 },
      { w: 3000, h: 300 },
      { w: 1600, h: 900 },
      { w: 50, h: 50 },
    ]) {
      const f = fitForKind({ kind: 'digital', art, stage: STAGE, maxScale: 100 });
      expect(f.place.x).toBeGreaterThan(-1e-6);
      expect(f.place.y).toBeGreaterThan(-1e-6);
      expect(f.place.x + art.w * f.scale).toBeLessThan(STAGE.w + 1e-6);
      expect(f.place.y + art.h * f.scale).toBeLessThan(STAGE.h + 1e-6);
    }
  });
});

describe('web: fills the width, starts at the top', () => {
  test('a tall page fills the width, sits at y 0 and can scroll the rest', () => {
    const f = fitForKind({ kind: 'web', art: { w: 1440, h: 5000 }, stage: STAGE });
    near(f.scale, 1600 / 1440);
    near(f.place.x, 0);
    near(f.place.y, 0);
    // the audience sees stage-height worth of page; the rest is reached by scrolling
    near(f.window.h, 900 / f.scale);
    near(f.window.w, 1440);
    near(f.maxScroll, 5000 - 900 / f.scale);
  });

  test('a short page starts at the top too and has nothing to scroll', () => {
    const f = fitForKind({ kind: 'web', art: { w: 1440, h: 400 }, stage: STAGE });
    near(f.place.y, 0);
    expect(f.maxScroll).toBe(0);
    near(f.window.h, 400);
  });
});

describe('print: the trim fills the stage, the bleed is off screen', () => {
  test('fits the trim (not the bleed box) and shows only the trim', () => {
    const f = fitForKind({ kind: 'print', art: { w: 800, h: 1100 }, stage: STAGE, bleedPx: 50 });
    // trim is 700 x 1000 -> height-bound
    near(f.scale, 900 / 1000);
    expect(f.window).toEqual({ x: 50, y: 50, w: 700, h: 1000 });
    // the TRIM centres in the stage, so the artboard origin is the trim origin pulled back by the bleed
    near(f.place.x + 50 * f.scale, (1600 - 700 * f.scale) / 2);
    near(f.place.y + 50 * f.scale, 0);
    expect(f.fill).toBe('pillarbox');
  });

  test('no bleed declared: the whole artboard is the trim', () => {
    const f = fitForKind({ kind: 'print', art: { w: 700, h: 1000 }, stage: STAGE });
    expect(f.window).toEqual({ x: 0, y: 0, w: 700, h: 1000 });
  });

  test('a bleed bigger than half the artboard cannot invert the trim', () => {
    const f = fitForKind({ kind: 'print', art: { w: 100, h: 100 }, stage: STAGE, bleedPx: 80 });
    expect(f.window.w).toBeGreaterThan(0);
    expect(f.window.h).toBeGreaterThan(0);
    expect(Number.isFinite(f.scale)).toBe(true);
  });
});

describe('the camera that puts a fit on screen, and the caps', () => {
  test('cameraFor maps the artboard origin to place', () => {
    const f = fitForKind({ kind: 'digital', art: { w: 1080, h: 1080 }, stage: STAGE });
    const cam = cameraFor(f, { x: 2000, y: -300 });
    near(cam.zoom, f.scale);
    // world point (2000, -300) (artboard top-left) lands at place
    near(cam.x + 2000 * cam.zoom, f.place.x);
    near(cam.y + -300 * cam.zoom, f.place.y);
  });

  test('the scale is capped like the canvas zoom and the artboard stays centred', () => {
    const f = fitForKind({ kind: 'digital', art: { w: 100, h: 100 }, stage: STAGE, maxScale: 4 });
    expect(f.scale).toBe(4);
    near(f.place.x, (1600 - 400) / 2);
    near(f.place.y, (900 - 400) / 2);
  });

  test('a stage with no size, or an artboard with none, gives a finite fit', () => {
    for (const input of [
      { kind: 'digital' as const, art: { w: 0, h: 0 }, stage: STAGE },
      { kind: 'web' as const, art: { w: 100, h: 100 }, stage: { w: 0, h: 0 } },
      { kind: 'print' as const, art: { w: Number.NaN, h: 5 }, stage: STAGE },
    ]) {
      const f = fitForKind(input);
      expect(
        Number.isFinite(f.scale) && Number.isFinite(f.place.x) && Number.isFinite(f.place.y)
      ).toBe(true);
      expect(f.scale).toBeGreaterThan(0);
    }
  });
});
