import { empty } from './fx.mjs';
export const fixture = empty;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  const act = async (id, q) => {
    await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type(q); await sleep(800);
    await page.locator(`[data-testid="palette-row-action:${id}"]`).first().click(); await sleep(1500);
  };
  await act('canvas.new', 'new canvas');
  await sleep(3500);
  await h.click('panel-icon-assistant');
  await sleep(1200);
  const btns = await page.$$eval('[data-testid="ai-chat-header"] button', (e) => e.map((x) => (x.getAttribute('data-testid') || '') + ':' + (x.getAttribute('aria-label') || x.textContent.trim().slice(0, 12))));
  console.log('header buttons', btns.join(' | '));
  console.log((await page.locator('[data-testid="ai-chat-header"]').first().evaluate((e) => e.outerHTML)).slice(0, 1400));
  process.exit(0);
  await sleep(900);
  const ids = await page.$$eval('[data-testid^="ai-chat-list"]', (e) => e.map((x) => x.getAttribute('data-testid') + '<' + x.tagName + '>'));
  console.log('list ids', ids.join(','));
  await h.step(`${D}/es-edge-panels.chat-list`, 'Chat list open', 'AI panel › title', async () => {});
}
