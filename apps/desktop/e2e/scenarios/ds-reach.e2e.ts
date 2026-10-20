import { $, $$, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 13 · ds-edit-reach (S10.9) — "Used in 5 canvases · Show": select the Accent swatch on the Design system canvas,
 * press Show, and the reach view draws every place the colour lands, ringed, in live renders of the canvases that
 * use it; then the same review list opens beside it. Close goes back and changes nothing.
 * WRITTEN, NOT RUN in the S10.9 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Boots into wdio.ds-reach.conf.ts's project: system `acme` converted, the Accent change waiting, ui/Home (two
 * buttons read var(--accent)) and ui/Pricing (one) each with an artboard. Driving model: as ds-review.e2e.ts — the
 * pilot runs with the origin split off, so the Design system canvas frame is same-origin and the swatch is found
 * by its `data-ds-token`; the swatch is selected with a ⌘-less click at its centre. Everything after that is the
 * shell's own DOM (the inspector's Show, the reach view and its list). The preview frames are canvas iframes —
 * their rings are the shell's overlay, counted from the shell.
 */
const swatchCentre = () =>
  browser.execute(() => {
    const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const el = f?.contentDocument?.querySelector(
      '[data-ds-token="--accent"]'
    ) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  });

async function clickInFrame(x: number, y: number): Promise<void> {
  await browser.execute(
    (px, py) => {
      const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
      const doc = f.contentDocument as Document;
      const target = doc.elementFromPoint(px, py) ?? doc.body;
      for (const type of ['pointerdown', 'pointerup', 'click'])
        target.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: px, clientY: py, button: 0 })
        );
    },
    x,
    y
  );
}

describe('ds-reach — Show draws every place ringed, then the review list opens', () => {
  before(() => {
    startReport('ds-reach');
  });

  it('opens the Design system canvas and selects the Accent swatch; the inspector says where it is used', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-system-acme-design-system');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await browser.waitUntil(async () => (await swatchCentre()) !== null, {
      timeout: 30_000,
      timeoutMsg: 'the Accent swatch never drew on the Design system canvas',
    });
    const at = (await swatchCentre()) as { x: number; y: number };
    await clickInFrame(at.x, at.y);
    await (await $('[data-testid="ds-token-used"]')).waitForExist({ timeout: 20_000 });
    expect(await (await $('[data-testid="ds-token-used"]')).getText()).toContain('Used in');
    await capture('ds-reach-used-line');
  });

  it('Show opens the reach view: a frame per artboard, the whole-view tag in words', async () => {
    await (await $('[data-testid="ds-token-show"]')).click();
    await (await $('[data-testid="ds-reach"]')).waitForExist({ timeout: 20_000 });
    expect(await (await $('[data-testid="ds-reach-title"]')).getText()).toBe(
      'One colour, everywhere it lands'
    );
    await browser.waitUntil(async () => (await $$('[data-testid="ds-reach-frame"]')).length === 2, {
      timeout: 15_000,
      timeoutMsg: 'the view never drew a frame for Home and one for Pricing',
    });
    expect(await (await $('[data-testid="ds-reach-tag"]')).getText()).toMatch(
      /^2 patterns · \d+ places$/
    );
  });

  it('every place is ringed (the canvases answer where the elements are drawn)', async () => {
    await browser.waitUntil(async () => (await $$('[data-testid="ds-reach-ring"]')).length >= 3, {
      timeout: 45_000,
      timeoutMsg: 'the three Accent buttons were never ringed (Home 2, Pricing 1)',
    });
    expect((await $$('[data-testid="ds-reach-line"]')).length).toBe(2);
    await capture('ds-reach-rings');
  });

  it('then the same review list opens: the followers ticked, Update counts them', async () => {
    await (await $('[data-testid="ds-reach-review"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="ds-reach-review-title"]')).getText()).toBe(
      'Update canvases with the new Accent?'
    );
    expect((await $$('[data-testid="ds-reach-row"]')).length).toBe(3);
    expect(await (await $('[data-testid="ds-reach-update"]')).getText()).toBe('Update 3 canvases');
    await capture('ds-reach-review-list');
  });

  it('Close goes back to the canvas and changes nothing', async () => {
    await (await $('[data-testid="ds-reach-close"]')).click();
    await (await $('[data-testid="ds-reach"]')).waitForExist({ reverse: true, timeout: 10_000 });
    // the change still waits
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
          return (
            f?.contentDocument?.querySelector('[data-testid="ds-bar-pending"]')?.textContent ===
            '1 change waiting'
          );
        }),
      { timeout: 15_000, timeoutMsg: 'closing the reach view changed what waits' }
    );
  });
});
