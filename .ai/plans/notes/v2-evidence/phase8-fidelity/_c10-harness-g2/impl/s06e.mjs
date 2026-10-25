// FINAL (D2): ad-ds became reachable (stage C built Design system › Advanced, 13 · ds-advanced). Fixture: the g5 converted-system project.
import { join } from 'node:path';
import { REPO } from './lib.mjs';
export const fixture = async () => join(REPO, '.scr/fx-cache/ds-converted');
export const keepState = true;
export const page = { w: 1440, h: 900 };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-homepage', 3500);
  if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
  await page.locator('[data-testid="canvases-ds-row"]').first().click({ timeout: 6000 });
  await sleep(6000);
  await page.mouse.click(150, 500);
  await sleep(1500);
  await page.locator('[data-testid="panel-icon-left"],[data-testid="panel-fold-left"]').first().click().catch(() => {});
  await sleep(700);
  await page.locator('[data-testid="panel-icon-right"]').first().click().catch(() => {});
  await sleep(1200);
  await h.step(`${D}/ad-ds-pre`, 'Design system canvas, nothing selected', 'open the board', async () => {});
  await h.step(`${D}/ad-ds`, 'Design system › Advanced open', 'open the Advanced fold of the system panel', async () => {
    // C10: the fold is <details open> by default (the board draws it open) - a blind click CLOSED it in D6
    const det = page.locator('[data-testid="ds-advanced-fold"]').first();
    await det.waitFor({ timeout: 6000 });
    if (!(await det.evaluate((el) => el.open))) await det.locator('summary').first().click({ timeout: 6000 });
    await sleep(1200);
  });
}
