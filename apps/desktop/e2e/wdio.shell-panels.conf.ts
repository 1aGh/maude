/**
 * WebdriverIO config for the shell-panels scenario (rc.1 findings 5 / 6 / 16 / 20, `shell-panels.e2e.ts`): panel grips,
 * the chat's minimum size and its Hide chevron, a shell that never scrolls, Advanced folds closed on a fresh Mac.
 *
 * The base fixture project (a canvas with nothing waiting), one app process. Run:
 * `pnpm --filter @maude/desktop-e2e e2e:shell-panels`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/shell-panels',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'shell-panels.e2e.ts')],
};
