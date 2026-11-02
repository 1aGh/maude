// C6: just 08 ak-convert + ak-convert-after (the convert of the Matchday post to A6), the rest of 08 untouched.
import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '08';
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
  await h.open('ui-matchday', 3500);
  await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200);
  { const b = await frame().locator('[data-dc-screen="post"]').first().boundingBox().catch(() => null); if (b) { await page.mouse.click(b.x + 50, b.y - 14); await sleep(1200); } }
  await h.step(`${D}/ak-convert`, 'Post 4:5 → A6 print', 'select the post, Size select › A6', async () => {
    await page.locator('[data-testid="insp-ab-preset"]').first().selectOption('paper:a6', { timeout: 5000 });
    for (let i = 0; i < 30; i++) { await sleep(1000); const t = await page.locator('[data-testid="convert-check"]').first().innerText().catch(() => ''); if (t && !/Checking/.test(t)) break; }
    await sleep(400);
  });
  await h.step(`${D}/ak-convert-after`, 'After — the post stays, the A6 copy sits beside it', 'dialog › Make A6 print', async () => {
    const go = page.getByRole('button', { name: /make a6 print/i }).first();
    await go.click({ timeout: 4000 });
    await sleep(9000);
  });
  await h.esc(2);
}
