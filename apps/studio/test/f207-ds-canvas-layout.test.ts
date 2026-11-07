// 2.0.7 fix #6 (Michal, desktop 2.0.6, StudyFi): `system/studyfi-v3/design-system.tsx` opened as an
// empty canvas; zoom-to-fit showed the artboards at 2 %, spread over a huge area.
//
// Root cause, layout half: the converter put every specimen page of a section in ONE row, so the
// 29 component pages made a row 43 000 px wide (and, once the pages hug their content, the canvas
// is 43 000 x 54 000 px — fit-all is 2 %). The layout is not absurd per artboard, it is unbounded per row.
//
//   1. the generator wraps a section's pages after MAX_ROW_COLUMNS, rows stay packed and in order;
//   2. an existing converted canvas (the StudyFi meta as written) is wrapped at run time — the same
//      grid the generator now writes, never written to the meta;
//   3. the wrap touches only an untouched generated grid: an arranged layout comes back as-is (same
//      array), and so does an already-compact one (idempotent — the canvas effect must not loop);
//   4. the default camera: fit-all when it is readable, else the top row, else the first artboard;
//   5. a camera that shows no artboard is recognised (the stored one that opened on nothing).
import { describe, expect, test } from 'bun:test';
import { cameraShowsContent, defaultCamera, READABLE_ZOOM, topRow } from '../canvas-camera.ts';
import {
  flowRows,
  isUntouchedRowGrid,
  MAX_ROW_COLUMNS,
  type RowRect,
  rowsOf,
  wrapRows,
} from '../canvas-rows.ts';
import { designSystemCanvasMeta, type OwnSpecimenArtboard } from '../ds/board/template.ts';
import { SECTIONS } from '../ds/board/types.ts';

const W = 1440;
const GAP = 48;

/** The StudyFi meta's shape: the seven sections + one row per section of 1440 x 900 pages. */
function studyfiLayout(): RowRect[] {
  const sections = SECTIONS.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h }));
  const counts = [2, 8, 1, 5, 2, 29, 11];
  const own: RowRect[] = [];
  counts.forEach((n, r) => {
    for (let c = 0; c < n; c++)
      own.push({ id: `ds-own-${r}-${c}`, x: c * (W + GAP), y: 1860 + r * 980, w: W, h: 900 });
  });
  return [...sections, ...own];
}

const bbox = (rects: readonly RowRect[]) => ({
  w: Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x)),
  h: Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y)),
});
const maxRowWidth = MAX_ROW_COLUMNS * W + (MAX_ROW_COLUMNS - 1) * GAP;

describe('the converter writes a compact grid', () => {
  test('a section with more pages than MAX_ROW_COLUMNS wraps onto rows below it', () => {
    const own: OwnSpecimenArtboard[] = [];
    for (let i = 0; i < 29; i++)
      own.push({
        id: `ds-own-c${i}`,
        label: `C${i}`,
        src: `preview/c${i}.tsx`,
        section: 'components',
      });
    for (let i = 0; i < 3; i++)
      own.push({ id: `ds-own-m${i}`, label: `M${i}`, src: `preview/m${i}.tsx`, section: 'motion' });
    const meta = designSystemCanvasMeta('x', own) as { layout: { artboards: RowRect[] } };
    const rects = meta.layout.artboards;
    const pages = rects.filter((r) => r.id.startsWith('ds-own-'));
    expect(bbox(pages).w).toBeLessThanOrEqual(maxRowWidth);
    for (const row of rowsOf(pages)) expect(row.length).toBeLessThanOrEqual(MAX_ROW_COLUMNS);
    // the order reads on: c0..c5 on the first row, c6 starts the second at the left edge
    const byId = new Map(rects.map((r) => [r.id, r]));
    expect(byId.get('ds-own-c6')?.x).toBe(0);
    expect(byId.get('ds-own-c6')?.y).toBeGreaterThan(byId.get('ds-own-c0')?.y as number);
    // motion starts its own row under the last components row
    expect(byId.get('ds-own-m0')?.y).toBeGreaterThan(byId.get('ds-own-c28')?.y as number);
    // still a generated grid the canvas re-pitches
    expect(isUntouchedRowGrid(rects)).toBe(true);
    expect(wrapRows(rects)).toBe(rects);
  });
});

describe('an existing converted canvas is wrapped at run time', () => {
  test('the StudyFi layout: no row wider than MAX_ROW_COLUMNS, nothing overlaps, sections unmoved', () => {
    const before = studyfiLayout();
    expect(bbox(before).w).toBeGreaterThan(40_000); // the bug: one 29-page row
    const after = wrapRows(before);
    expect(after).not.toBe(before);
    expect(bbox(after).w).toBeLessThanOrEqual(maxRowWidth + 1);
    for (const row of rowsOf(after)) expect(row.length).toBeLessThanOrEqual(MAX_ROW_COLUMNS);
    expect(isUntouchedRowGrid(after)).toBe(true);
    const byId = new Map(after.map((r) => [r.id, r]));
    for (const s of SECTIONS) expect(byId.get(s.id)).toMatchObject({ x: s.x, y: s.y });
    // the rows that needed no wrap and sit above the first wrapped one keep their place
    expect(byId.get('ds-own-0-0')).toMatchObject({ x: 0, y: 1860 });
    // the generator and the run-time wrap agree on where page 7 of the colours goes
    expect(byId.get('ds-own-1-6')).toMatchObject({ x: 0, y: 1860 + 980 + 980 });
    // and the row flow still takes it from there
    const tall = after.map((r) => (r.id === 'ds-own-1-0' ? { ...r, h: 3000 } : r));
    const declared = new Map(after.map((r) => [r.id, { w: r.w, h: r.h }] as const));
    expect(flowRows(tall, { declared })).not.toBe(tall);
  });

  test('idempotent: an already wrapped layout comes back as the same array', () => {
    const once = wrapRows(studyfiLayout());
    expect(wrapRows(once)).toBe(once);
  });

  test('a layout a person arranged is never wrapped (same array)', () => {
    const dragged = studyfiLayout().map((r) =>
      r.id === 'ds-own-5-3' ? { ...r, x: r.x + 333, y: r.y - 47 } : r
    );
    expect(wrapRows(dragged)).toBe(dragged);
  });
});

describe('the default camera', () => {
  const fitOf = (vw: number, vh: number) => (rects: readonly RowRect[]) => {
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const b = bbox(rects);
    const zoom = Math.min((vw - 48) / b.w, (vh - 48) / b.h, 1);
    return { x: (vw - b.w * zoom) / 2 - x0 * zoom, y: (vh - b.h * zoom) / 2 - y0 * zoom, zoom };
  };

  test('fit-all when it is readable', () => {
    const small: RowRect[] = [
      { id: 'a', x: 0, y: 0, w: 400, h: 300 },
      { id: 'b', x: 448, y: 0, w: 400, h: 300 },
    ];
    const fit = fitOf(1440, 900);
    expect(defaultCamera(small, fit)).toEqual(fit(small));
  });

  test('a canvas too big to read at fit-all opens on its top row, readable and on content', () => {
    const fit = fitOf(1440, 900);
    const rects = studyfiLayout();
    expect(fit(rects).zoom).toBeLessThan(READABLE_ZOOM); // the 2 % fit
    const cam = defaultCamera(rects, fit);
    expect(cam.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(cameraShowsContent(cam, 1440, 900, rects)).toBe(true);
    expect(topRow(rects).map((r) => r.id)).toEqual(['ds-brand', 'ds-colour', 'ds-type']);
  });

  test('a top row still too wide falls back to the first artboard', () => {
    const row: RowRect[] = [];
    for (let i = 0; i < 40; i++) row.push({ id: `p${i}`, x: i * (W + GAP), y: 0, w: W, h: 900 });
    const cam = defaultCamera(row, fitOf(1440, 900));
    expect(cam.zoom).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(cameraShowsContent(cam, 1440, 900, [row[0] as RowRect])).toBe(true);
  });
});

describe('a camera that shows nothing', () => {
  test('the stored StudyFi camera (world y ~69 000) frames no artboard', () => {
    const empty = { x: -4011.93, y: -41325.57, zoom: 0.5991 };
    expect(cameraShowsContent(empty, 1440, 900, studyfiLayout())).toBe(false);
  });
  test('a camera on an artboard shows content; a broken one never does', () => {
    expect(cameraShowsContent({ x: 0, y: 0, zoom: 1 }, 1440, 900, studyfiLayout())).toBe(true);
    expect(cameraShowsContent({ x: 0, y: 0, zoom: 0 }, 1440, 900, studyfiLayout())).toBe(false);
    expect(cameraShowsContent({ x: 0, y: 0, zoom: 1 }, 0, 0, studyfiLayout())).toBe(false);
  });
});
