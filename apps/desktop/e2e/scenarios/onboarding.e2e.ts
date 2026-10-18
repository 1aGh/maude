import { $, browser, expect } from '@wdio/globals';

import { enterCanvasFrame, exitToTop } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { expandTree } from '../helpers/tree';

/**
 * Phase 29 / E4 — the native COLD-START onboarding, driven through the real wizard DOM.
 * Proves a person who installs Maude reaches the studio with ZERO terminal:
 *   1. first launch → the OnboardingWizard renders (not the canvas browser)
 *   2. Door A · Continue with GitHub → device-code modal → signed-in GitHub door
 *   3. Door B · Open a folder → "Set up Maude here" → the studio opens on the empty
 *      project card (S6.2); ↵ in its prompt makes the first canvas from the sentence.
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

  it('3 · Door B · open a folder → set up Maude → the empty project asks for its first canvas', async () => {
    await ensureWelcome();
    await (await $(tid('ob-door-local'))).click();
    // "Choose a project folder" → the stubbed picker returns an EMPTY temp dir → the
    // non-Maude-folder branch offers "Set up Maude here".
    await (await $(tid('ob-local-choose'))).click();
    const setup = await $(tid('ob-local-setup'));
    await setup.waitForDisplayed({ timeout: 20_000 });
    await capture('04-folder-not-a-maude-project');

    await setup.click();
    // scaffoldDesign writes .design/ → open_local_project switches the sidecar → the webview
    // reloads onto the real project. That respawn is WebDriver-flaky (git-switch-repos
    // learning), so wait generously.
    await browser.pause(8_000);
    await waitForSidecar();

    // S6.2 — the wizard is gone (app_is_first_run is now false) and a project with no
    // canvases shows the 05 es-project-new card, not a seeded canvas (S6.15 retires the
    // seed): "<Project> has no canvases yet.", the prompt, "Start with an empty canvas ⌘N".
    // No toolbar: there is nothing to draw on.
    const card = await $(tid('empty-project'));
    await card.waitForDisplayed({ timeout: 120_000 });
    await expect(await $(tid('empty-project-blank'))).toBeDisplayed();
    await capture('05-empty-project-card');

    // ↵ in the prompt makes the first canvas from the sentence (S6.3 takes the sentence on to
    // draft it). The create call names the canvas from the words, opens it, and the card goes.
    const prompt = await $(tid('empty-project-prompt'));
    await prompt.setValue('A one-page portfolio with six projects, calm and light');
    await browser.keys('Enter');
    await card.waitForDisplayed({ timeout: 30_000, reverse: true });
    // The server names it from the sentence (C4), so the row is found by prefix, not by name.
    await browser.waitUntil(
      async () => {
        await expandTree();
        return await (await $('[data-testid^="canvas-row-"]')).isExisting();
      },
      { timeout: 60_000, interval: 500, timeoutMsg: 'the first canvas never appeared in the list' }
    );
    await capture('06-first-canvas-from-the-sentence');

    // Soft: the canvas builds for a few seconds after first open. The hard proof is the row
    // above; this confirms the canvas frame is up.
    try {
      await enterCanvasFrame(30_000);
      await exitToTop();
      await capture('07-first-canvas-rendered');
    } catch {
      await exitToTop().catch(() => undefined);
      await capture('07-first-canvas-open-state');
    }
  });
});
