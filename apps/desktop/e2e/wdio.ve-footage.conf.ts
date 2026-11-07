/**
 * WebdriverIO config — 07 ve-footage: footage another person's Mac holds, in the Timeline and the clip Inspector
 * (T2.6c, issue #172).
 *
 * Same setUp as wdio.team-cell.conf.ts (a cell-shaped local hub that owns a checkout, alice's studio at work, the
 * designer's copy linked as bob and opened as the boot project), with ONE difference: the app under test runs with the
 * canvas-origin split OFF. Selecting a video artboard to bring the Timeline up needs a click inside the canvas frame,
 * which is unreachable by DOM on another origin. The split also gates TSX sync, so bob does not receive alice's canvases
 * in this lane — the spec writes its own canvas on his disk. Alice's studio was started by the launcher BEFORE this
 * override (with the split on, like the cell lane) and only holds the file for the presence report.
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:ve-footage` (after `pnpm test:e2e:desktop:build`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as cell } from './wdio.team-cell.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// wdio.team-cell.conf.ts set the split ON (TSX sync needs it) and has already stood up alice's studio with it. The app
// under test is spawned after this, from this env.
process.env.MAUDE_CANVAS_ORIGIN_SPLIT = '0';

// The launcher loaded wdio.team-cell.conf.ts (which set MAUDE_E2E_RUN_DIR under .../team-cell/); move the shots of
// this lane to their own folder. The workers inherit the env after this runs in the launcher.
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('ve-footage')) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/ve-footage',
    stamp
  );
}

export const config: WebdriverIO.Config = {
  ...cell,
  specs: [resolve(HERE, 'scenarios', 've-footage.e2e.ts')],
  mochaOpts: { ...cell.mochaOpts, timeout: 600_000 },
};
