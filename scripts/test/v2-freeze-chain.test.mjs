// #171 gate tooling: the V2-8.1 chain a freeze records runs the nothing-deleted audit and checks that the
// committed dist/styles.css is what its sources build (the client bundle's freshness has its own gate in the
// e2e lane; the stylesheet had none, so a CSS edit without the release rebuild shipped the old one).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildStyles, staleStyles } from '../check-v2-styles-fresh.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/check-v2-styles-fresh.mjs');
const GATES = join(ROOT, 'scripts/v2-gates.mjs');

function studio(css) {
  const dir = mkdtempSync(join(tmpdir(), 'styles-fresh-'));
  mkdirSync(join(dir, 'client/styles'), { recursive: true });
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'client/styles/_index.css'), css);
  return dir;
}

test('a stylesheet built from the sources is fresh', () => {
  const dir = studio('@layer base { :root { --x: 1; } a { color: red; } }\n');
  try {
    writeFileSync(join(dir, 'dist/styles.css'), buildStyles(dir));
    assert.equal(staleStyles(dir), null);
    const run = spawnSync('node', [SCRIPT, '--studio', dir], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a source edit without the rebuild is stale, and the script exits 1 naming the rebuild', () => {
  const dir = studio('a { color: red; }\n');
  try {
    writeFileSync(join(dir, 'dist/styles.css'), buildStyles(dir));
    writeFileSync(join(dir, 'client/styles/_index.css'), 'a { color: blue; }\n');
    assert.match(staleStyles(dir), /is not what its sources build/);
    const run = spawnSync('node', [SCRIPT, '--studio', dir], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /build\.ts --release/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing dist/styles.css is stale', () => {
  const dir = studio('a { color: red; }\n');
  try {
    assert.match(staleStyles(dir), /missing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed dist/styles.css is fresh against the real sources', () => {
  assert.equal(staleStyles(join(ROOT, 'apps/studio')), null);
});

test('the V2-8.1 gate command runs the nothing-deleted audit and the styles freshness check', () => {
  const run = spawnSync('node', [GATES, '--cmd', 'V2-8.1'], { encoding: 'utf8', cwd: ROOT });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /node scripts\/check-v2-nothing-deleted\.mjs/);
  assert.match(run.stdout, /node scripts\/check-v2-styles-fresh\.mjs/);
});
