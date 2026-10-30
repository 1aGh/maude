/**
 * WebdriverIO config for the relaunch scenario (V2-3.9 T7, contract V2-3.7 §4/§7.4): a relaunch
 * restores exactly the previous project tabs and the active one, and never adds a tab.
 *
 * One spec, three launches against the SAME kept app-state: the spec quits the app (SIGTERM, the
 * session is saved on the way out) and starts it again (helpers/session.ts `relaunchApp`) — the
 * embedded WebDriver service keeps one app per lane and cannot relaunch it mid-spec.
 * No MAUDE_PROJECT_ROOT: a launch told what to open does not restore (windows.rs
 * `restore_enabled`). Same two-project fixture as wdio.tabs.conf.ts.
 * Run: `pnpm test:e2e:desktop:relaunch`.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { RELAUNCHED_PID_FILE } from './helpers/session';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = lifecycleFixtureOnce();
delete process.env.MAUDE_PROJECT_ROOT;
process.env.MAUDE_E2E_PRIMARY_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
process.env.MAUDE_USE_SYSTEM_GIT = '1';
process.env.MAUDE_E2E_SHELL_LOG ??= resolve(
  HERE,
  '../../../.ai/device/scenario-runs/relaunch',
  `shell-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.log`
);

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/relaunch', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'relaunch.e2e.ts')],
  // The service stops the app IT started; the spec's relaunched one is stopped here, after the
  // runner deleted the session (a kill in the spec would fail that delete).
  afterSession() {
    try {
      const pid = Number(readFileSync(RELAUNCHED_PID_FILE(), 'utf8'));
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // nothing relaunched (an early red), or already gone
    }
    rmSync(RELAUNCHED_PID_FILE(), { force: true });
  },
  // Two cold sidecars on the first launch.
  mochaOpts: { ...base.mochaOpts, timeout: 300_000 },
};
