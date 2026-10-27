// p8-secfix-f F3: the Mac mini remote lane runs its command under `env -i` with an allowlist, never
// in the mini owner's login env (tokens), HOME, ~/.config/maude or with the real signed-in claude
// reachable. The live proof is a lane run (see scripts/remote-lane.sh header); this pins the shape so
// a later edit cannot quietly drop back to the inherited env.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FILE =
  process.env.REMOTE_LANE_FILE ?? fileURLToPath(new URL('../remote-lane.sh', import.meta.url));
const src = readFileSync(FILE, 'utf8');
const remote = src.slice(src.indexOf("<<'REMOTE'"), src.lastIndexOf('\nREMOTE\n'));
const sandbox = /SANDBOX=\(env -i\n([\s\S]*?)\)\n/.exec(remote)?.[1] ?? '';
const vars = [...sandbox.matchAll(/"?([A-Za-z_][A-Za-z0-9_]*)=/g)].map((m) => m[1]);

test('the slot command and the dep install run under the env -i allowlist', () => {
  assert.ok(sandbox, 'a SANDBOX=(env -i …) array');
  assert.match(remote, /nice -n 10 "\$\{SANDBOX\[@\]\}" bash -c "\$CMD"/);
  assert.match(remote, /sb pnpm install/);
  assert.match(remote, /sb bun install/);
});

test('the allowlist is exactly the basics, a slot-local home and the caches', () => {
  assert.deepEqual(vars.sort(), [
    'BUN_INSTALL_CACHE_DIR',
    'GIT_CONFIG_GLOBAL',
    'HOME',
    'HUBS_CONFIG_PATH',
    'LANG',
    'MAUDE_CLAUDE_BIN',
    'MAUDE_CLOUD_CONFIG',
    'MAUDE_NO_AUTOBUILD',
    'NO_OPEN',
    'PATH',
    'PLAYWRIGHT_BROWSERS_PATH',
    'TMPDIR',
    'XDG_CONFIG_HOME',
    'npm_config_cache',
    'npm_config_devdir',
    'npm_config_store_dir',
  ]);
  for (const v of ['HOME', 'XDG_CONFIG_HOME', 'TMPDIR', 'MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH'])
    assert.match(sandbox, new RegExp(`"${v}=\\$H[/"]`), `${v} lives under the slot home`);
  assert.match(remote, /H="\$D\/\.runner-home"/);
  assert.match(sandbox, /"PATH=\$H\/bin:/, 'the stub claude dir is first on PATH');
  assert.match(remote, /writeStubClaude/);
});
