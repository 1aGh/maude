import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from '../wdio.conf';

const path = process.env.MAUDE_SURFACE_CONFIG;
if (!path) throw new Error('Run the local-e2e.sh wrapper to prepare isolated participants.');
const run = JSON.parse(readFileSync(path, 'utf8'));
process.env.MAUDE_PROJECT_ROOT = run.nativeProject;
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '1';
process.env.MAUDE_E2E_FRAME_PROBE = '1';
export const config: WebdriverIO.Config = {
  ...base,
  specs: [join(dirname(fileURLToPath(import.meta.url)), 'surface.e2e.ts')],
  logLevel: 'warn',
  services: [['@wdio/tauri-service', { embeddedPort: 4455, captureBackendLogs: true }]],
  outputDir: join(run.out, 'driver'),
  // Whole-catalogue allowance only. Per-operation deadlines remain 15 seconds.
  mochaOpts: { ui: 'bdd', timeout: Math.max(900_000, run.samples * 3 * 20_000) },
};
