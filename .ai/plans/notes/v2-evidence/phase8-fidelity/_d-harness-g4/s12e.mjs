import { join } from 'node:path';
import { photos2 } from './fx2.mjs';
export const fixture = photos2;
export const page = { tauri: false };
const D = '12-import-and-assets';

export async function run(h) {
  const { page, sleep, project } = h;
  const palette = async (q) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(600);
    await page.keyboard.press('Enter');
    await sleep(1500);
  };
  // ── details › Advanced ──
  await h.open('ui-photos', 2500);
  await h.click('panel-tab-assets').catch(() => {});
  await sleep(700);
  await h.step('ia-advanced', D, 'asset details › Advanced fold', async () => {
    await page.locator('[data-testid="assets-tile"]').nth(2).click({ button: 'right' });
    await sleep(500);
    await h.click('assets-menu-details');
    await sleep(800);
    await h.click('assets-details-advanced').catch(() => {});
  });
  await h.click('assets-details-close').catch(() => {});
  await h.esc(2);
  await page.reload();
  await sleep(3500);
  await h.open('ui-photos', 2500);
  // ── the photo inspector: a photo with a content-addressed name (assets/<sha8>.jpg) ──
  await h.open('ui-photos', 2500);
  await h.step('ia-photo-inspector', D, 'fixture photo named assets/<sha8>.jpg (as a real import stores it); click the photo on the artboard', async () => {
    await page.mouse.click(900, 460);
    await sleep(1200);
  });
  await h.step('ia-photo-steps', D, 'inspector › Photo section (Look tiles, Remove background…)', async () => {
    const t = page.getByRole('tab', { name: /photo/i }).first();
    if (await t.count()) await t.click().catch(() => {});
    await sleep(900);
  });
  await h.esc(2);
  // ── Generate, with an artboard selected ──
  await h.open('ui-photos', 2500);
  await page.mouse.click(900, 460);
  await sleep(700);
  await h.step('ia-gen-ask', D, 'artboard selected, ⌘K › Generate with AI…', async () => { await palette('Generate'); });
  await h.esc(3);
  // ── the Finder drop: dragenter/dragover INSIDE the canvas iframe, at the artboard's own coordinates ──
  await h.open('ui-spread', 3000);
  await h.step('ia-drop-photos', D, 'SYNTHETIC dragenter+dragover (6 image files) dispatched in the canvas frame at the artboard centre (browser lane: no native file-drop)', async () => {
    const fr = page.frameLocator('[data-testid="canvas-frame"]');
    const ab = fr.locator('[data-dc-screen]').first();
    const box = await ab.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const handle = await ab.evaluateHandle(() => {
      const dt = new DataTransfer();
      for (let i = 0; i < 6; i++) dt.items.add(new File(['x'], `IMG_22${30 + i}.jpg`, { type: 'image/jpeg' }));
      return dt;
    });
    await ab.dispatchEvent('dragenter', { dataTransfer: handle, clientX: box.x, clientY: box.y });
    await ab.dispatchEvent('dragover', { dataTransfer: handle, clientX: box.x, clientY: box.y });
    await sleep(900);
  });
  await page.reload();
  await sleep(3500);
  // ── placed: artboard of six empty frames selected, Assets › From this Mac… with six files ──
  await h.open('ui-spread', 3000);
  await page.mouse.click(900, 470);
  await sleep(900);
  if (!(await page.locator('[data-testid="assets-panel"]').count())) {
    if (!(await page.locator('[data-testid="panel-tab-assets"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(600); }
    await h.click('panel-tab-assets').catch(() => {});
    await sleep(800);
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
    await sleep(3500);
  }, { notice: true });
}
