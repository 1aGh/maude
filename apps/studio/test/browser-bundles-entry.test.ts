// V2-2.8 P1 — the SVG export's browser bundle must resolve its package from disk, not through a
// runtime require.resolve (which never reaches disk inside the compiled sidecar), and the
// desktop bundle must stage that package.
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { packageEntry } from '../exporters/_browser-bundles.ts';

describe('packageEntry', () => {
  test('walks up node_modules from the given root to the package entry file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-pkg-'));
    const pkg = path.join(root, 'node_modules', 'dom-to-svg');
    mkdirSync(path.join(pkg, 'lib'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ module: 'lib/index.js' }));
    writeFileSync(path.join(pkg, 'lib', 'index.js'), 'export {}');
    const deep = path.join(root, 'apps', 'studio');
    mkdirSync(deep, { recursive: true });
    expect(packageEntry('dom-to-svg', deep)).toBe(path.join(pkg, 'lib', 'index.js'));
    expect(() => packageEntry('no-such-pkg', deep)).toThrow(/Cannot find package/);
  });

  test('dom-to-svg resolves from the dev-server root of this tree', () => {
    expect(existsSync(packageEntry('dom-to-svg'))).toBe(true);
  });

  test('the SVG lane no longer calls require.resolve, and the .app stages dom-to-svg', () => {
    const src = readFileSync(
      path.join(import.meta.dir, '..', 'exporters', '_browser-bundles.ts'),
      'utf8'
    );
    expect(src).not.toContain('require.resolve(packageName)');
    const stage = readFileSync(
      path.join(import.meta.dir, '..', '..', 'desktop', 'scripts', 'stage-resources.mjs'),
      'utf8'
    );
    expect(
      stage.slice(
        stage.indexOf('const RENDER_RUNTIME_PKGS'),
        stage.indexOf('];', stage.indexOf('const RENDER_RUNTIME_PKGS'))
      )
    ).toContain("'dom-to-svg'");
  });
});
