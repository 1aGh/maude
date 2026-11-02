/**
 * WebdriverIO config for the tab strip scenario (11 Projects and Navigation: pn-tab-a, pn-tab-a20, pn-tab-menu,
 * pn-windows — as the contract V2-3.7 builds them, our own strip). Same two-project fixture as
 * wdio.tabs.conf.ts, with a running cap of 2 so twenty open tabs rest instead of spawning twenty servers.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:shell-strip`.
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
process.env.MAUDE_E2E_RUNNING_CAP = '2';
process.env.MAUDE_E2E_SHELL_LOG ??= resolve(
  HERE,
  '../../../.ai/device/scenario-runs/shell-strip',
  `shell-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.log`
);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/shell-strip',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'shell-strip.e2e.ts')],
  // Twenty tabs: two cold sidecars and eighteen that rest.
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
};
