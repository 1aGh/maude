import { base } from './fx.mjs';
export const fixture = base;
const D = '02';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-smoke', 3000);
  await page.mouse.click(1000, 250);
  await sleep(500);
  await h.tid('palette-row-action:ai.chat').count();
  await page.keyboard.press('Meta+Slash');
  await sleep(1500);
  await h.step(`${D}/ob-edge-ai-missing.probe`, 'Meta+Slash', 'Meta+Slash', async () => {});
  const open = await page.locator('[data-testid="chat-composer"]').count();
  console.log('composer after Meta+Slash:', open);
  if (!open) {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Ask AI'); await sleep(800);
    const rows = await page.$$eval('[data-testid^="palette-row"]', (e) => e.map((x) => x.getAttribute('data-testid')).slice(0, 8));
    console.log('rows', rows.join(','));
  }
}
