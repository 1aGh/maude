// The packaged app stages every npm package a `maude design <verb>` helper imports
// (apps/desktop/scripts/helper-deps.mjs → stage-resources.mjs, DDR-177). The scrape is a
// regex over source, so CODE A HELPER GENERATES — `from '${specifier}'` in a template string —
// must never read as an import: the V2-2.17 index helper reached clip-ops.ts through api.ts and
// the desktop build died on "missing ${specifier} (design helper)".
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectImports,
  renderShimGaps,
  serverRenderShims,
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

test('string text that reads like "from \' +" is not a package (sync/doc-name.ts message)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-helper-deps-'));
  try {
    writeFileSync(
      join(dir, '_entry.mjs'),
      "const msg = 'export it — could not be read from ' +\n  'git';\nimport 'svgo';\n"
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

// DDR-177's npm channel: `npm i -g @1agh/maude` installs only the ROOT package.json's
// dependencies, and `maude design <verb>` runs the bundled `.sh` → `bun run _<verb>.mjs` from
// that install. A helper dep missing there resolves in this checkout (apps/studio has its own
// node_modules) and breaks for every npm user (V2-2.4b: `check` imports oxc-parser, magic-string).
test('the root package.json ships every standalone helper npm dep (npm channel)', () => {
  const root = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
  );
  const shipped = new Set(Object.keys(root.dependencies ?? {}));
  assert.deepEqual(
    standaloneHelperNpmDeps(BIN).filter((d) => !shipped.has(d)),
    [],
    'add these to the root package.json dependencies (same range as apps/studio/package.json)'
  );
});

// P8 (2026-10-29): the server spawns render shims itself (`exportShimPath('<name>')` — exports,
// the thumbnail renderer). Like a helper, each must be staged with its npm closure, or covers and
// exports die only in the packaged app. `check-bundle-completeness` asserts it from this scrape.
const STUDIO = fileURLToPath(new URL('../../apps/studio', import.meta.url));

test('every render shim the server spawns is found by the scrape, the thumbnail renderer included', () => {
  const shims = serverRenderShims(STUDIO);
  assert.ok(shims.includes('_thumbs-playwright.mjs'), shims.join(', '));
  assert.ok(shims.includes('_png-playwright.mjs'), shims.join(', '));
  assert.deepEqual(renderShimGaps(STUDIO), []);
});

test('a render shim that is not staged, or lacks a dep, is a gap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-shim-gaps-'));
  try {
    mkdirSync(join(dir, 'thumbs'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(
      join(dir, 'thumbs', 'service.ts'),
      "Bun.spawn([rt, exportShimPath('_thumbs-playwright.mjs')]);\n" +
        "// exportShimPath('_gone.mjs') in a comment is not a spawn\n"
    );
    assert.deepEqual(serverRenderShims(dir), ['_thumbs-playwright.mjs']);
    assert.deepEqual(renderShimGaps(dir), [{ shim: '_thumbs-playwright.mjs', missing: ['file'] }]);
    writeFileSync(
      join(dir, 'bin', '_thumbs-playwright.mjs'),
      "import { chromium } from 'playwright';\n"
    );
    assert.deepEqual(renderShimGaps(dir), [
      { shim: '_thumbs-playwright.mjs', missing: ['playwright'] },
    ]);
    mkdirSync(join(dir, 'node_modules', 'playwright'), { recursive: true });
    assert.deepEqual(renderShimGaps(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
