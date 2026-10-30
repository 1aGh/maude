/**
 * WebdriverIO config for the per-Mac memory scenario (06 Advanced: ad-edge-remember) — an Advanced you open stays
 * open on this Mac across a relaunch, and a different Mac (another config home) does not inherit it.
 *
 * Like wdio.relaunch.conf.ts the spec quits and starts the app itself (helpers/session.ts), so the app it started is
 * stopped here after the session. The base fixture project is opened on every launch (MAUDE_PROJECT_ROOT).
 * Run: `pnpm --filter @maude/desktop-e2e e2e:remember`.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELAUNCHED_PID_FILE } from './helpers/session';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/remember', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'remember-folds.e2e.ts')],
  afterSession() {
    try {
      const pid = Number(readFileSync(RELAUNCHED_PID_FILE(), 'utf8'));
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // nothing relaunched (an early red), or already gone
    }
    rmSync(RELAUNCHED_PID_FILE(), { force: true });
  },
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
