import { kit } from './g5.mjs';
import { studioSite } from './fx5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-homepage', 3000);
  await k.fold();
  await k.fit();
  await page.mouse.click(150, 800); await sleep(300);
  await page.keyboard.press('Alt+Meta+1'); await sleep(1200);
  await page.keyboard.press('Meta+-'); await sleep(800);
  await page.keyboard.press('n'); await sleep(1300);
  await page.keyboard.press('Escape'); await sleep(300);
  await page.keyboard.press('e'); await sleep(1500);
  await h.click('stickers-search').catch(() => {});
  await page.keyboard.type('done'); await sleep(1200);
  const t = page.locator('[data-testid^="sticker-"]').first();
  await t.click(); await sleep(600);
  await page.mouse.click(1000, 300); await sleep(4000);
  const imgs = await k.fr.locator('.dc-annot-el img').evaluateAll((els) => els.map((e) => ({ src: e.src.slice(0, 120), ok: e.complete && e.naturalWidth > 0 })));
  console.log('IMGS', JSON.stringify(imgs));
  await h.step('probe/q1-drop', 'drop', '', async () => {});
}
