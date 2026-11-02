import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 1700 };
const D = '09';
// round 7: ex-advanced — every kind's part of the fold at once (a mixed selection), a tall window so the whole sheet is in frame,
// the exact scale typed to 2.5 as on the board
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  await page.route('**/_api/export-estimate', async (route) => {
    const r = await route.fetch();
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') j.render = { cloud: true, suggest: 'cloud', why: '4k' };
    await route.fulfill({ response: r, json: j });
  });
  await h.open('ui-matchday', 3500);
  if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
    await tid('panel-fold-left').click().catch(() => {});
    await sleep(500);
  }
  await page.keyboard.press('Meta+0');
  await sleep(1200);
  await page.mouse.click(1380, 1650);
  await page.keyboard.press('Meta+a');
  await sleep(700);
  await page.keyboard.press('Shift+Meta+e');
  await sleep(1500);
  await h.click('export-advanced-toggle');
  await sleep(800);
  const sc = tid('export-adv-scale');
  if (await sc.count()) {
    const inp = sc.locator('input').first();
    const t = (await inp.count()) ? inp : sc;
    await t.fill('2.5').catch(() => {});
    await sleep(500);
  }
  const sheetRegion = async () => {
    const bb = await tid('export-sheet').boundingBox().catch(() => null);
    if (!bb) return undefined;
    const x = Math.max(0, bb.x - 20), y = Math.max(0, bb.y - 20);
    return { x, y, width: Math.min(1440 - x, bb.width + 40), height: Math.min(1700 - y, bb.height + 40) };
  };
  await h.step(`${D}/ex-advanced`, 'Export › Advanced, per kind', 'mixed selection, Advanced open, scale 2.5', async () => {}, { clip: sheetRegion });
}
