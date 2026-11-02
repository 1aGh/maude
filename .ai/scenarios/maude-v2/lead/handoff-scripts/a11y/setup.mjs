// Throwaway world for the V2-8.7 final audit: HOME, XDG, machine file, stub claude, two projects.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const W = '/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y';
const REPO = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a999aac949ee0b1f8';
for (const d of ['home/bin', 'home/xdg', 'home/index']) mkdirSync(join(W, d), { recursive: true });
writeFileSync(join(W, 'home/bin/claude'), `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
for (const p of ['fix', 'empty']) rmSync(join(W, p), { recursive: true, force: true });
cpSync(join(REPO, 'apps/desktop/e2e/fixtures/project'), join(W, 'fix'), { recursive: true });
mkdirSync(join(W, 'empty/.design'), { recursive: true });
cpSync(join(W, 'fix/.design/config.json'), join(W, 'empty/.design/config.json'));
for (const p of ['fix', 'empty']) {
  const run = (...a) => spawnSync('git', ['-C', join(W, p), '-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  run('init', '-q');
  run('add', '-A');
  run('commit', '-qm', 'init');
}
console.log('ok', existsSync(join(W, 'fix/.design/ui/Smoke.tsx')));
