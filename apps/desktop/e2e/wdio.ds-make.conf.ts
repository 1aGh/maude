/**
 * WebdriverIO config for making a design system (S10.16b, `ds-review.e2e.ts` part 4).
 *
 * Same harness as wdio.conf.ts, but boots the app into a COPY of fixtures/project (a project with canvases and no
 * design system, so the pinned row says "Make a design system"). The copy is thrown away with the temp dir; the
 * checked-in fixture is never written. Run: `pnpm --filter @maude/desktop-e2e e2e:ds-make`.
 */
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useFakeAi } from './helpers/fake-ai';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

// Make three directions SENDS the brief as the person's own message (use-ask-ai.js, origin ds-make): the run must
// reach the scripted fake agent (it answers "ok."), never a real `claude` — the spec plays the agent's writes itself
// through /_api/ds/make.
useFakeAi();

// Evaluated twice (launcher, then worker): copy ONCE, in the launcher, so the spec reads the project the app opened.
if (!process.env.MAUDE_E2E_DS_MAKE_ROOT) {
  const root = mkdtempSync(join(tmpdir(), 'maude-e2e-ds-make-'));
  cpSync(resolve(HERE, 'fixtures', 'project'), root, { recursive: true });
  process.env.MAUDE_E2E_DS_MAKE_ROOT = root;
}
process.env.MAUDE_PROJECT_ROOT = process.env.MAUDE_E2E_DS_MAKE_ROOT;
process.env.MAUDE_E2E_DS_REVIEW_PART = '4';

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ds-make', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ds-review.e2e.ts')],
};
