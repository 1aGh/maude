// c7-g15b: 04 md-edit-image - the Image slot is pressed while the Assets panel is open (shell-panels)
import { studioSite } from './fx5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-homepage', 4000);
  await page.mouse.click(328, 301); await sleep(600);
  await page.keyboard.press('Meta+Equal'); await sleep(300); await page.keyboard.press('Meta+Equal'); await sleep(1200);
  await h.step('04-modes/md-edit-image', 'Assets open beside the canvas; Image slot pressed', 'select the hero picture, press the Image slot', async () => {
    const hero = f.locator('[data-cd-id="hero-art"]').first();
    await hero.click({ timeout: 5000 }).catch(() => {}); await sleep(900);
    await f.locator('[data-testid="toolbar-slot-image"]').first().click({ timeout: 4000 }); await sleep(1500);
  });
}
