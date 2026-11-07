/**
 * WebdriverIO config — 15 an-vote: a vote between two people on a cell (T2.6c, issue #172).
 *
 * Same setUp as wdio.team-cell.conf.ts (a cell-shaped local hub that owns a checkout, alice's studio at work, the
 * designer's copy linked as bob and opened as the boot project). Only the spec and the run dir differ.
 *
 *   • 15 an-vote   bob starts a vote from ⌘K, alice casts, the bar counts her without showing what, bob ends it
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:an-vote` (after `pnpm test:e2e:desktop:build`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as cell } from './wdio.team-cell.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The launcher loaded wdio.team-cell.conf.ts (which set MAUDE_E2E_RUN_DIR under .../team-cell/); move the shots of
// this lane to their own folder. The workers inherit the env after this runs in the launcher.
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('an-vote')) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/an-vote', stamp);
}

export const config: WebdriverIO.Config = {
  ...cell,
  specs: [resolve(HERE, 'scenarios', 'an-vote.e2e.ts')],
  mochaOpts: { ...cell.mochaOpts, timeout: 600000 },
};
