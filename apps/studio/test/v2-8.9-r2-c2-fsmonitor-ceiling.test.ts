// V2-8.9 r2 C2 (attacker) — the studio's system-git engine (MAUDE_USE_SYSTEM_GIT=1) ran `git` with
// neither `core.fsmonitor=false` nor a discovery ceiling. A `.git/config` that travelled with a shared
// folder (Syncthing / Dropbox carry it; a clone does not) names `core.fsmonitor = <command>`, and git
// runs it on every `git status`. And a project whose own `.git` is not a valid repo let git walk UP
// into a parent the attacker controls. Now every `runGit` passes `-c core.fsmonitor=false` and
// `GIT_CEILING_DIRECTORIES=<dirname(dir)>`, like acp/repo-private.ts.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitLog, gitStatus } from '../git/service.ts';

let top: string;
let saved: string | undefined;

function run(args: string[], cwd: string) {
  const r = Bun.spawnSync(['git', ...args], { cwd });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}
function seedRepo(dir: string) {
  run(['init', '-b', 'main'], dir);
  run(['config', 'user.name', 'Test'], dir);
  run(['config', 'user.email', 'test@example.com'], dir);
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  run(['add', '-A'], dir);
  run(['commit', '-m', 'seed'], dir);
}
/** A planted fsmonitor hook: git runs it through the shell; it leaves a marker file. */
function plantFsmonitor(repo: string, marker: string) {
  const hook = join(top, 'payload.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o755 });
  run(['config', 'core.fsmonitor', hook], repo);
}

beforeEach(() => {
  saved = process.env.MAUDE_USE_SYSTEM_GIT;
  process.env.MAUDE_USE_SYSTEM_GIT = '1';
  top = mkdtempSync(join(tmpdir(), 'maude-c2-git-'));
});
afterEach(() => {
  if (saved === undefined) delete process.env.MAUDE_USE_SYSTEM_GIT;
  else process.env.MAUDE_USE_SYSTEM_GIT = saved;
  rmSync(top, { recursive: true, force: true });
});

describe('system git never runs a planted fsmonitor', () => {
  test("the project's own .git/config names core.fsmonitor: status runs no command", async () => {
    const proj = join(top, 'proj');
    mkdirSync(proj);
    seedRepo(proj);
    const marker = join(top, 'OWNED-own');
    plantFsmonitor(proj, marker);
    const s = await gitStatus(proj);
    expect(s.repo).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });

  test("a project whose .git is not a repo never reaches the parent's .git", async () => {
    // the share root: a real repo with a planted hook
    seedRepo(top);
    const marker = join(top, 'OWNED-parent');
    plantFsmonitor(top, marker);
    // the "new project" inside it: a .git that git does not accept, so discovery would walk up
    const proj = join(top, 'shared', 'proj');
    mkdirSync(join(proj, '.git'), { recursive: true });
    await gitStatus(proj);
    await gitLog(proj);
    expect(existsSync(marker)).toBe(false);
  });
});
