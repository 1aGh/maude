// #170 F35 (burndown T2.4b) — "the Canvases panel body sits 8 px off" in the Share / Version history shots: content
// flush with the left border, a gap on the right. Measured on a throwaway project (2026-11-08, Chromium, 1024 px):
// the Share sheet (24 / 24 px) and Version history (16 / 16 header, 12 / 12 rows, 20 / 20 fold) are symmetric; the
// left panel's `.sh-sidebar` is `overflow: hidden` with 16 px of hidden horizontal overflow (the "+ New canvas"
// row's New-folder button carries a `data-tip` tooltip pseudo-element laid out past the edge), and an
// overflow:hidden box is still a scroll container — `scrollLeft = 8` sticks, which draws exactly the shot. Clip
// it like the shell root (r1-panels finding 20): `overflow: clip` is not a scroll container, so nothing can shift it.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(
  join(import.meta.dir, '..', 'client/v2/shell/floating-panels.css'),
  'utf8'
);

describe('F35 — the left panel cannot be scrolled sideways', () => {
  test('.sh-sidebar clips where overflow: clip is supported (hidden stays the fallback)', () => {
    expect(css).toMatch(
      /@supports \(overflow: clip\) \{\s*\.sh-sidebar \{\s*overflow: clip;\s*\}\s*\}/
    );
    const base = css.match(/\n {2}\.sh-sidebar \{([^}]*)\}/)?.[1] ?? '';
    expect(base).toContain('overflow: hidden;');
  });
});
