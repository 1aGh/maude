import { $, $$, browser, expect } from '@wdio/globals';
import { waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow, openLeftPanel } from '../helpers/tree';

/**
 * 08 Artboard Kinds / 05 Empty States — the kind chips in the Layers header (S7.24b, ak-mixed-fit, es-filter): the same
 * five chips as the Canvases panel, counted over the OPEN canvas's artboards. Print on a canvas that has none says
 * which filter is on and clears in one click (the kit block), and the canvas dims every artboard (`dim-artboards`)
 * while it is on. The dim is a look: clearing the filter removes it.
 *
 * Driving model: as kinds-picker.e2e.ts — MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas iframe is same-origin and the dim
 * stylesheet is read in the frame; the chips and the block are the SHELL's, plain wdio elements. Selection/view only:
 * nothing is written, so no fixture guard. The fixture's `ui/Smoke.tsx` has one fixed-size/web artboard and no print.
 * WRITTEN, NOT RUN in the S7.24b hand-back (the lead runs the desktop lane; it needs an unlocked screen and the lock).
 */

const chip = (kind: string) => $(`[data-testid="layers-kind-chip-${kind}"]`);

/** Is the canvas dimming something right now? (the one `<style data-ed-kind-dim>` in the canvas document) */
const dimmed = () =>
  browser.execute(() => {
    const iframe = document.querySelector(
      '[data-testid="canvas-frame"]'
    ) as HTMLIFrameElement | null;
    return !!iframe?.contentDocument?.querySelector('style[data-ed-kind-dim]');
  });

describe('layers-kind-filter — the kind chips in the Layers header', () => {
  before(() => {
    startReport('layers-kind-filter');
  });
  after(async () => {
    // the filter is the window's own; leave it as found
    const all = chip('all');
    if (await all.isExisting()) await all.click();
  });

  it('five chips counted over this canvas; All is on and nothing is dimmed', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForEditChrome();
    await openLeftPanel();
    await $('[data-testid="panel-tab-layers"]').click();
    await $('[data-testid="layers-kind-chips"]').waitForExist({ timeout: 30_000 });
    const names = await $$('[data-testid^="layers-kind-chip-"]').map((c) =>
      c.getAttribute('aria-label')
    );
    expect(names.map((n) => (n ?? '').split(',')[0])).toEqual([
      'All',
      'Fixed size',
      'Web page',
      'Print',
      'Video',
    ]);
    await browser
      .waitUntil(
        async () =>
          (await chip('all').getAttribute('aria-pressed')) === 'true' && !(await dimmed()),
        { timeout: 5_000, interval: 100 }
      )
      .catch(() => undefined);
    expect(await chip('all').getAttribute('aria-pressed')).toBe('true');
    expect(await dimmed()).toBe(false);
    await capture('layers-kind-chips-all');
  });

  it('Print on a canvas with no print: the block names the filter, the canvas dims', async () => {
    await openLeftPanel();
    await chip('print').click();
    const none = $('[data-testid="layers-kind-none"]');
    await none.waitForExist({ timeout: 15_000 });
    expect(await none.getText()).toContain('No print artboards in');
    await browser.waitUntil(dimmed, { timeout: 10_000, timeoutMsg: 'the canvas never dimmed' });
    // V2-8.5 C8: "N other artboards are dimmed. Show all" is the FOOT of the list the filter narrowed — and a kind this
    // canvas has none of has no list to narrow: the block above REPLACES the foot, whose way out is its Clear filter.
    expect(await $('[data-testid="layers-kind-foot"]').isExisting()).toBe(false);
    expect(await $('[data-testid="layers-kind-clear"]').isDisplayed()).toBe(true);
    await capture('layers-kind-none');
  });

  it('Clear filter undoes it in one click: the block goes and the canvas is back', async () => {
    await openLeftPanel();
    await $('[data-testid="layers-kind-clear"]').click();
    await browser.waitUntil(
      async () => !(await $('[data-testid="layers-kind-none"]').isExisting())
    );
    await browser.waitUntil(async () => !(await dimmed()), {
      timeout: 10_000,
      timeoutMsg: 'the canvas stayed dimmed',
    });
    expect(await chip('all').getAttribute('aria-pressed')).toBe('true');
  });
});
