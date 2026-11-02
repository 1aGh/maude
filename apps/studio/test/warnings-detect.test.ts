// S7.25 — the four warning detectors (08 ak-warnings) plus the soft-picture one Change kind shows (ak-convert-after).
// Pure: a fixture is an artboard's facts and, where the check looks at layers, the rects a render gives.

import { describe, expect, test } from 'bun:test';

import {
  detectWarnings,
  effectivePpi,
  layersAtCut,
  resolvedPaper,
  summaryWords,
  type WarnRect,
  type WarnRects,
} from '../kinds/warnings.ts';

const A6 = { paper: 'a6', bleedMm: 3 };
// A6 + 3 mm bleed on both sides = 419 × 581 px (08 ak-advanced)
const board = (rects: WarnRect[], w = 419, h = 581): WarnRects => ({
  artboard: { x: 1000, y: 500, w, h },
  elements: rects.map((r) => ({ ...r, x: r.x + 1000, y: r.y + 500 })),
});
const el = (
  cdId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<WarnRect> = {}
) => ({ cdId, x, y, w, h, tag: 'div', ...extra }) as WarnRect;

describe('crosses the cut (print)', () => {
  test('a QR code with its corner past the trim line is ONE warning with Move inside', () => {
    // trim runs from 11 to 408 px across; the code reaches 8 px past it (inside the 11 px bleed)
    const r = board([el('qr', 332, 480, 84, 84, { tag: 'img' })]);
    const w = detectWarnings({ id: 'a', kind: 'print', widthPx: 419, heightPx: 581, print: A6 }, r);
    expect(w).toHaveLength(1);
    expect(w[0]?.code).toBe('crosses-cut');
    expect(w[0]?.verb).toBe('Move inside');
    expect(w[0]?.text).toBe('The picture crosses the cut — part of it would be trimmed.');
    const fix = w[0]?.fix;
    expect(fix?.kind).toBe('move-inside');
    // moved by that fix, it sits inside the trim
    if (fix?.kind === 'move-inside') expect(332 + 84 + fix.dx).toBeLessThanOrEqual(408);
  });

  test('bleed art that runs on to the artboard edge is not a violation, nor is a full page wrapper', () => {
    const r = board([
      el('bg', -5, 0, 200, 581), // starts past the edge: bleed art on the left
      el('page', 0, 0, 419, 581),
      el('inner', 40, 40, 100, 100),
    ]);
    expect(
      detectWarnings({ id: 'a', kind: 'print', widthPx: 419, heightPx: 581, print: A6 }, r)
    ).toEqual([]);
  });

  test('two layers across the cut are one row (Show), counted in words', () => {
    const r = board([el('a', 360, 100, 52, 30), el('b', 100, 520, 60, 52)]);
    const w = detectWarnings({ id: 'a', kind: 'print', widthPx: 419, heightPx: 581, print: A6 }, r);
    expect(w).toHaveLength(1);
    expect(w[0]?.code).toBe('layers-at-cut');
    expect(w[0]?.text).toBe('Two layers sit where the paper is cut.');
    expect(w[0]?.verb).toBe('Show');
    expect(w[0]?.fix).toEqual({ kind: 'show', elements: ['a', 'b'] });
  });

  test('layersAtCut reports a corner when two edges are crossed', () => {
    const paper = resolvedPaper(A6);
    const at = layersAtCut(paper, board([el('c', 360, 520, 52, 52)]));
    expect(at[0]?.corner).toBe(true);
  });
});

describe('soft pictures', () => {
  test('640 px over a 194 px place is 317 ppi (fine); over 400 px it is 154 ppi (soft)', () => {
    expect(Math.round(effectivePpi(640, 194))).toBe(317);
    expect(Math.round(effectivePpi(640, 400))).toBe(154);
    const r = board([el('foto', 20, 20, 400, 300, { tag: 'img', naturalW: 640 })], 419, 581);
    const w = detectWarnings({ id: 'a', kind: 'print', widthPx: 419, heightPx: 581, print: A6 }, r);
    const soft = w.find((x) => x.code === 'soft-image');
    expect(soft?.text).toBe('The picture is 640 px wide — at A6 it may print a little soft.');
    expect(soft?.verb).toBe('Replace…');
  });
});

describe('longer than one export (video)', () => {
  test('2:40 at 30 fps (4800 frames) warns with the cap in the same words as the sheet', () => {
    const w = detectWarnings({
      id: 'v',
      kind: 'video',
      widthPx: 1920,
      heightPx: 1080,
      durationFrames: 4800,
      fps: 30,
    });
    expect(w).toHaveLength(1);
    expect(w[0]?.text).toBe('2:40 long — one export goes up to 2 min (3600 frames at 30 fps).');
    expect(w[0]?.verb).toBe('Allow longer');
    expect(w[0]?.fix).toEqual({ kind: 'allow-longer', maxFrames: 4800 });
  });

  test('exactly the cap, or an artboard that allowed longer, says nothing', () => {
    const base = { id: 'v', kind: 'video' as const, widthPx: 1920, heightPx: 1080, fps: 30 };
    expect(detectWarnings({ ...base, durationFrames: 3600 })).toEqual([]);
    expect(detectWarnings({ ...base, durationFrames: 4800, maxFrames: 6000 })).toEqual([]);
  });
});

describe('not the paper size (print)', () => {
  test('A4 landscape + 3 mm bleed is 1145 × 816; a hand-typed 1144 gets Fix size', () => {
    const print = { paper: 'a4', orientation: 'landscape', bleedMm: 3 };
    const w = detectWarnings({
      id: 'k',
      kind: 'print',
      widthPx: 1144,
      heightPx: 816,
      fixed: true,
      print,
    });
    expect(w).toHaveLength(1);
    expect(w[0]?.text).toBe('1 px narrower than A4 landscape with bleed (1145 × 816).');
    expect(w[0]?.verb).toBe('Fix size');
    expect(w[0]?.fix).toEqual({ kind: 'fix-size', width: 1145, height: 816 });
    expect(
      detectWarnings({ id: 'k', kind: 'print', widthPx: 1145, heightPx: 816, fixed: true, print })
    ).toEqual([]);
  });

  test('a print prop that names no paper raises nothing (never throws)', () => {
    expect(
      detectWarnings({ id: 'k', kind: 'print', widthPx: 10, heightPx: 10, print: { paper: 'zz' } })
    ).toEqual([]);
    expect(
      detectWarnings({ id: 'k', kind: 'print', widthPx: 10, heightPx: 10, print: '{nope' })
    ).toEqual([]);
  });
});

describe('wider than the page (web)', () => {
  test('a 960 px layer on a Mobile page gets Fit to width', () => {
    const r: WarnRects = {
      artboard: { x: 0, y: 0, w: 390, h: 900 },
      elements: [el('partneri', 0, 600, 960, 120, { text: 'Partneři', tag: 'section' })],
    };
    const w = detectWarnings({ id: 'm', kind: 'web', widthPx: 390, heightPx: 900 }, r);
    expect(w).toHaveLength(1);
    expect(w[0]?.text).toBe('“Partneři” is 960 px wide — wider than Mobile.');
    expect(w[0]?.verb).toBe('Fit to width');
    expect(w[0]?.fix).toEqual({ kind: 'fit-width', element: 'partneri', maxWidth: 390 });
  });
});

describe('the label mark', () => {
  test('counts in words', () => {
    expect(summaryWords(1)).toBe('1 thing to check');
    expect(summaryWords(2)).toBe('2 things to check');
  });

  test('a fixed size has no warnings of its own', () => {
    expect(
      detectWarnings({ id: 'f', kind: 'digital', widthPx: 1080, heightPx: 1350 }, board([]))
    ).toEqual([]);
  });
});
