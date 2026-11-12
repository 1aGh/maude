// #226 — `maude codex` must not pay the Codex plugin-CLI sync on every launch.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { run as runCodexCommand } from '../../commands/codex.mjs';
import { syncCodexRuntime } from './codex-runtime.mjs';

/** A fake `codex` that logs every call and answers the JSON the sync reads. */
async function fakeCodex(dir, { sleepSeconds = 0 } = {}) {
  const log = join(dir, 'calls.log');
  const bin = join(dir, 'codex');
  await writeFile(
    bin,
    `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
${sleepSeconds ? `sleep ${sleepSeconds}` : ''}
case "$*" in
  "--version") echo "codex-cli 9.9.9" ;;
  "plugin marketplace list --json") echo '{"marketplaces":[]}' ;;
  "plugin list --json") echo '{"installed":[]}' ;;
  "mcp list --json") echo '[]' ;;
  *) echo '{}' ;;
esac
`
  );
  await chmod(bin, 0o755);
  return { bin, log };
}

async function world(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'maude-codex-226-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const codexHome = join(home, '.codex');
  const projectRoot = join(root, 'project');
  await mkdir(codexHome, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(codexHome, 'config.toml'), '');
  await writeFile(join(home, '.claude.json'), '{}');
  return { root, home, codexHome, projectRoot };
}

const calls = async (log) => {
  try {
    return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
};

test('#226: an unchanged setup does not call the Codex plugin CLI again', async (t) => {
  const w = await world(t);
  const codex = await fakeCodex(w.root);
  const opts = {
    codexExecutable: codex.bin,
    codexHome: w.codexHome,
    home: w.home,
    projectRoot: w.projectRoot,
  };
  const first = await syncCodexRuntime(opts);
  const afterFirst = (await calls(codex.log)).length;
  assert.ok(afterFirst > 0, 'the first launch syncs');
  const second = await syncCodexRuntime(opts);
  assert.equal((await calls(codex.log)).length, afterFirst, 'the second launch calls nothing');
  assert.deepEqual(second.launchArguments, first.launchArguments);
  assert.deepEqual(second.summary.plugins, first.summary.plugins);
  // a change Maude did not make (the person edited config.toml) syncs again
  await writeFile(join(w.codexHome, 'config.toml'), '# edited\n');
  await syncCodexRuntime(opts);
  assert.ok((await calls(codex.log)).length > afterFirst, 'a changed config syncs again');
});

test('#226: --version, --help and login go straight to the real Codex with no sync', async (t) => {
  const w = await world(t);
  const codex = await fakeCodex(w.root);
  for (const args of [['--version'], ['-V'], ['--help'], ['help'], ['login', 'status']]) {
    let synced = 0;
    const prev = { ...process.env };
    process.env.MAUDE_CODEX_REAL = codex.bin;
    process.env.HOME = w.home;
    process.env.CODEX_HOME = w.codexHome;
    delete process.env.MAUDE_CODEX_BRIDGE_ACTIVE;
    try {
      await runCodexCommand({
        args,
        sync: async () => {
          synced += 1;
          throw new Error('must not sync');
        },
        stdio: 'ignore',
      });
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
      Object.assign(process.env, prev);
    }
    assert.equal(synced, 0, `${args.join(' ')} must not sync`);
  }
  const log = await calls(codex.log);
  assert.deepEqual(log, ['--version', '-V', '--help', 'help', 'login status']);
  process.exitCode = 0;
});

test('#226: a Codex call that hangs fails with words that say what to do', async (t) => {
  const w = await world(t);
  const codex = await fakeCodex(w.root, { sleepSeconds: 5 });
  const prev = process.env.MAUDE_CODEX_SYNC_TIMEOUT_MS;
  process.env.MAUDE_CODEX_SYNC_TIMEOUT_MS = '1000';
  try {
    await assert.rejects(
      syncCodexRuntime({
        codexExecutable: codex.bin,
        codexHome: w.codexHome,
        home: w.home,
        projectRoot: w.projectRoot,
      }),
      (err) => /did not answer within/.test(err.message) && /MAUDE_CODEX_REAL/.test(err.message)
    );
  } finally {
    if (prev === undefined) delete process.env.MAUDE_CODEX_SYNC_TIMEOUT_MS;
    else process.env.MAUDE_CODEX_SYNC_TIMEOUT_MS = prev;
  }
});
