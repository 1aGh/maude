import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '09';
// round 7: ex-video / ex-offline on the trailer (24 named clips, real footage) with the cloud door on offer
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
  await sleep(1500);
  const frame = page.frameLocator('[data-testid="canvas-frame"]');
  const b = await frame.locator('[data-dc-screen="hype"]').first().boundingBox().catch(() => null);
  console.log('hype box', JSON.stringify(b));
  if (b) await page.mouse.click(b.x + 40, b.y - 12);
  await sleep(1500);
  await page.keyboard.press('Shift+Meta+e');
  await sleep(1500);
  const sheetRegion = async () => {
    const bb = await tid('export-sheet').boundingBox().catch(() => null);
    if (!bb) return undefined;
    const x = Math.max(0, bb.x - 20), y = Math.max(0, bb.y - 20);
    return { x, y, width: Math.min(1440 - x, bb.width + 40), height: Math.min(900 - y, bb.height + 40) };
  };
  // the stills are extracted in the browser, one video at a time: give them time
  await sleep(14000);
  await h.step(`${D}/ex-video`, 'A video artboard → MP4, GIF or sound, with a filmstrip', 'select the trailer, ⇧⌘E, cloud on offer', async () => {}, { clip: sheetRegion });
  await h.step(`${D}/ex-offline`, 'Offline — this Mac renders, the cloud waits', 'browser context offline, same sheet', async () => {
    await page.context().setOffline(true);
    await sleep(2500);
  }, { reach: 'partial', note: 'browser-level offline', clip: sheetRegion });
  await page.context().setOffline(false);
}
