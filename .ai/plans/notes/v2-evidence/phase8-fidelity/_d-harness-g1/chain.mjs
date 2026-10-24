// node chain.mjs <themes> [scenario files...]  — runs every scenario for the themes, sequentially, logs to ../chain-*.log
import { spawnSync } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1266e1495ea7588d';
const themes = process.argv[2] || 'light,dark';
const all = ['s01ai.mjs', 's01b.mjs', 's01c.mjs', 's01d.mjs', 's02p.mjs', 's05a.mjs', 's05c.mjs', 's05d.mjs', 's05e.mjs', 's05f.mjs', 's05g.mjs'];
const list = process.argv.length > 3 ? process.argv.slice(3) : all;
const env = { ...process.env, SHOTS_OUT: join(R, '.scr/impl-raw') };
const log = join(R, '.scr/chain.log');
rmSync(log, { force: true });
for (const s of list) {
  const t = Date.now();
  const r = spawnSync('node', ['run.mjs', s, themes], { cwd: join(R, '.scr/h'), env, encoding: 'utf8', timeout: 600000 });
  appendFileSync(log, `== ${s} ${Math.round((Date.now() - t) / 1000)}s exit ${r.status}\n${(r.stdout || '').split('\n').filter((l) => /fail|FAIL|ERROR|error/i.test(l)).join('\n')}\n`);
}
const h = spawnSync('node', ['home2.mjs', themes], { cwd: join(R, '.scr/h'), env, encoding: 'utf8', timeout: 900000 });
appendFileSync(log, `== home2 exit ${h.status}\n${(h.stdout || '').split('\n').filter((l) => /fail|ERROR/i.test(l)).join('\n')}\n`);
appendFileSync(log, 'DONE\n');
