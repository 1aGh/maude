import { readdirSync } from 'node:fs';

import { $, browser, expect } from '@wdio/globals';

import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { expandTree } from '../helpers/tree';
import { activeTab, HOME, labels, waitWindow } from '../helpers/windows';

/**
 * S6.8 — the native FIRST RUN, which is Home (02 Onboarding ob-first-launch · ob-adv-open ·
 * ob-local-name · ob-local-first; replaces the pre-v2 OnboardingWizard scenario, no
 * MAUDE_FORCE_ONBOARDING). A person who installs Maude reaches a project with ZERO terminal:
 *   1. first launch opens Home with the sign-in card — two doors, no wizard, no tour
 *   2. Advanced options folds out five rows and is closed again on the next launch (not driven here)
 *   3. Just a local project → "Create a local project" → a name → a project tab on the empty
 *      project card (S6.2) — the project is in the throwaway Maude folder the config names
 *   4. the empty card's prompt makes the first canvas from a sentence (S6.3 takes it from there)
 *   5. Help and guides adds the two guide canvases on request (S6.15: a new project starts empty)
 *
 * NOT covered here (needs a debug-only switch in the Rust shell, not part of this slice): the CLOUD
 * leg — Sign in to cloud.maude.sh against a fake control plane. `home_cloud_sign_in_open` opens the
 * system browser, and the default profile's credential is `$HOME/.config/maude/cloud.json`, the
 * developer's own. It needs (a) a `MAUDE_E2E_NO_BROWSER` gate like `MAUDE_E2E_NO_REVEAL` and (b) an
 * isolated HOME for the run, then a stub `/auth/device/{code,token}` + `/api/home` in the lane's
 * config. The page-level behaviour (prepare → start → open → poll → done, nudges, timeout, offline)
 * is held by test/home-first-run.test.tsx.
 *
 * Only runs under wdio.onboarding.conf.ts (empty app-state, empty index, a throwaway projects dir).
 * Under any other config it self-skips; on a Mac that is signed in to Maude Cloud there is no first
 * run to drive, so it skips there too.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const PROJECTS_DIR = process.env.MAUDE_E2E_FIRST_RUN_PROJECTS ?? '';

async function onHome(): Promise<void> {
  await browser.switchToWindow(HOME);
}

describe('native-first-run (native-desktop)', () => {
  before(async function () {
    if (!PROJECTS_DIR) this.skip(); // wrong config
    startReport(
      'native-first-run (native-desktop) — Home first run → local project, zero terminal'
    );
    await browser.setTimeout({ script: 60_000 });
  });

  it('1 · a first launch opens Home with the sign-in card, two doors and no wizard', async function () {
    await waitWindow(HOME);
    await onHome();
    expect(await isNativeShell()).toBe(true);
    const card = await $(tid('signin-card'));
    try {
      await card.waitForDisplayed({ timeout: 60_000 });
    } catch {
      await capture('01-no-first-run-card');
      this.skip(); // this Mac already has a project or a cloud account — not a first run
    }
    expect(await (await $(tid('signin-cloud'))).getText()).toContain('Sign in to cloud.maude.sh');
    expect(await (await $(tid('signin-local'))).getText()).toContain('Just a local project');
    expect(await card.getAttribute('data-state')).toBe('idle');
    expect(await (await $(tid('onboarding-wizard'))).isExisting()).toBe(false);
    await capture('01-first-launch-is-home');
  });

  it('2 · Advanced options folds out the five rows', async () => {
    await (await $(tid('signin-advanced'))).click();
    await (await $(tid('signin-advanced-menu'))).waitForDisplayed({ timeout: 5_000 });
    for (const row of ['hub', 'folder-github', 'ai', 'cli', 'figma']) {
      expect(await (await $(tid(`signin-adv-${row}`))).isDisplayed()).toBe(true);
    }
    await capture('02-advanced-options');
    await (await $(tid('signin-advanced'))).click(); // folded again
    await (await $(tid('signin-advanced-menu'))).waitForDisplayed({
      reverse: true,
      timeout: 5_000,
    });
  });

  it('3 · Just a local project → a name → the project opens as a tab on the empty card', async () => {
    const before = await labels();
    await (await $(tid('signin-local'))).click();
    await (await $(tid('home-create-dialog'))).waitForDisplayed({ timeout: 10_000 });
    expect(await (await $(tid('home-create-dialog'))).getText()).toContain(
      'Create a local project'
    );
    await (await $(tid('home-create-name'))).setValue('Portfolio 2026');
    await capture('03-create-a-local-project');
    await (await $(tid('home-create-submit'))).click();
    await browser.waitUntil(async () => (await labels()).length === before.length + 1, {
      timeout: 30_000,
      interval: 250,
      timeoutMsg: 'no project tab after Create project',
    });
    const created = (await labels()).find((l) => !before.includes(l)) as string;
    await browser.waitUntil(async () => (await activeTab()) === created, { timeout: 15_000 });
    // kept in the Maude folder the config names (never ~/Maude)
    expect(readdirSync(PROJECTS_DIR)).toContain('Portfolio 2026');

    // the new tab boots its own server; a project with no canvases shows the 05 empty card
    await browser.switchToWindow(created);
    await browser.waitUntil(
      async () => {
        try {
          return /^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(await browser.getUrl());
        } catch {
          return false;
        }
      },
      {
        timeout: 150_000,
        interval: 1000,
        timeoutMsg: 'the new project tab never reached its server',
      }
    );
    await (await $(tid('empty-project'))).waitForDisplayed({ timeout: 120_000 });
    await expect(await $(tid('empty-project-blank'))).toBeDisplayed();
    await capture('04-the-empty-project');
  });

  it('4 · a sentence in the empty card makes the first canvas', async () => {
    const prompt = await $(tid('empty-project-prompt'));
    await prompt.setValue('A one-page portfolio with six projects, calm and light');
    await browser.keys('Enter');
    await (await $(tid('empty-project'))).waitForDisplayed({ timeout: 30_000, reverse: true });
    await browser.waitUntil(
      async () => {
        await expandTree();
        return await (await $('[data-testid^="canvas-row-"]')).isExisting();
      },
      { timeout: 60_000, interval: 500, timeoutMsg: 'the first canvas never appeared in the list' }
    );
    await capture('05-first-canvas-from-the-sentence');
  });

  it('5 · Help and guides adds the two guide canvases on request (S6.15, Q10)', async () => {
    // A new project starts empty; the guides are one button away. F1 opens Help and guides.
    expect(await (await $(tid('canvas-row-ui-how-to-use-maude'))).isExisting()).toBe(false);
    await pressMenuRow('help.guides', 'help'); // Help › Help and guides (F1 is swallowed while the AI composer holds focus)
    const add = await $(tid('help-add-guides'));
    await add.waitForDisplayed({ timeout: 15_000 });
    expect(await add.getText()).toBe('Add the guide canvases to this project');
    await add.click();
    // "Adding the guides…" is the in-flight line (add-guides.js GUIDES_WORDS.adding); wait for what it DID
    await browser.waitUntil(
      async () => {
        const said = await (await $(tid('help-add-guides-status'))).getText();
        return said !== '' && said !== 'Adding the guides…';
      },
      { timeout: 15_000, timeoutMsg: 'the Help dialog never said what it did' }
    );
    expect(await (await $(tid('help-add-guides-status'))).getText()).toBe(
      'Added the guides to this project.'
    );
    await capture('06-guides-added');
    await browser.keys('Escape');
    await browser.waitUntil(
      async () => {
        await expandTree();
        return (
          (await (await $(tid('canvas-row-ui-how-to-use-maude'))).isExisting()) &&
          (await (await $(tid('canvas-row-ui-how-to-make-video'))).isExisting())
        );
      },
      { timeout: 60_000, interval: 500, timeoutMsg: 'the two guides never appeared in the list' }
    );
    // a second press adds nothing and says so
    await pressMenuRow('help.guides', 'help'); // Help › Help and guides (F1 is swallowed while the AI composer holds focus)
    await (await $(tid('help-add-guides'))).click();
    await browser.waitUntil(
      async () =>
        (await (await $(tid('help-add-guides-status'))).getText()) ===
        'The guides are already in this project.',
      { timeout: 15_000, timeoutMsg: 'asking twice did not say the guides were already there' }
    );
    await browser.keys('Escape');
  });
});
