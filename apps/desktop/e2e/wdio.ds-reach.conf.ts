/**
 * WebdriverIO config for the reach view scenario (S10.9, `ds-reach.e2e.ts`).
 *
 * Same harness as wdio.ds-review.conf.ts, but boots into the project fixtures/seed-ds-reach.ts generates: system
 * `acme` converted, the Accent change waiting, and two canvases that use the Accent in an artboard each.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:ds-reach`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// This module is evaluated twice: by the launcher (which starts the app — its env is what the app
// inherits) and again by the worker. Seed ONCE, in the launcher: a second seed would hand the spec a
// project the app never opened.
if (!process.env.MAUDE_E2E_DS_REACH_ROOT) {
  process.env.MAUDE_E2E_DS_REACH_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-ds-reach.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_REACH_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ds-reach', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-reach.e2e.ts')],
};
