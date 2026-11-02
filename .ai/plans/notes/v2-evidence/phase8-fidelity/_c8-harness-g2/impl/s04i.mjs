// c7-g15b: 04 md-edit-image - the Image slot is pressed while the Assets panel is open (shell-panels)
import { studioSite } from './fx5.mjs';
// D5: the board's Assets panel holds six photos (Photos group); the g5 site fixture has none, so seed the same six as the 04 studio fixture (fx4)
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export const fixture = async () => {
  const d = await studioSite();
  const as = join(d, '.design/assets');
  mkdirSync(as, { recursive: true });
  cpSync(join(import.meta.dirname, '../../.ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g2/fixtures/photos'), as, { recursive: true });
  return d;
};
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
