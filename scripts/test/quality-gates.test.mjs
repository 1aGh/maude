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
  // `pnpm test` runs package.json's `test` script, whose `node --test` globs reach plugins/ too
  // (plugins/flow/hooks since the flow refactor): a glob counts as its directory.
  if (/run: pnpm test\s*$/m.test(text)) {
    const script = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts?.test ?? '';
    for (const m of script.matchAll(/node --test ([^&|;]+)/g))
      for (const arg of m[1].trim().split(/\s+/))
        if (arg.startsWith('plugins/'))
          runs.push(arg.includes('*') ? arg.slice(0, arg.lastIndexOf('/')) : arg);
  }
  const unrun = files.filter(
    (f) =>
      !runs.some((r) => !r.startsWith('-') && (f === r || f.startsWith(`${r.replace(/\/$/, '')}/`)))
  );
  assert.deepEqual(unrun, [], 'add a `bun test <dir>` step to quality.yml for these');
});

// S10.13 (S10 Q4) — both in-repo design systems stay at schema level 0. S2.8-style token work edits
// colors_and_type.css; one that skips `ds-check --emit` turns `manifest-stale` (level 10) red — here, in the
// PR, instead of at the next release. The local `tokens` gate and the CI step name the same two systems.
test('quality.yml checks the two in-repo design systems at level 0', () => {
  assert.match(
    text,
    /run:\s*node cli\/bin\/maude\.mjs design ds-check maude maude-v2\s*$/m,
    'quality.yml needs a step: node cli/bin/maude.mjs design ds-check maude maude-v2'
  );
});

test('the local `tokens` gate runs the same check', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, '.ai', 'workflows.config.json'), 'utf8'));
  assert.match(cfg.quality.tokens, /design ds-check maude maude-v2/);
});
