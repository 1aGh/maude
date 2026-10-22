// P8 bug sweep B2 — layout fixes that need a browser to see and a text read to pin. Each one was measured
// in Chromium 1600×1000 (a Playwright pass over the release client, elements poking past their panel's
// edge); the rule below is what makes the measurement come out right. Add one test per fix.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = (rel: string) => readFileSync(join(import.meta.dir, '..', 'client', rel), 'utf8');
/** The declaration block of the first rule whose selector is exactly `sel` (alone or last in a list). */
const rule = (src: string, sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[\\n,}])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(src);
  if (!m) throw new Error(`no rule for ${sel}`);
  return m[1] ?? '';
};

describe('Inspector', () => {
  test('Combine shapes wraps inside the 170 px value column (Exclude was cut off by 19 px)', () => {
    const r = rule(css('v2/inspector/sections/sections.css'), '.insp-combine');
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).toMatch(/min-width:\s*0/);
  });
});

describe('pinned panels', () => {
  test('the sidebar and right panel fill the slot through the display:contents wrapper (Canvases list was 6 px tall)', () => {
    const shell = css('styles/3-shell-maude.css');
    expect(shell).toMatch(
      /\.st-dockslot > \.st-dockslot-inner > \.st-sidebar\s*\{\s*flex:\s*1 1 auto/
    );
    expect(shell).toMatch(/\.st-dockslot > \.st-dockslot-inner > \.st-rpanel,/);
  });
});

describe('"?" sheet', () => {
  const search = css('v2/search/search.css');
  test('the sticky footer owns the sheet bottom padding (rows scrolled past it showed through a 24 px strip)', () => {
    expect(rule(search, '.so-overlay--v2')).toMatch(/padding-bottom:\s*0/);
    expect(rule(search, '.so-overlay--v2 .so-overlay-ft')).toMatch(
      /padding-bottom:\s*var\(--space-6\)/
    );
  });
});
