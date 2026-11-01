// r3-ds-rows — Michal 2026-11-01 on the Design system canvas: "design system je hrozne rozlezly,
// chtelo by to mit mensi mezeru mezi radky, radek artboards by mel mit vzdy jen takovou vysku jako je
// jeho nejdelsi artboard".
//
// Root cause: the converter placed the specimen-page rows at a fixed pitch (900 + 4300 px) before any
// page was measured; the pages hug their content (1 500–4 750 px), so short rows left thousands of px
// of air and one tall page spilled into the next row. `flowRows` re-pitches the rows from the
// measured heights: row height = its tallest artboard, one constant gap, columns untouched, and a
// layout a person has arranged is left alone.
//
//   1. pure flow: mixed heights → row height = max, gap constant, nothing overlaps, x untouched;
//   2. the layout the converter really wrote (this repo's committed Design system canvas) flows;
//   3. an arranged layout (one artboard dragged anywhere) is returned as-is — same array;
//   4. idempotent / stable by identity (the canvas effect must not loop);
//   5. the generator itself writes the compact pitch;
//   6. a frame too small to carry its name draws no label (the sections' stacked names at 2 % zoom).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  flowRows,
  isDsCanvasIds,
  isUntouchedRowGrid,
  ROW_GAP,
  type RowRect,
  rowsOf,
} from '../canvas-rows.ts';
import { designSystemCanvasMeta, OWN_ARTBOARD } from '../ds/board/template.ts';
import { SECTIONS } from '../ds/board/types.ts';

const W = 1440;
const COL_GAP = 48;

/** `heights[r][c]` → a converter-shaped grid at an arbitrary (legacy) row pitch. */
function grid(heights: number[][], y0 = 1860, pitch = 5200): RowRect[] {
  const out: RowRect[] = [];
  heights.forEach((row, r) =>
    row.forEach((h, c) =>
      out.push({ id: `a-${r}-${c}`, x: c * (W + COL_GAP), y: y0 + r * pitch, w: W, h })
    )
  );
  return out;
}

/** every page is DRAWN at a showcase's 1440 x 900 and grows to its content */
const drawn = (rects: RowRect[]) => new Map(rects.map((r) => [r.id, { w: W, h: 900 }]));
const flow = (rects: RowRect[]) => flowRows(rects, { declared: drawn(rects) });

const overlaps = (a: RowRect, b: RowRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('flowRows — a row is as tall as its tallest artboard', () => {
  const heights = [[900, 4750, 1500], [900], [1500, 2000], [6200, 900, 900, 900], [900, 900]];

  test('row height = max, the gap is one constant, nothing overlaps, columns stay', () => {
    const before = grid(heights);
    const after = flow(before);
    const rows = rowsOf(after);
    expect(rows.length).toBe(heights.length);
    // the first row keeps its y
    expect((rows[0] as RowRect[])[0]?.y).toBe(1860);
    for (let r = 1; r < rows.length; r++) {
      const prev = rows[r - 1] as RowRect[];
      const bottom = prev[0] ? prev[0].y + Math.max(...prev.map((a) => a.h)) : 0;
      // every artboard of the row starts exactly ROW_GAP under the tallest one above
      for (const a of rows[r] as RowRect[]) expect(a.y - bottom).toBe(ROW_GAP);
    }
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++)
        expect(overlaps(after[i] as RowRect, after[j] as RowRect)).toBe(false);
      expect((after[i] as RowRect).x).toBe((before[i] as RowRect).x);
    }
  });

  test('a row of short pages no longer reserves the room of a tall one (the old 5 200 px pitch)', () => {
    const before = grid([
      [900, 900],
      [900, 900],
    ]);
    const after = flow(before);
    expect(rowsOf(after)[1]?.[0]?.y).toBe(1860 + 900 + ROW_GAP);
  });

  test('one tall page pushes the row below it down instead of spilling into it', () => {
    const before = grid([[900, 4750], [900]]);
    const after = flow(before);
    const tall = after.find((a) => a.id === 'a-0-1') as RowRect;
    const below = after.find((a) => a.id === 'a-1-0') as RowRect;
    expect(below.y).toBe(tall.y + 4750 + ROW_GAP);
    expect(overlaps(tall, below)).toBe(false);
  });

  test('idempotent, and returns the SAME array once settled (the canvas effect compares by identity)', () => {
    const once = flow(grid(heights));
    expect(flow(once)).toBe(once);
    const settled = grid([[900], [900]], 0, 900 + ROW_GAP);
    expect(flow(settled)).toBe(settled);
  });

  test('the row gap is bigger than the column gap and is the one the generator writes', () => {
    expect(ROW_GAP).toBeGreaterThan(COL_GAP);
    expect(OWN_ARTBOARD.rowGap).toBe(ROW_GAP);
  });
});

describe('flowRows — a layout a person arranged is not touched', () => {
  const base = () => grid([[900, 2000], [900], [1500, 900]]);

  test('an artboard dragged to a free spot', () => {
    const rects = base().map((r) => (r.id === 'a-1-0' ? { ...r, x: 9000, y: 123 } : r));
    expect(isUntouchedRowGrid(rects, drawn(rects))).toBe(false);
    expect(flow(rects)).toBe(rects);
  });

  test('an artboard dragged to the left edge but off its row', () => {
    const rects = base().map((r) => (r.id === 'a-2-1' ? { ...r, x: 0, y: r.y + 777 } : r));
    expect(flow(rects)).toBe(rects);
  });

  test('an artboard nudged sideways inside its row', () => {
    const rects = base().map((r) => (r.id === 'a-0-1' ? { ...r, x: r.x + 120 } : r));
    expect(flow(rects)).toBe(rects);
  });

  test('a lone artboard, or nothing, is not a grid to re-pitch', () => {
    expect(flowRows([])).toEqual([]);
    const one = [{ id: 'x', x: 40, y: 10, w: 100, h: 100 }];
    expect(flow(one)).toBe(one);
  });

  test('a rect with an unknown size is never guessed at', () => {
    const rects = base().map((r, i) => (i === 0 ? { ...r, w: Number.NaN } : r));
    expect(flow(rects)).toBe(rects);
  });
});

describe('the layout the converter really wrote', () => {
  const metaFile = path.resolve(
    import.meta.dir,
    '../../../.design/system/maude/design-system.meta.json'
  );
  const written = (
    JSON.parse(readFileSync(metaFile, 'utf8')) as { layout: { artboards: RowRect[] } }
  ).layout.artboards;

  test('is an untouched row grid, so it flows', () => {
    expect(written.length).toBeGreaterThan(40);
    expect(isUntouchedRowGrid(written)).toBe(true);
  });

  test('with real page heights it ends far shorter than the 33 000 px it was written at', () => {
    // measured live on this system (2026-10-31): pages 1 500–4 750 px, one at ~6 200
    const measured = written.map((a, i) => ({
      ...a,
      h: a.id.startsWith('ds-own-') ? [1500, 2300, 3100, 4750, 6200, 1800][i % 6] : a.h,
    }));
    const flowed = flowRows(measured, {
      declared: new Map(written.map((a) => [a.id, { w: a.w, h: a.h }])),
    });
    const bottom = (rs: RowRect[]) => Math.max(...rs.map((r) => r.y + r.h));
    const top = (rs: RowRect[]) => Math.min(...rs.map((r) => r.y));
    expect(bottom(flowed) - top(flowed)).toBeLessThan(bottom(measured) - top(measured));
    // no overlaps anywhere, whatever the heights
    for (let i = 0; i < flowed.length; i++)
      for (let j = i + 1; j < flowed.length; j++)
        expect(overlaps(flowed[i] as RowRect, flowed[j] as RowRect)).toBe(false);
  });

  test('the seven sections (declared heights) do not move', () => {
    const sections = SECTIONS.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h }));
    expect(flowRows(sections)).toBe(sections);
  });
});

describe('the generator writes the compact pitch', () => {
  test('rows of kept pages sit ROW_GAP under the row above at a showcase height', () => {
    const own = ['a', 'b', 'c'].map((s, i) => ({
      id: `ds-own-${s}`,
      label: s,
      src: `preview/${s}.tsx`,
      section: (['colour', 'type', 'space'] as const)[i],
    }));
    const meta = designSystemCanvasMeta('x', own) as { layout: { artboards: RowRect[] } };
    const ys = own.map((o) => meta.layout.artboards.find((a) => a.id === o.id)?.y as number);
    expect(ys[1]).toBe((ys[0] as number) + OWN_ARTBOARD.h + ROW_GAP);
    expect(ys[2]).toBe((ys[1] as number) + OWN_ARTBOARD.h + ROW_GAP);
  });
});

describe('which canvas flows', () => {
  test('the Design system canvas, and only while every artboard is its own', () => {
    expect(isDsCanvasIds(['ds-brand', 'ds-colour', 'ds-own-x', 'ds-dir-a'])).toBe(true);
    expect(isDsCanvasIds(['ds-brand', 'my-own-board'])).toBe(false);
    expect(isDsCanvasIds(['landing', 'pricing'])).toBe(false);
    expect(isDsCanvasIds([])).toBe(false);
  });
});

describe('an artboard name is drawn only on a frame that can carry it', () => {
  // The sections (560–2 256 px wide) sit 80 px apart; at 2 % zoom their names (16 screen px tall) stacked into
  // one unreadable clump over the top-left of the canvas. The name's box is capped to the frame's on-screen
  // width; below ~24 screen px the cap goes to 0 so the name vanishes with its frame instead of piling up.
  const src = readFileSync(path.resolve(import.meta.dir, '../canvas-lib.tsx'), 'utf8');
  const rule = src.slice(
    src.indexOf('.dc-canvas .dc-artboard.dc-positioned > .dc-artboard-label {')
  );
  const block = rule.slice(0, rule.indexOf('}'));

  test('the placed name caps its width at the frame and collapses it under the legible minimum', () => {
    expect(block).toContain('max-width: min(');
    expect(block).toContain('var(--dc-zoom, 1)');
    expect(block).toMatch(/- 24px\) \* 1000\)/);
  });
});
