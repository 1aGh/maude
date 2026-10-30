/**
 * WebdriverIO config for the git-lifecycle UI scenario (DDR-133).
 *
 * Boots the bundled `.app` into a clone of a LOCAL bare repo (fixtures/make-lifecycle-fixture.ts) and drives the
 * complete git lifecycle through the UI (Version history › Advanced). Nothing reaches GitHub or the network
 * (decision `v2-p8-e2e-lifecycle-local-bare-remote`): the clone's origin is `ssh://maude-e2e.invalid/<bare>` and
 * the app's git reaches it through a local ssh shim (`GIT_SSH_COMMAND`), with every other transport refused
 * (`GIT_ALLOW_PROTOCOL=ssh`). MAUDE_USE_SYSTEM_GIT=1 keeps every operation on the git binary (the ssh transport
 * is system-git only anyway). Run: `pnpm test:e2e:desktop:lifecycle`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary, env } = lifecycleFixtureOnce();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
process.env.MAUDE_USE_SYSTEM_GIT = '1';
// the app (and its sidecar's git) inherit these: the bare remote through the shim, nothing else
Object.assign(process.env, env);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/git-lifecycle',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'git-lifecycle.e2e.ts')],
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 }, // long: many UI steps + reloads
};
