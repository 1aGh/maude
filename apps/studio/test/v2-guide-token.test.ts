// S2.8 (shared) — DDR-046 rename `--guide-magenta` → `--guide`: the guide colour comes from the maude-v2 tokens
// through the generated HUD block (the V2-2.6 generator), canvas-lib's snap chrome reads `--guide`, and the old name
// is only an alias so a canvas that still says var(--guide-magenta) keeps its colour. The token-drift gate
// (`node scripts/gen-tokens.mjs --check`) is run by the lead's quality gate; this pins the wiring.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { HUD_TOKENS_CSS } from '../canvas-hud-tokens.gen.ts';

const ROOT = join(import.meta.dir, '../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('--guide', () => {
  test('maude-v2 owns the colour: the HUD block carries its --x-guide / --x-guide-fg, once, on :root', () => {
    const v2 = read('.design/system/maude-v2/colors_and_type.css');
    const guide = /^\s*--x-guide:\s*([^;]+);/m.exec(v2)?.[1]?.trim();
    const fg = /^\s*--x-guide-fg:\s*([^;]+);/m.exec(v2)?.[1]?.trim();
    expect(guide).toBeTruthy();
    expect(HUD_TOKENS_CSS).toContain(`--guide:    ${guide};`);
    expect(HUD_TOKENS_CSS).toContain(`--guide-fg: ${fg};`);
    // declared in the first (:root) block, which the light block inherits — one value, not two themes
    expect(HUD_TOKENS_CSS.split('--guide:').length).toBe(2);
    expect(HUD_TOKENS_CSS.indexOf('--guide:')).toBeLessThan(
      HUD_TOKENS_CSS.indexOf(':root[data-maude-theme="light"]')
    );
  });

  test('the old name is an alias of the new one, nothing more', () => {
    expect(HUD_TOKENS_CSS).toContain('--guide-magenta: var(--guide);');
  });

  test('canvas-lib reads --guide (snap lines and the distance pill); no literal magenta left behind', () => {
    const lib = read('apps/studio/canvas-lib.tsx');
    expect(lib).not.toMatch(/var\(--guide-magenta/);
    expect(lib).not.toMatch(/^\s*--guide-magenta:/m);
    expect(lib).toContain('.dc-snap-guide--sibling');
    expect(lib).toMatch(/\.dc-snap-guide--sibling \{\s*background: var\(--guide,/);
    expect(lib).toMatch(/\.dc-snap-pill \{[^}]*color: var\(--guide-fg,/s);
  });

  test('the studio client ladder already has --guide for the shell (generated from the same system)', () => {
    const css = read('apps/studio/client/styles/1-tokens-maude-v2.css');
    expect(css).toContain('--guide: var(--x-guide);');
  });

  test('no other source still names --guide-magenta as a consumer', () => {
    for (const rel of [
      'apps/studio/use-snap-guides.tsx',
      'apps/studio/canvas-shell.tsx',
      'apps/studio/editing/preset-ruler.tsx',
    ])
      expect(read(rel), rel).not.toContain('--guide-magenta');
  });
});
