// quality.yml's gates gate (V2-2.13).
//
// The full studio suite ran with `continue-on-error: true` until its clean-CI
// history named the quarantine list — and the list came back EMPTY (16 green
// main pushes in a row, every earlier failure fixed; see the job's comment).
// A job that cannot fail is a report, not a gate, and it is one line to put
// back. This keeps it out: a flaky test gets fixed or quarantined BY NAME, the
// job stays blocking.
//
// QUALITY_WORKFLOW_UNDER_TEST=<file> points it at another copy (how the
// red-first run proved it fails on the pre-V2-2.13 workflow).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = process.env.QUALITY_WORKFLOW_UNDER_TEST
  ? resolve(process.env.QUALITY_WORKFLOW_UNDER_TEST)
  : join(ROOT, '.github', 'workflows', 'quality.yml');
const text = readFileSync(FILE, 'utf8');

/** Non-comment `continue-on-error: true` lines, with their line numbers. */
const nonBlocking = text
  .split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => !/^\s*#/.test(line) && /continue-on-error:\s*true/.test(line));

test('no quality.yml job or step is continue-on-error', () => {
  assert.deepEqual(
    nonBlocking.map(({ n, line }) => `quality.yml:${n}: ${line.trim()}`),
    [],
    'a quality.yml gate cannot be made non-blocking — fix the flaky test or quarantine it by name in the studio-suite comment'
  );
});

test('the studio-suite job runs the FULL suite', () => {
  assert.match(text, /^ {2}studio-suite:\n/m, 'the studio-suite job is gone');
  assert.match(text, /bun test --isolate --timeout 20000\)/, 'the full-suite invocation changed');
  assert.match(text, /name: Studio suite \(full\)\n/);
});

// V2-2.4b — a test under plugins/ is reached by neither `cli/**/*.test.mjs` (pnpm test) nor the
// studio suite (apps/studio). Each such file needs its own `bun test <dir>` step here, or it
// guards nothing in CI (the design plugin's hooks.test.mjs sat unrun until this).
test('every plugins/ test file is run by a quality.yml step', () => {
  const files = execFileSync('git', ['ls-files', 'plugins/**/*.test.mjs', 'plugins/**/*.test.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length > 0, 'no plugins/ test files found — the glob is stale');
  const runs = [...text.matchAll(/bun test ([^\n)&|;]+)/g)].flatMap((m) =>
    m[1].trim().split(/\s+/)
  );
  const unrun = files.filter(
    (f) =>
      !runs.some((r) => !r.startsWith('-') && (f === r || f.startsWith(`${r.replace(/\/$/, '')}/`)))
  );
  assert.deepEqual(unrun, [], 'add a `bun test <dir>` step to quality.yml for these');
});
