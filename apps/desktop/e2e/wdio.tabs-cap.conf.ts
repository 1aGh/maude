/**
 * WebdriverIO config for the 2.0.4 running-cap + idle-rest check (decision
 * `v2-michal-running-cap-3-rest-15min`). Unlike wdio.tabs.conf.ts (cap forced to 2), this lane runs the
 * SHIPPED cap — no MAUDE_E2E_RUNNING_CAP — so a fourth open project is what rests one. The idle limit is
 * shortened to 60 s (MAUDE_E2E_IDLE_REST_SECS, debug builds only; the sweep then runs every 60 s too), long
 * enough that the cap step finishes before any background tab could rest by idling.
 * Run: `pnpm --filter @maude/desktop-e2e e2e:tabs-cap`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

delete process.env.MAUDE_E2E_RUNNING_CAP;
process.env.MAUDE_E2E_IDLE_REST_SECS = '60';

// Stamped once in the launcher; a worker re-evaluating this file across a minute boundary keeps it (the app,
// started by the launcher, writes the shell log the spec reads).
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/project-tabs-cap', stamp);
if (!process.env.MAUDE_E2E_RUN_DIR?.includes('project-tabs-cap'))
  process.env.MAUDE_E2E_RUN_DIR = RUN_DIR;
// The shell's own decision log: the spec tells a cap rest from an idle rest by its line.
mkdirSync(process.env.MAUDE_E2E_RUN_DIR, { recursive: true });
process.env.MAUDE_E2E_SHELL_LOG ??= resolve(process.env.MAUDE_E2E_RUN_DIR, 'shell.log');

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'project-tabs-cap.e2e.ts')],
  // four cold sidecars, then up to two idle sweeps
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
