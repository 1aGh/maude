// 04 md-comment: the Comment tool in Preview, the Comments panel docked by arming it, a pin and its composer
import { studio } from './fx4.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900 };
const D = '04-modes';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const el = (id) => f.locator(`[data-cd-id="${id}"]`).first();
  await h.open('ui-homepage', 4000);
  await h.click('palette-mode-preview');
  await sleep(1800);
  await h.step(`${D}/md-comment`, 'Comment tool: the panel docked, a pin and a composer', 'Preview, Comment tool, click on the artboard, type', async () => {
    await f.locator('[data-testid="toolbar-slot-comment"]').first().click({ timeout: 4000 });
    await sleep(600);
    await el('tablet-h1').click({ timeout: 4000 });
    await sleep(900);
    await page.keyboard.type('Cards on tablet — tighten the gap');
    await sleep(500);
  });
  await h.esc(2);
}
