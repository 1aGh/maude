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

// G3: the code view's header (Copy, ×) sat under the Share cluster (z 30) and the right dock (z 20)
// because the card pinned itself 16px from the top at z 12. It starts below the cluster, the way the
// right dock does, and stacks above the docks and their grips (z 25) but under the cluster.
describe('code view clears the Share cluster and the docks (G3)', () => {
  const card = body(read('client/v2/code/code.css'), '.v2-code');
  test('starts below the Share cluster', () => {
    expect(card).toMatch(
      /top:\s*calc\(var\(--float-gap[^)]*\)\s*\+\s*var\(--pill-h[^)]*\)\s*\+\s*var\(--pill-gap[^)]*\)\)/
    );
  });
  test('stacks above the docks and grips, under the cluster', () => {
    const z = Number(card.match(/z-index:\s*(\d+)/)?.[1]);
    const cluster = Number(
      read('client/v2/shell/share-cluster.css').match(/z-index:\s*(\d+)/)?.[1]
    );
    expect(z).toBeGreaterThan(25);
    expect(z).toBeLessThan(cluster);
  });
});
