// V2-8.5 c4-video (07 ve-select · ve-long · ve-advanced): the timeline island sits UNDER the selected video, never over
// it. The board draws the artboard above the island with the notch on its bottom edge; in the app the island is
// anchored to the window's foot, so a video that fills the canvas used to be covered by it. When the island comes up
// (or changes size) over the video it belongs to, the shell asks the canvas to bring that artboard into the free part of
// the canvas — one `reveal-artboard`, which fits it between the floating islands (insets). Nothing else moves the camera.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { artboardUnderIsland } from '../client/v2/timeline/anchor.js';

const box = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
});

describe('artboardUnderIsland — does the island cover the video it points at?', () => {
  test('a video that runs down behind the island is covered', () => {
    expect(artboardUnderIsland(box(80, 120, 1360, 840), box(250, 604, 1150, 820))).toBe(true);
  });
  test('a video that ends above the island is clear (a gap of the notch and a little air)', () => {
    expect(artboardUnderIsland(box(560, 92, 754, 437), box(90, 610, 990, 820))).toBe(false);
  });
  test('the notch needs room: a video ending a hair above the island still counts as covered', () => {
    expect(artboardUnderIsland(box(100, 100, 900, 600), box(90, 604, 990, 820))).toBe(true);
  });
  test('a video beside the island (no horizontal overlap) is clear', () => {
    expect(artboardUnderIsland(box(1200, 120, 1400, 840), box(90, 604, 900, 820))).toBe(false);
  });
  test('a video wholly below the island top edge but above its bottom is covered', () => {
    expect(artboardUnderIsland(box(300, 700, 600, 800), box(90, 604, 990, 820))).toBe(true);
  });
  test('no island, no artboard: nothing to do', () => {
    expect(artboardUnderIsland(null, box(0, 0, 1, 1))).toBe(false);
    expect(artboardUnderIsland(box(0, 0, 1, 1), null)).toBe(false);
  });
});

describe('TimelineHost asks for the camera, once the island is at rest', () => {
  const src = readFileSync(
    join(import.meta.dir, '../client/v2/timeline/TimelineHost.jsx'),
    'utf8'
  );
  test('it posts reveal-artboard for the followed video when the island covers it', () => {
    expect(src).toContain("dgn: 'reveal-artboard'");
    expect(src).toContain('artboardUnderIsland(');
  });
  test('and never flashes a ring (it is not a jump)', () => {
    expect(src).toMatch(/reveal-artboard'[^}]*flash: false/);
  });
});
