// The guard `npm test` preloads: a test file that exits with code 0 before its
// tests finish must FAIL the run (see early-exit-guard.mjs).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./fixtures/early-exit.fixture.mjs', import.meta.url));
const guard = fileURLToPath(new URL('./early-exit-guard.mjs', import.meta.url));
// A top-level run of its own: inherited NODE_TEST_CONTEXT would make the nested
// runner report to THIS one instead of deciding its own exit status.
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const run = (args) =>
  spawnSync(process.execPath, ['--test', '--test-force-exit', ...args, fixture], {
    encoding: 'utf8',
    env,
  });

test('without the guard, a file that exits early is a shorter green run', () => {
  const r = run([]);
  assert.equal(r.status, 0, 'node alone does not notice');
  assert.doesNotMatch(r.stdout, /never reports/);
});

test('with the guard, the same file fails the run', () => {
  const r = run(['--import', guard]);
  assert.notEqual(r.status, 0, `the run must fail: ${r.stdout.slice(-400)}`);
  assert.match(r.stderr + r.stdout, /exited before its tests finished|fail 1/);
});
