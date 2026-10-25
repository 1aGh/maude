// P8 c6 (14 ed-ab-arrange) — a snap that pulled the board by less than half a pixel draws no "Δ0" pill: it said
// nothing and the board draws only the guide, the gap chips and the X · Y pill.
import { describe, expect, test } from 'bun:test';

describe('the snap pill', () => {
  test('is gated on the ROUNDED delta, so Δ0 is never drawn', async () => {
    const src = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url)).text();
    expect(src).toContain("const showPill = g.kind !== 'grid' && Math.round(Math.abs(delta)) > 0;");
    expect(src).not.toContain("const showPill = g.kind !== 'grid' && Math.abs(delta) > 0;");
  });
});
