// #171 (T8.2) — the Mac mini cannot run the desktop e2e lane, and `scripts/remote-lane.sh` says so up front.
//
// Why it cannot (checked on the mini 2026-11-08):
//   - the lane drives the debug `Maude.app` (Tauri + WKWebView) through WebDriver, and the mini has no Rust
//     toolchain to build it (`cargo`/`rustc` absent; nothing may be brew-installed there);
//   - WebKit renders only for a visible window in an UNLOCKED GUI session: a locked or dark screen freezes
//     rAF and animations, so elements read "not displayed" and the reds are fake (memory
//     maude-webkit-locked-screen-invalid). The mini's console session was locked at the time of the check, and
//     a process started over ssh is not in that GUI session (the same wall `safaridriver` hit: its
//     authorisation is tied to the GUI session).
// So a run sent there would burn the slot and report a red that says nothing about the product. The script
// refuses the command line before it pushes anything; MAUDE_REMOTE_ALLOW_DESKTOP_E2E=1 is the door for the day the
// mini has the toolchain and an unlocked session. The script is run for real with its network stubbed out.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../remote-lane.sh', import.meta.url));

function run(argv, extraEnv = {}) {
  return spawnSync('bash', [FILE, '--', ...argv], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      MAUDE_REMOTE_HOST: 'remote-lane-test.invalid',
      GIT_SSH_COMMAND: 'false',
      ...extraEnv,
    },
  });
}

for (const argv of [
  ['pnpm', 'test:e2e:desktop:tabs'],
  ['pnpm', 'test:e2e:desktop'],
  ['bash', '-c', 'cd apps/desktop/e2e && pnpm wdio run wdio.tabs.conf.ts'],
  ['bash', '-c', 'pnpm test:e2e:desktop:build'],
  ['npx', 'wdio', 'run', 'apps/desktop/e2e/wdio.home.conf.ts'],
  ['cargo', 'tauri', 'build', '--debug'],
]) {
  test(`${argv.join(' ')} is refused: the mini cannot run the desktop lane`, () => {
    const r = run(argv);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /desktop e2e/i);
    assert.match(r.stderr, /unlocked/i);
  });
}

for (const argv of [
  ['bash', '-c', 'cd apps/studio && bun test --isolate'],
  ['pnpm', '--filter', '@maude/hub', 'test'],
  ['node', 'scripts/dev/shoot.mjs'],
]) {
  test(`${argv.join(' ')} is not mistaken for a desktop e2e run`, () => {
    const r = run(argv);
    assert.doesNotMatch(r.stderr, /desktop e2e/i, r.stderr);
  });
}

test('MAUDE_REMOTE_ALLOW_DESKTOP_E2E=1 lets the command through to the push (which this test stubs out)', () => {
  const r = run(['pnpm', 'test:e2e:desktop:tabs'], { MAUDE_REMOTE_ALLOW_DESKTOP_E2E: '1' });
  assert.doesNotMatch(r.stderr, /desktop e2e lane/i, r.stderr);
});
