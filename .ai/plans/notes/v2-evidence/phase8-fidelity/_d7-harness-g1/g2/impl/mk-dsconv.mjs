// Build the converted-DS project for 13: copy the maude-v2 + maude system folders into a scratch project,
// boot a studio on it, and run `maude design ds convert` against it (the real verb, over the running studio).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, boot, sleep } from './lib.mjs';
import { makeSite } from './fx5.mjs';
import { stubClaudeEnv } from '../../scripts/lib/stub-claude.mjs';

const src = makeSite({ systems: ['maude-v2', 'maude'], canvases: ['Homepage', 'Landing', 'Pricing', 'Combine-kampan'], key: 'dsconv', name: 'Studio site' });
const scratch = mkdtempSync(join(tmpdir(), 'maude-g5-dsconv-'));
const project = join(scratch, 'project');
cpSync(src, project, { recursive: true });
const s = await boot(project, scratch, {}, { theme: 'light' });
await sleep(1500);
const home = join(scratch, 'home');
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', ...stubClaudeEnv(home) };
const run = (args) => {
  const r = spawnSync('bun', [join(REPO, 'apps/studio/bin/_ds.mjs'), ...args, '--root', project], { env, encoding: 'utf8' });
  console.log('ds', args.join(' '), '→ exit', r.status, '\n', (r.stdout || '').slice(0, 1500), (r.stderr || '').slice(0, 800));
};
run(['convert', '--dry-run']);
run(['convert']);
run(['status']);
await sleep(1500);
s.stop();
await sleep(800);
const out = join(REPO, '.scr/fx-cache/ds-converted');
rmSync(out, { recursive: true, force: true });
cpSync(project, out, { recursive: true });
for (const p of ['.design/_server.json', '.design/_state', '.design/_sync.json']) rmSync(join(out, p), { recursive: true, force: true });
console.log('saved', out);
process.exit(0);
