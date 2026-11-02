// p8-hub-folder-boundary (decision maude/v2-michal-hub-is-the-folder-boundary-before-config,
// option A). Until the owner declares canvas folders — no usable `canvasGroups` in the checkout's
// `.design/config.json` — the hub is the folder boundary: the kernel takes any folder
// (`allowUndeclaredGroup: !groups || groups.length === 0`), so the file classifier must class a
// kernel-accepted path as a canvas too. Before this, `components/x.tsx` became `code-module` — a
// teammate's content in the owner-only, importable class (final security pair, defender I2 /
// attacker L2). Once the owner declares groups they rule, exactly as before.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { checkoutFileClass, listProjectFiles, readCanvasGroups } from '../src/file-manifest.mjs';
import { classifyProjectFile } from '../src/file-membership.mjs';

function checkout(config) {
  const root = mkdtempSync(join(tmpdir(), 'hub-boundary-'));
  for (const d of ['components', 'screens', 'system/ds/preview', 'ui']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  writeFileSync(join(root, 'components/x.tsx'), 'export default () => null;\n');
  writeFileSync(join(root, 'screens/home.tsx'), 'export default () => null;\n');
  writeFileSync(join(root, 'system/ds/preview/_brand-css.ts'), 'export const css = "";\n');
  writeFileSync(join(root, 'components/util.ts'), 'export const u = 1;\n');
  if (config !== undefined) writeFileSync(join(root, 'config.json'), JSON.stringify(config));
  return root;
}

test('readCanvasGroups: null when the checkout declares no usable group (the kernel rule)', (t) => {
  for (const cfg of [undefined, {}, { canvasGroups: [] }, { canvasGroups: [{ label: 'x' }] }]) {
    const root = checkout(cfg);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    assert.equal(readCanvasGroups(root), null, JSON.stringify(cfg ?? 'no config'));
  }
  const root = checkout({ canvasGroups: [{ label: 'Screens', path: 'screens' }] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readCanvasGroups(root), [{ label: 'Screens', path: 'screens' }]);
});

test("no config: a teammate's components/x.tsx is a canvas, not owner-only code", (t) => {
  const root = checkout(undefined);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(checkoutFileClass('components/x.tsx', root), 'canvas-owned');
  assert.equal(checkoutFileClass('screens/home.tsx', root), 'canvas-owned');
  // genuinely code stays code
  assert.equal(checkoutFileClass('components/util.ts', root), 'code-module');
  assert.equal(checkoutFileClass('system/ds/preview/_brand-css.ts', root), 'code-module');
  // the file plane never offers a canvas body (it is Plane A's)
  const listed = listProjectFiles(root).files.map((f) => f.path);
  assert.ok(!listed.includes('components/x.tsx'), listed.join(','));
  assert.ok(listed.includes('components/util.ts'), listed.join(','));
});

test('declared groups rule: an undeclared folder keeps the code-module class', (t) => {
  const root = checkout({ canvasGroups: [{ label: 'Screens', path: 'screens' }] });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(checkoutFileClass('screens/home.tsx', root), 'canvas-owned');
  assert.equal(checkoutFileClass('components/x.tsx', root), 'code-module');
  assert.ok(listProjectFiles(root).files.some((f) => f.path === 'components/x.tsx'));
});

test('absent groups (no opts) keep the default set — only null means undeclared', () => {
  assert.equal(classifyProjectFile('components/x.tsx'), 'code-module');
  assert.equal(classifyProjectFile('components/x.tsx', { canvasGroups: null }), 'canvas-owned');
  assert.equal(classifyProjectFile('x.tsx', { canvasGroups: null }), 'code-module');
});
