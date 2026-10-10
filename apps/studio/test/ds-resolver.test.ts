// V2-2.15 (V2-1.13 §5.11 + §7 ds-resolver): `@maude/ds` resolves per canvas — the system's
// `preview/_ds.tsx` override when it exists, else the shipped defaults — and the generated module
// registers the canvas's system (lead decision B), in the live build AND the handoff inline.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildCanvasModule } from '../canvas-build.ts';
import { buildLibMap, inlineDsImport } from '../canvas-lib-inline.ts';
import { canvasLibPath } from '../canvas-lib-resolver.ts';
import { canvasSystemFor, dsDepsFor, dsTargetFor } from '../ds/ds-resolver.ts';

const root = mkdtempSync(join(tmpdir(), 'ds-resolver-'));
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
put(
  'config.json',
  JSON.stringify({
    designSystems: [
      { name: 'fx', path: 'system/fx', themes: ['light', 'dark'], themeDefault: 'dark' },
      { name: 'ov', path: 'system/ov', themes: ['light'], themeDefault: 'light' },
    ],
    defaultDesignSystem: 'fx',
  })
);
put(
  'system/ov/preview/_ds.tsx',
  'export function Button() { return null; }\nexport const ext = { Hero: 1 };\n'
);
const USES_DS =
  'import { DSRoot } from "@maude/canvas-lib";\nimport { Button } from "@maude/ds";\nexport default () => <DSRoot><Button /></DSRoot>;\n';
put('ui/a.tsx', USES_DS);
put('ui/a.meta.json', JSON.stringify({ designSystem: 'fx' }));
put('ui/b.tsx', USES_DS);
put('ui/b.meta.json', JSON.stringify({ designSystem: 'ov' }));
put(
  'ui/none.tsx',
  'import { DSRoot } from "@maude/canvas-lib";\nexport default () => <DSRoot />;\n'
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

const build = (rel: string) =>
  buildCanvasModule(join(root, rel), readFileSync(join(root, rel), 'utf8'), {
    designRoot: root,
    restrictImportsTo: root,
  });

describe('@maude/ds resolver', () => {
  test('the canvas system: path-owned, then meta.designSystem, then the project default', () => {
    expect(canvasSystemFor(root, join(root, 'system/ov/preview/x.tsx'))?.name).toBe('ov');
    expect(canvasSystemFor(root, join(root, 'ui/b.tsx'))?.name).toBe('ov');
    expect(canvasSystemFor(root, join(root, 'ui/none.tsx'))?.name).toBe('fx');
  });

  test('the target: the system override when it exists, else the shipped defaults', () => {
    expect(dsTargetFor(root, canvasSystemFor(root, join(root, 'ui/b.tsx')))).toBe(
      join(root, 'system/ov/preview/_ds.tsx')
    );
    expect(dsTargetFor(root, canvasSystemFor(root, join(root, 'ui/a.tsx')))).toMatch(
      /ds\/default-components\.tsx$/
    );
  });

  test('the live build registers the canvas system before the canvas renders', async () => {
    const a = (await build('ui/a.tsx')).js;
    expect(a).toContain('__registerDesignSystem({ name: "fx", themeDefault: "dark" })');
    expect(a).not.toMatch(/from\s*["']@maude\/ds["']/);
    const b = (await build('ui/b.tsx')).js;
    expect(b).toContain('__registerDesignSystem({ name: "ov", themeDefault: "light" })');
  });

  test('no @maude/ds import → nothing registers', async () => {
    expect((await build('ui/none.tsx')).js).not.toMatch(/__registerDesignSystem\(\{/);
  });

  test('a missing export fails loud', async () => {
    put('ui/c.tsx', 'import { Nope } from "@maude/ds";\nexport default () => <Nope />;\n');
    put('ui/c.meta.json', JSON.stringify({ designSystem: 'ov' }));
    await expect(build('ui/c.tsx')).rejects.toThrow(/Nope/);
  });

  test('the handoff inline carries the same registration, with no dev-time specifier left', () => {
    const src = readFileSync(join(root, 'ui/a.tsx'), 'utf8');
    const libPath = canvasLibPath();
    const libMap = buildLibMap(libPath, readFileSync(libPath, 'utf8'));
    const out = inlineDsImport(src, root, join(root, 'ui/a.tsx'), libMap).content;
    expect(out).not.toMatch(/from\s*["']@maude\/(ds|canvas-lib)["']/);
    expect(out).toContain('__registerDesignSystem({ name: "fx", themeDefault: "dark" });');
    expect(out).toContain('function DSRoot(');
    expect(out).toContain('function Button(');
    // the call runs after the `let` it writes is declared (no TDZ)
    expect(out.lastIndexOf('__registerDesignSystem({ name')).toBeGreaterThan(
      out.indexOf('let registeredDesignSystem')
    );
  });

  test('P-11 deps: a canvas importing @maude/ds depends on its meta, config.json and the override path', () => {
    const deps = dsDepsFor(USES_DS, join(root, 'ui/b.tsx'), root);
    expect(deps).toEqual([
      join(root, 'ui/b.meta.json'),
      join(root, 'config.json'),
      join(root, 'system/ov/preview/_ds.tsx'),
    ]);
    expect(dsDepsFor('export default () => null;\n', join(root, 'ui/b.tsx'), root)).toEqual([]);
  });
});
