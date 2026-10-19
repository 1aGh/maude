import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 13 · ds-edit-review, part 1 (S10.8) — a design-system change waits; "Update N canvases" is the one place it
 * reaches the canvases: edit → review → untick a canvas → Update → it keeps the old look with a dot → ⌘Z takes
 * the update back. WRITTEN, NOT RUN in the S10.8 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Boots into a generated project (wdio.ds-review.conf.ts → fixtures/seed-ds-review.ts): system `acme`
 * converted, three canvases that follow it (Home, Landing, Pricing), and one change waiting (Accent).
 *
 * Driving model: same as edit-artboards.e2e.ts — the pilot runs with MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas
 * iframe is same-origin; the one click inside it ("Review…" on the Design system bar) is a DOM click in that
 * frame. Everything else is the shell's own DOM (the sheet, the Canvases rows). The project is a throwaway temp
 * dir, so there is nothing to restore.
 */
const ROOT = process.env.MAUDE_E2E_DS_REVIEW_ROOT ?? '';
const metaOf = (rel: string): Record<string, unknown> => {
  const file = join(ROOT, '.design', rel.replace(/\.tsx$/, '.meta.json'));
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
};
const tick = (path: string) => $(`[data-testid="ds-review-tick"][data-path="${path}"]`);

describe('ds-review (part 1) — edit, review, untick, Update, dot, ⌘Z', () => {
  before(() => {
    startReport('ds-review (part 1)');
  });

  it('opens the Design system canvas: the bar says one change waits', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-system-acme-design-system');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return (
            f?.contentDocument?.querySelector('[data-testid="ds-bar-pending"]')?.textContent ===
            '1 change waiting'
          );
        }),
      { timeout: 30_000, timeoutMsg: 'the bar never said "1 change waiting"' }
    );
    await capture('ds-bar-one-change-waiting');
  });

  it('Review… opens "Update 3 canvases" — followers ticked, the head count in words', async () => {
    await browser.execute(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const button = f.contentDocument?.querySelector('[data-testid="ds-bar-review"]');
      (button as HTMLElement).click();
    });
    await (await $('[data-testid="ds-review"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="ds-review-title"]')).getText()).toBe(
      'Update canvases with the new Accent?'
    );
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe('Update 3 canvases');
    expect((await $$('[data-testid="ds-review-row"]')).length).toBe(3);
    for (const p of ['ui/Home.tsx', 'ui/Landing.tsx', 'ui/Pricing.tsx'])
      expect(await (await tick(p)).getAttribute('aria-checked')).toBe('true');
    await capture('ds-review-three-ticked');
  });

  it('untick Landing: the button counts down and the row says what it keeps', async () => {
    await (await tick('ui/Landing.tsx')).click();
    expect(await (await $('[data-testid="ds-review-update"]')).getText()).toBe('Update 2 canvases');
    expect(await (await $('[data-testid="ds-review-head"]')).getText()).toBe('2 of 3 canvases');
    const note = await $(
      '[data-testid="ds-review-row"][data-path="ui/Landing.tsx"] [data-testid="ds-review-note"]'
    );
    expect(await note.getText()).toContain('keeps the old Accent');
    await capture('ds-review-landing-unticked');
  });

  it('Update: the followers carry on, Landing keeps the old head and its row says "update"', async () => {
    await (await $('[data-testid="ds-review-update"]')).click();
    await (await $('[data-testid="ds-review"]')).waitForExist({ reverse: true, timeout: 20_000 });
    await browser.waitUntil(() => typeof metaOf('ui/Landing.tsx').dsRev === 'string', {
      timeout: 20_000,
      timeoutMsg: 'Landing never got its dsRev (it should keep the old head)',
    });
    expect(metaOf('ui/Home.tsx').dsRev).toBeUndefined();
    expect(metaOf('ui/Pricing.tsx').dsRev).toBeUndefined();
    const landing = await canvasRow('canvas-row-ui-landing');
    await browser.waitUntil(async () => (await landing.getText()).includes('update'), {
      timeout: 15_000,
      timeoutMsg: 'the Landing row never showed the quiet "update" word',
    });
    await capture('ds-review-updated-landing-left-out');
  });

  it('⌘Z takes all of it back: Landing follows again and the row is quiet', async () => {
    await browser.execute(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await browser.keys(['Meta', 'z']);
    await browser.waitUntil(() => metaOf('ui/Landing.tsx').dsRev === undefined, {
      timeout: 20_000,
      timeoutMsg: '⌘Z never took the update back',
    });
    const landing = await canvasRow('canvas-row-ui-landing');
    expect(await landing.getText()).not.toContain('update');
    await capture('ds-review-undone');
  });
});
