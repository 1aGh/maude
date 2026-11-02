import { studio } from './fx4.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-homepage', 4000);
  // fold the left panel so the menu is not over it
  await h.click('panel-fold-left').catch(() => {});
  await sleep(700);
  await f.locator('[data-dc-screen="desktop"] .dc-artboard-label').first().click({ button: 'right', timeout: 6000 });
  await sleep(900);
  await h.step('14-editing/ed-ab-menu.only', 'Right-click an artboard: the menu', 'right-click the artboard name', async () => {});
  const dup = f.getByText('Duplicate at another width', { exact: false }).first();
  await dup.hover({ timeout: 3000 }).catch((e) => console.log('dup hover fail', String(e.message).split('\n')[0]));
  await sleep(800);
  await h.step('14-editing/ed-ab-menu', 'Right-click an artboard: Duplicate at another width', 'hover the row', async () => {});
  await h.step('01-create-flow/cf-duplicate-width', 'Duplicate at another width', 'hover the row', async () => {});
  await page.keyboard.press('Escape');
  await sleep(500);
  // an object
  await f.locator('[data-cd-id="desktop-pricing"]').first().click({ button: 'right', timeout: 6000 });
  await sleep(900);
  await h.step('14-editing/ed-obj-menu.only', 'Right-click an object', 'right-click See pricing', async () => {});
}
