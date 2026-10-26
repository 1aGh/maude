// V2-4.1 — reduced motion = cut, and the island material has one place (V2-1.8 M1/M3).
// happy-dom has no media-query engine, so this reads the two stylesheets: the panels' fold/unfold
// animations take every duration from `--dur-*` tokens (never a literal), the maude ladder collapses
// `--dur-panel` to 1 ms under prefers-reduced-motion, and the floating rules drop the keyframes there.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const FLOAT = read('client/v2/shell/floating-panels.css');
const TOKENS = read('client/styles/1-tokens-shell.css');

const declarations = (css: string, prop: RegExp) =>
  [...css.matchAll(/^\s*([a-z-]+)\s*:\s*([^;]+);/gm)]
    .filter((m) => prop.test(m[1] as string))
    .map((m) => `${m[1]}: ${m[2]}`);

describe('reduced motion is a cut', () => {
  test('every animation / transition in the floating panels takes its duration from a --dur token', () => {
    const decls = declarations(FLOAT, /^(animation|transition)$/);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) {
      if (/:\s*none$/.test(d)) continue;
      expect(d).toMatch(/var\(--dur-[a-z0-9-]+\)/);
      expect(d).not.toMatch(/(^|[^-\w])\d*\.?\d+m?s\b/); // no literal 220ms / 0.2s
    }
  });

  test('the ladder the shell resolves collapses --dur-panel to 1ms under prefers-reduced-motion', () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n  \}/.exec(TOKENS)?.[1] ?? '';
    // P8 C0: the shell ladder (1-tokens-shell.css) collapses on the shell roots, theme-independent
    expect(block).toMatch(/:root,\s*\.maude\s*\{/);
    const panel = /--dur-panel:\s*(\d+)ms/.exec(block);
    expect(Number(panel?.[1])).toBeLessThanOrEqual(1);
    // …and the normal value is a real animation, so the test above is not vacuous.
    expect(TOKENS).toMatch(/--dur-panel:\s*220ms/);
  });

  test('the floating rules drop the keyframes outright under reduced motion', () => {
    const rm =
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n  \}/.exec(FLOAT)?.[1] ?? '';
    expect(rm).toMatch(/\.sh-dockslot-inner/);
    expect(rm).toMatch(/\.sh-corner/);
    expect(rm).toMatch(/animation:\s*none/);
  });
});

describe('the island material has one place (V2-1.8 M1)', () => {
  test('a backdrop-filter in the floating panels is var(--island-backdrop) or none, nothing else', () => {
    const decls = declarations(FLOAT, /^(-webkit-)?backdrop-filter$/);
    expect(decls.length).toBeGreaterThan(0);
    for (const d of decls) expect(d).toMatch(/:\s*(var\(--island-backdrop\)|none)$/);
    expect(FLOAT).not.toMatch(/\bblur\(/);
  });

  test('--island-backdrop is none, and the island background is opaque (M2)', () => {
    expect(FLOAT).toMatch(/--island-backdrop:\s*none/);
    expect(FLOAT).toMatch(/--island-bg:\s*var\(--bg-1\)/);
  });

  test('the material is not keyed on engine, shell or setting (M3)', () => {
    expect(FLOAT).not.toMatch(/\[data-(engine|shell|tauri|native|material)/);
    expect(FLOAT).not.toMatch(/@supports|-webkit-touch-callout|html\.tauri/);
  });
});
