/**
 * WebdriverIO config — 05 es-all-trashed on a LOCAL project (P8 test round "missing-a").
 *
 * The card for a canvas with no artboard left, and Restore. No hub, no second person: the app boots into a COPY of
 * fixtures/project (a throwaway temp dir; the checked-in fixture is never written). Run:
 * `pnpm --filter @maude/desktop-e2e e2e:all-trashed`.
 */
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher, then worker): copy ONCE, in the launcher, so the spec reads the project the app opened.
if (!process.env.MAUDE_E2E_ALL_TRASHED_ROOT) {
  const root = mkdtempSync(join(tmpdir(), 'maude-e2e-all-trashed-'));
  cpSync(resolve(HERE, 'fixtures', 'project'), root, { recursive: true });
  process.env.MAUDE_E2E_ALL_TRASHED_ROOT = root;
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_ALL_TRASHED_ROOT;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/all-trashed', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'all-trashed.e2e.ts')],
};
