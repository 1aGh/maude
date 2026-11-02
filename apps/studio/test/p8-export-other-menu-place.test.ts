// p8-e2e-prodfix · the Export sheet's "Other…" list stays inside the sheet sideways too.
//
// The desktop export-formats run found GIF / batch / print rows unreachable: the list is fixed at the
// button's left edge and 380 px wide, so a button near the sheet's right edge (the video section draws
// "Other…" after its formats) pushed the list off the sheet and the window. menuPlace now takes the
// horizontal bounds and clamps.
import { describe, expect, test } from 'bun:test';

import { menuPlace } from '../client/v2/export/other-formats.jsx';

const btn = (left: number) => ({ top: 100, bottom: 128, left });

describe('menuPlace · horizontal clamp', () => {
  test('a button near the right edge pulls the list back inside the bounds', () => {
    // sheet spans 300..1020; the list is 380 wide; the button sits at x=900
    const p = menuPlace(btn(900), 800, { left: 300, right: 1020 });
    const left = p?.style.left as number;
    const width = p?.style.width as number;
    expect(left + width).toBeLessThanOrEqual(1020 - 16);
    expect(left).toBeGreaterThanOrEqual(300 + 16);
  });

  test('a button with room keeps the list under it', () => {
    const p = menuPlace(btn(340), 800, { left: 300, right: 1020 });
    expect(p?.style.left).toBe(340);
  });

  test('bounds narrower than the list shrink it rather than overflow', () => {
    const p = menuPlace(btn(40), 800, { left: 0, right: 320 });
    expect(p?.style.width as number).toBeLessThanOrEqual(320 - 2 * 16);
    expect((p?.style.left as number) + (p?.style.width as number)).toBeLessThanOrEqual(320 - 16);
  });

  test('without bounds the vertical behaviour is unchanged', () => {
    const p = menuPlace(btn(40), 800);
    expect(p?.side).toBe('below');
    expect(p?.style).toMatchObject({ position: 'fixed', top: 132, left: 40 });
  });
});
