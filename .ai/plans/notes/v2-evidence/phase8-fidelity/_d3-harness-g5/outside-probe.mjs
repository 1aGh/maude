// probe: does an on-disk edit of colors_and_type.css surface as "outside" in `ds status` (no browser)?
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, boot, scratchProject, sleep } from './lib.mjs';
import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
const { scratch, project } = scratchProject(join(REPO, '.scr/fx-cache/ds-converted'), true);
const s = await boot(project, scratch, {}, { theme: 'light' });
const home = join(scratch, 'home');
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', ...stubClaudeEnv(home) };
const ds = (args) => { const r = spawnSync('bun', [join(REPO, 'apps/studio/bin/_ds.mjs'), ...args, '--root', project], { env, encoding: 'utf8' }); return r.stdout + r.stderr; };
await sleep(4000);
const css = join(project, '.design/system/maude-v2/colors_and_type.css');
const text = readFileSync(css, 'utf8');
console.log('has accent line', /--accent:\s+oklch\(0\.53 0\.175 238\);/.test(text));
writeFileSync(css, text.replace(/--accent:\s+oklch\(0\.53 0\.175 238\);/, '--accent:        oklch(0.50 0.19 250);'));
for (const t of [3000, 6000, 9000]) { await sleep(3000); const o = ds(['status']); const m = o.match(/"outside":\s*(\{[^}]*\}|null)/); console.log(t, m && m[1].slice(0, 200)); }
s.stop();
rmSync(scratch, { recursive: true, force: true });
process.exit(0);
