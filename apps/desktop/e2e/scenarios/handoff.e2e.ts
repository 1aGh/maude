import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 09 · ex-handoff, ex-handoff-ready, ex-handoff-edges (S8.10) — ⇧⌘H opens Handoff to production on the open
 * canvas: the targets come from the project's settings (web registry, React Native, Lottie — off with "needs an
 * animated frame" when nothing moves), Use the design system, the last review line, and Advanced names the ONE
 * file the run may write. Design system › Hand off tokens opens the same sheet on the system's tokens.
 *
 * NO AI RUN IS STARTED: the scenario never presses Hand off (a connected Mac would start a real drafting run).
 * The run itself — scoped to its target file, queued offline, released after Connect — is proven headless in
 * apps/studio/test/handoff-v2.test.ts and test/v2-handoff-sheet.test.tsx.
 * WRITTEN, NOT RUN in the S8.10 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Harness: wdio.handoff.conf.ts → fixtures/seed-ds-outside.ts (system `acme`, three canvases that follow it).
 */
describe('handoff — ⇧⌘H, the targets, Advanced, Hand off tokens', () => {
  before(() => {
    startReport('handoff');
  });

  it('⇧⌘H on an open canvas opens Handoff to production with the targets from settings', async () => {
    await waitForSidecar();
    const rows = await $$('[data-testid^="canvas-row-"]');
    let opened = false;
    for (const r of rows) {
      const id = (await r.getAttribute('data-testid')) ?? '';
      if (id.includes('system-')) continue;
      await r.click();
      opened = true;
      break;
    }
    expect(opened).toBe(true);
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await browser.keys(['Shift', 'Meta', 'h']);
    const sheet = await $('[data-testid="export-sheet"][data-mode="handoff"]');
    await sheet.waitForExist({ timeout: 15_000, timeoutMsg: 'the handoff sheet never opened' });
    expect(await (await $('[data-testid="export-title"]')).getText()).toMatch(
      /^Hand off “.+” to production$/
    );
    expect(await (await $('[data-testid="export-submit-label"]')).getText()).toBe('Hand off');
    await (await $('[data-testid="handoff-target-web"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="handoff-target-web"]')).getAttribute('aria-checked')).toBe(
      'true'
    );
    const lottie = await $('[data-testid="handoff-target-lottie"]');
    expect(await lottie.getAttribute('aria-disabled')).toBe('true');
    expect(await lottie.getText()).toContain('needs an animated frame');
    expect(await (await $('[data-testid="handoff-review"]')).isExisting()).toBe(true);
    await capture('handoff-targets');
  });

  it('Advanced names the one file the run may write; App writes a component in the repo', async () => {
    await (await $('[data-testid="handoff-target-app"]')).click();
    await (await $('[data-testid="handoff-advanced"]')).click();
    const adv = await $('.ho-adv-body');
    await adv.waitForDisplayed({ timeout: 5_000 });
    expect(await adv.getText()).toMatch(/Writes\s+src\/components\/\w+\.tsx/);
    await capture('handoff-advanced');
    await browser.keys(['Escape']);
    await (await $('[data-testid="export-sheet"]')).waitForExist({ reverse: true, timeout: 5_000 });
  });

  it('Design system › Hand off tokens opens the sheet on the system, with the tokens target', async () => {
    // the Files panel starts collapsed: reveal the row the way a person would
    const ds = await canvasRow('canvas-row-system-acme-design-system');
    await ds.click();
    await (await $('[data-testid="ds-advanced"]')).waitForExist({ timeout: 25_000 });
    await (await $('[data-testid="ds-advanced-fold"] summary')).click();
    await (await $('[data-testid="ds-handoff-tokens"]')).click();
    const tokens = await $('[data-testid="handoff-target-tokens"]');
    await tokens.waitForExist({ timeout: 15_000, timeoutMsg: 'the tokens target never appeared' });
    expect(await tokens.getAttribute('aria-checked')).toBe('true');
    await capture('handoff-tokens');
    await browser.keys(['Escape']);
  });
});
