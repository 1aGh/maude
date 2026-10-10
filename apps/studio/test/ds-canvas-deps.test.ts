// P-11 (V2-1.13 §5.11): a canvas that imports `@maude/ds` is rebuilt when its system changes —
// its `.meta.json`, `config.json` and the system's `preview/_ds.tsx` override (present or not)
// are module-cache deps, so a meta.designSystem switch or a new override invalidates the build.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDepsFromSource } from '../http.ts';

const root = mkdtempSync(join(tmpdir(), 'ds-canvas-deps-'));
mkdirSync(join(root, 'ui'), { recursive: true });
writeFileSync(
  join(root, 'config.json'),
  JSON.stringify({ designSystems: [{ name: 'fx', path: 'system/fx', themeDefault: 'dark' }] })
);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('P-11: @maude/ds deps', () => {
  test('a system change rebuilds the canvas: meta, config.json and the override are deps', () => {
    const src = 'import { Button } from "@maude/ds";\nexport default () => <Button />;\n';
    const deps = localDepsFromSource(src, join(root, 'ui/a.tsx'), root);
    expect(deps).toContain(join(root, 'ui/a.meta.json'));
    expect(deps).toContain(join(root, 'config.json'));
    expect(deps).toContain(join(root, 'system/fx/preview/_ds.tsx'));
  });

  test('a canvas without @maude/ds keeps its deps as they were', () => {
    expect(
      localDepsFromSource('export default () => null;\n', join(root, 'ui/a.tsx'), root)
    ).toEqual([]);
  });
});
