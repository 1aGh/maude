// The Phase 8 gate evidence is a file anyone with write access can author — it must never run a
// command and never count when its claims don't hold (security review, Phase 1 gate).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = new URL('../..', import.meta.url).pathname;
const run = (dir) =>
  spawnSync('node', ['scripts/v2-gates.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, V2_GATES_EVIDENCE_DIR: dir },
  }).stdout;
const line = (out, id) => out.split('\n').find((l) => l.includes(` ${id} `)) ?? '';
const HEAD = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

test('a planted head never reaches a shell, and a symbolic head is not fresh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-gates-'));
  const marker = join(dir, 'pwned');
  try {
    writeFileSync(
      join(dir, 'V2-8.1.json'),
      JSON.stringify({ pass: true, head: `HEAD; touch ${marker}` })
    );
    writeFileSync(join(dir, 'V2-8.2.json'), JSON.stringify({ pass: true, head: 'HEAD' }));
    const out = run(dir);
    assert.equal(existsSync(marker), false);
    assert.match(line(out, 'V2-8.1'), /^FAIL .*stale — head is not a full commit sha/);
    assert.match(line(out, 'V2-8.2'), /^FAIL .*stale — head is not a full commit sha/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('evidence for another command, or without the quality hash, is stale', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-gates-'));
  try {
    writeFileSync(
      join(dir, 'V2-8.2.json'),
      JSON.stringify({ pass: true, head: HEAD, cmd: 'true' })
    );
    assert.match(line(run(dir), 'V2-8.2'), /stale — the quality gate definitions changed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an attested report edited afterwards no longer counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-gates-'));
  try {
    writeFileSync(
      join(dir, 'V2-8.15.json'),
      JSON.stringify({
        pass: true,
        head: HEAD,
        reports: ['package.json'],
        reportHashes: { 'package.json': 'deadbeef' },
      })
    );
    assert.match(line(run(dir), 'V2-8.15'), /^FAIL .*stale/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
