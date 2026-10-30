// V2-8.5 c7 (01 cf-open-big) — the camera knows it is fitted: the readout says "Zoom to fit · 10%".
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { viewportAtFit } from '../viewport-fit.ts';

const mark = { x: 40, y: 64, zoom: 0.1 };

describe('viewportAtFit', () => {
  test('on the target: fitted; no target yet: never', () => {
    expect(viewportAtFit({ ...mark }, mark)).toBe(true);
    expect(viewportAtFit({ ...mark }, null)).toBe(false);
    expect(viewportAtFit(null, mark)).toBe(false);
  });

  test('a pan or a zoom step leaves the fit', () => {
    expect(viewportAtFit({ ...mark, x: mark.x + 12 }, mark)).toBe(false);
    expect(viewportAtFit({ ...mark, y: mark.y - 12 }, mark)).toBe(false);
    expect(viewportAtFit({ ...mark, zoom: 0.11 }, mark)).toBe(false);
  });

  test('sub-pixel rounding of the eased move still counts as on the target', () => {
    expect(viewportAtFit({ x: 40.4, y: 63.7, zoom: 0.1004 }, mark)).toBe(true);
  });
});

describe('the shell side', () => {
  const root = new URL('../', import.meta.url);
  const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

  test('canvas-lib marks the fit target and reports fit with the zoom', () => {
    const src = read('canvas-lib.tsx');
    expect(src).toContain('viewportAtFit');
    expect(src).toMatch(/viewport-zoom', zoom: vp\.zoom, fit/);
  });

  test('the readout words "Zoom to fit · N%" only while fitted', async () => {
    const { zoomPctLabel } = await import('../client/v2/undo/zoom-undo.jsx');
    expect(zoomPctLabel(0.1, true)).toBe('Zoom to fit · 10%');
    expect(zoomPctLabel(0.1, false)).toBe('10%');
    expect(zoomPctLabel(1, undefined)).toBe('100%');
  });
});
