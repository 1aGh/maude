// S01's real self-host door: a clean native profile signs in to a team's own
// server with the address, email and password a teammate was invited with.
// Operator input: MAUDE_SELFHOST_ENTRY_TARGET points to
// {hubUrl, email, password} for an ISOLATED disposable hub (0600 file).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from '../wdio.conf';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.env.MAUDE_SELFHOST_ENTRY_TARGET;
if (!input) throw new Error('An explicit disposable self-host target is required.');
if (process.platform !== 'linux') throw new Error('This isolated-profile runner is Linux-only.');
const target = JSON.parse(readFileSync(input, 'utf8'));
const url = new URL(target.hubUrl);
if (!['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol !== 'https:')
  throw new Error('A non-loopback team server must be HTTPS.');

if (!process.env.MAUDE_SELFHOST_ENTRY_RUN) {
  const scratch = mkdtempSync(join(tmpdir(), 'maude-selfhost-entry-'));
  const out = resolve(
    here,
    '../../../../.ai/device/scenario-runs/reliable-project-multiplayer',
    `selfhost-entry-${new Date().toISOString().replaceAll(':', '-')}`
  );
  mkdirSync(out, { recursive: true });
  process.env.MAUDE_SELFHOST_ENTRY_RUN = JSON.stringify({ input, scratch, out });
  process.env.XDG_CONFIG_HOME = join(scratch, 'config');
  process.env.XDG_DATA_HOME = join(scratch, 'data');
  process.env.HUBS_CONFIG_PATH = join(scratch, 'hubs.json');
  process.env.MAUDE_CLOUD_CONFIG = join(scratch, 'cloud.json');
  // Evidence records WHICH server, never the credentials.
  writeFileSync(
    join(out, 'target.json'),
    JSON.stringify({ hubUrl: url.origin, email: target.email, scratch }, null, 2)
  );
  console.log(`Self-host entry evidence: ${out}`);
}
const run = JSON.parse(process.env.MAUDE_SELFHOST_ENTRY_RUN);
process.env.MAUDE_E2E_RUN_DIR = run.out;
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_E2E_FRAME_PROBE = '1';
process.env.MAUDE_NO_AUTOBUILD = '1';
delete process.env.MAUDE_PROJECT_ROOT;

export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(here, 'selfhost-entry.e2e.ts')],
  logLevel: 'warn',
  outputDir: join(run.out, 'driver'),
  mochaOpts: { ui: 'bdd', timeout: 600_000 },
};
