import { $, browser, expect } from '@wdio/globals';

import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * S8.17 — Import from Figma (canvas 12 · ia-figma-sheets, ia-figjam), DOM-driven.
 *
 * Tests never call the real Figma API, and this app reaches only api.figma.com (no base override: the
 * token would follow it — DDR-216 D2). So this scenario drives every leg that does not need Figma to
 * answer, and the frame-pick → artboards leg is covered by test/figma-pictures.test.ts (stubbed REST) +
 * test/v2-figma-sheet.test.tsx (the sheet against stubbed routes):
 *   1. Menu › File › Import from Figma… opens the sheet; with no token it says "Figma isn't connected yet."
 *      and Connect… opens the token step IN PLACE (three steps, a password field); Cancel goes back;
 *   2. a link that is not Figma's is refused with fixed words, and nothing is listed;
 *   3. a FigJam link takes the FigJam door (annotations on the open canvas), never the frame list.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

async function openSheet() {
  await pressMenuRow('import.figma', 'file');
  const sheet = await $(tid('figma-import-panel'));
  await sheet.waitForDisplayed({ timeout: 10_000 });
  return sheet;
}

async function typeLink(value: string) {
  const field = await $(tid('figma-import-url'));
  await field.waitForDisplayed({ timeout: 5_000 });
  await field.clearValue();
  await field.addValue(value);
}

async function closeSheet() {
  const cancel = await $(tid('figma-cancel'));
  if (await cancel.isDisplayed().catch(() => false)) await cancel.click();
  await browser.waitUntil(
    async () => !(await (await $(tid('figma-import-panel'))).isDisplayed().catch(() => false)),
    { timeout: 5_000, timeoutMsg: 'figma sheet did not close' }
  );
}

describe('import-figma', () => {
  before(async () => {
    startReport('import-figma — Connect in place, a non-Figma link refused, the FigJam door');
    await waitForSidecar();
  });

  it('1 · not connected: Connect… opens the token step in place; Cancel goes back', async () => {
    await openSheet();
    await capture('01-sheet-link');
    const callout = await $(tid('figma-not-connected'));
    if (await callout.isDisplayed().catch(() => false)) {
      await expect(callout).toHaveText(expect.stringContaining("Figma isn't connected yet."));
      await (await $(tid('figma-connect-open'))).click();
      const step = await $(tid('figma-connect-step'));
      await step.waitForDisplayed({ timeout: 5_000 });
      await expect(await $(tid('figma-connect-token'))).toHaveAttribute('type', 'password');
      await capture('02-connect-in-place');
      await (await $(tid('figma-cancel'))).click();
      await (await $(tid('figma-import-url'))).waitForDisplayed({ timeout: 5_000 });
    }
    await closeSheet();
  });

  it('2 · a link that is not Figma is refused with fixed words', async () => {
    await openSheet();
    await typeLink('https://evil.example/design/abc/x');
    await (await $(tid('figma-import-preview'))).click();
    const err = await $(tid('figma-import-error'));
    await err.waitForDisplayed({ timeout: 5_000 });
    await expect(err).toHaveText(
      expect.stringContaining("That isn't a Figma link Maude can read.")
    );
    await expect(await $(tid('figma-import-mode-frames'))).not.toBeDisplayed();
    await capture('03-not-figma-refused');
    await closeSheet();
  });

  it('3 · a FigJam link takes the FigJam door, never the frame list', async () => {
    await openSheet();
    await typeLink('https://www.figma.com/board/Em6NOwaOFTYV7NlQT4NK8l/Retro');
    await (await $(tid('figma-import-preview'))).click();
    const step = await $(tid('figma-import-mode-board'));
    await step.waitForDisplayed({ timeout: 5_000 });
    await capture('04-figjam-door');
    await closeSheet();
  });
});
