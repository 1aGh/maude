import { $, browser, expect } from '@wdio/globals';
import { Key } from 'webdriverio';
import { capture, startReport } from '../helpers/evidence';
import { canEnterCanvasFrame, isNativeShell, openApp, target } from '../helpers/target';
import { canvasRow } from '../helpers/tree';

/**
 * One studio, three shells — Cloud Phase 27 E4.
 *
 * THE SAME FILE runs against the native `.app` and against a cloud URL. That is
 * the point: the phase's claim is that a browser loads the byte-identical
 * client the desktop loads, and the way that claim was checked until now was a
 * person opening the site and looking. "Files panel missing in cloud" should be
 * a red build, not a customer email.
 *
 *   pnpm test:e2e:desktop:parity          # the bundled .app
 *   pnpm test:e2e:desktop:parity:cloud    # a cell — local stand-in, or
 *                                         # MAUDE_E2E_CLOUD_URL for a real one
 *
 * WHAT IS ASSERTED IS DELIBERATELY THE SHARED SURFACE. Everything the design is
 * MADE of: the file tree, search, the menubar, the status bar, opening a canvas
 * and getting that canvas, the Inspector and Layers panels (C1 — read-only
 * means cannot change, not cannot see). What legitimately differs lives in
 * `helpers/target.ts` behind a name, not as a branch in here.
 */
describe(`shell parity (${target()})`, () => {
  before(() => startReport(`shell-parity-${target()}`));

  it('shows the same application in either shell', async () => {
    const url = await openApp();
    expect(url).toBeTruthy();
    await capture('app-open');

    // The one thing that legitimately differs at this level: the desktop is a
    // native shell, the cloud is a tab. Asserted rather than assumed, so a
    // parity run that silently fell back to the wrong target says so.
    expect(await isNativeShell()).toBe(target() === 'native');

    // ---- the shared chrome ------------------------------------------------
    for (const testId of ['canvas-list', 'menubar', 'statusbar', 'canvas-search']) {
      const el = await $(`[data-testid="${testId}"]`);
      await el.waitForExist({ timeout: 60_000 });
      expect(await el.isExisting()).toBe(true);
    }
    await capture('chrome-present');
  });

  it('opens a canvas and renders THAT canvas', async () => {
    await openApp();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();

    const frame = await $('[data-testid="canvas-frame"]');
    await frame.waitForExist({ timeout: 30_000 });
    expect(await frame.getAttribute('data-path')).toBe('.design/ui/Smoke.tsx');
    await capture('canvas-open');

    // The canvas iframe's own DOM is reachable only on the desktop: a cell
    // serves canvases from a per-project canvas origin, which is DDR-054 doing
    // its job. Stated here rather than skipped mysteriously.
    expect(canEnterCanvasFrame()).toBe(target() === 'native');
  });

  it('lets a reader OPEN the Inspector — C1', async () => {
    // "Read-only means cannot change, not cannot see." C1 removed Inspector and
    // Layers from `viewerHiddenPanels`; writing this test found that two other
    // gates had been left behind — the ⌘⇧I shortcut refused a viewer, and the
    // panel refused to mount at all — so the View menu offered a panel that
    // could never appear. Both are fixed; this is what keeps them fixed.
    await openApp();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });

    await browser.keys([Key.Command, Key.Shift, 'i']); // ⌘⇧I
    const inspector = await $('[data-testid="inspector-panel"]');
    await inspector.waitForExist({ timeout: 10_000 });
    expect(await inspector.isExisting()).toBe(true);
    await capture('inspector-open');
  });
});
