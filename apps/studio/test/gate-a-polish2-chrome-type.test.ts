// gate-a-polish2 — chrome type + the Inspect swatch edge. Source-level pins: each rule's block is read out of
// the file that owns it, so a mono face or a missing edge comes back as a red line naming the selector.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** The declaration block of the first rule whose selector is exactly `sel`. */
function block(src: string, sel: string): string {
  const i = src.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return src.slice(i, src.indexOf('}', i));
}

describe('the sticker gallery headings (canvas 15: body face, xs, semibold, fg-2)', () => {
  const css = read('client/v2/annotations/stickers-gallery.css');
  const ph = block(css, '.sg-ph');
  test('.sg-ph is --font-body, --type-xs, semibold, --fg-2', () => {
    expect(ph).toContain('font-family: var(--font-body)');
    expect(ph).toContain('font-size: var(--type-xs)');
    // the v2 weight alias is mounted later (Phase 4); the 600 fallback keeps the heading semibold until then
    expect(ph).toContain('font-weight: var(--w-semibold, 600)');
    expect(ph).toContain('color: var(--fg-2)');
  });
  test('the pack name keeps the heading colour, the count is tabular', () => {
    expect(block(css, '.sg-ph strong')).toContain('color: var(--fg-2)');
    expect(css).toMatch(/\.sg-ph span\s*{[^}]*tabular-nums/);
  });
  test('the whole island is set in the body face, so no row falls back to the v1 mono', () => {
    expect(block(css, '.st-sticker-picker.sg')).toContain('font-family: var(--font-body)');
  });
});

describe('the selection tag and the size tag are sans on chrome tokens', () => {
  test('.ed-name-tag ("Alligators · 595 × 51")', () => {
    const b = block(read('editing/selection.tsx'), '.ed-name-tag');
    expect(b).toContain('--maude-chrome-font-body');
    expect(b).not.toContain('font-mono');
  });
  test('.dc-cv-inspect-tag ("595 × 51")', () => {
    const b = block(read('inspect-overlay.tsx'), '.dc-cv-inspect-tag');
    expect(b).toContain('--maude-chrome-font-body');
    expect(b).not.toContain('font-mono');
    expect(b).toContain('tabular-nums');
  });
});

describe('the Inspect colour swatch has an edge that shows on a dark panel', () => {
  test('a 1px token border, strong enough for #111 on the dark island', () => {
    const b = block(read('client/v2/inspect/inspect.css'), '.sh-inspect-sw');
    expect(b).toContain('var(--border-strong)');
    expect(b).toMatch(/inset 0 0 0 1px/);
  });
});
