import { studioSite } from './fx5.mjs';
export const fixture = studioSite;
export const page = { w: 1440, h: 900 };
export async function run(h) {
  const { page, sleep } = h;
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  const ids = async () => (await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))).join(' ');
  await h.open('ui-homepage', 3000);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(500);
  await fr.locator('[data-dc-screen="desktop"] .dc-artboard-label').first().click();
  await sleep(900);
  console.log('A', await ids());
  await page.mouse.click(1408, 85);
  await sleep(900);
  console.log('B', await ids());
  await h.step('x/insp', 'inspector', 'x', async () => {});
  const fids = await fr.locator('[data-testid]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  console.log('F', fids.join(' ').slice(0, 1500));
}
