// S11.19 G1: Canvases > Advanced widened to the folder path's width and clipped
// the switches out of the 228 px panel. A grid track defaults to `auto`, so the
// nowrap mono path inflated it. The body must pin its one column to minmax(0, 1fr).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dir, '../client/v2/left-panel/left-panel.css'), 'utf8');

describe('left panel Advanced body (G1)', () => {
  test('.lp-adv-body pins its column so a long path cannot widen the panel', () => {
    const m = css.match(/\.lp-adv-body\s*\{([^}]*)\}/);
    expect(m).not.toBeNull();
    const body = m ? m[1] : '';
    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
