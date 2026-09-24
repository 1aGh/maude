// S01's real cloud door. No fake device approval or pre-seeded app credentials.
// Operator input: MAUDE_CLOUD_ENTRY_TARGET points to {controlUrl, projectId}.
// Approve the UI's device code in the invited designer's isolated browser.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from '../wdio.conf';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.env.MAUDE_CLOUD_ENTRY_TARGET;
if (!input) throw new Error('An explicit disposable cloud target is required.');
if (process.platform !== 'linux') throw new Error('This isolated-profile runner is Linux-only.');
const target = JSON.parse(readFileSync(input, 'utf8'));
const url = new URL(target.controlUrl);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/')
  throw new Error('The control plane must be an HTTPS origin.');
if (!/^[a-z0-9-]+$/.test(target.projectId)) throw new Error('Invalid explicit project id.');

if (!process.env.MAUDE_CLOUD_ENTRY_RUN) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-cloud-entry-'));
  const out = resolve(
    here,
    '../../../../.ai/device/scenario-runs/reliable-project-multiplayer',
    `cloud-entry-${new Date().toISOString().replaceAll(':', '-')}`
  );
  mkdirSync(out, { recursive: true });
  process.env.MAUDE_CLOUD_ENTRY_RUN = JSON.stringify({ ...target, scratch, out });
  process.env.XDG_CONFIG_HOME = join(scratch, 'config');
  process.env.XDG_DATA_HOME = join(scratch, 'data');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  writeFileSync(join(out, 'target.json'), JSON.stringify({ ...target, scratch }, null, 2), {
    mode: 0o600,
  });
  console.log(`Cloud entry evidence: ${out}`);
}
const run = JSON.parse(process.env.MAUDE_CLOUD_ENTRY_RUN);
process.env.MAUDE_E2E_RUN_DIR = run.out;
process.env.MAUDE_CLOUD_URL = url.origin;
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_E2E_FRAME_PROBE = '1';
process.env.MAUDE_NO_AUTOBUILD = '1';
delete process.env.MAUDE_PROJECT_ROOT;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(here, 'cloud-entry.e2e.ts')],
  logLevel: 'warn',
  outputDir: join(run.out, 'driver'),
  mochaOpts: { ui: 'bdd', timeout: 600_000 },
};
