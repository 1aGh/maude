// S11.19 G1/G2: an Advanced body widened to its widest nowrap child and clipped the rest out of the
// panel (Canvases › Advanced: the folder path pushed the switches out of the 228 px panel; Version
// history › Advanced: the project and branch values and the notes ran past the 264 px panel).
// A grid track defaults to `auto`, so the child's min-content inflated it. Each body pins its one
// column to minmax(0, 1fr).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');

function body(css: string, selector: string): string {
  const esc = selector.replace(/[.]/g, '\\.');
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  expect(m).not.toBeNull();
  return m ? m[1] : '';
}

describe('Advanced bodies pin their column (G1, G2)', () => {
  test('.lp-adv-body (Canvases and Layers › Advanced)', () => {
    const b = body(read('client/v2/left-panel/left-panel.css'), '.lp-adv-body');
    expect(b).toMatch(/display:\s*grid/);
    expect(b).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });

  test('.v2-fold-body (every other panel fold: Version history, Inspector, …)', () => {
    const b = body(read('client/v2/fold/fold.css'), '.v2-fold-body');
    expect(b).toMatch(/display:\s*grid/);
    expect(b).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
