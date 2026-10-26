import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasOpened } from '../helpers/canvas-frame';
import { openInspector } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { dsRow } from '../helpers/tree';

/**
 * 13 · ds-edge-contrast, ds-edge-trash (S10.17) — select the text colour that falls short on the Design system canvas:
 * the inspector says so quietly and offers "Lighten to 4.5:1"/"Darken to 4.5:1"; pressing it leaves ONE change waiting
 * and the warning gone. Then select the line colour two canvases use: "Move to trash…" opens the sheet that says which
 * colour the canvases follow, and Cancel changes nothing.
 * WRITTEN, NOT RUN in the S10.17 hand-back (the lead runs the desktop lane, under the lock).
 *
 * Boots into wdio.ds-edges.conf.ts's project. Driving model as ds-reach.e2e.ts: the pilot runs with the origin split
 * off, so the Design system canvas frame is same-origin and a swatch is found by its `data-ds-token`; everything after
 * the click is the shell's own DOM. The off-system question needs a git history for "changed lines" and is proven in
 * ds-edges.test.ts / v2-ds-edges.test.tsx, not here.
 */
const ROOT = process.env.MAUDE_E2E_DS_EDGES_ROOT ?? '';
/** The tokens with a change waiting, as the engine left them in the system canvas's meta (`dsPending.tokens`). */
const pendingTokens = (): string[] => {
  const file = join(ROOT, '.design', 'system', 'acme', 'design-system.meta.json');
  if (!existsSync(file)) return [];
  const meta = JSON.parse(readFileSync(file, 'utf8')) as { dsPending?: { tokens?: object } };
  return Object.keys(meta.dsPending?.tokens ?? {}).sort();
};
const swatchCentre = (css: string) =>
  browser.execute((token) => {
    const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const el = f?.contentDocument?.querySelector(
      `[data-ds-token="${token}"]`
    ) as HTMLElement | null;
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }, css);

async function clickInFrame(x: number, y: number): Promise<void> {
  // (x, y) are the swatch's centre INSIDE the frame; the pointer helper takes a window coordinate and
  // raises pointer + mouse + click events on whatever is under it, through the frame
  const off = (await browser.execute(() => {
    const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
    const r = f.getBoundingClientRect();
    return { x: r.left, y: r.top };
  })) as { x: number; y: number };
  // the first click on a board's content selects the ARTBOARD (Colour); the second goes in to the element
  await pointerClick(off.x + x, off.y + y);
  await browser.pause(1_000);
  await pointerClick(off.x + x, off.y + y);
}

async function select(css: string): Promise<void> {
  await browser.waitUntil(async () => (await swatchCentre(css)) !== null, {
    timeout: 30_000,
    timeoutMsg: `the ${css} swatch never drew on the Design system canvas`,
  });
  const at = (await swatchCentre(css)) as { x: number; y: number };
  await clickInFrame(at.x, at.y);
  await openInspector();
}

describe('ds-edges — a quiet contrast warning with the fix, and a colour to the trash', () => {
  before(() => {
    startReport('ds-edges');
  });

  it('selects the text colour that falls short: the warning offers the fix', async () => {
    await waitForSidecar();
    const row = await dsRow('acme');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await (await $('[data-testid="canvas-frame"]')).waitForExist({ timeout: 30_000 });
    await waitForCanvasOpened();
    await select('--fg-2');
    const line = await $('[data-testid="ds-token-contrast"]');
    await line.waitForExist({ timeout: 20_000 });
    expect(await line.getAttribute('data-tone')).toBe('warn');
    expect(await (await $('[data-testid="ds-contrast-fix"]')).getText()).toMatch(
      /^(Lighten|Darken) to 4\.5:1$/
    );
    expect(await (await $('[data-testid="ds-contrast-short"]')).getText()).toContain(
      'Falls short in 2 canvases'
    );
    await capture('ds-edges-contrast-warning');
  });

  it('pressing it leaves one change waiting, and the pair now clears', async () => {
    await (await $('[data-testid="ds-contrast-fix"]')).click();
    await browser.waitUntil(
      async () =>
        (await $('[data-testid="ds-token-contrast"]'))
          .getAttribute('data-tone')
          .then((t) => t === 'ok'),
      { timeout: 20_000, timeoutMsg: 'the contrast line never turned ok after the fix' }
    );
    // The change waits in the Design system canvas's own meta (`dsPending`, engine.ts withPending) — the disk says
    // whether the engine took it; the bar says whether the canvas drew it. Two assertions, so a red tells which broke.
    await browser.waitUntil(() => pendingTokens().includes('--fg-2'), {
      timeout: 20_000,
      timeoutMsg: `the engine never recorded the fix as a waiting change (dsPending tokens: ${JSON.stringify(pendingTokens())})`,
    });
    expect(pendingTokens()).toEqual(['--fg-2']);
    let barSaid: string | null | undefined;
    try {
      await browser.waitUntil(
        async () => {
          barSaid = await browser.execute(() => {
            const f = document.querySelector('[data-testid="canvas-frame"]') as HTMLIFrameElement;
            return f?.contentDocument?.querySelector('[data-testid="ds-bar-pending"]')?.textContent;
          });
          return barSaid === '1 change waiting';
        },
        { timeout: 30_000 }
      );
    } catch {
      throw new Error(
        `the engine holds one waiting change but the bar does not say so (the bar said ${JSON.stringify(barSaid)} — null is no bar at all)`
      );
    }
    await capture('ds-edges-contrast-fixed');
  });

  it('Move to trash… says which colour the canvases follow; Cancel changes nothing', async () => {
    await select('--x-line-fine');
    await (await $('[data-testid="ds-token-advanced"]')).click();
    await (await $('[data-testid="ds-token-trash"]')).click();
    await (await $('[data-testid="ds-trash"]')).waitForExist({ timeout: 15_000 });
    expect(await (await $('[data-testid="ds-trash-line"]')).getText()).toMatch(
      /^2 canvases use it\. They switch to .+, the closest colour, so nothing breaks\.$/
    );
    expect(await (await $('[data-testid="ds-trash-back"]')).getText()).toBe(
      'Restore from the Trash puts it back in all 2.'
    );
    await capture('ds-edges-trash-sheet');
    await (await $('[data-testid="ds-trash-cancel"]')).click();
    await (await $('[data-testid="ds-trash"]')).waitForExist({ reverse: true, timeout: 10_000 });
  });
});
