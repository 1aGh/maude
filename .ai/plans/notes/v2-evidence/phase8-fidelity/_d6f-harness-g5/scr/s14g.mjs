import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  await h.open('ui-homepage', 3000);
  await k.leftTab('layers');
  await k.inspector(true);
  await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
  await k.fold();
  await page.keyboard.press('Alt+Meta+1'); await sleep(1200);
  await k.deep(hp('[data-cd-id="book"]'), 3);
  const vp = await k.tall(2400);
  if ((await page.locator('[data-testid="fold-inspector"][data-open="true"]').count()) === 0) { await page.locator('[data-testid="fold-inspector-toggle"]').first().click(); await sleep(900); }
  await h.step(`${D}/ed-inspector`, 'The inspector for one button', 'select Book a call; Advanced open; the page taller', async () => {});
  await k.short(vp);
}
