// P8 C9 (01 create flow, D6 critic) — three CSS fixes the critic found on the merged tip:
//  (1) cf-panel-search: the native search cancel button drew beside Maude's own × — one shared rule hides it
//      for every v2 search input (not just home.css);
//  (2) cf-open-big: the zen share cluster is the panels button alone — the Share button (`.btn`, display set in
//      @layer components) outranked the zen rule that sat in @layer shell, so the rule must live in components;
//  (3) cf-open-big: the "Panels hidden…" notice centres on the WINDOW — the toast is absolutely positioned inside
//      its 640 px toaster and `margin-inline: auto` only centres when both offsets are 0.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const client = join(import.meta.dir, '../client');
const read = (rel: string) => readFileSync(join(client, rel), 'utf8');

/** The text of every top-level `@layer <name> { … }` block in a file (brace-balanced). */
function layerBlocks(css: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`@layer ${name} \\{`, 'g');
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

describe('cf-panel-search: one clear control', () => {
  test('the kit layer hides the native search cancel button + decoration for every search input', () => {
    const kit = read('styles/3-kit-maude-v2.css');
    const rule = kit.match(/input\[type="search"\]::-webkit-search-cancel-button[^{]*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toContain('input[type="search"]::-webkit-search-decoration');
    expect(rule?.[0]).toMatch(/display:\s*none/);
    expect(rule?.[0]).toMatch(/appearance:\s*none/);
    // it is a shell-layer rule, so it reaches an input of any surface
    expect(
      layerBlocks(kit, 'shell').some((b) => b.includes('::-webkit-search-cancel-button'))
    ).toBe(true);
  });
});

describe('cf-open-big: zen share cluster', () => {
  test('the zen hide rule sits in @layer components (the layer .maude .btn sets display in)', () => {
    const css = read('v2/shell/share-cluster.css');
    const zen = '.st-share[data-zen="true"] > :not([data-testid="share-cluster-panels"])';
    expect(layerBlocks(css, 'components').some((b) => b.includes(zen))).toBe(true);
    expect(layerBlocks(css, 'shell').some((b) => b.includes(zen))).toBe(false);
  });
});

describe('cf-open-big: the notice centres on the window', () => {
  test('the toast spans its toaster (left/right 0) so margin-inline auto centres it', () => {
    const src = readFileSync(join(import.meta.dir, '../notifications.tsx'), 'utf8');
    const rule = src.match(/\.maude-notifications \[data-sonner-toast\] \{[^}]*\}/);
    expect(rule?.[0]).toContain('left: 0');
    expect(rule?.[0]).toContain('right: 0');
    expect(rule?.[0]).toContain('margin-inline: auto');
    expect(rule?.[0]).toContain('width: fit-content');
  });
});
