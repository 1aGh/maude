import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';

import { pressMenuRow } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * S8.17 — Import from Figma (canvas 12 · ia-figma-sheets, ia-figjam), DOM-driven.
 *
 * Tests never call the real Figma API, and this app reaches only api.figma.com (no base override: the
 * token would follow it — DDR-216 D2). Legs 1-3 need no Figma answer. Leg 4 (the frame leg) runs under
 * wdio.import-figma.conf.ts, which sets MAUDE_FIGMA_FIXTURE (S8.17b): the studio's Figma client then answers
 * from fixtures/figma — local JSON and SVG files, no network, no account — and the leg is skipped without it.
 *   1. Menu › File › Import from Figma… opens the sheet; with no token it says "Figma isn't connected yet."
 *      and Connect… opens the token step IN PLACE (three steps, a password field); Cancel goes back;
 *   2. a link that is not Figma's is refused with fixed words, and nothing is listed;
 *   3. a FigJam link takes the FigJam door (annotations on the open canvas), never the frame list;
 *   4. (fixture) a design link lists the file's two frames as pictures; Import 2 frames makes ONE canvas of two Fixed
 *      size artboards at Figma px (the file on disk is the assertion), and the summary names what came in.
 *
 * Written, not run, by the slice; run with `pnpm --filter @maude/desktop-e2e e2e:import-figma`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const DESIGN = join(HERE, '../fixtures/project/.design');
const FRAMES_LINK = 'https://www.figma.com/design/k8Fq2abcdEFGH12345678/Uniformy-2027';
const FIXTURE_ON = Boolean(process.env.MAUDE_FIGMA_FIXTURE);
const CANVAS = join(DESIGN, 'ui/Uniformy-2027.tsx');
const META = join(DESIGN, 'ui/Uniformy-2027.meta.json');
const fixtures = createFixtureGuard('import-figma', [CANVAS, META]);
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
    startReport(
      'import-figma — Connect in place, a non-Figma link refused, the FigJam door, the frame leg'
    );
    fixtures.snapshot();
    await waitForSidecar();
  });

  after(() => {
    // the frame leg writes a canvas, its meta and its pictures into the shared fixture project
    if (existsSync(CANVAS)) {
      for (const m of readFileSync(CANVAS, 'utf8').matchAll(/assets\/[0-9a-f]{8}\.svg/g))
        rmSync(join(DESIGN, m[0]), { force: true });
    }
    fixtures.restore();
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
  it('4 · (fixture) a design link: two frames as pictures → one canvas of two Fixed size artboards', async function () {
    if (!FIXTURE_ON) return this.skip();
    await openSheet();
    await typeLink(FRAMES_LINK);
    await (await $(tid('figma-import-preview'))).click();
    await (await $(tid('figma-import-mode-frames'))).waitForDisplayed({ timeout: 10_000 });
    await expect(await $(tid('figma-pictures-line'))).toHaveText(
      expect.stringContaining("Each frame arrives as Figma's exact picture.")
    );
    await expect(await $(tid('figma-import-run'))).toHaveText('Import 2 frames');
    await (await $(tid('figma-dest'))).selectByAttribute('value', 'ui');
    await capture('05-frames-listed');
    await (await $(tid('figma-import-run'))).click();
    await (await $(tid('figma-import-summary'))).waitForDisplayed({ timeout: 20_000 });
    await capture('06-frames-arrived');
    expect(existsSync(CANVAS)).toBe(true);
    const tsx = readFileSync(CANVAS, 'utf8');
    expect(tsx.match(/<DCArtboard/g)?.length).toBe(2);
    expect(tsx).toContain('kind="digital"');
    expect(tsx).toContain('width={900}');
    expect(tsx).toContain('height={1280}');
    expect(tsx).not.toContain('maude-fixture');
    expect(tsx).not.toContain('figma.com');
  });
});
