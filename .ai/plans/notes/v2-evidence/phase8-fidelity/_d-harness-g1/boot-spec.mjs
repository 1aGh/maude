import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { join } from 'node:path';
import { stubClaudeEnv } from '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d/scripts/lib/stub-claude.mjs';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d';
const home = join(R, '.scr/spec-home');
const out = openSync(join(R, '.scr/spec-server.log'), 'w');
const p = spawn('bun', ['run', join(R, 'apps/studio/server.ts'), '--root', join(R, '.scr/design-copy'), '--port', '4777'], {
  env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', MAUDE_MACHINE_FILE: join(R, '.scr/spec-machine.json'), ...stubClaudeEnv(home) },
  stdio: ['ignore', out, out], detached: true,
});
p.unref();
console.log('pid', p.pid);
