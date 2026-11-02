// trimmed s10.mjs: the three comment frames of 10 (+ 04 md-comment's twin shot, same lane)
import { base } from './fx.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';

export async function run(h) {
  const { page, sleep } = h;
  const closeLeft = async () => {
    await h.click('panel-fold-left').catch(() => {});
    await sleep(500);
  };
  const comment = async (text, x = 760, y = 420) => {
    await h.click('palette-mode-preview');
    await sleep(900);
    await page.keyboard.press('c');
    await sleep(500);
    await page.mouse.click(x, y);
    await sleep(900);
    await page.keyboard.type(text);
    await sleep(500);
  };
  await h.open('ui-smoke', 1500);
  await closeLeft();
  await h.step('co-comment-thread', D, 'Preview › C › click › type (+ Comments panel opened)', async () => {
    // the Comment tool docks the Comments panel by itself now (P8 C5): no click on the cluster
    await comment('Korektura je hotová, @Te', 900, 520);
    await page.keyboard.press('Meta+Enter');
    await sleep(1500);
    const fr = page.frameLocator('[data-testid="canvas-frame"]');
    await fr.locator('.cm-pin').first().click({ timeout: 4000 });
    await sleep(800);
    await fr.locator('.cm-thread__reply-textarea').first().click({ timeout: 4000 });
    await page.keyboard.type('Díky, opraveno. @Te');
    await sleep(800);
  });
  await h.esc(2);
  await h.open('ui-video', 3000);
  await h.step('co-comment-video', D, 'Preview, comment tool on the video artboard', async () => {
    await h.click('palette-mode-preview');
    await sleep(900);
    await page.keyboard.press('c');
    await sleep(400);
    await page.mouse.click(800, 420);
    await sleep(900);
  });
  await h.esc(3);
  await h.open('ui-print', 2000);
  // round 8: the board draws the print guides (trim, safe margin) and the "Bleed 3 mm · trim · safe margin 5 mm" legend: View > Print guides, through ⌘K
  await page.keyboard.press('Meta+k');
  await sleep(600);
  await page.keyboard.type('Print guides');
  await sleep(800);
  await page.keyboard.press('Enter');
  await sleep(1200);
  await h.step('co-comment-print', D, 'Preview, comment tool on the print artboard', async () => {
    await h.click('palette-mode-preview').catch(() => {});
    await sleep(800);
    await page.keyboard.press('c');
    await sleep(400);
    await page.mouse.click(700, 420);
    await sleep(900);
  });
  await h.esc(3);
}
