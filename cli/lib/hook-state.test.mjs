// #164 F8 + D7 — hook-state.mjs hardening: the temp write never follows a planted link, a symlinked
// target is refused, the base dir is tightened to 0700 on every open, and pruning removes the empty
// session folders and a stale lane cache it leaves behind.
//
// Run: node --test cli/lib/hook-state.test.mjs

import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import {
  bashStatePath,
  hookStateDir,
  lanesCachePath,
  pruneStates,
  readState,
  writeState,
} from './hook-state.mjs';

let scratch;
let env;
before(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'maude-hs-hard-')));
  env = { MAUDE_HOOK_STATE_HOME: join(scratch, 'home') };
});
after(() => rmSync(scratch, { recursive: true, force: true }));

describe('writeState (F8)', () => {
  test('a symlink planted at the temp name is not followed', () => {
    const p = bashStatePath('/r1', 's', 'tool1', env);
    mkdirSync(join(p, '..'), { recursive: true });
    const victim = join(scratch, 'victim.txt');
    writeFileSync(victim, 'keep');
    symlinkSync(victim, `${p}.${process.pid}.tmp`);
    writeState(p, { v: 1 }, env);
    assert.equal(readFileSync(victim, 'utf8'), 'keep');
    assert.deepEqual(readState(p), { v: 1 });
    assert.equal(lstatSync(p).isSymbolicLink(), false);
  });

  test('a symlinked target is refused, and what it points at is left alone', () => {
    const p = bashStatePath('/r2', 's', 'tool2', env);
    mkdirSync(join(p, '..'), { recursive: true });
    const victim = join(scratch, 'victim2.txt');
    writeFileSync(victim, 'keep');
    symlinkSync(victim, p);
    assert.throws(() => writeState(p, { v: 1 }, env));
    assert.equal(readFileSync(victim, 'utf8'), 'keep');
  });
});

describe('writeState (D7)', () => {
  test('the base dir and the root dir are tightened to 0700 on every open', () => {
    const home = join(scratch, 'loose');
    const e = { MAUDE_HOOK_STATE_HOME: home };
    mkdirSync(home, { mode: 0o755 });
    chmodSync(home, 0o755);
    const p = bashStatePath('/r3', 's', 'tool3', e);
    mkdirSync(hookStateDir('/r3', e), { recursive: true, mode: 0o755 });
    chmodSync(hookStateDir('/r3', e), 0o755);
    writeState(p, { v: 1 }, e);
    assert.equal(statSync(home).mode & 0o777, 0o700);
    assert.equal(statSync(hookStateDir('/r3', e)).mode & 0o777, 0o700);
    assert.equal(statSync(p).mode & 0o777, 0o600);
  });
});

describe('pruneStates (D7)', () => {
  test('removes empty session dirs and a stale lanes.json, keeps a fresh state', () => {
    const e = { MAUDE_HOOK_STATE_HOME: join(scratch, 'prune') };
    const root = '/r4';
    const old = new Date(Date.now() - 3 * 24 * 3_600_000);
    const stale = bashStatePath(root, 'gone', 'a', e);
    const fresh = bashStatePath(root, 'live', 'b', e);
    writeState(stale, { v: 1 }, e);
    writeState(fresh, { v: 1 }, e);
    writeState(lanesCachePath(root, e), { v: 1, files: {} }, e);
    utimesSync(stale, old, old);
    utimesSync(lanesCachePath(root, e), old, old);
    utimesSync(join(stale, '..'), old, old);
    utimesSync(join(stale, '..', '..'), old, old);
    pruneStates(root, 24 * 3_600_000, e);
    assert.equal(existsSync(stale), false);
    assert.equal(existsSync(join(stale, '..', '..')), false, 'the emptied session dir is gone');
    assert.equal(existsSync(lanesCachePath(root, e)), false, 'a stale lane cache is dropped');
    assert.equal(existsSync(fresh), true);
  });
});
