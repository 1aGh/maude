// S7.7 — where the island sits (client/v2/timeline/anchor.js): compact is 900 wide, centred under the video,
// clamped 16 px inside the window, the notch on the artboard's centre and never in a rounded corner.
import { describe, expect, test } from 'bun:test';
import {
  anchorCentre,
  EDGE_GAP,
  ISLAND_W,
  NOTCH_INSET,
  placeCompact,
  placeFull,
} from '../client/v2/timeline/anchor.js';

describe('compact island', () => {
  test('centred under the artboard, notch on its centre', () => {
    const p = placeCompact({ cx: 720, viewportW: 1440 });
    expect(p.width).toBe(ISLAND_W);
    expect(p.left).toBe(270);
    expect(p.notch).toBe(450); // the island's middle
  });

  test('07 · ve-select: Reels at x 539 draws exactly what the canvas draws', () => {
    const p = placeCompact({ cx: 539, viewportW: 1440 });
    expect(p.left).toBe(89);
    expect(p.notch).toBe(450);
  });

  test('clamped 16 px from the left edge; the notch still points at the artboard', () => {
    const p = placeCompact({ cx: 100, viewportW: 1440 });
    expect(p.left).toBe(EDGE_GAP);
    expect(p.notch).toBe(100 - EDGE_GAP);
  });

  test('clamped 16 px from the right edge', () => {
    const p = placeCompact({ cx: 1400, viewportW: 1440 });
    expect(p.left + p.width).toBe(1440 - EDGE_GAP);
    expect(p.notch).toBe(1400 - p.left);
  });

  test('an artboard panned off screen leaves the notch on the straight edge, not in a corner', () => {
    expect(placeCompact({ cx: -500, viewportW: 1440 }).notch).toBe(NOTCH_INSET);
    const far = placeCompact({ cx: 5000, viewportW: 1440 });
    expect(far.notch).toBe(far.width - NOTCH_INSET);
  });

  test('a window narrower than the island shrinks it to the window less both gaps', () => {
    const p = placeCompact({ cx: 400, viewportW: 600 });
    expect(p.width).toBe(600 - 2 * EDGE_GAP);
    expect(p.left).toBe(EDGE_GAP);
  });
});

describe('full island', () => {
  test('edge to edge, 16 px in, no notch', () => {
    expect(placeFull({ viewportW: 1440 })).toEqual({ left: 16, width: 1408, notch: null });
  });
});

describe('the artboard centre in window px', () => {
  test('frame offset plus the reported rect', () => {
    expect(anchorCentre({ left: 0 }, { x: 414, w: 250 })).toBe(539);
    expect(anchorCentre({ left: 60 }, { x: 100, w: 40 })).toBe(180);
  });
});
