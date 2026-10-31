// p8-comment-gate (final-3 defender I6 + attacker I4) — the V2-8.4 rig wipes only a throwaway run dir, and
// the hour-long wildcard admin token it mints in the local cell does not outlive the switch it is for.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { runDirRefusal } from '../v2-verify/p84-run-dir.mjs';

const REPO = resolve(new URL('../../', import.meta.url).pathname);
const o = { home: homedir(), repo: REPO };

test('refused: /, $HOME, the repo, their ancestors, a shallow path, outside a throwaway root', () => {
  for (const bad of [
    '/',
    homedir(),
    REPO,
    resolve(REPO, '..'),
    '/tmp',
    '/private/tmp',
    '/Users',
    '',
    '.',
  ])
    assert.ok(runDirRefusal(bad, o), `should refuse ${JSON.stringify(bad)}`);
  assert.match(runDirRefusal(join(REPO, 'apps', 'x-run'), o), /throwaway root/);
  assert.match(runDirRefusal(join(homedir(), 'p84-run'), o), /throwaway root/);
});

test('accepted: a new or previous-run dir under the temp dir, /tmp or .ai/device', () => {
  const base = mkdtempSync(join(tmpdir(), 'p84-guard-'));
  try {
    assert.equal(runDirRefusal(join(base, 'run'), o), null);
    assert.equal(runDirRefusal(join(REPO, '.ai', 'device', 'p84', 'run'), o), null);
    const prev = join(base, 'prev');
    mkdirSync(join(prev, 'home'), { recursive: true });
    writeFileSync(join(prev, 'rig.json'), '{}');
    assert.equal(runDirRefusal(prev, o), null);
    mkdirSync(join(base, 'empty'));
    assert.equal(runDirRefusal(join(base, 'empty'), o), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('refused: a non-empty dir that is not a rig run, a file, a symlink, a symlinked parent out of the root', () => {
  const base = mkdtempSync(join(tmpdir(), 'p84-guard-'));
  try {
    const other = join(base, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'notes.txt'), 'keep me');
    assert.match(runDirRefusal(other, o), /does not look like a previous rig run/);
    writeFileSync(join(base, 'file'), 'x');
    assert.match(runDirRefusal(join(base, 'file'), o), /not a directory/);
    symlinkSync(other, join(base, 'link'));
    assert.match(runDirRefusal(join(base, 'link'), o), /symlink/);
    symlinkSync(homedir(), join(base, 'home-link'));
    assert.ok(
      runDirRefusal(join(base, 'home-link', 'p84-run'), o),
      'a parent symlink to $HOME is resolved'
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('p84-up.mjs checks the run dir before it wipes it, and revokes its admin token', () => {
  const src = readFileSync(new URL('../v2-verify/p84-up.mjs', import.meta.url), 'utf8');
  const guard = src.indexOf('runDirRefusal(');
  const wipe = src.indexOf('rmSync(RUN');
  assert.ok(guard > 0 && wipe > guard, 'runDirRefusal runs before rmSync(RUN)');
  assert.match(src, /removeToken\(join\(cellDir, 'data'\), 'p84-owner-switch'\)/);
  const mint = src.indexOf("label: 'p84-owner-switch'");
  assert.ok(src.indexOf('finally', mint) > mint, 'the revoke runs in a finally after the mint');
});
