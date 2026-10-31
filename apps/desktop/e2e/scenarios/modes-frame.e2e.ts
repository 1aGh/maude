import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * r2-p3 — `modes-frame`: Edit → Preview → Edit changes only the toolbar (Michal TD1d, decision
 * maude/v2-michal-ux-audit-td-decisions). The project pill and the Share cluster keep their place and form
 * (`data-cluster="full"` in both modes), Undo stays (`zoom-undo-undo`), and the switch names its mode and key
 * (TD1b). Read from the SHELL DOM only (the canvas iframe is not reachable by DOM). Lane: `e2e:modes-frame`.
 */

const tid = (id: string) => `[data-testid="${id}"]`;

const pressed = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="palette-mode-"]'))
      .filter((e) => e.getAttribute('aria-pressed') === 'true')
      .map((e) => (e.getAttribute('data-testid') ?? '').replace('palette-mode-', ''))
  );

async function landsOn(mode: string) {
  await browser
    .waitUntil(async () => (await pressed()).join() === mode, { timeout: 4000, interval: 100 })
    .catch(() => undefined);
  expect(await pressed()).toEqual([mode]);
}

/** The frame's fixed parts: where they are and what form they take. */
const frame = () =>
  browser.execute(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].map((n) => Math.round(n)).join(',');
    };
    return {
      cluster:
        document.querySelector('[data-testid="share-cluster"]')?.getAttribute('data-cluster') ??
        null,
      undo: !!document.querySelector('[data-testid="zoom-undo-undo"]'),
      pill: box('.sh-pill.island'),
      clusterBox: box('[data-testid="share-cluster"]'),
    };
  });

describe('modes-frame (r2-p3, TD1d)', () => {
  before(async () => {
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await $(tid('canvas-frame')).waitForExist({ timeout: 15000 });
  });

  it('Edit → Preview → Edit: the Share cluster stays full, Undo stays, the pill and cluster do not move', async () => {
    const report = startReport('modes-frame');
    await landsOn('edit');
    await browser.pause(400);
    const edit = await frame();
    expect(edit.cluster).toBe('full');
    expect(edit.undo).toBe(true);
    expect(await $(tid('palette-mode-preview')).getAttribute('title')).toBe('Preview  ⌥⌘P');
    await capture(report, '01-edit');

    await $(tid('palette-mode-preview')).click();
    await landsOn('preview');
    await browser.pause(600);
    const preview = await frame();
    expect(preview).toEqual(edit);
    expect(await $(tid('mode-switch-live')).getProperty('textContent')).toBe('Preview');
    await capture(report, '02-preview');

    await $(tid('palette-mode-edit')).click();
    await landsOn('edit');
    await browser.pause(600);
    expect(await frame()).toEqual(edit);
    await capture(report, '03-edit-again');
  });
});
