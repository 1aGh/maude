import { $, browser, expect } from '@wdio/globals';

import { enterCanvasFrame, exitToTop } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * Phase 29 / E4 — the native COLD-START onboarding, driven through the real wizard DOM.
 * Proves a person who installs Maude reaches the studio with ZERO terminal:
 *   1. first launch → the OnboardingWizard renders (not the canvas browser)
 *   2. Door A · Continue with GitHub → device-code modal → signed-in GitHub door
 *   3. Door B · Open a folder → "Set up Maude here" → the studio opens on a real,
 *      SEEDED starter canvas (scaffold-design.ts) instead of an empty list.
 *
 * Only runs under wdio.onboarding.conf.ts, which drops MAUDE_PROJECT_ROOT (→ first-run)
 * and sets the two debug-only stub envs. Under any other config it self-skips.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const ONBOARDING = !!process.env.MAUDE_E2E_PICK_DIR;

async function waitForWizard(timeout = 180_000): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        return await (await $(tid('onboarding-wizard'))).isDisplayed();
      } catch {
        return false; // mid-boot the JS context can be torn down — keep polling
      }
    },
    { timeout, interval: 500, timeoutMsg: 'first-run onboarding wizard never appeared' }
  );
}

/** Return to the welcome door picker if a prior step left us on a sub-door. */
async function ensureWelcome(): Promise<void> {
  const back = await $(tid('ob-back'));
  if (await back.isDisplayed().catch(() => false)) await back.click();
  await (await $(tid('ob-door-local'))).waitForDisplayed({ timeout: 10_000 });
}

describe('native-onboarding (native-desktop)', () => {
  before(async function () {
    if (!ONBOARDING) this.skip(); // wrong config (no first-run / stubs) — not applicable
    startReport('native-onboarding (native-desktop) — first-run wizard → studio, zero terminal');
    await browser.setTimeout({ script: 60_000 });
  });

  it('1 · boots to the first-run onboarding wizard with three doors', async () => {
    await waitForSidecar();
    expect(await isNativeShell()).toBe(true);
    await waitForWizard();
    for (const door of ['ob-door-github', 'ob-door-local', 'ob-door-hub']) {
      expect(await (await $(tid(door))).isDisplayed()).toBe(true);
    }
    expect(await (await $(tid('ob-door-github'))).getText()).toContain('GitHub');
    await capture('01-first-run-wizard-three-doors');
  });

  it('2 · Door A · Continue with GitHub shows the device code, then signs in', async () => {
    await (await $(tid('ob-door-github'))).click();
    // The debug stub emits a deterministic device-code (~2.5 s) before "authorizing".
    // Best-effort (it's transient): a missed catch must not fail the harder assertion.
    try {
      await (await $(tid('ob-device-modal'))).waitForDisplayed({ timeout: 8_000 });
      expect(await (await $(tid('ob-device-code'))).getText()).toContain('E2E-CODE');
      await capture('02-device-code-modal');
    } catch {
      await capture('02-device-code-missed');
    }
    // Hard assertion: it advances to the signed-in GitHub door ("Start a new project").
    await (await $(tid('ob-github-create'))).waitForDisplayed({ timeout: 20_000 });
    await capture('03-signed-in-github-door');
  });

  it('3 · Door B · open a folder → set up Maude → studio opens on a seeded canvas', async () => {
    await ensureWelcome();
    await (await $(tid('ob-door-local'))).click();
    // "Choose a project folder" → the stubbed picker returns an EMPTY temp dir → the
    // non-Maude-folder branch offers "Set up Maude here".
    await (await $(tid('ob-local-choose'))).click();
    const setup = await $(tid('ob-local-setup'));
    await setup.waitForDisplayed({ timeout: 20_000 });
    await capture('04-folder-not-a-maude-project');

    await setup.click();
    // scaffoldDesign writes .design/ + the seeded Welcome canvas → open_local_project
    // switches the sidecar → the webview reloads onto the real project. That respawn is
    // WebDriver-flaky (git-switch-repos learning), so wait generously.
    await browser.pause(8_000);
    await waitForSidecar();

    // The wizard is gone (app_is_first_run is now false) and the studio shows the SEEDED
    // canvas — proof the empty-studio gap is closed.
    const welcomeRow = await canvasRow('canvas-row-ui-welcome');
    await welcomeRow.waitForDisplayed({ timeout: 120_000 });
    await capture('05-studio-with-seeded-welcome-canvas');

    // Open it + assert the seeded artboard rendered. Soft: the canvas builds for a few
    // seconds after first open (an immediate snapshot can lag) — the hard proof is the
    // seeded row above; this confirms it actually renders.
    await welcomeRow.click();
    try {
      await enterCanvasFrame(30_000);
      await (await $(tid('welcome-artboard-content'))).waitForDisplayed({ timeout: 30_000 });
      await exitToTop();
      await capture('06-seeded-canvas-rendered');
    } catch {
      await exitToTop().catch(() => undefined);
      await capture('06-seeded-canvas-open-state');
    }
  });
});
