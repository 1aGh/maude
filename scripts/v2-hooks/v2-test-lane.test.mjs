// Tests for scripts/v2-test-lane.sh (plan V2-0.0 "Single test lane"), run in a throwaway git repo.
//   node --test scripts/v2-hooks/v2-test-lane.test.mjs

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let root;
const dirs = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'v2-lane-'));
  dirs.push(root);
  mkdirSync(join(root, 'scripts'));
  copyFileSync(join(REPO, 'scripts/v2-test-lane.sh'), join(root, 'scripts/v2-test-lane.sh'));
  mkdirSync(join(root, 'apps/studio/dist'), { recursive: true });
  writeFileSync(join(root, 'apps/studio/dist/client.bundle.js'), 'release\n');
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
});
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const lane = (args) =>
  spawnSync('bash', [join(root, 'scripts/v2-test-lane.sh'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });

test('passes the command exit code through and releases the lock', () => {
  assert.equal(lane(['--', 'bash', '-c', 'exit 3']).status, 3);
  assert.equal(existsSync(join(root, '.git/v2-test.lock')), false);
});

test('a run that clobbers a tracked dist file gets it reverted', () => {
  const r = lane(['--', 'bash', '-c', 'echo dev-bundle > apps/studio/dist/client.bundle.js']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /reverted 1 tracked dist file/);
  assert.equal(readFileSync(join(root, 'apps/studio/dist/client.bundle.js'), 'utf8'), 'release\n');
});

test('--keep-dist leaves the change in place', () => {
  lane(['--keep-dist', '--', 'bash', '-c', 'echo dev > apps/studio/dist/client.bundle.js']);
  assert.equal(readFileSync(join(root, 'apps/studio/dist/client.bundle.js'), 'utf8'), 'dev\n');
});

test('dist already dirty before the run is never reverted', () => {
  writeFileSync(join(root, 'apps/studio/dist/client.bundle.js'), 'mine\n');
  const r = lane(['--', 'bash', '-c', 'echo theirs > apps/studio/dist/client.bundle.js']);
  assert.match(r.stderr, /already dirty/);
  assert.equal(readFileSync(join(root, 'apps/studio/dist/client.bundle.js'), 'utf8'), 'theirs\n');
});

test('a second run cannot take a held lane', async () => {
  const holder = spawn('bash', [join(root, 'scripts/v2-test-lane.sh'), '--', 'sleep', '3'], {
    cwd: root,
  });
  for (let i = 0; i < 40 && !existsSync(join(root, '.git/v2-test.lock')); i++)
    await new Promise((r) => setTimeout(r, 50));
  const r = lane(['--wait', '0', '--', 'true']);
  assert.equal(r.status, 75);
  assert.match(r.stderr, /lane busy/);
  holder.kill();
  await new Promise((r) => holder.on('exit', r));
});

test('a worktree shares the main checkout lock', () => {
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  git('worktree', 'add', '-q', join(root, 'wt'), '-b', 'lane');
  const holder = spawnSync(
    'bash',
    [
      '-c',
      `${join(root, 'wt/scripts/v2-test-lane.sh')} --wait 0 -- bash -c 'ls ${join(root, '.git/v2-test.lock')}'`,
    ],
    { cwd: join(root, 'wt'), encoding: 'utf8' }
  );
  assert.equal(holder.status, 0, holder.stderr);
});

test('a stale lock (dead pid) is taken over', () => {
  writeFileSync(join(root, '.git/v2-test.lock'), '999999\t2026-01-01\told run\n');
  const r = lane(['--wait', '0', '--', 'true']);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /stale lock/);
});

const HOST = (spawnSync('hostname', ['-s'], { encoding: 'utf8' }).stdout ?? '').replace(
  /[^A-Za-z0-9-]/g,
  ''
);
const Q = () => join(root, `.git/v2-test.queue.${HOST || 'host'}`);

test('waiters are served in arrival order — an older live ticket goes first', async () => {
  const older = spawn('sleep', ['5']);
  mkdirSync(Q(), { recursive: true });
  writeFileSync(join(Q(), `1000000000.${older.pid}`), '');
  const r = lane(['--wait', '1', '--', 'true']);
  assert.equal(r.status, 75, 'the lane is free but an older waiter is queued');
  assert.match(r.stderr, /queued behind 1000000000\./);
  older.kill();
  await new Promise((res) => older.on('exit', res));
  const r2 = lane(['--wait', '2', '--', 'true']);
  assert.equal(r2.status, 0, 'a dead waiter’s ticket is dropped');
  assert.equal(existsSync(join(Q(), `1000000000.${older.pid}`)), false);
});

test('a forged ticket (pid 0, -1, or not <epoch>.<pid>) never stalls the lane', () => {
  mkdirSync(Q(), { recursive: true });
  for (const n of ['1.0', '1.1', '1.-1', 'junk']) writeFileSync(join(Q(), n), '');
  const r = lane(['--wait', '2', '--', 'true']);
  assert.equal(r.status, 0, r.stderr);
  for (const n of ['1.0', '1.1', '1.-1', 'junk']) assert.equal(existsSync(join(Q(), n)), false);
});
