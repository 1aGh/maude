// S7.13 — the marks on the canvas (07 ve-formats): a link glyph between linked video artboards and "Unlinked copy — its
// own cut" under a forked one. Where the glyphs go is geometry, pinned here; which artboards are linked is the same
// derivation the Formats list uses (video/link-groups.ts), pinned in linked-formats-derive.test.ts.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

// 07 ve-formats at its own scale: Reels 238 × 422, 16:9 422 × 238, 1:1 140 × 140, the 0:15 copy 242 × 136
const RECTS = [
  { id: 'reels', x: 110, y: 96, w: 238, h: 422 },
  { id: 'wide', x: 392, y: 96, w: 422, h: 238 },
  { id: 'square', x: 392, y: 378, w: 140, h: 140 },
  { id: 'copy', x: 572, y: 378, w: 242, h: 136 },
];

describe('the link glyphs', () => {
  test('one spoke from the first artboard to each other format, in the middle of the gap between them', async () => {
    const { linkPills } = await import('../video-links-overlay.tsx');
    const pills = linkPills([{ ids: ['reels', 'wide', 'square'] }], RECTS);
    expect(pills.map((p) => [p.from, p.to])).toEqual([
      ['reels', 'wide'],
      ['reels', 'square'],
    ]);
    // between Reels (right edge 348) and 16:9 (left edge 392): x 370, in the rows they share
    expect(pills[0]).toMatchObject({ x: 370, gap: 44 });
    expect(pills[0]?.y).toBeCloseTo(96 + 238 / 2, 6);
    // Reels ↔ 1:1: the same gap, in the rows they share
    expect(pills[1]).toMatchObject({ x: 370, gap: 44 });
    expect(pills[1]?.y).toBeCloseTo(378 + 140 / 2, 6);
  });

  test('stacked artboards are joined across the gap between them; diagonal ones at the middle of their centres', async () => {
    const { linkPills } = await import('../video-links-overlay.tsx');
    const stacked = linkPills(
      [{ ids: ['a', 'b'] }],
      [
        { id: 'a', x: 0, y: 0, w: 100, h: 50 },
        { id: 'b', x: 20, y: 90, w: 60, h: 50 },
      ]
    );
    expect(stacked[0]).toMatchObject({ x: 50, y: 70, gap: 40 });
    const diagonal = linkPills(
      [{ ids: ['a', 'b'] }],
      [
        { id: 'a', x: 0, y: 0, w: 100, h: 100 },
        { id: 'b', x: 200, y: 200, w: 100, h: 100 },
      ]
    );
    expect(diagonal[0]).toMatchObject({ x: 150, y: 150, gap: 0 });
  });

  test('an artboard the canvas does not hold (trashed, not yet laid out) is left out; the rest are still joined', async () => {
    const { linkPills } = await import('../video-links-overlay.tsx');
    const pills = linkPills([{ ids: ['reels', 'gone', 'wide'] }], RECTS);
    expect(pills.map((p) => p.to)).toEqual(['wide']);
    expect(linkPills([{ ids: ['gone', 'wide'] }], RECTS)).toEqual([]);
  });
});

describe('the unlinked copy’s tag', () => {
  test('a component called <Comp>Unlinked is a copy when <Comp> is one of the canvas’s comps', async () => {
    const { unlinkedCopies } = await import('../video-links-overlay.tsx');
    expect(
      unlinkedCopies([
        { id: 'reels', name: 'Recap' },
        { id: 'wide', name: 'Recap' },
        { id: 'copy', name: 'RecapUnlinked' },
        { id: 'other', name: 'HypeUnlinked' }, // its original is not on this canvas: not "a copy of" anything here
        { id: 'anon', name: null },
      ])
    ).toEqual([{ id: 'copy', of: 'Recap' }]);
  });
});
