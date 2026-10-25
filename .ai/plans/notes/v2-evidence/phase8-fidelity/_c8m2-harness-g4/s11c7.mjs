import { base } from './fx.mjs';
import { snap } from './lib.mjs';
import { prepare as prep, page as pg } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
export const page = pg;
const D = '11-projects-and-navigation';
const only = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (id) => !only.length || only.includes(id);

export async function run(h) {
  const { page, sleep } = h;
  await sleep(2500);
  // ── pn-move: a canvas dragged onto a folder says "Move here" (the drag held, not dropped) ──
  if (want('pn-move')) {
    await h.open('ui-uniformy-2027', 3500);
    const row = page.locator('[data-testid="canvas-row-ui-smoke"]').first();
    const folder = page.locator('[data-testid^="tree-folder-"]', { hasText: 'club-web' }).first();
    await row.scrollIntoViewIfNeeded().catch(() => {});
    const rb = await row.boundingBox();
    const fb = await folder.boundingBox();
    console.log('BOXES', JSON.stringify({ rb, fb }));
    if (rb && fb) {
      // c8m2: Chrome's drag interception does not deliver dragover to the panel (D5: no "Move here"), so the HTML5 events are
      // dispatched by hand on one DataTransfer: dragstart on the canvas row (the hook writes its MIME), dragenter + dragover on the folder
      await page.evaluate(() => {
        const row = document.querySelector('[data-testid="canvas-row-ui-smoke"]');
        const folder = [...document.querySelectorAll('[data-testid^="tree-folder-"]')].find((e) => /club-web/.test(e.textContent || ''));
        const dt = new DataTransfer();
        const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        fire(row, 'dragstart');
        fire(folder, 'dragenter');
        fire(folder, 'dragover');
        window.__dnd = { row, folder, fire };
      });
      await sleep(150);
      // shot straight away (h.step waits ~2 s for notices): the folder's 600 ms spring-load has not opened it yet, and the dragged row is still in view
      await snap(page, `${D}/pn-move-${h.theme}`, '', 'drag Smoke onto club-web and hold');
      console.log('ROW', JSON.stringify({ id: 'pn-move', theme: h.theme }));
      await page.evaluate(() => window.__dnd.fire(window.__dnd.row, 'dragend'));
      await sleep(900);
    }
    await h.esc(2);
  }
  // ── pn-jump: collapse the folders, open Wide's artboards, select one (the current row is marked) ──
  if (want('pn-jump')) {
    await h.open('ui-wide', 5000);
    // select the 4th artboard on the canvas (the Canvases panel folds with the inspector: open it again, then its jump list)
    await page.evaluate(() => {
      const f = document.querySelector('[data-testid="canvas-frame"]');
      f?.contentWindow?.postMessage({ dgn: 'select-by-id', artboardId: 'a3', index: 0 }, '*');
    });
    await sleep(1800);
    if (!(await page.locator('[data-testid="canvas-jump-toggle-ui-wide"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(1200); }
    await page.locator('[data-testid="canvas-jump-toggle-ui-wide"]').first().click({ force: true });
    await sleep(1200);
    await page.locator('[data-testid="canvas-row-ui-wide"]').first().evaluate((el) => { const sc = el.closest('.cv-tree') || el.parentElement; const r = el.getBoundingClientRect(); const t = sc.getBoundingClientRect(); sc.scrollTop += r.top - t.top - 4; }).catch(() => {});
    await sleep(800);
    await h.step('pn-jump', D, 'open Wide (21 artboards), artboard 4 selected on the canvas, the row’s artboard list opened (jump toggle) and scrolled to the top (the current row is marked)', async () => {});
  }
}
