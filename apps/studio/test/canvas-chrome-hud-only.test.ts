// P8 C5 (13 / 14 / 15 a11y): the canvas document also loads the PROJECT's design system, whose `:root` may define
// any DS name (`--island-bg`, `--accent`, `--dur-panel`, …) — a light-only project DS once turned Maude's dark toolbar
// into #dee1e2 under #b7bbc0 glyphs (1.47:1). So Maude's in-canvas chrome reads ONLY its own prefixed HUD family
// (`--maude-hud-*` / `--maude-chrome-*`, generated from maude-v2 into canvas-hud-tokens.gen.ts) plus the `--guide`
// pair that block owns; every fallback is a literal. A name a project DS can define is a red test here.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// P8 C5 (14 R1, 04 R2): every label Maude draws over a canvas speaks the DS body face — mono is "Advanced + code
// only" (maude-v2 README). The size pill, rulers, hints, gap chips, align bar, reorder tag, tab badges, snap pill,
// minimap, link chip, cursors' names, the growth tag, the activity badge.
const MONO_FREE = [
  ...new Bun.Glob('editing/**/*.{ts,tsx}').scanSync({ cwd: join(import.meta.dir, '..') }),
  'measure-overlay.tsx',
  'link-chip-overlay.tsx',
  'equal-spacing-handles.tsx',
  'use-element-resize.tsx',
  'cursors-overlay.tsx',
  'artboard-growth-tag.tsx',
  'inspect.ts',
  'web-overlay-content.tsx',
  'toolbars/toolbar-css.ts',
];
describe('in-canvas chrome labels are never mono', () => {
  test('no chrome file names a mono face (the HUD mono token or a monospace stack)', () => {
    const hits: string[] = [];
    for (const f of MONO_FREE) {
      const src = readFileSync(join(import.meta.dir, '..', f), 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return; // prose
        if (/--maude-chrome-font-mono|ui-monospace|\bmonospace\b/.test(line))
          hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
  test('canvas-lib chrome (snap pill, minimap, zoom controls) is the body face too', () => {
    const src = readFileSync(join(import.meta.dir, '../canvas-lib.tsx'), 'utf8');
    expect(src).not.toContain('--maude-chrome-font-mono');
  });
});

// P8 C5 (14 R2, board .ed-sel / .ed-h): a selection is a 1.5 px accent outline (no halo, no ticks) with eight
// 8 × 8 bg-2 squares inset 1.5 px accent, no radius — objects and artboards alike; no rim on an unselected artboard.
describe('selection drawing is the board’s', () => {
  const rule = (file: string, sel: string) => {
    const src = readFileSync(join(import.meta.dir, '..', file), 'utf8');
    const at = src.indexOf(`\n${sel} {`);
    expect({ file, sel, found: at >= 0 }).toEqual({ file, sel, found: true });
    return src.slice(at, src.indexOf('}', at));
  };
  test('outline 1.5 px, no halo ring, ticks drawn as nothing', () => {
    const sel = rule('canvas-shell.tsx', '.dc-cv-halo--selected');
    expect(sel).toContain('1.5px solid');
    expect(sel).toContain('box-shadow: none');
    expect(rule('canvas-shell.tsx', '.dc-cv-halo--selected .tick')).toContain('display: none');
    expect(rule('canvas-shell.tsx', '.dc-canvas .dc-artboard[aria-current="true"]')).toContain(
      'box-shadow: none'
    );
  });
  test('handles: bg-2 square, inset 1.5 px accent, radius 0, 8 × 8 on every edge', () => {
    for (const [file, sel] of [
      ['use-element-resize.tsx', '.dc-el-resize-handle'],
      ['editing/artboard-handles.tsx', '.ed-ab-handle'],
    ] as const) {
      const r = rule(file, sel);
      expect(r).toContain('var(--maude-chrome-bg-2');
      expect(r).toContain('inset 0 0 0 1.5px var(--maude-hud-accent');
      expect(r).toContain('border-radius: 0');
      const src = readFileSync(join(import.meta.dir, '..', file), 'utf8');
      expect(src).not.toMatch(/width: 14px; height: 6px|width: 6px; height: 14px/);
    }
  });
});
