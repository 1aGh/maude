/**
 * WebdriverIO config — 10 co-mention-notify: an @mention reaches the person it names (T2.6c, issue #172).
 *
 * Same setUp as wdio.team-cell.conf.ts (a cell-shaped local hub that owns a checkout, alice's studio at work, the
 * designer's copy linked as bob and opened as the boot project). Only the spec and the run dir differ.
 *
 *   • 10 co-mention-notify   alice mentions bob in a comment; bob's app raises the in-app toast and the unread count
 *     (the Mac banner and the e-mail are the native shell's and the cloud's — soak, not driven here)
 *
 * Run: `pnpm --filter @maude/desktop-e2e e2e:co-mention-notify` (after `pnpm test:e2e:desktop:build`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as cell } from './wdio.team-cell.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// The launcher loaded wdio.team-cell.conf.ts (which set MAUDE_E2E_RUN_DIR under .../team-cell/); move the shots of
// this lane to their own folder. The workers inherit the env after this runs in the launcher.
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('co-mention-notify')) {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  process.env.MAUDE_E2E_RUN_DIR = resolve(
    HERE,
    '../../../.ai/device/scenario-runs/co-mention-notify',
    stamp
  );
}

export const config: WebdriverIO.Config = {
  ...cell,
  specs: [resolve(HERE, 'scenarios', 'co-mention-notify.e2e.ts')],
  mochaOpts: { ...cell.mochaOpts, timeout: 600000 },
};
