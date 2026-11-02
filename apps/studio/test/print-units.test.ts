// feature-2-print-artboards T1 — print/units.ts unit tests + the single-source
// lint guard (no `25.4` outside this module — see the plan's T1 gotcha).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  CSS_DPI,
  defaultBleedMm,
  getPaperPreset,
  MM_PER_INCH,
  mmToPt,
  mmToPx,
  PAPER_PRESETS,
  pxToMm,
  pxToPt,
  resolvePrintArtboard,
  trimSizeMm,
} from '../print/units.ts';

describe('print/units — conversions', () => {
  test('mmToPx / pxToMm are inverses at 96dpi', () => {
    expect(mmToPx(MM_PER_INCH)).toBeCloseTo(CSS_DPI, 10);
    expect(pxToMm(CSS_DPI)).toBeCloseTo(MM_PER_INCH, 10);
    expect(pxToMm(mmToPx(37))).toBeCloseTo(37, 10);
  });

  test('mmToPt: 25.4mm === 72pt (1 inch)', () => {
    expect(mmToPt(MM_PER_INCH)).toBeCloseTo(72, 10);
  });

  test('pxToPt: 96px @96dpi === 72pt (1 inch)', () => {
    expect(pxToPt(96)).toBeCloseTo(72, 10);
  });
});

describe('print/units — PAPER_PRESETS', () => {
  test('every ISO A-series preset id resolves', () => {
    for (const id of ['a6', 'a5', 'a4', 'a3', 'a2', 'a1', 'a0']) {
      expect(getPaperPreset(id)).toBeDefined();
    }
  });

  test('A4 is 210×297mm portrait', () => {
    const a4 = getPaperPreset('a4');
    expect(a4?.width).toBe(210);
    expect(a4?.height).toBe(297);
    expect(a4?.unit).toBe('mm');
  });

  test('Letter is a US in-unit preset', () => {
    const letter = getPaperPreset('letter');
    expect(letter?.unit).toBe('in');
    expect(letter?.width).toBe(8.5);
    expect(letter?.height).toBe(11);
  });

  test('unknown id is undefined', () => {
    expect(getPaperPreset('nope')).toBeUndefined();
  });

  test('no duplicate ids', () => {
    const ids = PAPER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('print/units — orientation', () => {
  test('landscape swaps width/height', () => {
    const a4 = getPaperPreset('a4');
    expect(a4).toBeDefined();
    const portrait = trimSizeMm(a4 as NonNullable<typeof a4>, 'portrait');
    const landscape = trimSizeMm(a4 as NonNullable<typeof a4>, 'landscape');
    expect(portrait.widthMm).toBe(210);
    expect(portrait.heightMm).toBe(297);
    expect(landscape.widthMm).toBe(297);
    expect(landscape.heightMm).toBe(210);
  });
});

describe('print/units — default bleed', () => {
  test('mm-unit presets default to 3mm bleed', () => {
    const a4 = getPaperPreset('a4');
    expect(a4).toBeDefined();
    expect(defaultBleedMm(a4 as NonNullable<typeof a4>)).toBe(3);
  });

  test('in-unit presets default to 0.125in bleed, expressed in mm', () => {
    const letter = getPaperPreset('letter');
    expect(letter).toBeDefined();
    expect(defaultBleedMm(letter as NonNullable<typeof letter>)).toBeCloseTo(
      0.125 * MM_PER_INCH,
      10
    );
  });
});

describe('print/units — resolvePrintArtboard', () => {
  test('throws on unknown paper', () => {
    expect(() => resolvePrintArtboard({ paper: 'nope' })).toThrow(/unknown paper preset/);
  });

  test('A4 portrait, default bleed — artboard px = trim + 2×bleed exactly', () => {
    const r = resolvePrintArtboard({ paper: 'a4' });
    expect(r.bleedMm).toBe(3);
    expect(r.widthPx).toBe(r.trimWidthPx + 2 * r.bleedPx);
    expect(r.heightPx).toBe(r.trimHeightPx + 2 * r.bleedPx);
    // Sanity band around the nominal A4-at-96dpi size (~794×1123px trim).
    expect(r.trimWidthPx).toBeGreaterThan(790);
    expect(r.trimWidthPx).toBeLessThan(798);
    expect(r.trimHeightPx).toBeGreaterThan(1118);
    expect(r.trimHeightPx).toBeLessThan(1128);
  });

  test('landscape orientation swaps the resolved trim dimensions', () => {
    const portrait = resolvePrintArtboard({ paper: 'a4', orientation: 'portrait' });
    const landscape = resolvePrintArtboard({ paper: 'a4', orientation: 'landscape' });
    expect(landscape.trimWidthPx).toBe(portrait.trimHeightPx);
    expect(landscape.trimHeightPx).toBe(portrait.trimWidthPx);
  });

  test('explicit bleedMm=0 removes the bleed border entirely', () => {
    const r = resolvePrintArtboard({ paper: 'a4', bleedMm: 0 });
    expect(r.bleedPx).toBe(0);
    expect(r.widthPx).toBe(r.trimWidthPx);
    expect(r.heightPx).toBe(r.trimHeightPx);
  });

  test('margins default to 5mm on all sides when unset', () => {
    const r = resolvePrintArtboard({ paper: 'a4' });
    expect(r.marginsMm).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
  });

  test('partial margin override only replaces the given sides', () => {
    const r = resolvePrintArtboard({ paper: 'a4', marginsMm: { top: 10 } });
    expect(r.marginsMm).toEqual({ top: 10, right: 5, bottom: 5, left: 5 });
  });
});

describe('print/units — single-source lint guard', () => {
  const STUDIO_ROOT = join(import.meta.dir, '..');
  const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '_history']);

  function walk(dir: string, out: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mjs|jsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  test('the mm-per-inch conversion constant (25.4 in arithmetic) appears ONLY in print/units.ts', () => {
    // Matches `25.4` used as a division/multiplication operand (the shape a
    // hand-rolled mm↔px conversion would take, e.g. `mm * 96 / 25.4`) — NOT
    // any bare occurrence of the substring, which also shows up coincidentally
    // in unrelated numeric data (e.g. SVG path coordinates in canvas-cursors.ts).
    const CONVERSION_SHAPE = /[*/]\s*25\.4\b|\b25\.4\s*[*/]/;
    const files = walk(STUDIO_ROOT, []);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(STUDIO_ROOT, file);
      if (rel === join('print', 'units.ts')) continue;
      if (rel === join('test', 'print-units.test.ts')) continue;
      // a frozen copy of an older release's print/units.ts (a v1-peer fixture), never a second source
      if (rel.startsWith(`${join('test', 'fixtures', 'v1')}/`)) continue;
      const text = readFileSync(file, 'utf8');
      if (CONVERSION_SHAPE.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
