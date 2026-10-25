import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const openC = async (slug, ms = 2500, fit = true) => { await h.open(slug, ms); await closePanel(); await sleep(900); if (fit) { await page.keyboard.press('Meta+0'); await sleep(1200); } };
  const frame = () => page.frameLocator('[data-testid="canvas-frame"]');
  // click an artboard by its id (the label chip of the placed artboard), through the canvas frame
  // c7: the artboard is selected by its label chip (a click in the middle lands on the photo / text inside it)
  const pick = async (id) => {
    await closePanel();
    const el = frame().locator(`[data-dc-screen="${id}"]`).first();
    let b = await el.boundingBox().catch(() => null);
    if (!b) return false;
    // a label above the window (the camera sits low after the page grew) cannot be clicked: fit first
    if (b.y - 14 < 60 || b.x + 44 < 0) {
      await page.keyboard.press('Meta+0');
      await sleep(1300);
      b = await el.boundingBox().catch(() => null);
      if (!b) return false;
    }
    await page.mouse.click(b.x + 44, b.y - 14);
    await sleep(900);
    return true;
  };
  const regionOf = async (id, pad = 24) => {
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return undefined;
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    return { x, y, width: Math.min(1440 - x, b.width + 2 * pad), height: Math.min(900 - y, b.height + 2 * pad) };
  };

  // c8m2: only the four ids this round touched (08: ak-safe-zones, ak-mixed-fit, ak-mixed-filter, ak-web-widths)
  await openC('ui-matchday', 3500);
  await pick('story');
  await h.step(`${D}/ak-safe-zones`, 'Safe zones, close up', 'story selected, Safe zones → Instagram Reels, the platform menu left open', async () => {
    // c8m2: the Safe zones row is a select-shaped button that opens a floating checked menu (insp-safe-zones[-menu])
    await tid('insp-safe-zones').click({ timeout: 4000 }); await sleep(500);
    await tid('insp-safe-zones-instagram-reels').click({ timeout: 4000 }); await sleep(1400);
    // the menu stays closed: the card has nothing under the Safe zones row to hold it, so an open menu is cut off at the card's foot and
    // would hide the Show-on-canvas row the board's inspector draws (the platform menu is a side state)
  }, { reach: 'partial', note: 'Reels picked on the story board: the bands and tags are on the artboard, the Show-on-canvas row in the inspector' });
  await h.esc(2);
  await page.keyboard.press('Meta+0'); await sleep(900);
  await h.step(`${D}/ak-mixed-fit`, '⌘0 fits all — Layers filters by kind', '⌘0, Layers tab, Print chip', async () => {
    await tid('panel-icon-left').click().catch(() => {});
    await sleep(500);
    await h.click('panel-tab-layers').catch(() => {});
    await h.click('layers-kind-chip-print').catch(() => {});
    await sleep(900);
  }, { reach: 'partial', note: 'a 7-artboard mixed canvas, not 21' });
  // c8m2: the kind filter is ONE store shared by Layers and Canvases — clear it before pressing the Canvases chip, or the press toggles it off
  await h.click('layers-kind-chip-all').catch(() => {});
  await h.click('panel-tab-tree').catch(() => {});
  await h.step(`${D}/ak-mixed-filter`, 'Canvases filtered by kind', 'Canvases panel, kind chip: Print', async () => { await h.click('kind-chip-print'); await sleep(900); }, { reach: 'partial', note: 'a handful of canvases, not 93' });
  await h.click('kind-chip-all').catch(() => {});
  await h.esc(3);
  await page.keyboard.press('Meta+0'); await sleep(900);
  await h.step(`${D}/ak-web-widths`, 'Duplicate at another width', 'web artboard selected › Other widths › Add a width › Desktop, Mobile', async () => {
    if (!(await tid('project-pill').isVisible().catch(() => false))) { await page.keyboard.press('Meta+\\'); await sleep(1000); }
    const nb = await frame().locator('[data-dc-screen="nabor"]').first().boundingBox();
    await page.mouse.click(nb.x + 60, nb.y - 14); await sleep(1200);
    for (const w of ['1440', '390']) {
      await tid('insp-ab-add-width').click({ timeout: 3000 }); await sleep(500);
      await tid('insp-ab-add-width-' + w).click({ timeout: 3000 }); await sleep(1400);
    }
    // c8m2: the board selects the Mobile copy (the tallest): ⌘0, then click the label chip of the last-added board
    await page.keyboard.press('Meta+0'); await sleep(1200);
    const ids = await frame().locator('[data-dc-screen][data-dc-kind="web"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-dc-screen'), h: e.offsetHeight })));
    console.log('web boards', JSON.stringify(ids));
    const tall = ids.sort((a, b) => b.h - a.h)[0];
    if (tall) { const b = await frame().locator(`[data-dc-screen="${tall.id}"]`).first().boundingBox(); await page.mouse.click(b.x + 50, b.y - 14); await sleep(1200); }
  }, { note: 'Desktop and Mobile added beside the 834 page; the tallest of the three selected' });
}
