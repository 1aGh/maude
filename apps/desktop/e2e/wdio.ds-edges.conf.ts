/**
 * WebdriverIO config for the design-system edges scenario (S10.17, `ds-edges.e2e.ts`).
 *
 * Same harness as wdio.ds-reach.conf.ts, but boots into the project fixtures/seed-ds-edges.ts generates: system
 * `acme` converted, a Light text colour that falls short of 4.5:1, and a line colour two canvases use.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:ds-edges`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher and worker): seed ONCE, in the launcher, so the spec sees the project the app opened.
if (!process.env.MAUDE_E2E_DS_EDGES_ROOT) {
  process.env.MAUDE_E2E_DS_EDGES_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-ds-edges.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_EDGES_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ds-edges', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-edges.e2e.ts')],
};
