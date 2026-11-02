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

  await openC('ui-matchday', 3500);
  await h.step(`${D}/ak-print-letak`, 'A6 flyer — the inspector speaks mm', 'select the A6 print artboard', async () => { await pick('a-front'); });
  await h.step(`${D}/ak-advanced`, 'Advanced — exact values and the code', 'print artboard, inspector Advanced fold', async () => {
    await tid('fold-inspector-toggle').click({ timeout: 3000 }).catch(async () => { await page.getByText('Advanced', { exact: true }).last().click().catch(() => {}); });
    await sleep(2000);
    await page.evaluate(() => { const o = document.querySelector('.st-rp-body'); if (o) o.scrollTop = o.scrollHeight; const f = document.querySelector('[data-testid="fold-inspector-body"]'); if (f) f.scrollTop = f.scrollHeight; });
    await sleep(500);
  });
  await h.esc(2);
  await page.keyboard.press('Meta+0'); await sleep(800);
  await h.step(`${D}/ak-print-view`, 'Print guides from View, next to the web page', 'palette: print guides', async () => {
    await page.keyboard.press('Escape'); await sleep(300);
    await tid('project-pill').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-sub-view').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-sub-advanced').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-view.print-guides').click({ timeout: 3000 }); await sleep(1200);
    await tid('project-pill').click({ timeout: 3000 }).catch(() => {}); await sleep(700);
    await tid('project-menu-row-sub-view').click({ timeout: 3000 }).catch(() => {}); await sleep(700);
    await tid('project-menu-row-sub-advanced').click({ timeout: 3000 }).catch(() => {}); await sleep(2200);
  }, { note: 'Menu › View › Advanced › Print guides, opened again after the toggle so the checked row shows' });
  await h.esc(3);
}
