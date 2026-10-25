// V2-8.0 — the dead-module check (scripts/check-v2-dead-modules.mjs) on a planted tree:
// a module no entry reaches is reported, an allow-listed one (with a reason) is not, and
// every way a module can be reached without a static import still counts as reached.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-v2-dead-modules.mjs');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function plant(files, allow) {
  const root = mkdtempSync(join(tmpdir(), 'dead-modules-'));
  dirs.push(root);
  const all = { ...files };
  if (allow) all['scripts/v2-dead-modules.allow.json'] = JSON.stringify(allow);
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}
const run = (root) => spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
const S = 'apps/studio';

const LIVE = {
  [`${S}/server.ts`]: [
    "import './live.ts';",
    "import { x } from './ds/index.ts';",
    "const f = join(ROOT, 'ds', 'board', 'index.tsx');",
    "const w = new URL('./worker.ts', import.meta.url);",
    "const css = '/_client/overlay.css';",
    'export { x, f, w, css };',
  ].join('\n'),
  [`${S}/live.ts`]: "import './deep.tsx';\n",
  [`${S}/deep.tsx`]: 'export const d = 1;\n',
  [`${S}/ds/index.ts`]: 'export const x = 1;\n',
  [`${S}/ds/board/index.tsx`]: 'export const b = 1;\n',
  [`${S}/worker.ts`]: 'export const w = 1;\n',
  [`${S}/client/overlay.css`]: '.a{}\n',
  [`${S}/bin/helper.mjs`]: "import '../via-bin.ts';\n",
  [`${S}/via-bin.ts`]: 'export const v = 1;\n',
  'cli/lib/uses-studio.mjs': "import '../../apps/studio/via-cli.ts';\n",
  [`${S}/via-cli.ts`]: 'export const c = 1;\n',
};

test('a clean tree passes and says how many modules it saw', () => {
  const r = run(plant(LIVE));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 dead of 10/);
});

test('a planted dead module is reported and fails the run', () => {
  const r = run(plant({ ...LIVE, [`${S}/orphan.ts`]: 'export const o = 1;\n' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /dead module: apps\/studio\/orphan\.ts/);
});

test('a module only a test reaches is dead; the test itself is not a module', () => {
  const r = run(
    plant({
      ...LIVE,
      [`${S}/only-tested.ts`]: 'export const t = 1;\n',
      [`${S}/test/only-tested.test.ts`]: "import '../only-tested.ts';\n",
    })
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /only-tested\.ts/);
  assert.doesNotMatch(r.stderr, /only-tested\.test/);
});

test('a path named only in a comment does not keep a module alive', () => {
  const r = run(
    plant({
      ...LIVE,
      [`${S}/commented.ts`]: 'export const c = 1;\n',
      [`${S}/live.ts`]:
        "// see './commented.ts'\n/*\n * and `commented.ts` again\n */\nimport './deep.tsx';\n",
    })
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /commented\.ts/);
});

test('an allow-listed dead module with a reason passes', () => {
  const files = { ...LIVE, [`${S}/orphan.ts`]: 'export const o = 1;\n' };
  const r = run(plant(files, { [`${S}/orphan.ts`]: 'pinned by a test' }));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 allow-listed/);
});

test('an allow-list entry without a reason fails', () => {
  const files = { ...LIVE, [`${S}/orphan.ts`]: 'export const o = 1;\n' };
  const r = run(plant(files, { [`${S}/orphan.ts`]: '  ' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /without a reason/);
});

test('a stale allow-list entry (module is reached or gone) fails', () => {
  const r = run(plant(LIVE, { [`${S}/live.ts`]: 'once dead' }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not dead any more/);
});
