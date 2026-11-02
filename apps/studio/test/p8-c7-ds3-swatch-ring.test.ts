// P8 round 7 third pass (13 · ds-edit-colour, ds-edge-contrast): the selection ring on a Design system swatch is
// the board's own — 2 px, 4 px clear of the swatch — and every other selection keeps its 1.5 px outline hugging the box.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../canvas-shell.tsx', import.meta.url), 'utf8');

describe('the swatch ring', () => {
  test('the stylesheet gives a ringed halo 2 px', () => {
    expect(src).toMatch(/\.dc-cv-halo--selected\[data-ring\]\s*\{[^}]*border-width:\s*2px/);
  });

  test('a board token or master rings 4 px clear of itself; nothing else does', () => {
    expect(src).toMatch(
      /const gap = el\.hasAttribute\('data-ds-token'\) \|\| el\.hasAttribute\('data-ds-master'\) \? 4 : 0/
    );
    expect(src).toContain('child.style.left = `${Math.round(r.left) - gap}px`');
    expect(src).toContain('child.style.width = `${Math.round(r.width) + gap * 2}px`');
    // the generic selection stays the 1.5 px outline
    expect(src).toMatch(/\.dc-cv-halo--selected\s*\{[^}]*border:\s*1\.5px solid/);
  });
});
