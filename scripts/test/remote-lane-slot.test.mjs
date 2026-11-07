// #168 — `scripts/remote-lane.sh --slot` is validated against an allowlist before it reaches a path or a command.
// The slot becomes `$R/locks/slot$s`, `$R/slot$got` and an `rm -rf`, on the local side and again on the mini, so
// a value like `../x` or `1; cmd` must stop at the door. The script is run for real with its network stubbed out
// (`GIT_SSH_COMMAND=false`, an unresolvable host): a rejected slot exits 2 BEFORE any push is attempted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('../remote-lane.sh', import.meta.url));

function run(slot) {
  return spawnSync('bash', [FILE, '--slot', slot, '--', 'true'], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      MAUDE_REMOTE_HOST: 'remote-lane-test.invalid',
      GIT_SSH_COMMAND: 'false',
    },
  });
}

for (const bad of [
  '../x',
  '1; touch /tmp/pwned',
  '4',
  '0',
  '',
  '1 2',
  'AUTO',
  '$(id)',
  '-1',
  '1/..',
]) {
  test(`--slot ${JSON.stringify(bad)} is refused before anything is sent`, () => {
    const r = run(bad);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /--slot must be 1, 2, 3 or auto/);
    assert.doesNotMatch(r.stderr, /push to/, 'it never reached the push');
  });
}

for (const ok of ['1', '2', '3', 'auto']) {
  test(`--slot ${ok} passes validation (and only then fails at the unreachable host)`, () => {
    const r = run(ok);
    assert.doesNotMatch(r.stderr, /--slot must be/);
  });
}

test('the mini re-checks the slot it was handed, before it builds a path from it', () => {
  const src = readFileSync(FILE, 'utf8');
  const remote = src.slice(src.indexOf("<<'REMOTE'"), src.lastIndexOf('\nREMOTE\n'));
  const check = remote.search(/case "\$SLOT" in\s*\n?\s*1\|2\|3\|auto\)/);
  assert.ok(check >= 0, 'a case allowlist on $SLOT in the remote half');
  assert.ok(
    check < remote.indexOf('mkdir -p "$R/locks"'),
    'checked before the lock dir is touched'
  );
});
