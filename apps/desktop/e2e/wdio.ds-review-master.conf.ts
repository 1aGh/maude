/**
 * WebdriverIO config for ds-review.e2e.ts PART 2 (S10.10, component masters): boots the app into a GENERATED project
 * with one converted design system, a Button master whose Corners wait at 6 px, and fourteen canvases in three
 * folders (fixtures/seed-ds-master.ts, bun). Run: `pnpm --filter @maude/desktop-e2e e2e:ds-review-master`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher, worker): seed ONCE, in the launcher — see wdio.ds-review.conf.ts.
if (!process.env.MAUDE_E2E_DS_REVIEW_ROOT) {
  process.env.MAUDE_E2E_DS_REVIEW_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-ds-master.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_REVIEW_ROOT;
// the spec runs its part 2 when this is set (and its part 1 otherwise)
process.env.MAUDE_E2E_DS_REVIEW_PART = '2';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/ds-review-master',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-review.e2e.ts')],
};
