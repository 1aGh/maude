/**
 * WebdriverIO config for the team-library scenario (S10.18c, `ds-library.e2e.ts`).
 *
 * The seed (fixtures/seed-ds-library.ts, bun) starts a loopback stand-in hub, links `gator` from it, moves the hub
 * on, and prints the grants file and the project root. The app is started with that grants file
 * (MAUDE_DS_LIBRARY_GRANTS_PATH) so THIS Mac holds the grant. Run: `pnpm --filter @maude/desktop-e2e e2e:ds-library`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher, worker): seed ONCE, in the launcher, or the spec gets a project the app never opened.
if (!process.env.MAUDE_E2E_DS_LIBRARY_ROOT) {
  const lines = execFileSync('bun', [resolve(HERE, 'fixtures', 'seed-ds-library.ts')], {
    env: process.env,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  process.env.MAUDE_E2E_DS_LIBRARY_ROOT = lines.pop();
  process.env.MAUDE_DS_LIBRARY_GRANTS_PATH = lines.pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_LIBRARY_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/ds-library',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-library.e2e.ts')],
};
