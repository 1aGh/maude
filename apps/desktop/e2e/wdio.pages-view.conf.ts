/**
 * WebdriverIO config for the pages-view scenario (2.0.7 B2, `pages-view.e2e.ts`): Canvas | Pages on a six-artboard canvas
 * (Preview and Present greyed in Pages, the pick in the view file); 2.0.7 polish — the left panel marks the page and
 * a pick in it turns the page, and the Design system canvas has the switch on its own bar.
 *
 * Boots into the project fixtures/seed-pages-view.ts generates (the six-artboard canvas + the `acme` system with its
 * real Design system canvas), one app process. Run: `pnpm --filter @maude/desktop-e2e e2e:pages-view`.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Evaluated twice (launcher and worker): seed ONCE, in the launcher, so the spec sees the project the app opened.
if (!process.env.MAUDE_E2E_PAGES_VIEW_ROOT) {
  process.env.MAUDE_E2E_PAGES_VIEW_ROOT = execFileSync(
    'bun',
    [resolve(HERE, 'fixtures', 'seed-pages-view.ts')],
    { env: process.env, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .pop();
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_PAGES_VIEW_ROOT;

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
