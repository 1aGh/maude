// p8-fixups2 (V2-8.7 moderates) — the three small desktop pages are documents a screen reader lands on: each has ONE
// main landmark and ONE h1 (axe landmark-one-main, page-has-heading-one). Pure markup, no visual change: the h1 of the
// splash / the notice IS the existing wordmark / title (margin reset), the tab strip's is visually hidden.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..', 'desktop', 'src');
const page = (name: string) => readFileSync(join(SRC, name), 'utf8');
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('desktop pages: one main, one h1', () => {
  for (const name of ['strip.html', 'index.html', 'root-missing.html']) {
    test(`${name}: exactly one <main> and one <h1>`, () => {
      const html = page(name)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script[\s\S]*?<\/script>/g, '');
      expect(count(html, /<main[\s>]/g)).toBe(1);
      expect(count(html, /<h1[\s>]/g)).toBe(1);
    });
  }

  test('the strip keeps its tablist and nav inside the main, the h1 is visually hidden (no visual change)', () => {
    const html = page('strip.html');
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(main).toContain('data-testid="tab-strip"');
    expect(main).toContain('role="tablist"');
    expect(html).toMatch(/<h1 class="sr-only"[^>]*>[^<]+<\/h1>/);
    expect(html).toMatch(/\.sr-only\s*\{[^}]*clip:/);
  });

  test('the splash wordmark and the notice title are the h1 (margin reset, same type)', () => {
    expect(page('index.html')).toMatch(/<h1 class="wordmark"/);
    expect(page('index.html')).toMatch(/\.wordmark\s*\{[^}]*margin:\s*0/);
    expect(page('root-missing.html')).toMatch(/<h1 class="gone-t" id="gone-t"/);
  });
});
