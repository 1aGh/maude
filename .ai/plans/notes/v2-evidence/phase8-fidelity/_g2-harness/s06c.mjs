import { alligators } from './fx3.mjs';
export const fixture = alligators;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-combine-kampan', 3500);
  await h.step(`${D}/ad-settings`, 'Settings › Advanced tab', '⌘K › Settings, then the Advanced tab', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Settings'); await sleep(800);
    await page.locator('[data-testid="palette-row-action:settings.open"]').first().click(); await sleep(1200);
    await h.click('settings-tab-advanced');
    await sleep(900);
  });
  await h.esc(3);
  await h.step(`${D}/ad-open-all`, 'Open all Advanced sections (⌘K row)', '⌘K, "open all advanced"', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Open all Advanced'); await sleep(900);
    await page.keyboard.press('Enter'); await sleep(1500);
  });
}
