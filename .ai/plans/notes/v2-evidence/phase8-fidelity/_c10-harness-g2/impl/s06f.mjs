// Round 7 (p8-c7-oboard): harness fixes for 06 - the Advanced body in frame (ad-inspector), the Menu > Diagnostics
// submenu (ad-diag), the Advanced tab of Settings (ad-settings, ad-open-all), Logs with the desktop stub still on
// (Show in Finder is a desktop-only row; s06b deleted __TAURI__ for ad-share and never put it back).
import { alligators } from './fx3.mjs';
export const fixture = alligators;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  await h.open('ui-combine-kampan', 3500);
  // ad-inspector: the open fold's body (Element / Used in / Tokens bound / CSS / Copy code), scrolled into the frame
  await h.step(`${D}/ad-inspector`, 'Inspector, with the Advanced rows', 'meta-click the headline, open Advanced, scroll its body into frame', async () => {
    await f.locator('[data-cd-id="post-headline"]').first().click({ modifiers: ['Meta'], timeout: 5000 });
    await sleep(1000);
    const fold = page.locator('[data-testid="fold-inspector"]').first();
    if (!(await fold.getAttribute('data-open').catch(() => null))) await page.locator('[data-testid="fold-inspector-toggle"]').first().click({ timeout: 4000 });
    await sleep(900);
    await page.evaluate(() => {
      const b = document.querySelector('[data-testid="fold-inspector-body"]') || document.querySelector('[data-testid^="adv-group-"]');
      b?.parentElement?.scrollIntoView({ block: 'start' });
    });
    await sleep(800);
  });
  await h.esc(2);
  // ad-diag: the Menu > Diagnostics submenu (status words, Logs, Reload canvas, Check AI setup again, Advanced)
  await h.step(`${D}/ad-diag`, 'Menu › Diagnostics', 'project pill, Diagnostics submenu', async () => {
    await page.locator('[data-tour="menus"]').first().click({ timeout: 5000 });
    await sleep(700);
    await page.locator('[data-testid="project-menu-row-sub-diagnostics"]').first().click({ timeout: 5000 });
    await sleep(900);
  });
  await h.esc(3);
  await h.step(`${D}/ad-logs`, 'Diagnostics — Logs', '⌘K › Logs (desktop stub on)', async () => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('diagnostics'); await sleep(700);
    await h.click('palette-row-action:diag.logs');
    await sleep(1400);
  });
  await h.esc(3);
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
