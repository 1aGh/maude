// p8-fix-a F21 — the element bar (Group / Ungroup, colour, ...) floats above the selection and flips below it when
// there is no headroom. "No headroom" must count the shell's islands that cover the top of the canvas (the
// Preview bar, `occluded-insets.top`): at Fit's margin a top-row element's bar landed UNDER the island and its
// buttons could not be clicked (annotations-parity clicked them with dispatchEvent to get round it).

import { describe, expect, test } from 'bun:test';

import { barTopFor } from '../annotations/ui/bar-place.ts';

const sel = { y: 100, h: 80 };

describe('barTopFor', () => {
  test('with room above (past the edge and the top inset), the bar sits above the selection', () => {
    expect(barTopFor(sel, 40, 28, 0)).toBe(100 - 40 - 28);
    expect(barTopFor({ y: 300, h: 80 }, 40, 28, 56)).toBe(300 - 40 - 28);
  });

  test('no headroom at the edge: below the selection (the old rule, inset 0)', () => {
    expect(barTopFor({ y: 50, h: 80 }, 40, 28, 0)).toBe(50 + 80 + 28);
  });

  test('headroom that an island covers is not headroom: below the selection', () => {
    // above would be 100 - 40 - 28 = 32 px: clear of the 8 px edge, but under a 56 px island
    expect(barTopFor(sel, 40, 28, 0)).toBe(32);
    expect(barTopFor(sel, 40, 28, 56)).toBe(100 + 80 + 28);
  });

  test('a bad inset reads as none', () => {
    expect(barTopFor(sel, 40, 28, Number.NaN)).toBe(32);
    expect(barTopFor(sel, 40, 28, -10)).toBe(32);
  });
});
