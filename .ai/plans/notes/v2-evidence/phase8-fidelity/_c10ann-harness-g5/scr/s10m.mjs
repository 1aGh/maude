// C6: 10 co-comment-thread + co-sync-offline only (the offline day is seeded: a Mac that went offline yesterday 18:20)
import { base } from './fx.mjs';
import { fakeSync } from './s10.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';

export async function run(h) {
  const { page, sleep } = h;
  const ctx = page.context();
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
  const who = await page
    .frameLocator('[data-testid="canvas-frame"]')
    .locator('.cm-thread__author, .cm-pin')
    .allInnerTexts()
    .catch(() => []);
  console.log('THREAD-WHO', JSON.stringify(who));
  await h.esc(3);
  // ── offline: this Mac has held its changes since yesterday 18:20 (the per-Mac "since" survives a relaunch) ──
  await fakeSync(page, { pending: 14 });
  await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(18, 20, 0, 0);
    try {
      localStorage.setItem('maude-offline-since', String(d.getTime()));
    } catch (e) {}
  });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 800);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(600);
  await ctx.setOffline(true);
  await sleep(2500);
  await h.step('co-sync-offline', D, 'FAKED linked project + browser offline + /_api/outbox pending=14 + since yesterday 18:20: panel foot + cluster word', async () => {});
  await ctx.setOffline(false);
}
