// V2-8.5 c7 (01 cf-search-k) — the ⌘K rows as the kit draws them: a picture tile (32 × 22) at the left of a canvas row
// whether or not its cover has arrived, the meta as its own right-hand column, and Ask AI pinned in view at the foot of a long
// list. CSS-rule pins: a headless run cannot judge a sticky row, the rule is what carries it.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = join(import.meta.dir, '../client');
const css = readFileSync(join(CLIENT, 'v2/search/search.css'), 'utf8');
const jsx = readFileSync(join(CLIENT, 'dialogs/command-palette.jsx'), 'utf8');

const block = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

describe('⌘K canvas rows (01 cf-search-k)', () => {
  test('the picture and its placeholder are the same 32 × 22 tile', () => {
    expect(block('.st-pal-thumb')).toMatch(/width: 32px;[\s\S]*height: 22px/);
    expect(block('.st-palette--search .st-pal-icon--pic')).toMatch(
      /width: 32px;[\s\S]*height: 22px/
    );
    // a canvas row without a cover wears the tile; an action row keeps the 24 px icon square
    expect(jsx).toContain("item.group === 'canvases' ? ' st-pal-icon--pic'");
  });
  test('the meta is a column at the right, not glued to the name', () => {
    expect(block('.st-pal-meta')).toContain('margin-left: auto');
    expect(block('.st-pal-label')).toContain('flex: 1');
  });
  test('Ask AI is pinned to the foot of the scrolling list, on the palette surface', () => {
    const b = block('.st-pal-ask');
    expect(b).toContain('position: sticky');
    expect(b).toContain('bottom: 0');
    expect(b).toContain('background: var(--bg-2)');
  });
});
