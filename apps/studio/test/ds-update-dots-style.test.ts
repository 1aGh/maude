// S10.10 (S10.8 follow-up): the "update available" mark in the canvas shell must not move the user's layout and
// must not carry a colour of Maude's own into the user's design. It is an outline in a CSS variable with a
// neutral fallback — no `position: relative` forced onto the element, no hard-coded hex.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SHELL = readFileSync(
  path.join(import.meta.dir, '../../../plugins/design/templates/_shell.html'),
  'utf8'
);
const block = SHELL.slice(
  SHELL.indexOf('// ds-update-dots:begin'),
  SHELL.indexOf('// ds-update-dots:end')
);
// the rule is a few string literals joined with `+`; the CSS is what is inside the quotes
const assignment = block.match(/style\.textContent =([\s\S]*?);\n/)?.[1] ?? '';
const css = [...assignment.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]).join('');

describe('the update mark in the canvas shell', () => {
  test('the block was found and draws the mark on [data-ds-update]', () => {
    expect(block).toContain('data-ds-update');
    expect(css).toContain('[data-ds-update]');
  });

  test('it takes its colour from a CSS variable with a neutral fallback, never a hex of ours', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).toMatch(/var\(--maude-update-dot,\s*currentColor\)/);
  });

  test('it does not change the element’s layout: no position, no size, no pseudo-element box', () => {
    expect(css).not.toMatch(/position\s*:/);
    expect(css).not.toMatch(/::(after|before)/);
    expect(css).not.toMatch(/\b(width|height|margin|padding|display)\s*:/);
    expect(css).toMatch(/outline\s*:/);
  });
});
