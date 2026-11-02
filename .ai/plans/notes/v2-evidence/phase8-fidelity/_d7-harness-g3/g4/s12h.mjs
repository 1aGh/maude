import { join } from 'node:path';
import { photos2 } from './fx2.mjs';
export const fixture = photos2;
export const page = { tauri: false };
const D = '12-import-and-assets';

export async function run(h) {
  const { page, sleep, project } = h;
  // ── the photo inspector: ⌘-click goes deep to the photo (a plain click selects the artboard) ──
  await h.open('ui-photos', 4000);
  await h.step('ia-photo-inspector', D, 'fixture photo named assets/<sha8>.jpg; ⌘-click the photo on the artboard (deep select)', async () => {
    await page.keyboard.down('Meta');
    await page.mouse.click(900, 460);
    await page.keyboard.up('Meta');
    await sleep(1800);
  });
  await h.step('ia-photo-steps', D, 'inspector › Photo section (Look tiles, Remove background…)', async () => {
    const t = page.getByRole('tab', { name: /photo/i }).first();
    if (await t.count()) await t.click().catch(() => {});
    await sleep(1500);
  });
  await h.esc(2);
  // ── placed: Spread artboard selected, Assets › From this Mac… with six files ──
  await h.open('ui-spread', 4000);
  await page.mouse.click(900, 470);
  await sleep(1200);
  if (!(await page.locator('[data-testid="assets-panel"]').count())) {
    if (!(await page.locator('[data-testid="panel-tab-assets"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(600); }
    await h.click('panel-tab-assets').catch(() => {});
    await sleep(1000);
  }
  await h.step('ia-placed', D, 'Spread artboard (six empty frames) selected, Assets › From this Mac… › file chooser with 6 files', async () => {
    const p = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    const b = page.locator('[data-testid="assets-from-mac"]').first();
    await b.scrollIntoViewIfNeeded().catch(() => {});
    await b.click({ force: true, timeout: 5000 });
    const fc = await p;
    if (!fc) throw new Error('no filechooser');
    const as = join(project, '.design/assets');
    await fc.setFiles(['IMG_2231', 'IMG_2232', 'IMG_2240', 'Matchday-02', 'Matchday-03', 'Team-photo'].map((n) => join(as, n + '.jpg')));
    await sleep(7000);
  }, { notice: true });
}
