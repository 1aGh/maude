/**
 * WebdriverIO config for the design-system switch scenario (S10.14, `ds-switch.e2e.ts`).
 *
 * Same harness as wdio.conf.ts, but boots the app into a GENERATED project with three design systems and canvases
 * on one of them (fixtures/seed-ds-switch.ts, bun). Run: `pnpm --filter @maude/desktop-e2e e2e:ds-switch`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher and worker): seed ONCE, in the launcher, so the spec sees the project the app opened.
if (!process.env.MAUDE_E2E_DS_SWITCH_ROOT) {
  process.env.MAUDE_E2E_DS_SWITCH_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-ds-switch.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_SWITCH_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ds-switch', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-switch.e2e.ts')],
};
