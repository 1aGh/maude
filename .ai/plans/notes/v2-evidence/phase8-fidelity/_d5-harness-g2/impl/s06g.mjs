// Round 7b (p8-c7-g0607b): ad-pinned - Canvases left + Inspector right, both PINNED, Advanced fold open on the Inspector
import { alligators } from './fx3.mjs';
export const fixture = alligators;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-combine-kampan', 3500);
  await h.step(`${D}/ad-pinned`, 'Pin panels to the side - Canvases + Inspector docked', 'Menu > View > Pin panels, select an artboard, Advanced open', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('pin panels'); await sleep(800);
    await page.keyboard.press('Enter'); await sleep(1200);
    await h.board(1060, 330, 1200);
    const t = page.locator('[data-testid="fold-inspector-toggle"]').first();
    if (await t.count()) { const fold = page.locator('[data-testid="fold-inspector"]').first(); if (!(await fold.getAttribute('data-open').catch(() => null))) await t.click({ timeout: 4000 }); }
    await sleep(900);
  });
}
