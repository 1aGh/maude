/**
 * WebdriverIO config for the design-system outside-change scenario (S10.11, `ds-review-outside.e2e.ts`).
 *
 * Same harness as wdio.ds-review.conf.ts, but the generated project has NOTHING waiting
 * (fixtures/seed-ds-outside.ts, bun): the scenario edits the system's CSS from outside the app.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:ds-outside`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher, worker): seed ONCE, in the launcher, or the spec gets a project the app never opened.
if (!process.env.MAUDE_E2E_DS_OUTSIDE_ROOT) {
  process.env.MAUDE_E2E_DS_OUTSIDE_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-ds-outside.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_OUTSIDE_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/ds-outside',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-review-outside.e2e.ts')],
};
