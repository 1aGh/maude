// S2.8 — the maths behind artboard resize, the preset ruler, the sticky name and the long-page minimap
// (14 Editing: ed-ab-select, ed-ab-resize, ed-edge-huge). Pure: no DOM.
import { describe, expect, test } from 'bun:test';
import {
  type Box,
  bubbleText,
  computeArtboardResize,
  HANDLES,
  isLongPage,
  jumpTarget,
  LONG_PAGE_MIN,
  presetNear,
  presetOf,
  rulerStops,
  sectionAt,
  sectionsOf,
  snapTolerance,
  stickyNameTop,
  visibleRange,
  visibleSentence,
  WIDTH_PRESETS,
} from '../editing/artboard-resize.ts';

// the canvas's Desktop board: 1440 wide, 1573 tall, at the world origin
const DESKTOP: Box = { x: 0, y: 0, w: 1440, h: 1573 };

describe('the eight handles', () => {
  test('there are exactly eight: four corners and four edges', () => {
    expect([...HANDLES].sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });
});

describe('preset snapping (world units)', () => {
  test('the presets are Tablet 834 · Laptop 1280 · Desktop 1440 (and Mobile 390)', () => {
    expect(WIDTH_PRESETS.map((p) => `${p.label} ${p.w}`)).toEqual([
      'Mobile 390',
      'Tablet 834',
      'Laptop 1280',
      'Desktop 1440',
    ]);
  });

  test('dragging the east edge from 1440 to ~1275 clicks onto Laptop 1280 and says so', () => {
    const r = computeArtboardResize(DESKTOP, 'e', -165, 0);
    expect(r.box.w).toBe(1280);
    expect(r.preset?.label).toBe('Laptop');
    expect(bubbleText(r.box, r.preset)).toBe('Laptop · 1280 × 1573');
    expect(r.widthChanged).toBe(true);
    expect(r.heightChanged).toBe(false);
  });

  test('a drag far from every preset keeps the raw width and no preset name', () => {
    const r = computeArtboardResize(DESKTOP, 'e', -300, 0); // 1140
    expect(r.box.w).toBe(1140);
    expect(r.preset).toBeNull();
    expect(bubbleText(r.box, r.preset)).toBe('1140 × 1573');
  });

  test('the reach is wider on screen at a low zoom (10 screen px, never under 8 world px)', () => {
    expect(snapTolerance(1)).toBe(10);
    expect(snapTolerance(0.38)).toBeCloseTo(10 / 0.38, 5);
    expect(snapTolerance(8)).toBe(8);
    expect(presetNear(1260, 1)).toBeNull();
    expect(presetNear(1260, 0.38)?.w).toBe(1280); // 20 world px away, 7.6 px on screen
  });

  test('⌘ ignores presets: the width stays where the pointer put it', () => {
    const r = computeArtboardResize(DESKTOP, 'e', -163, 0, { meta: true });
    expect(r.box.w).toBe(1277);
    expect(r.preset).toBeNull();
  });

  test('the nearest preset wins when two are in reach', () => {
    const near = [
      { label: 'A', w: 1000 },
      { label: 'B', w: 1008 },
    ];
    expect(presetNear(1006, 1, near)?.label).toBe('B');
  });

  test('presetOf names an exact width for the inspector (no tolerance)', () => {
    expect(presetOf(1280)?.label).toBe('Laptop');
    expect(presetOf(1281)).toBeNull();
  });
});

describe('edges, corners and modifiers', () => {
  test('the west edge keeps the east edge still (x moves with the width)', () => {
    const r = computeArtboardResize(DESKTOP, 'w', 100, 0, { meta: true });
    expect(r.box).toEqual({ x: 100, y: 0, w: 1340, h: 1573 });
  });

  test('⌥ grows both sides about the centre', () => {
    const r = computeArtboardResize(DESKTOP, 'e', -80, 0, { alt: true, meta: true });
    expect(r.box.w).toBe(1280);
    expect(r.box.x).toBe(80);
  });

  test('a bottom-edge drag changes the height and pins the board to Fixed', () => {
    const r = computeArtboardResize(DESKTOP, 's', 0, -373);
    expect(r.box.h).toBe(1200);
    expect(r.heightChanged).toBe(true);
    expect(r.fixedHeight).toBe(true);
    expect(r.preset).toBeNull(); // a pure height drag never names a width preset
  });

  test('a width-only drag keeps "Fits content" (no Fixed)', () => {
    expect(computeArtboardResize(DESKTOP, 'e', -165, 0).fixedHeight).toBe(false);
  });

  test('a bottom-edge click with no travel does not pin the height', () => {
    const r = computeArtboardResize(DESKTOP, 's', 0, 0);
    expect(r.fixedHeight).toBe(false);
  });

  test('the north edge keeps the bottom edge still', () => {
    const r = computeArtboardResize(DESKTOP, 'n', 0, 73);
    expect(r.box).toEqual({ x: 0, y: 73, w: 1440, h: 1500 });
    expect(r.fixedHeight).toBe(true);
  });

  test('⇧ on a corner keeps the ratio and skips presets', () => {
    const r = computeArtboardResize({ x: 0, y: 0, w: 400, h: 200 }, 'se', 100, 0, { shift: true });
    expect(r.box.w).toBe(500);
    expect(r.box.h).toBe(250);
    expect(r.preset).toBeNull();
  });

  test('a corner moves both axes and snaps the width', () => {
    const r = computeArtboardResize(DESKTOP, 'se', -162, -73);
    expect(r.box.w).toBe(1280);
    expect(r.box.h).toBe(1500);
    expect(r.fixedHeight).toBe(true);
  });

  test('sizes stay inside what resize-artboard accepts (64 … 8192)', () => {
    expect(computeArtboardResize(DESKTOP, 'e', -5000, 0).box.w).toBe(64);
    expect(computeArtboardResize(DESKTOP, 'e', 99999, 0).box.w).toBe(8192);
  });
});

describe('the ruler', () => {
  test('stops sit at width × zoom from the left edge; the lit one is the snapped preset', () => {
    const lit = presetOf(1280);
    const stops = rulerStops(1280, 0.38, lit);
    const laptop = stops.find((s) => s.w === 1280);
    expect(laptop?.on).toBe(true);
    expect(laptop?.left).toBeCloseTo(1280 * 0.38, 5);
    expect(stops.find((s) => s.w === 1440)?.on).toBe(false);
    expect(stops.map((s) => s.label)).toContain('Tablet');
  });

  test('a board near 1440 shows Laptop and Desktop; Mobile is not drawn until the drag goes low', () => {
    const labels = rulerStops(1440, 0.38, null).map((s) => s.label);
    expect(labels).toContain('Desktop');
    expect(labels).toContain('Laptop');
    expect(labels).not.toContain('Mobile');
    expect(rulerStops(420, 0.38, null).map((s) => s.label)).toContain('Mobile');
  });

  test('the lit stop is always drawn, however far the board has moved from it', () => {
    expect(rulerStops(1440, 1, presetOf(390)).some((s) => s.w === 390 && s.on)).toBe(true);
  });
});

describe('a long page', () => {
  test('3000 px and up is long; the 1573 px home page is not', () => {
    expect(LONG_PAGE_MIN).toBe(3000);
    expect(isLongPage(6000)).toBe(true);
    expect(isLongPage(3000)).toBe(true);
    expect(isLongPage(2999)).toBe(false);
    expect(isLongPage(1573)).toBe(false);
  });

  test('the name rides at the window top once its own label has scrolled away', () => {
    expect(stickyNameTop(300, 1500, 20)).toBe(300); // label on screen: stays there
    expect(stickyNameTop(-900, 1500, 20)).toBe(8); // scrolled off: sticks
    expect(stickyNameTop(-900, 15, 20)).toBe(-5); // the page is ending: it rides up with the bottom edge
    expect(stickyNameTop(-900, 0, 20)).toBeNull(); // gone
  });

  test('"You\'re looking at 1727–5636 of 6000."', () => {
    // body top at -1727 × 0.5 on screen, window 1000 tall → page px 1727 … 5636? use the zoom that gives it
    const zoom = 1000 / (5636 - 1727);
    const r = visibleRange(-1727 * zoom, zoom, 1000, 6000);
    expect(r).toEqual({ from: 1727, to: 5636 });
    expect(visibleSentence(r?.from ?? 0, r?.to ?? 0, 6000)).toBe(
      "You're looking at 1727–5636 of 6000."
    );
  });

  test('the range is clamped to the page and null when nothing of it shows', () => {
    expect(visibleRange(200, 1, 1000, 6000)).toEqual({ from: 0, to: 800 });
    expect(visibleRange(-6500, 1, 1000, 6000)).toBeNull();
    expect(visibleRange(0, 0, 1000, 6000)).toBeNull();
  });

  test('sections come from the top-level children: named, in page order, empty ones dropped', () => {
    const s = sectionsOf([
      { name: 'Tým', top: 1900, height: 1200 },
      { name: 'Hero', top: 0, height: 900 },
      { name: '  ', top: 900, height: 1000 },
      { name: 'Hidden', top: 4000, height: 300, hidden: true },
      { name: 'Empty', top: 5000, height: 0 },
    ]);
    expect(s.map((x) => x.name)).toEqual(['Hero', 'Section', 'Tým']);
    expect(sectionAt(s, 2000)?.name).toBe('Tým');
    expect(sectionAt(s, 6000)).toBeNull();
  });

  test('jumping to a section puts its top at the window top, zoom and x unchanged', () => {
    // artboard body top at world y = 100; section at page y 1900; zoom 0.22
    const t = jumpTarget({ x: 40, y: 10, zoom: 0.22 }, 100, 1900, 24);
    expect(t.zoom).toBe(0.22);
    expect(t.x).toBe(40);
    // after the jump, screen y of the section top is the margin
    expect((100 + 1900) * t.zoom + t.y).toBeCloseTo(24, 6);
  });
});
