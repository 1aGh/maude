// The bundled Codex ACP adapter (DDR-252 D3, plan Task B5): stage-resources.mjs ships the one
// pre-bundled entry + LICENSE + a trimmed package.json, never node_modules and never @openai/codex;
// check-bundle-completeness.mjs fails a bundle that carries either.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CODEX_ADAPTER_PKG,
  checkStagedCodexAdapter,
  nonBuiltinImports,
  stageCodexAdapter,
} from '../../apps/desktop/scripts/codex-adapter.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'codex-adapter-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function fakeStudio(entrySource) {
  const studio = join(tmp, `studio-${++n}`);
  const pkg = join(studio, 'node_modules', CODEX_ADAPTER_PKG);
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  mkdirSync(join(pkg, 'node_modules', 'zod'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: CODEX_ADAPTER_PKG,
      version: '9.9.9',
      license: 'Apache-2.0',
      type: 'module',
      bin: { 'codex-acp': 'dist/index.js' },
      dependencies: { '@openai/codex': '^0.165.0', zod: '^4' },
    })
  );
  writeFileSync(join(pkg, 'dist', 'index.js'), entrySource);
  writeFileSync(join(pkg, 'LICENSE'), 'Apache');
  writeFileSync(join(pkg, 'README.md'), 'readme');
  return studio;
}

const SELF_CONTAINED =
  "import { spawn } from 'node:child_process';\nconst fs = require(\"fs\");\nimport('node:os');\n";

test('nonBuiltinImports: builtins pass, a bare package does not', () => {
  assert.deepEqual(nonBuiltinImports(SELF_CONTAINED), []);
  assert.deepEqual(
    nonBuiltinImports(
      `${SELF_CONTAINED}import { z } from "zod";\nrequire('@openai/codex/bin/codex.js')`
    ),
    ['@openai/codex/bin/codex.js', 'zod']
  );
  // relative imports are the bundle's own business
  assert.deepEqual(nonBuiltinImports("import x from './chunk.js'"), []);
});

test('stageCodexAdapter ships the entry, LICENSE and a trimmed package.json only', () => {
  const studio = fakeStudio(SELF_CONTAINED);
  const out = join(tmp, `out-${n}`);
  const r = stageCodexAdapter(studio, out);
  const dst = join(out, 'node_modules', CODEX_ADAPTER_PKG);
  assert.equal(r.version, '9.9.9');
  assert.ok(existsSync(join(dst, 'dist', 'index.js')));
  assert.ok(existsSync(join(dst, 'LICENSE')));
  assert.ok(!existsSync(join(dst, 'README.md')));
  assert.ok(!existsSync(join(dst, 'node_modules')), 'no node_modules staged');
  const pkg = JSON.parse(readFileSync(join(dst, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.bin, { 'codex-acp': 'dist/index.js' });
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined, 'the staged manifest claims no deps');
  assert.deepEqual(checkStagedCodexAdapter(join(out, 'node_modules')), []);
});

test('stageCodexAdapter refuses a release that is no longer self-contained', () => {
  const studio = fakeStudio(`${SELF_CONTAINED}import { z } from 'zod';`);
  assert.throws(() => stageCodexAdapter(studio, join(tmp, `out-${n}`)), /self-contained.*zod/);
});

test('stageCodexAdapter fails loud when the adapter is not installed', () => {
  assert.throws(() => stageCodexAdapter(join(tmp, 'empty'), join(tmp, 'out-x')), /not installed/);
});

test('checkStagedCodexAdapter flags @openai/codex anywhere in the staged tree', () => {
  const studio = fakeStudio(SELF_CONTAINED);
  const out = join(tmp, `out-${n}`);
  stageCodexAdapter(studio, out);
  const nm = join(out, 'node_modules');
  mkdirSync(join(nm, 'some-pkg', 'node_modules', '@openai', 'codex-darwin-arm64'), {
    recursive: true,
  });
  const problems = checkStagedCodexAdapter(nm);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /@openai\/codex staged: .*codex-darwin-arm64/);
});

test('checkStagedCodexAdapter flags a missing adapter and an adapter with node_modules', () => {
  assert.match(checkStagedCodexAdapter(join(tmp, 'nothing')).join(), /not staged/);
  const studio = fakeStudio(SELF_CONTAINED);
  const out = join(tmp, `out-${n}`);
  stageCodexAdapter(studio, out);
  mkdirSync(join(out, 'node_modules', CODEX_ADAPTER_PKG, 'node_modules'));
  assert.match(checkStagedCodexAdapter(join(out, 'node_modules')).join(), /own node_modules/);
});

test('the pinned codex-acp release is self-contained and @openai/codex is overridden away', (t) => {
  const studioPkg = JSON.parse(readFileSync(join(REPO, 'apps/studio/package.json'), 'utf8'));
  assert.match(studioPkg.dependencies[CODEX_ADAPTER_PKG], /^\d+\.\d+\.\d+$/, 'pinned exactly');
  assert.ok(studioPkg.overrides?.['@openai/codex'], 'bun override drops @openai/codex');
  assert.match(
    readFileSync(join(REPO, 'pnpm-workspace.yaml'), 'utf8'),
    /overrides:\n\s+'@openai\/codex': '-'/,
    'pnpm override drops @openai/codex'
  );
  const entry = join(REPO, 'apps/studio/node_modules', CODEX_ADAPTER_PKG, 'dist', 'index.js');
  if (!existsSync(entry)) return t.skip('apps/studio deps not installed');
  assert.deepEqual(nonBuiltinImports(readFileSync(entry, 'utf8')), []);
});

test('the Codex adapter smoke reads stderr too (the adapter reports a failed spawn there, exit 0)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../../apps/desktop/scripts/check-bundle-completeness.mjs', import.meta.url),
    'utf8'
  );
  const smoke = src.slice(
    src.indexOf("const sentinel = '/nonexistent/maude-smoke-codex'"),
    src.indexOf("fail('Codex adapter smoke'")
  );
  assert.match(smoke, /spawnSync\(runtimeFound/);
  assert.match(smoke, /r\.stderr/);
  assert.doesNotMatch(smoke, /execFileSync\(runtimeFound/);
});
