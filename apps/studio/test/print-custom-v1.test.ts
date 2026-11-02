// S7.1 — a custom print size is `paper: <nearest-larger preset>` + `sizeMm` (decision
// maude/v2-S7-custom-print-sizeMm), and a v1 peer reads it without a crash and draws the same trim.
//
// The v1 reader is FROZEN (test/fixtures/v1/print-units.v1.9.1.ts, verbatim from the tag), so a
// later change to print/units.ts cannot make this pass by accident. `readArtboardPrintProp` is
// today's canvas-edit.ts function, byte-identical to v1.9.1's (as is `objectExpressionToPlain`).

import { describe, expect, test } from 'bun:test';

import { readArtboardPrintProp } from '../canvas-edit.ts';
import {
  customPrintProp,
  isCustomPrint,
  nearestLargerPreset,
  readSizeMm,
  resolveCustomPrintArtboard,
} from '../kinds/print-custom.ts';
import { resolveMmPx, resolvePrintArtboard } from '../print/units.ts';
import * as v1 from './fixtures/v1/print-units.v1.9.1.ts';

describe('nearest-larger preset', () => {
  test('the smallest preset that holds the trim, in the matching orientation', () => {
    expect(nearestLargerPreset(99, 210)).toEqual({ paper: 'dl', orientation: 'portrait' });
    expect(nearestLargerPreset(105, 148)).toEqual({ paper: 'a6', orientation: 'portrait' });
    expect(nearestLargerPreset(148, 105)).toEqual({ paper: 'a6', orientation: 'landscape' });
    expect(nearestLargerPreset(150, 211)).toEqual({ paper: 'c5', orientation: 'portrait' });
    expect(nearestLargerPreset(215.9, 279.4)).toEqual({ paper: 'letter', orientation: 'portrait' });
    expect(nearestLargerPreset(2000, 1500)).toEqual({ paper: 'a0', orientation: 'landscape' });
    // the card rows are written wide: their "portrait" already holds a wide size
    expect(nearestLargerPreset(85, 55)).toEqual({ paper: 'card-eu', orientation: 'portrait' });
    expect(nearestLargerPreset(55, 85)).toEqual({ paper: 'card-eu', orientation: 'landscape' });
  });

  test('the picker writes the preset, the trim and an explicit bleed', () => {
    expect(customPrintProp([99, 210])).toEqual({
      paper: 'dl',
      orientation: 'portrait',
      sizeMm: [99, 210],
      bleedMm: 3,
    });
    expect(customPrintProp([90, 50], { bleedMm: 2 })).toMatchObject({
      paper: 'a6',
      orientation: 'landscape',
      bleedMm: 2,
    });
    expect(() => customPrintProp([5, 210])).toThrow(RangeError);
    expect(() => customPrintProp([Number.NaN, 210])).toThrow(RangeError);
  });

  test('sizeMm is read leniently: a malformed value is no custom size', () => {
    expect(readSizeMm({ sizeMm: [99.004, 210] })).toEqual([99, 210]);
    for (const sizeMm of [[99], [99, 210, 3], ['99', 210], [99, 1e9], { w: 99, h: 210 }, null])
      expect(isCustomPrint({ paper: 'a4', sizeMm })).toBe(false);
  });
});

describe('v2 resolves the custom trim', () => {
  test('sizeMm wins over the preset geometry', () => {
    const r = resolveCustomPrintArtboard(customPrintProp([99, 210]));
    expect(r).toMatchObject({ paper: 'dl', trimWidthMm: 99, trimHeightMm: 210, bleedMm: 3 });
    expect(r.trimWidthPx).toBe(374); // 99 mm at 96 px/in
    expect(r.trimWidthPx).toBe(resolveMmPx(99));
    expect(r.widthPx).toBe(r.trimWidthPx + 2 * r.bleedPx);
  });

  test('without sizeMm it is resolvePrintArtboard, unknown paper included', () => {
    expect(resolveCustomPrintArtboard({ paper: 'a5' })).toEqual(
      resolvePrintArtboard({ paper: 'a5' })
    );
    expect(() => resolveCustomPrintArtboard({ paper: 'custom' })).toThrow();
    // but a custom prop never throws, whatever its paper says
    expect(resolveCustomPrintArtboard({ paper: 'custom', sizeMm: [99, 210] }).paper).toBe('dl');
  });
});

describe('a v1 peer (print/units.ts @ v1.9.1)', () => {
  const sizes: [number, number][] = [
    [99, 210],
    [216, 280], // lands on an inch preset (tabloid): the explicit bleed keeps v1's bleed at 3 mm
    [90, 50],
    [1000, 700],
  ];

  test('resolvePrintArtboard does not throw on any custom prop, and names the stored preset', () => {
    for (const s of sizes) {
      const prop = customPrintProp(s);
      expect(() => v1.resolvePrintArtboard(prop)).not.toThrow();
      expect(v1.resolvePrintArtboard(prop).paper).toBe(prop.paper);
    }
  });

  test("its guides land on the custom trim: the artboard's px size less v1's bleed is v2's trim", () => {
    for (const s of sizes) {
      const v2 = resolveCustomPrintArtboard(customPrintProp(s));
      const v1BleedPx = v1.resolveMmPx(v1.resolveBleedMm(customPrintProp(s)));
      expect(v1BleedPx).toBe(v2.bleedPx);
      expect(v2.widthPx - 2 * v1BleedPx).toBe(v2.trimWidthPx);
      expect(v2.heightPx - 2 * v1BleedPx).toBe(v2.trimHeightPx);
    }
  });

  test("why never paper: 'custom' — v1 throws on it", () => {
    expect(() => v1.resolvePrintArtboard({ paper: 'custom' })).toThrow(/unknown paper preset/);
  });

  test('the canvas prop reader keeps paper + bleed and drops the array', () => {
    const src = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="flyer" kind="print" width={397} height={816}
        print={{ paper: 'dl', orientation: 'portrait', sizeMm: [99, 210], bleedMm: 3 }}>
        <p>x</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
    const prop = readArtboardPrintProp('/x/ui/Flyer.tsx', src, 'flyer');
    expect(prop).toEqual({ paper: 'dl', orientation: 'portrait', bleedMm: 3 });
    expect(() => v1.resolvePrintArtboard(prop as never)).not.toThrow();
  });
});
