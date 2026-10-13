/**
 * WebdriverIO config for the project-tabs scenario (V2-3.2, one window per open
 * project). Same two-project fixture as wdio.switchrepos.conf.ts: a github-backed
 * primary clone (boots on `main`) + an offline secondary (feat/nav-redesign), so
 * each tab has a branch of its own to show. Run: `pnpm test:e2e:desktop:tabs`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLifecycleFixture } from './fixtures/make-lifecycle-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = makeLifecycleFixture();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
process.env.MAUDE_USE_SYSTEM_GIT = '1';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/project-tabs',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'project-tabs.e2e.ts')],
  // Two cold sidecars + a 10 s close grace.
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
