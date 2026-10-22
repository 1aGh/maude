// P8 C0 (decision maude/v2-p8-c0-one-shell-ladder) — the maude-v2 tokens ARE the shell's tokens.
//
// The shell mounts as `.maude[data-theme]` under `<html data-theme>`; popovers and sheets portal to <body>, so they
// resolve whatever <html> resolves. Before C0 the shell resolved the v1 ladders (1-tokens.css' amber `:root`
// palette, 1-tokens-maude.css' indigo `.maude` palette) and the v2 values only reached a `.maude-v2` wrapper.
//
// This runs the real cascade over the bundled client CSS (Lightning CSS, as build.ts bundles it): for each theme it
// resolves every custom property on <html data-theme>, on `.maude[data-theme]`, and — as the expected side — on a
// `.maude-v2[data-theme]` element against the maude-v2 source file. Every name maude-v2 declares must resolve to the
// same declared value in the shell, except the island material, which the shell keeps solid (V2-1.8 M1–M3).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { bundle, transform } from 'lightningcss';

const STUDIO = join(import.meta.dir, '..');
const REPO = join(STUDIO, '..', '..');
const SHELL_SOLID = new Set(['--x-island-bg', '--x-island-bg-strong']);

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

type Rule = { selectors: string[]; decls: [string, string][]; layer: number; order: number };

/** Style rules of a CSS text with their cascade layer rank (unlayered = highest); @media blocks are skipped. */
function rules(css: string, props = /(--[\w-]+)\s*:\s*([^;]*?)\s*(?:;|$)/g): Rule[] {
  const layerNames: string[] = [];
  const stmt = /@layer\s+([\w\s,.-]+);/g;
  for (const m of css.matchAll(stmt))
    for (const n of m[1].split(',').map((s) => s.trim()))
      if (!layerNames.includes(n)) layerNames.push(n);
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  let order = 0;
  const walk = (text: string, layer: number) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text
        .slice(i, open)
        .replace(/^[\s;]+/, '')
        .trim();
      // matching close brace
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      const lastStmt = head.split(';').pop()!.trim();
      if (lastStmt.startsWith('@layer')) {
        const name = lastStmt.replace('@layer', '').trim();
        if (!layerNames.includes(name)) layerNames.push(name);
        walk(body, layerNames.indexOf(name));
      } else if (lastStmt.startsWith('@')) {
        // @media / @supports / @keyframes … — not part of the default cascade checked here
      } else {
        const decls: [string, string][] = [];
        for (const m of body.matchAll(props)) decls.push([m[1], m[2]]);
        if (decls.length)
          out.push({
            selectors: lastStmt.split(',').map((s) => s.trim()),
            decls,
            layer,
            order: order++,
          });
      }
      i = j;
    }
  };
  walk(src, 1e6);
  return out;
}

function specificity(sel: string): number {
  const s = sel.replace(/:not\(([^)]*)\)/g, ' $1 ');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const tags = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 1e6 + cls * 1e3 + tags;
}

/** The declared value of every custom property that wins on `el` (own declarations only, no inheritance). */
function resolve(all: Rule[], el: Element): Map<string, string> {
  const win = new Map<string, { v: string; key: [number, number, number] }>();
  for (const r of all) {
    let spec = -1;
    for (const s of r.selectors) {
      try {
        if (el.matches(s)) spec = Math.max(spec, specificity(s));
      } catch {
        /* a selector happy-dom cannot parse never matches here */
      }
    }
    if (spec < 0) continue;
    const key: [number, number, number] = [r.layer, spec, r.order];
    for (const [n, v] of r.decls) {
      const cur = win.get(n);
      const beats =
        !cur ||
        key[0] > cur.key[0] ||
        (key[0] === cur.key[0] &&
          (key[1] > cur.key[1] || (key[1] === cur.key[1] && key[2] >= cur.key[2])));
      if (beats) win.set(n, { v, key });
    }
  }
  return new Map([...win].map(([n, w]) => [n, w.v.replace(/\s+/g, ' ')]));
}

const shellCss = () =>
  new TextDecoder().decode(
    bundle({ filename: join(STUDIO, 'client/styles/_index.css'), minify: false }).code
  );
const v2Css = () =>
  new TextDecoder().decode(
    transform({
      filename: 'maude-v2.css',
      code: Buffer.from(
        readFileSync(join(REPO, '.design/system/maude-v2/colors_and_type.css'), 'utf8')
      ),
      minify: false,
    }).code
  );

describe('P8 C0 · the shell resolves the maude-v2 tokens', () => {
  const shell = rules(shellCss());
  const v2 = rules(v2Css());
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: <html> (portals) and .maude resolve every maude-v2 token to its v2 value`, () => {
      document.documentElement.setAttribute('data-theme', theme);
      document.body.innerHTML = `<div class="maude" data-theme="${theme}"></div><div class="maude-v2" data-theme="${theme}"></div>`;
      const expected = resolve(v2, document.querySelector('.maude-v2')!);
      expect(expected.size).toBeGreaterThan(100);
      for (const el of [document.documentElement, document.querySelector('.maude')!]) {
        const got = resolve(shell, el);
        const wrong: string[] = [];
        for (const [n, v] of expected)
          if (!SHELL_SOLID.has(n) && got.get(n) !== v) wrong.push(`${n}: ${got.get(n)} ≠ ${v}`);
        expect(wrong.slice(0, 8)).toEqual([]);
        // the island material stays solid in the shell (floating-panels.css, V2-1.8)
        expect(got.get('--x-island-bg')).toBe('var(--bg-1)');
      }
    });
  }

  test('the v1 palettes are gone from the bundle: no amber/indigo hue, no Berkeley Mono on the shell roots', () => {
    const css = shellCss();
    expect(/Berkeley Mono/.test(css)).toBe(false);
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      const got = resolve(rules(css), document.documentElement);
      expect(got.get('--accent')).toMatch(/ 238\)$/);
    }
  });

  test('the shell root is `.maude[data-theme]` and <html data-theme> follows the theme', () => {
    const app = readFileSync(join(STUDIO, 'client/app.jsx'), 'utf8');
    expect(app).toMatch(/className=\{'maude' \+/);
    const sync = readFileSync(join(STUDIO, 'client/hooks/use-photo-and-timeline.jsx'), 'utf8');
    expect(sync).toMatch(/document\.documentElement\.setAttribute\('data-theme', theme\)/);
  });

  test('the canvas HUD block (in-canvas chrome) is generated from maude-v2: azure accent, v2 faces', () => {
    const hud = readFileSync(join(STUDIO, 'canvas-hud-tokens.gen.ts'), 'utf8');
    expect(hud).toMatch(/maude-v2\/colors_and_type\.css/);
    for (const m of hud.matchAll(/--maude-hud-accent:\s*([^;]+);/g))
      expect(m[1]).toMatch(/ 238\)$/);
    expect(hud).not.toMatch(/JetBrains Mono|'Inter'/);
  });
});

describe('P8 C0 · the cascade lets v2 rules win', () => {
  test('nothing in the bundle is unlayered but keyframes and the reduced-motion cut', () => {
    const css = shellCss().replace(/\/\*[\s\S]*?\*\//g, '');
    const top: string[] = [];
    let depth = 0;
    let head = '';
    for (const c of css) {
      if (c === '{') {
        if (depth === 0) top.push(head.split(/[;}]/).pop()?.trim() ?? '');
        depth++;
        head = '';
      } else if (c === '}') {
        depth--;
        head = '';
      } else if (depth === 0) head += c;
    }
    const stray = top.filter(
      (h) => !/^@layer\b|^@keyframes\b|^@media \(prefers-reduced-motion: reduce\)/.test(h)
    );
    expect(stray).toEqual([]);
  });

  test("a panel's adjustment of the empty kit wins over the kit's base size (Canvases' folded empty line)", () => {
    const all = rules(shellCss(), /([a-z-]+)\s*:\s*([^;]*?)\s*(?:;|$)/g);
    document.body.innerHTML =
      '<div class="maude" data-theme="light"><div class="cv-empty"><div class="es-e es-e--fold"><p class="es-sit">x</p><p class="es-next">y</p></div></div></div>';
    expect(resolve(all, document.querySelector('.es-sit')!).get('font-size')).toBe('var(--type-sm)');
    expect(resolve(all, document.querySelector('.es-next')!).get('font-size')).toBe('var(--type-xs)');
  });
});
