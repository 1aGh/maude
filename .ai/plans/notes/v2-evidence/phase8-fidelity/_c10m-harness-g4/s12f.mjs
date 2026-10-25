import { photos2 } from './fx2.mjs';
export const fixture = photos2;
export const page = { tauri: false };
const D = '12-import-and-assets';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-photos', 2500);
  await h.click('panel-tab-assets').catch(() => {});
  await sleep(1200);
  await h.step('ia-advanced', D, 'asset details › Advanced fold', async () => {
    await page.locator('[data-testid="assets-tile"]').nth(2).click({ button: 'right' });
    await sleep(700);
    await h.click('assets-menu-details');
    await sleep(900);
    await h.click('assets-details-advanced').catch(() => {});
  });
}
