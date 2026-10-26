// V2-8.3 (p8-e2e-specs-b): every desktop e2e spec session starts from a project nothing has opened.
//
// `restoreFixtureTree` puts the tracked tree back byte-exact but leaves `_*` alone (runtime state — it must not
// be touched under a running sidecar). Across sessions that state leaks: a canvas an earlier spec trashed comes
// back as an "In the trash" ghost beside the live one and the click opens the trashed copy read-only (the
// edit-artboards part 2 red: "the editing toolbar never mounted"). `resetFixtureRuntime` runs before the app
// launches, in `beforeSession`.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { resetFixtureRuntime } = await import(
  new URL('../../apps/desktop/e2e/helpers/fixture-tree.ts', import.meta.url).href
);

test('resetFixtureRuntime removes every `_*` entry of the design root and nothing tracked', () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-fixture-reset-'));
  try {
    mkdirSync(join(root, '_trash', '2026__ui-arrange-tsx'), { recursive: true });
    mkdirSync(join(root, '_canvas-state'));
    writeFileSync(join(root, '_canvas-state', 'ui-arrange.view.json'), '{}');
    writeFileSync(join(root, '_export-history.json'), '[]');
    mkdirSync(join(root, 'ui'));
    writeFileSync(join(root, 'ui', 'Smoke.tsx'), 'export default 1');
    writeFileSync(join(root, 'config.json'), '{}');
    writeFileSync(join(root, '.ignore-rules'), '_*\n');

    const removed = resetFixtureRuntime(root).sort();
    assert.deepEqual(removed, ['_canvas-state', '_export-history.json', '_trash']);
    assert.deepEqual(readdirSync(root).sort(), ['.ignore-rules', 'config.json', 'ui']);
    assert.ok(existsSync(join(root, 'ui', 'Smoke.tsx')));
    // idempotent, and a missing design root is not an error
    assert.deepEqual(resetFixtureRuntime(root), []);
    assert.deepEqual(resetFixtureRuntime(join(root, 'nope')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
