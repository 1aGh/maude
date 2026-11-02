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
  const openC = async (slug, ms = 2500) => { await h.open(slug, ms); await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200); };
  const frame = () => page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (id) => {
    await closePanel();
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return false;
    // p8-bugs3: a click on the page now lands on the top OBJECT under the page root (decision
    // v2-c3-page-root-is-the-artboard) — the board's "select the post" is the artboard, picked by its label chip
    await page.mouse.click(b.x + 40, b.y - 12);
    await sleep(1500);
    return true;
  };
  // D2: the sheet AND any menu / list that opens from it (the formats list hangs off the sheet's edge)
  const sheetMenuRegion = async () => {
    const b = await tid('export-sheet').boundingBox().catch(() => null);
    if (!b) return undefined;
    let x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
    const extra = await page.evaluate(() => [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="combobox"] + *')].map((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40 ? [r.x, r.y, r.right, r.bottom] : null; }).filter(Boolean));
    for (const [a, b2, c, d] of extra) { x0 = Math.min(x0, a); y0 = Math.min(y0, b2); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    const x = Math.max(0, x0 - 20), y = Math.max(0, y0 - 20);
    return { x, y, width: Math.min(1440 - x, x1 - x0 + 40), height: Math.min(900 - y, y1 - y0 + 40) };
  };
  const sheetRegion = async () => {
    const b = await tid('export-sheet').boundingBox().catch(() => null);
    if (!b) return undefined;
    const x = Math.max(0, b.x - 20), y = Math.max(0, b.y - 20);
    return { x, y, width: Math.min(1440 - x, b.width + 40), height: Math.min(900 - y, b.height + 40) };
  };
  const keys = async (k) => { await page.keyboard.press(k); await sleep(1100); };
  const close = async () => {
    await h.esc(2);
    const c = tid('export-cancel');
    if (await c.count()) await c.click().catch(() => {});
    const c2 = page.getByRole('button', { name: /^cancel$/i }).last();
    if (await c2.count()) await c2.click({ timeout: 1500 }).catch(() => {});
    await sleep(500);
  };

  await openC('ui-matchday', 3500);
  // --- canvas / batch scope
  // c7b: nothing selected = Escape out of whatever the last pick left (a click on the canvas lands on an object),
  // and the sheet is shown on "This canvas" — the board's ex-canvas
  await h.esc(3); await sleep(500);
  await h.step(`${D}/ex-canvas`, '⇧⌘E with nothing selected → this canvas', 'Escape, ⇧⌘E, This canvas', async () => {
    await keys('Shift+Meta+e');
    if ((await tid('export-scope-canvas').getAttribute('aria-checked').catch(() => null)) !== 'true') await h.click('export-scope-canvas').catch(() => {});
    await sleep(700);
  });
  await h.step(`${D}/ex-huge`, 'Whole project, chosen in Scope', 'sheet open, Whole project scope', async () => { await h.click('export-scope-project'); }, { reach: 'partial', note: '13 canvases, not 93 / 524 artboards' });
  await close(); await close();
  await h.esc(3); await sleep(300);
  // c7b: two fixed-size artboards and a print one, picked by their label chips (⌘A selected the sections' frames)
  const chip = async (id, shift) => {
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return;
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(b.x + 40, b.y - 12);
    if (shift) await page.keyboard.up('Shift');
    await sleep(500);
  };
  await closePanel();
  await chip('post'); await chip('story', true); await chip('a-front', true);
  await h.step(`${D}/ex-batch-pick`, 'Five artboards, two kinds', 'select post, story, A front by their chips, ⇧⌘E', async () => { await keys('Shift+Meta+e'); }, { reach: 'partial', note: 'three artboards of two kinds (the board has five)' });
  // c7b: the cloud door on offer, as on the board (videos in the cloud)
  await page.route('**/_api/export-estimate', async (route) => {
    const r = await route.fetch();
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') { j.lane = 'cloud'; }
    await route.fulfill({ response: r, json: j });
  });
  await h.step(`${D}/ex-batch`, 'Export a folder — grouped by kind', 'Folder scope, the cloud door on offer', async () => { await h.click('export-scope-folder').catch(() => {}); await sleep(900); }, { reach: 'partial', note: 'folder scope; the cloud lane is answered by the harness' });
  await page.unroute('**/_api/export-estimate').catch(() => {});
  await close(); await close();
}
