// The packaged app stages every npm package a `maude design <verb>` helper imports
// (apps/desktop/scripts/helper-deps.mjs → stage-resources.mjs, DDR-177). The scrape is a
// regex over source, so CODE A HELPER GENERATES — `from '${specifier}'` in a template string —
// must never read as an import: the V2-2.17 index helper reached clip-ops.ts through api.ts and
// the desktop build died on "missing ${specifier} (design helper)".
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectImports,
  standaloneHelperNpmDeps,
} from '../../apps/desktop/scripts/helper-deps.mjs';

const BIN = fileURLToPath(new URL('../../apps/studio/bin', import.meta.url));

test('an interpolated specifier in generated code is not an import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-helper-deps-'));
  try {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, '_entry.mjs'), "import { gen } from './lib/gen.ts';\nimport 'svgo';\n");
    writeFileSync(
      join(dir, 'lib', 'gen.ts'),
      "export const gen = (n, specifier) => `import { ${n} } from '${specifier}';\\n`;\n" +
        'export const pick = (pkg) => import(`${pkg}/x`);\n'
    );
    assert.deepEqual(collectImports(join(dir, '_entry.mjs')), ['svgo']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no helper in apps/studio/bin stages an interpolated package name', () => {
  const deps = standaloneHelperNpmDeps(BIN);
  assert.ok(deps.length > 0);
  assert.deepEqual(
    deps.filter((d) => d.includes('${') || d.includes('`')),
    []
  );
});
