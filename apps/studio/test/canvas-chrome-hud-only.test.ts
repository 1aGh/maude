// P8 C5 (13 / 14 / 15 a11y): the canvas document also loads the PROJECT's design system, whose `:root` may define
// any DS name (`--island-bg`, `--accent`, `--dur-panel`, …) — a light-only project DS once turned Maude's dark toolbar
// into #dee1e2 under #b7bbc0 glyphs (1.47:1). So Maude's in-canvas chrome reads ONLY its own prefixed HUD family
// (`--maude-hud-*` / `--maude-chrome-*`, generated from maude-v2 into canvas-hud-tokens.gen.ts) plus the `--guide`
// pair that block owns; every fallback is a literal. A name a project DS can define is a red test here.

import { describe, expect, test } from 'bun:test';
import { HUD_TOKENS_CSS } from '../canvas-hud-tokens.gen.ts';
import { TOOLBAR_CSS } from '../toolbars/toolbar-css.ts';

/** In-canvas chrome stylesheets. Add each sheet here when it moves onto the HUD family. */
const CHROME: Record<string, string> = {
  'toolbars/toolbar-css.ts': TOOLBAR_CSS,
};

const declared = new Set([...HUD_TOKENS_CSS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));

describe('in-canvas chrome reads only the HUD family', () => {
  for (const [file, css] of Object.entries(CHROME)) {
    test(`${file}: every var() is a HUD token the generated block declares`, () => {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1] as string);
      expect(used.length).toBeGreaterThan(0);
      const foreign = used.filter(
        (n) =>
          !(
            n.startsWith('--maude-hud-') ||
            n.startsWith('--maude-chrome-') ||
            n === '--guide' ||
            n === '--guide-fg'
          )
      );
      expect(foreign).toEqual([]);
      const undeclared = [...new Set(used)].filter((n) => !declared.has(n));
      expect(undeclared).toEqual([]);
    });
  }

  test('a project DS that defines --island-bg / --accent cannot reach the toolbar', () => {
    // the exact names the light-only project DS defined when the dark toolbar washed out
    for (const name of [
      '--island-bg',
      '--island-edge',
      '--island-shadow',
      '--accent',
      '--bg-2',
      '--fg-1',
    ])
      expect(TOOLBAR_CSS).not.toContain(`var(${name}`);
  });
});
