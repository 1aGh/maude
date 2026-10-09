// `maude migrate v2` — the CLI shim (V2-1.12 §5.10): usage, exit codes passed
// through, the dry run as JSON, `--apply` writing the marker.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const MAUDE = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'maude.mjs');
const env = { ...process.env, MAUDE_NO_UPDATE_CHECK: '1', NO_UPDATE_NOTIFIER: '1' };
const maude = (...args) => spawnSync(process.execPath, [MAUDE, ...args], { encoding: 'utf8', env });
const hasBun = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;

function project() {
  const repo = mkdtempSync(join(tmpdir(), 'maude-migrate-cli-'));
  mkdirSync(join(repo, '.design'), { recursive: true });
  writeFileSync(join(repo, '.design', 'config.json'), '{\n  "name": "cli-test"\n}\n');
  return repo;
}

test('usage: no `v2` → exit 2 with the usage line', () => {
  const r = maude('migrate');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: maude migrate v2/);
});

test('dry run --json → exit 0 and the report; nothing written', { skip: !hasBun }, () => {
  const repo = project();
  try {
    const r = maude('migrate', 'v2', '--json', '--root', repo);
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.format, 'maude.migrate-report');
    assert.equal(report.dryRun, true);
    assert.equal(
      JSON.parse(readFileSync(join(repo, '.design', 'config.json'), 'utf8')).formatVersion,
      undefined
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('--apply writes the marker; a second run exits 10; --strip without --reverse is usage', {
  skip: !hasBun,
}, () => {
  const repo = project();
  try {
    const a = maude('migrate', 'v2', '--apply', '--root', repo);
    assert.equal(a.status, 0, a.stderr);
    assert.equal(
      readFileSync(join(repo, '.design', 'config.json'), 'utf8'),
      '{\n  "formatVersion": 2,\n  "name": "cli-test"\n}\n'
    );
    assert.equal(maude('migrate', 'v2', '--apply', '--root', repo).status, 10);
    assert.equal(maude('migrate', 'v2', '--strip', '--root', repo).status, 2);
    const rev = maude('migrate', 'v2', '--reverse', '--apply', '--root', repo);
    assert.equal(rev.status, 0, rev.stderr);
    assert.equal(
      readFileSync(join(repo, '.design', 'config.json'), 'utf8'),
      '{\n  "name": "cli-test"\n}\n'
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
