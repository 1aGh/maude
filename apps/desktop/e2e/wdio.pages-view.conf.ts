/**
 * WebdriverIO config for the pages-view scenario (2.0.7 B2, `pages-view.e2e.ts`): Canvas | Pages on a six-artboard canvas
 * (Preview and Present greyed in Pages, the pick in the view file).
 *
 * The base fixture project (a canvas with nothing waiting), one app process. Run:
 * `pnpm --filter @maude/desktop-e2e e2e:pages-view`.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(
  HERE,
  '../../../.ai/device/scenario-runs/pages-view',
  stamp
);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'pages-view.e2e.ts')],
};
