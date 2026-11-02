// P8 c10 ann - 15 an-crowd: the zoomed-out section count chip ("Nápady 84") must not clip its text. At 14 px with a 1.2
// line and 2 px of padding the chip was 20 px tall and the glyphs (accent to descender) filled it edge to edge, so the
// cap height read as cut off. The chip keeps a 1.3 line and 4 px above and below.
import { describe, expect, test } from 'bun:test';
import { LOD_CSS } from '../annotations/ui/lod.tsx';

describe('15 an-crowd: the count chip has room for its text', () => {
  const rule = LOD_CSS.match(/\[data-lod="count"\]\s*\{[^}]*\}/)?.[0] ?? '';
  test('line-height 1.3 and at least 4 px of padding above and below', () => {
    expect(rule).not.toBe('');
    const lh = Number(rule.match(/font:[^;]*?\/(\d+(?:\.\d+)?)/)?.[1]);
    expect(lh).toBeGreaterThanOrEqual(1.3);
    const pad = rule.match(/padding:\s*(\d+)px\s+(\d+)px/);
    expect(Number(pad?.[1])).toBeGreaterThanOrEqual(4);
  });
});
