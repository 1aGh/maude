// S10.9 (13 · ds-edit-reach) — places → rings per artboard, capped at 500. The pure half of the reach view:
// what the usage index says becomes frames (one per artboard that has places), the element ids to ring in each,
// and the words of the tags. Positions come from the canvas's answer to `ds-rects`, never from here.
import { describe, expect, test } from 'bun:test';

import {
  FRAMES_SHOWN,
  moreWords,
  patternsWords,
  placesWords,
  RING_CAP,
  reachModel,
  reachTag,
  ringsFor,
} from '../client/v2/ds/reach-model.js';

const el = (artboard: string | null, id: string) => ({ artboard, id });

const USAGE = {
  canvases: [
    {
      rel: 'ui/Homepage.tsx',
      places: 14,
      artboards: { 'ab-desktop': 9, 'ab-mobile': 5 },
      elements: [el('ab-desktop', 'a1'), el('ab-desktop', 'a2'), el('ab-mobile', 'b1')],
    },
    {
      rel: 'ui/Pricing.tsx',
      places: 11,
      artboards: { 'ab-desktop': 11 },
      elements: [el('ab-desktop', 'c1'), el('ab-desktop', 'c1'), el('ab-desktop', 'c2')],
    },
  ],
};

describe('reachModel — places to rings per artboard', () => {
  test('one frame per artboard that has places, busiest first, with its ring ids', () => {
    const m = reachModel(USAGE);
    expect(m.frames.map((f) => [f.rel, f.artboard, f.places])).toEqual([
      ['ui/Pricing.tsx', 'ab-desktop', 11],
      ['ui/Homepage.tsx', 'ab-desktop', 9],
      ['ui/Homepage.tsx', 'ab-mobile', 5],
    ]);
    expect(m.frames[0]?.ids).toEqual(['c1', 'c2']); // a repeated id is one ring
    expect(m.frames[1]?.ids).toEqual(['a1', 'a2']);
    expect(m.frames[2]?.ids).toEqual(['b1']);
    expect(m.frames[0]?.label).toBe('Pricing · Desktop');
  });

  test('the tag counts patterns (artboards) and places (the index total)', () => {
    const m = reachModel(USAGE);
    expect(m.patterns).toBe(3);
    expect(m.places).toBe(25);
    expect(m.tag).toBe('3 patterns · 25 places');
    expect(m.canvases).toBe(2);
  });

  test('words: one reads singular, many plural', () => {
    expect(reachTag(1, 1)).toBe('1 pattern · 1 place');
    expect(patternsWords(4)).toBe('4 patterns');
    expect(placesWords(14)).toBe('14 places');
  });

  test('a place the index could not tie to an element still counts, and one outside every artboard is a frame of the whole canvas', () => {
    const m = reachModel({
      canvases: [
        {
          rel: 'ui/Landing.tsx',
          places: 6,
          artboards: { 'ab-hero': 4 },
          elements: [el('ab-hero', 'h1'), el(null, 'x1')],
        },
      ],
    });
    expect(m.frames.map((f) => [f.artboard, f.places, f.ids])).toEqual([
      ['ab-hero', 4, ['h1']],
      [null, 2, ['x1']],
    ]);
    expect(m.frames[1]?.label).toBe('Landing');
    expect(m.frames[1]?.key).toBe('ui/Landing.tsx#');
    expect(m.places).toBe(6);
  });

  test('a canvas with no artboard at all is one frame of the whole canvas', () => {
    const m = reachModel({
      canvases: [
        { rel: 'ui/Bare.tsx', places: 3, artboards: {}, elements: [el(null, 'a'), el(null, 'b')] },
      ],
    });
    expect(m.frames.map((f) => [f.artboard, f.places, f.ids])).toEqual([[null, 3, ['a', 'b']]]);
    expect(m.tag).toBe('1 pattern · 3 places');
  });

  test('only FRAMES_SHOWN frames are drawn; the rest are named in the "in the review too" line', () => {
    const canvases = Array.from({ length: 7 }, (_, i) => ({
      rel: `ui/C${i}.tsx`,
      places: 10 - i,
      artboards: { 'ab-one': 10 - i },
      elements: [el('ab-one', `e${i}`)],
    }));
    const m = reachModel({ canvases });
    expect(m.frames).toHaveLength(FRAMES_SHOWN);
    expect(m.more).toHaveLength(7 - FRAMES_SHOWN);
    expect(m.patterns).toBe(7);
    expect(moreWords(m.more)).toBe('C4, C5 and C6 are in the review too');
  });

  test('moreWords: one canvas reads singular, many past three say how many', () => {
    expect(moreWords([{ rel: 'a', canvas: 'Onboarding', artboard: 'x', places: 1 }])).toBe(
      'Onboarding is in the review too'
    );
    expect(moreWords([])).toBe('');
    const five = ['A', 'B', 'C', 'D', 'E'].map((canvas) => ({
      rel: canvas,
      canvas,
      artboard: 'x',
      places: 1,
    }));
    expect(moreWords(five)).toBe('A, B and C and 2 more are in the review too');
  });

  test('rings are capped at 500 across the whole view, in frame order', () => {
    const ids = (p: string, n: number) =>
      Array.from({ length: n }, (_, i) => el('ab-one', `${p}${i}`));
    const m = reachModel(
      {
        canvases: [
          { rel: 'ui/Big.tsx', places: 400, artboards: { 'ab-one': 400 }, elements: ids('b', 400) },
          {
            rel: 'ui/Next.tsx',
            places: 300,
            artboards: { 'ab-one': 300 },
            elements: ids('n', 300),
          },
        ],
      },
      { frames: 8 }
    );
    expect(RING_CAP).toBe(500);
    expect(m.capped).toBe(true);
    expect(m.ringed).toBe(500);
    expect(m.frames.reduce((n, f) => n + f.ids.length, 0)).toBe(500);
    expect(m.frames[0]?.ids).toHaveLength(400);
    expect(m.frames[1]?.ids).toHaveLength(100);
    // the counts the person reads are the real ones, not the capped ones
    expect(m.places).toBe(700);
    expect(m.frames[1]?.places).toBe(300);
  });

  test('garbage in the index never reaches a ring', () => {
    const m = reachModel({
      canvases: [
        {
          rel: 'ui/Odd.tsx',
          places: 3,
          artboards: { 'ab-one': 3 },
          elements: [
            el('ab-one', 'ok'),
            el('ab-one', 'has space'),
            el('ab-one', '"><x'),
            null as never,
          ],
        },
        null as never,
        { rel: 'ui/Zero.tsx', places: 0, artboards: {}, elements: [] },
      ],
    });
    expect(m.frames[0]?.ids).toEqual(['ok']);
    expect(m.canvases).toBe(1);
    expect(reachModel(null).frames).toEqual([]);
    expect(reachModel(null).tag).toBe('0 patterns · 0 places');
  });
});

describe('ringsFor — the canvas answer becomes rings', () => {
  const view = { w: 960, h: 600 };
  test('only the ids we asked about, inside the frame', () => {
    const rings = ringsFor(
      {
        rects: [
          { id: 'a1', x: 10, y: 20, w: 100, h: 40 },
          { id: 'zzz', x: 10, y: 20, w: 100, h: 40 }, // never asked
          { id: 'a2', x: 2000, y: 20, w: 100, h: 40 }, // off the frame
          { id: 'a3', x: -50, y: -50, w: 20, h: 20 }, // wholly left of it
          { id: 'a4', x: 900, y: 580, w: 100, h: 100 }, // half in: kept
        ],
      },
      ['a1', 'a2', 'a3', 'a4'],
      view
    );
    expect(rings.map((r) => r.id)).toEqual(['a1', 'a4']);
  });

  test('a rect without a real size or number is dropped', () => {
    const rings = ringsFor(
      {
        rects: [
          { id: 'a1', x: 1, y: 1, w: 0, h: 10 },
          { id: 'a1', x: Number.NaN, y: 1, w: 5, h: 10 },
          { id: 'a1', x: 1, y: 1, w: 5, h: 10 },
        ],
      },
      ['a1'],
      view
    );
    expect(rings).toHaveLength(1);
    expect(ringsFor(null, ['a1'], view)).toEqual([]);
    expect(
      ringsFor({ rects: [{ id: 'a1', x: 1, y: 1, w: 5, h: 10 }] }, ['a1'], { w: 0, h: 0 })
    ).toEqual([]);
  });

  test('capped at 500', () => {
    const rects = Array.from({ length: 700 }, (_, i) => ({ id: `e${i}`, x: 1, y: 1, w: 5, h: 5 }));
    const rings = ringsFor(
      rects.length ? { rects } : null,
      rects.map((r) => r.id),
      view
    );
    expect(rings).toHaveLength(500);
  });
});
