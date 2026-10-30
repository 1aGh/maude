import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { focusCanvasFrame, waitForEditChrome } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { withNetProbe } from '../helpers/net-probe';
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
  return inFrame(
    `const b = doc.querySelector('[data-testid="toolbar-slot-frame"]'); if (!b) return false; b.click(); return true;`
  );
};
/**
 * Frame, until the shell's size picker is up. p8-e2e-fix-r11: right after a tile landed an artboard the canvas
 * hot-swaps its module (hmr-broadcast.ts `module`: the canvas content re-mounts), and a press in that window was
 * lost (r11 B/f1: no picker in 15 s). Press again only while the picker is absent and the slot does not read
 * pressed, 2.5 s apart, so a slow-opening picker is never toggled shut.
 */
//
// p8-e2e-fix-r12: F opens the picker only with NO artboard selected (size-ghost.tsx `sizesPanelRequest`); with one
// selected it arms drawing a frame inside it. A tile selects the artboard it lands, and under load that selection
// arrived before the next press: Frame read pressed, no picker, and the loop above never pressed again (r11 C1/C2 —
// the failure shot shows "FB event cover" selected in the size panel). Pressed with no picker 2.5 s on is that
// state: Esc twice (the tool, then the selection — `esc: steps-back`) and press again.
const openSizes = async () => {
  let presses = 0;
  let escapes = 0;
  let last = 0;
  await browser.waitUntil(
    async () => {
      if (await (await $('[data-testid="tool-panel-sizes"]')).isExisting()) return true;
      if (Date.now() - last < 2500) return false;
      const pressed = await inFrame<string | null>(
        `return doc.querySelector('[data-testid="toolbar-slot-frame"]')?.getAttribute('aria-pressed') ?? null;`
      );
      if (pressed === 'true') {
        await focusCanvasFrame();
        await browser.keys(['Escape']);
        await browser.pause(150);
        await browser.keys(['Escape']);
        escapes++;
        last = Date.now() - 2000; // press again on the next round, not 2.5 s later
        return false;
      }
      if (await pressFrame()) {
        presses++;
        last = Date.now();
      }
      return false;
    },
    { timeout: 20_000, interval: 250, timeoutMsg: 'the size picker never opened' }
  );
  if (presses > 1 || escapes > 0)
    console.warn(
      `[kinds-picker] Frame pressed ${presses} times, armed-without-picker cleared ${escapes} times`
    );
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
    await openSizes();
    for (const g of ['app', 'web', 'social', 'print', 'video'])
      await (await $(`[data-testid="size-picker-group-${g}"]`)).waitForExist();
    expect(await (await $('[data-testid="size-picker-search"]')).getAttribute('placeholder')).toBe(
      'Search sizes — “A5”, “story”, “1920”'
    );
    await capture('size-picker-open');
  });

  it('hovering "FB event cover" draws the dashed outline with its name and size on the canvas', async () => {
    // the tile shows its outline on mouse-enter / focus; the embedded WebDriver's pointer move reaches neither, so
    // raise what a hover raises (React derives onMouseEnter from `mouseover`)
    await browser.execute(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-testid="size-picker-tile-social-fb-event"]'
      );
      el?.dispatchEvent(
        new MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
          relatedTarget: document.body,
        })
      );
      el?.focus();
    });
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
    await openSizes();
    await (await $('[data-testid="size-picker-all-print"]')).click();
    await (await tile('print-custom')).click();
    await withNetProbe(async () => {
      await (await $('[data-testid="size-picker-custom"]')).waitForExist({ timeout: 10_000 });
    }, false);
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
