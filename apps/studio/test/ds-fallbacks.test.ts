// V2-2.15 (V2-1.13 §5.5, §7): the generated fallbacks are drift-free, the per-system block
// never names anything the system declares (F2), and the shell slot is filled per system.
import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { declaredBy, renderFallbacks } from '../ds/fallbacks.ts';
import { loadRegistry } from '../ds/registry.ts';
import { FALLBACKS_SLOT, fallbacksFor, injectFallbacks } from '../ds/shell-fallbacks.ts';
import { diskFs, loadSystem, systemConfigsFrom } from '../ds/system.ts';
import { conformantFiles, fixtureConfig, memFs } from './_ds-fixture.ts';

const reg = loadRegistry();
const REPO = join(import.meta.dir, '../../..');
const designRoot = join(REPO, '.design');
const config = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));

const declaredNamesIn = (css: string) =>
  [...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]);

describe('fallback layer', () => {
  test('gen-ds-schema.mjs --check: the committed fallbacks + template blocks are byte-equal', () => {
    const r = spawnSync('node', ['scripts/gen-ds-schema.mjs', '--check'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  test('the template block is exactly components.core[].fallbackCss', () => {
    const tpl = readFileSync(
      join(
        REPO,
        'plugins/design/templates/design-system-inspiration/core/preview/_components.css.tpl'
      ),
      'utf8'
    );
    for (const c of reg.components.core) if (c.fallbackCss) expect(tpl).toContain(c.fallbackCss);
  });

  test('F2: a per-system block defines only names the system never declares', () => {
    const files = conformantFiles();
    const cfg = fixtureConfig();
    const css = files[cfg.tokensCssRel]
      .replace(/\n {2}--scrim: [^;]*;/g, '')
      .replace(/\n {2}--tracking-tight: [^;]*;/g, '')
      .replace(/\n {2}--bg-2: [^;]*;/g, '');
    const m = loadSystem(memFs({ ...files, [cfg.tokensCssRel]: css }), cfg);
    const block = renderFallbacks(reg, declaredBy(m));
    const names = declaredNamesIn(block);
    expect(names).toContain('--scrim');
    for (const n of names) expect(m.declared.has(n), n).toBe(false);
    // --bg-2 is a DDR-043 role: never served by a fallback (a missing one lowers the level);
    // --tracking-tight is functional (v1), so it is served, as 0
    expect(names).toContain('--tracking-tight');
    expect(names).not.toContain('--bg-2');
    expect(block.startsWith('@layer maude.fallback;')).toBe(true);
  });

  test('this repo’s systems: the shell block shadows nothing and stays ≤ 8 KB', () => {
    for (const s of systemConfigsFrom(config)) {
      const m = loadSystem(diskFs(designRoot), s);
      const css = fallbacksFor(designRoot, config, s.tokensCssRel);
      expect(Buffer.byteLength(css), s.name).toBeLessThanOrEqual(8 * 1024);
      for (const n of declaredNamesIn(css)) expect(m.declared.has(n), `${s.name} ${n}`).toBe(false);
      // component + type-role fallbacks only ever apply under the .ds wrapper
      for (const line of css.split('\n'))
        if (/^\s{2}[.:][^-]/.test(line) && !line.includes(':where(:root'))
          expect(line.trimStart().startsWith(':where(.ds)')).toBe(true);
    }
  });

  test('the shell slot is filled for the canvas system named by ?tokens, untouched otherwise', () => {
    const html = `<head>${FALLBACKS_SLOT}<link id="canvas-tokens"></head>`;
    const s = systemConfigsFrom(config)[0];
    const filled = injectFallbacks(
      html,
      designRoot,
      config,
      new URLSearchParams({ tokens: s.tokensCssRel })
    );
    expect(filled).toContain('@layer maude.fallback');
    expect(filled.indexOf('@layer maude.fallback')).toBeLessThan(filled.indexOf('canvas-tokens'));
    expect(
      injectFallbacks(html, designRoot, config, new URLSearchParams({ tokens: 'nope.css' }))
    ).toBe(html);
    expect(injectFallbacks(html, designRoot, config, null)).toBe(html);
  });

  // config.json's rootClass is unvalidated locally and lands in the scope selector of the inline
  // block whenever the system lacks a role: `</` must never close the <style> early, and a
  // rootClass change must re-render the cached block.
  const lacking = (() => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-fallbacks-'));
    for (const [rel, text] of Object.entries(conformantFiles())) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text.replace(/\n {2}--scrim: [^;]*;/g, ''));
    }
    return dir;
  })();
  afterAll(() => rmSync(lacking, { recursive: true, force: true }));
  const withRoot = (name: string, rootClass: string) => ({
    designSystems: [
      { name, path: 'system/fx', rootClass, themes: ['light', 'dark'], themeDefault: 'light' },
    ],
  });
  test('the inline block escapes </ (a hostile rootClass cannot close the <style>)', () => {
    const html = `<head>${FALLBACKS_SLOT}</head>`;
    const cfg = withRoot('xss-probe', 'fx</style><script>alert(1)</script>');
    const s = systemConfigsFrom(cfg)[0];
    const filled = injectFallbacks(
      html,
      lacking,
      cfg,
      new URLSearchParams({ tokens: s.tokensCssRel })
    );
    expect(filled).toContain('--scrim:');
    expect(filled).toContain('<\\/style><script>');
    expect(filled).not.toContain('</style><script>');
    expect(filled.match(/<\/style>/g)?.length).toBe(1);
  });

  test('the cache follows the config: a rootClass change re-renders the block', () => {
    const a = withRoot('cache-probe', 'probe-a');
    const rel = systemConfigsFrom(a)[0].tokensCssRel;
    expect(fallbacksFor(lacking, a, rel)).toContain('.probe-a');
    expect(fallbacksFor(lacking, withRoot('cache-probe', 'probe-b'), rel)).toContain('.probe-b');
  });
});
