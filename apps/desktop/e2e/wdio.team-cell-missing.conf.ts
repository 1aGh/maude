/**
 * WebdriverIO config — P8 test round, "missing-a": the cell lane with two people who can race.
 *
 * Same setUp as wdio.team-cell.conf.ts (a cell-shaped local hub that owns a checkout, alice's studio at work, the
 * designer's copy linked as bob and opened as the boot project). Only the spec and the run dir differ, so the shots
 * of these rows sit in their own folder:
 *
 *   • 05 es-all-trashed   alice trashes three artboards and bob the fourth while the cell is away; bob's lands first
 *   • 12 ia-missing       a picture alice holds and the cell does not: "Waiting for alice's device"
 *   • 12 ia-edges D       a photo dropped while the cell is away is kept on this Mac, then goes up by itself
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:team-cell-missing` (after `pnpm test:e2e:desktop:build`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as cell } from './wdio.team-cell.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The launcher loaded wdio.team-cell.conf.ts (which set MAUDE_E2E_RUN_DIR under .../team-cell/); move the shots of
// this lane to their own folder. The workers inherit the env after this runs in the launcher.
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('team-cell-missing')) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/team-cell-missing',
    stamp
  );
}

export const config: WebdriverIO.Config = {
  ...cell,
  specs: [resolve(HERE, 'scenarios', 'team-cell-missing.e2e.ts')],
  mochaOpts: { ...cell.mochaOpts, timeout: 600_000 },
};
