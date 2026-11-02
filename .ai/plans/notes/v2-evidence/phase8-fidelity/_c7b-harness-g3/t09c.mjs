// C6: just 09 ex-social (select the post, ⇧⌘E) + the preview tile / size chip facts, both themes.
import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '09';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const frame = () => page.frameLocator('[data-testid="canvas-frame"]');
  page.on('response', async (r) => { if (/estimate|export-preview|export-preflight/.test(r.url())) { const t = await r.text().catch(() => ''); console.log('RESP', r.url().split('/_api')[1], t.slice(0, 400)); } });
  await h.open('ui-matchday', 3500);
  await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200);
  const b = await frame().locator('[data-dc-screen="post"]').first().boundingBox().catch(() => null);
  if (b) { await page.mouse.click(b.x + 40, b.y - 12); await sleep(1500); }
  await h.step(`${D}/ex-social`, 'A social post → PNG or JPG', 'select the post, ⇧⌘E', async () => {
    await page.keyboard.press('Shift+Meta+e'); const t0 = Date.now(); let cap0 = null; for (let i = 0; i < 60; i++) { await sleep(250); const c = await page.evaluate(() => ({ cap: document.querySelector('[data-testid=\"export-preview-caption\"]')?.textContent, img: !!document.querySelector('[data-testid=\"export-preview-pic\"] img') })); if (cap0 === null) { cap0 = c.cap; console.log('FIRST', h.theme, Date.now() - t0, JSON.stringify(c)); } if (c.img) { console.log('IMG', h.theme, Date.now() - t0, JSON.stringify(c)); break; } } await sleep(600);
  });
  const facts = await page.evaluate(() => ({
    caption: document.querySelector('[data-testid="export-preview-caption"]')?.textContent,
    img: !!document.querySelector('[data-testid="export-preview-pic"] img'),
    chips: [...document.querySelectorAll('[data-testid="export-sheet"] [class*="chip"], [data-testid="export-sheet"] .ex-chip')].map((e) => e.textContent),
  }));
  console.log('FACTS', theme(h), JSON.stringify(facts));
  await h.esc(3);
}
const theme = (h) => h.theme;
