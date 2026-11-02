import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => join(REPO, '.scr/fx-cache/ds-converted');
export const keepState = true;
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep, project, scratch } = h;
  const home = join(scratch, 'home');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', ...stubClaudeEnv(home) };
  const ds = (args) => spawnSync('bun', [join(REPO, 'apps/studio/bin/_ds.mjs'), ...args, '--root', project], { env, encoding: 'utf8' });
  await h.open('system-maude-v2-design-system', 6000);
  const css = join(project, '.design/system/maude-v2/colors_and_type.css');
  writeFileSync(css, readFileSync(css, 'utf8').replace(/--accent:\s+oklch\([^)]*\);/, '--accent:        oklch(0.50 0.19 250);'));
  for (const t of [2000, 6000, 12000]) {
    await sleep(t);
    const r = ds(['status', 'maude-v2', '--json']);
    const m = (r.stdout || '').match(/"outside":\s*(null|\{[^}]*\})/);
    console.log('t+', t, 'exit', r.status, 'outside=', m ? m[1].slice(0, 200) : (r.stdout || r.stderr || '').slice(0, 200));
  }
  await h.step('x/outside', 'o', 'o', async () => {});
}
