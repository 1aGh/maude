// V2-8.3 (p8-e2e-specs-b): every desktop e2e spec session starts from a project nothing has opened.
//
// `restoreFixtureTree` puts the tracked tree back byte-exact but leaves `_*` alone (runtime state — it must not
// be touched under a running sidecar). Across sessions that state leaks: a canvas an earlier spec trashed comes
// back as an "In the trash" ghost beside the live one and the click opens the trashed copy read-only (the
// edit-artboards part 2 red: "the editing toolbar never mounted"). `resetFixtureRuntime` runs before the app
// launches, in `beforeSession`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

// p8-e2e-fix-r10: the tree baseline is what is on disk when a lane starts, so a file git does not track became part
// of it and was put back before every spec. A stale, gitignored `.claudeignore` in the main checkout's fixture (a
// sync-untrusted block a linked run wrote) made photo-per-use red there and never in a fresh worktree.
// `cleanFixtureUntracked` is `git clean -fdx` scoped to the fixture: untracked AND ignored files go, tracked
// files (edited or not) stay, nothing outside the fixture is touched.
test('cleanFixtureUntracked drops untracked and ignored files under the fixture only', async () => {
  const { cleanFixtureUntracked } = await import(
    new URL('../../apps/desktop/e2e/helpers/fixture-tree.ts', import.meta.url).href
  );
  const repo = mkdtempSync(join(tmpdir(), 'maude-fixture-clean-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: repo,
      stdio: 'pipe',
    });
  try {
    const fx = join(repo, 'fx', 'project');
    mkdirSync(join(fx, '.design', 'ui'), { recursive: true });
    writeFileSync(join(repo, '.gitignore'), '.claudeignore\n');
    writeFileSync(join(fx, '.design', '.gitignore'), '_*\n');
    writeFileSync(join(fx, '.design', 'ui', 'Smoke.tsx'), 'export default 1');
    writeFileSync(join(fx, '.design', 'config.json'), '{}');
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'fixture');
    // a run's leftovers: ignored (invisible to `git status`), untracked, runtime state
    writeFileSync(join(fx, '.claudeignore'), '# maude:sync-untrusted begin\n');
    writeFileSync(join(fx, '.design', 'ui', 'Stray.tsx'), 'export default 2');
    mkdirSync(join(fx, '.design', 'ui', 'extra'));
    writeFileSync(join(fx, '.design', 'ui', 'extra', 'Deep.tsx'), 'export default 3');
    writeFileSync(join(fx, '.design', '_sync.json'), '{}');
    // a tracked file a developer is editing stays as it is
    writeFileSync(join(fx, '.design', 'config.json'), '{"edited":true}');
    // outside the fixture: never touched
    writeFileSync(join(repo, '.claudeignore'), 'keep\n');
    writeFileSync(join(repo, 'outside.txt'), 'keep');

    const gone = cleanFixtureUntracked(fx).sort();
    assert.deepEqual(gone, [
      '.claudeignore',
      '.design/_sync.json',
      '.design/ui/Stray.tsx',
      '.design/ui/extra/',
    ]);
    assert.deepEqual(readdirSync(fx, { recursive: true }).sort(), [
      '.design',
      '.design/.gitignore',
      '.design/config.json',
      '.design/ui',
      '.design/ui/Smoke.tsx',
    ]);
    assert.ok(existsSync(join(repo, '.claudeignore')));
    assert.ok(existsSync(join(repo, 'outside.txt')));
    assert.equal(readFileSync(join(fx, '.design', 'config.json'), 'utf8'), '{"edited":true}');
    // idempotent; no fixture → nothing; not a git checkout → nothing
    assert.deepEqual(cleanFixtureUntracked(fx), []);
    assert.deepEqual(cleanFixtureUntracked(join(repo, 'nope')), []);
    const bare = mkdtempSync(join(tmpdir(), 'maude-fixture-nogit-'));
    try {
      writeFileSync(join(bare, 'x'), '1');
      assert.deepEqual(cleanFixtureUntracked(bare), []);
      assert.ok(existsSync(join(bare, 'x')));
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
