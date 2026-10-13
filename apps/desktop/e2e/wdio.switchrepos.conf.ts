/**
 * WebdriverIO config for the git-switch-repos scenario (DDR-133). Same harness as
 * wdio.lifecycle.conf.ts (a github-backed primary clone + an offline secondary), but
 * runs only the switch-repos scenario, into its own evidence dir. Run:
 * `pnpm test:e2e:desktop:switchrepos`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = lifecycleFixtureOnce();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
process.env.MAUDE_USE_SYSTEM_GIT = '1';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/git-switch-repos',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'git-switch-repos.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
