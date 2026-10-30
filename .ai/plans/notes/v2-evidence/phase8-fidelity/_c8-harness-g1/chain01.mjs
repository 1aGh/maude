// node chain01.mjs <themes> [scenarios...] — 01-only chain (D4): s01ai s01b s01c s01d, then home2 cf-home-prompt
import { spawnSync } from 'node:child_process';
import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const R = process.env.D5_REPO || process.cwd();
const themes = process.argv[2] || 'light,dark';
const list = process.argv.length > 3 ? process.argv.slice(3) : ['s01ai.mjs', 's01b.mjs', 's01c.mjs', 's01d.mjs'];
const env = { ...process.env, SHOTS_OUT: join(R, '.scr/impl-raw') };
const log = join(R, '.scr/chain.log');
rmSync(log, { force: true });
for (const s of list) {
  const t = Date.now();
  const r = spawnSync('node', ['run.mjs', s, themes], { cwd: join(R, '.scr/h'), env, encoding: 'utf8', timeout: 900000 });
  appendFileSync(log, `== ${s} ${Math.round((Date.now() - t) / 1000)}s exit ${r.status}\n${(r.stdout || '').split('\n').filter((l) => /^shot|fail|FAIL|ERROR|error|pageerr/i.test(l)).join('\n')}\n`);
}
const h = spawnSync('node', ['home2.mjs', themes, 'cf-home-prompt,cf-home-prompt.target'], { cwd: join(R, '.scr/h'), env, encoding: 'utf8', timeout: 900000 });
appendFileSync(log, `== home2 exit ${h.status}\n${(h.stdout || '').split('\n').filter((l) => /^shot|fail|ERROR/i.test(l)).join('\n')}\n`);
appendFileSync(log, 'DONE\n');
