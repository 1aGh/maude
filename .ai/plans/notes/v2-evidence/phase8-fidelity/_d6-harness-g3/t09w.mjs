import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '09';
// round 7c: ex-print-warn on LetakA6 — a QR code 2 mm inside the cut, a headline face that will not embed (REAL preflight)
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  await h.open('ui-letaka6', 3500);
  if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) { await tid('panel-fold-left').click().catch(() => {}); await sleep(500); }
  await page.keyboard.press('Meta+0'); await sleep(1500);
  const b = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen="a-tackle"]').first().boundingBox();
  await page.mouse.click(b.x + 40, b.y - 12); await sleep(1500);
  await page.keyboard.press('Shift+Meta+e'); await sleep(1200);
  // the safe-margin measure is a headless render of the canvas: give it time
  await tid('export-print-safe-warn').waitFor({ timeout: 40000 }).catch(() => {});
  await sleep(1500);
  await h.step(`${D}/ex-print-warn`, 'Past the safe margin; a font that won’t embed', 'select the A6 flyer (QR 2 mm inside the cut, a restricted headline face), ⇧⌘E', async () => {}, { reach: 'yes', note: 'real preflight: the measure + the font check' });
}
