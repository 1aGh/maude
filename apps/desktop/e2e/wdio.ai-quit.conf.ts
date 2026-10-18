/**
 * WebdriverIO config for the S5.14 quit scenario (03 `ai-quit`, `ai-needs-away`; V2-1.15 R10):
 * ⌘Q while AI works asks once, Quit stops every run and keeps its partial work, a relaunch shows
 * "Stopped when the app quit" + Keep going, and a waiting chat in a background tab marks it "?".
 *
 * The spec quits its own app (⌘Q → Quit, then a second ⌘Q) and starts it again
 * (helpers/session.ts `startApp`) — the embedded WebDriver service cannot relaunch mid-spec, so
 * a relaunched app left at the end is stopped here, as wdio.relaunch.conf.ts does.
 * Needs a signed-in `claude` and an unlocked screen. Not run in CI.
 */
import { readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lifecycleFixtureOnce } from './fixtures/make-lifecycle-fixture';
import { RELAUNCHED_PID_FILE } from './helpers/session';
import { config as base } from './wdio.conf';

const HERE = dirname(fileURLToPath(import.meta.url));

const { primary, secondary } = lifecycleFixtureOnce();
process.env.MAUDE_PROJECT_ROOT = primary;
process.env.MAUDE_E2E_SECONDARY_ROOT = secondary;
delete process.env.MAUDE_FORCE_ONBOARDING;

const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
process.env.MAUDE_E2E_RUN_DIR = resolve(HERE, '../../../.ai/device/scenario-runs/ai-quit', stamp);

export const config: WebdriverIO.Config = {
  ...base,
  specs: [resolve(HERE, 'scenarios', 'ai-quit.e2e.ts')],
  afterSession() {
    try {
      const pid = Number(readFileSync(RELAUNCHED_PID_FILE(), 'utf8'));
      if (pid > 0) process.kill(pid, 'SIGTERM');
    } catch {
      // nothing relaunched, or it already quit (step 5 quits it)
    }
    rmSync(RELAUNCHED_PID_FILE(), { force: true });
  },
  // Real model turns, a quit, a relaunch, a quit.
  mochaOpts: { ...base.mochaOpts, timeout: 600_000 },
};
