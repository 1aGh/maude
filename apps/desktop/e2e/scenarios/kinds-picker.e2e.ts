import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { focusCanvasFrame, waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 08 Artboard Kinds — the F size picker (S7.20, ak-picker / ak-picker-full): F with nothing selected opens the picker
 * above the toolbar; hovering a tile draws the dashed outline "FB event cover 1920 × 1005" on the canvas; a click
 * lands the artboard WITH its kind (one write); Print › All 7 › Custom size… takes mm and writes `sizeMm` on the nearest
 * larger paper. WRITTEN, NOT RUN in the S7.20 hand-back (the lead runs the desktop lane).
 *
 * Driving model: same as edit-shapes.e2e.ts — MAUDE_CANVAS_ORIGIN_SPLIT=0, so the canvas iframe is same-origin and its
 * toolbar slot is clicked in the frame; the picker is the SHELL's (main document), so its tiles are plain wdio
 * elements. The scenario writes through to disk, so the fixture is snapshotted and restored byte-exact.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('kinds-picker', [SMOKE]);

/** Run `fn` inside the canvas frame with its document and window. */
function inFrame<T>(fn: string, ...args: unknown[]): Promise<T> {
  return browser.execute(
    (src, a) => {
      const iframe = document.querySelector(
        '[data-testid="canvas-frame"]'
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      const win = iframe?.contentWindow;
      if (!doc || !win) return null as never;
      return new (win as unknown as { Function: FunctionConstructor }).Function(
        'doc',
        'win',
        'args',
        src
      )(doc, win, a);
    },
    fn,
    args
  ) as Promise<T>;
}

// The shell refuses a tool-panel request from a canvas that does not hold focus (use-tool-panels.js `hasFocus`), and a
// scripted click inside the frame moves none: hand the focus to the frame first, as a person's click would.
const pressFrame = async () => {
  await focusCanvasFrame();
  return inFrame(`doc.querySelector('[data-testid="toolbar-slot-frame"]').click(); return true;`);
};
const tile = (id: string) => $(`[data-testid="size-picker-tile-${id}"]`);

describe('kinds-picker — F opens the size picker; a tile lands an artboard with its kind', () => {
  before(() => {
    rmSync(join(HERE, '../fixtures/project/.design/_canvas-state'), {
      recursive: true,
      force: true,
    });
    fixtures.snapshot();
    startReport('kinds-picker');
  });
  after(() => fixtures.restore());

  it('F with nothing selected opens the picker: five groups, Search sizes, three up front', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForEditChrome();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await pressFrame();
    await (await $('[data-testid="tool-panel-sizes"]')).waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the size picker never opened',
    });
    for (const g of ['app', 'web', 'social', 'print', 'video'])
      await (await $(`[data-testid="size-picker-group-${g}"]`)).waitForExist();
    expect(await (await $('[data-testid="size-picker-search"]')).getAttribute('placeholder')).toBe(
      'Search sizes — “A5”, “story”, “1920”'
    );
    await capture('size-picker-open');
  });

  it('hovering "FB event cover" draws the dashed outline with its name and size on the canvas', async () => {
    await (await tile('social-fb-event')).moveTo();
    await browser.waitUntil(
      async () =>
        (await inFrame<string | null>(
          `return doc.querySelector('[data-testid="edit-size-ghost-name"]')?.textContent ?? null;`
        )) === 'FB event cover1920 × 1005',
      { timeout: 10_000, timeoutMsg: 'the outline never showed "FB event cover 1920 × 1005"' }
    );
    await capture('size-picker-ghost');
  });

  it('a click lands the artboard with its kind: kind="digital", fixed, 1920 × 1005 — one write', async () => {
    await (await tile('social-fb-event')).click();
    await browser.waitUntil(() => /id="fb-event-cover"/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the artboard never reached the file',
    });
    const src = readFileSync(SMOKE, 'utf8');
    const tag = /<DCArtboard\b[^>]*\bid="fb-event-cover"[^>]*>/.exec(src)?.[0] ?? '';
    for (const part of [
      'kind="digital"',
      'width={1920}',
      'height={1005}',
      'label="FB event cover"',
    ])
      expect(tag).toContain(part);
    expect(tag).toMatch(/\bfixed\b/);
    expect(await (await $('[data-testid="tool-panel-sizes"]')).isExisting()).toBe(false);
    await capture('size-picker-landed');
  });

  it('Custom size… takes mm and writes sizeMm on the nearest larger paper', async () => {
    await pressFrame();
    await (await $('[data-testid="tool-panel-sizes"]')).waitForExist({ timeout: 15_000 });
    await (await $('[data-testid="size-picker-all-print"]')).click();
    await (await tile('print-custom')).click();
    await (await $('[data-testid="size-picker-custom"]')).waitForExist();
    await capture('size-picker-custom');
    await (await $('[data-testid="size-picker-custom-add"]')).click();
    await browser.waitUntil(() => /"sizeMm":\[99,210\]/.test(readFileSync(SMOKE, 'utf8')), {
      timeout: 15_000,
      timeoutMsg: 'the custom print size never reached the file',
    });
    const src = readFileSync(SMOKE, 'utf8');
    expect(src).toMatch(/"paper":"dl"/);
    expect(src).not.toContain('"custom"');
  });
});
