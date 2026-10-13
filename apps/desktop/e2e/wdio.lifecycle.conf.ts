/**
 * WebdriverIO config for the git-lifecycle UI scenario (DDR-133).
 *
 * Boots the bundled `.app` into a REAL github-backed clone and drives the complete
 * git lifecycle through the UI (switcher + GitPanel). Sets MAUDE_USE_SYSTEM_GIT=1 so
 * push/pull/fetch use the developer's git credential helper — the test app isn't
 * signed into GitHub, and forcing system-git is the screen-independent way to exercise
 * the token-bearing operations (verified tokenless in the de-risk). Run:
 * `pnpm test:e2e:desktop:lifecycle`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = lifecycleFixtureOnce();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
// Force system git so push/pull/fetch authenticate via the developer's credential
// helper (the e2e app has no GitHub sign-in). Reads/vocabulary are engine-independent.
process.env.MAUDE_USE_SYSTEM_GIT = '1';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/git-lifecycle',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'git-lifecycle.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 }, // long: many UI steps + reloads + network
};
