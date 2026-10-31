/**
 * WebdriverIO config for the modes-frame scenario (r2-p3, Michal TD1d, `modes-frame.e2e.ts`): Edit → Preview → Edit
 * changes only the toolbar — the Share cluster stays full, Undo stays, the pill and the cluster do not move.
 *
 * The base fixture project (a canvas with nothing waiting), one app process. Run:
 * `pnpm --filter @maude/desktop-e2e e2e:modes-frame`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/modes-frame',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'modes-frame.e2e.ts')],
};
