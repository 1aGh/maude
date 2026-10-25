import { gators, studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => (process.env.FX === 'gators' ? gators() : studioSite());
export const page = { w: 1440, h: 900 };
const D = '14-editing';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const fr = page.frameLocator('[data-testid="canvas-frame"]');
  const fold = async () => { await h.click('panel-fold-left').catch(() => {}); await sleep(600); };
  const box = async (id) => fr.locator(`[data-dc-screen="${id}"]`).first().boundingBox();
  const label = async (id) => { const c = await k.ctr(`[data-dc-screen="${id}"] .dc-artboard-label`); await page.mouse.click(c.x - c.b.width / 2 + 12, c.y); await sleep(900); };
  if (process.env.FX !== 'gators') {
    await h.open('ui-homepage', 3000);
    await fold();
    await k.inspector(true);
    await h.step(`${D}/ed-ab-select`, 'Select an artboard', 'click the artboard name', async () => { await label('desktop'); });
    // resize: drag the right edge
    await h.step(`${D}/ed-ab-resize`, 'Resize — snaps to presets', 'drag the right edge of the selected artboard', async () => {
      const b = await box('desktop');
      const x = b.x + b.width, y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      // 1440 -> 1280: the preset the width clicks onto (the board's "Laptop · 1280")
      const land = (160 * b.width) / 1440;
      await page.mouse.move(x - land / 2, y, { steps: 6 });
      await page.mouse.move(x - land, y, { steps: 8 });
      await sleep(500);
    });
    await page.mouse.up();
    await sleep(500);
    await page.keyboard.press('Meta+z');
    await h.esc(2);
    await h.step(`${D}/ed-ab-menu`, 'Right-click an artboard', 'right-click the artboard name; Duplicate at another width', async () => {
      const b = await box('desktop');
      await page.mouse.click(b.x + 40, b.y - 8, { button: 'right' });
      await sleep(700);
      const it = page.getByRole('menuitem', { name: /Duplicate at another width/ }).first();
      if (await it.count()) await it.hover().catch(() => {});
      await sleep(600);
    });
  } else {
    await h.open('ui-combine-kampan', 3500);
    await fold();
    await k.inspector(true);
    await page.keyboard.press('Meta+0');
    await sleep(1000);
    await h.step(`${D}/ed-ab-arrange`, 'Move one — smart guides and equal gaps', 'drag the 4th post into the row', async () => {
      const b = await box('p4');
      const hit = await k.pageHit('p4');
      const x = hit ? hit.x : b.x + b.width / 2, y = hit ? hit.y : b.y + b.height / 2;
      // the 4th post goes into the row, to the LEFT of the first: the gap to p1 is the row's gap, its top is the row's top
      // world coordinates from the canvas's own rect manifest; screen px per world px from the drawn box
      let rects = null;
      for (const f of page.frames()) { try { const r = await f.evaluate(() => window.__maudeCanvasRects && window.__maudeCanvasRects().artboards); if (r) rects = r; } catch {} }
      const R = (id) => rects.find((r) => r.id === id);
      const z = b.width / R('p4').w;
      const gap = R('p2').x - (R('p1').x + R('p1').w);
      const tx = (R('p1').x - gap - R('p4').w - R('p4').x) * z, ty = (R('p1').y - R('p4').y) * z;
      const pill = async () => {
        let txt = '';
        for (const f of page.frames()) { try { const t = await f.evaluate(() => [...document.querySelectorAll('.ed-ab-bubble-pos')].map((n) => n.textContent).join('')); if (t) txt = t; } catch {} }
        const m = /X\s*(-?\d+)\s*·\s*Y\s*(-?\d+)/.exec(txt);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
      };
      const wantX = R('p1').x - gap - R('p4').w - 4.975, wantY = 0; // the pill speaks layout px (the page origin sits 4.975 in)
      await page.mouse.move(x, y);
      await page.mouse.down();
      // two readings far from any snap give the true pointer -> layout scale (the drag lags its threshold)
      await page.mouse.move(x + tx * 0.4, y + ty * 0.4, { steps: 8 });
      await sleep(250);
      const p1 = await pill();
      await page.mouse.move(x + tx * 0.6, y + ty * 0.6, { steps: 4 });
      await sleep(250);
      const p2 = await pill();
      if (p1 && p2) {
        const sx = (p2.x - p1.x) / (tx * 0.2), sy = (p2.y - p1.y) / (ty * 0.2);
        // land exactly: the pointer where the UNSNAPPED board is at the row's gap and line
        let cx = x + tx * 0.6 + (wantX - p2.x) / sx, cy = y + ty * 0.6 + (wantY - p2.y) / sy;
        await page.mouse.move(cx, cy, { steps: 6 });
        for (let i = 0; i < 3; i++) { // fine steering, unsnapped board readings only count once it is close
          await sleep(250);
          const q = await pill();
          if (!q || (Math.abs(q.x - wantX) <= 1 && Math.abs(q.y - wantY) <= 1)) break;
          cx += (wantX - q.x) / sx; cy += (wantY - q.y) / sy;
          await page.mouse.move(cx, cy, { steps: 2 });
        }
      }
      await sleep(900);
      if (process.env.DBG) console.log('DBG', JSON.stringify(await box('p4')), JSON.stringify(await box('p1')), wantX, wantY, z);
    });
    await page.mouse.up();
    await sleep(400);
    await page.keyboard.press('Meta+z');
    await h.esc(2);
    // a loose layout to tidy: the 2nd story slid down and right a little (the lowest board sets the line)
    { const b = await box('s2'); const hit = await k.pageHit('s2'); const x = hit ? hit.x : b.x + b.width / 2, y = hit ? hit.y : b.y + 200;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 20, y + 24, { steps: 4 }); await page.mouse.move(x + 44, y + 52, { steps: 5 }); await page.mouse.up(); await sleep(500); await h.esc(2); }
    for (const n of ['Dismiss notification', 'Close']) { const c = page.getByRole('button', { name: n }).first(); if (await c.count()) { await c.click({ timeout: 1500 }).catch(() => {}); } }
    await h.step(`${D}/ed-ab-tidy`, 'Several at once — align, distribute, tidy', 'marquee over four artboards', async () => {
      const b1 = await box('p4'), b2 = await box('s2');
      await page.mouse.move(b1.x - 30, b1.y - 30);
      await page.mouse.down();
      await page.mouse.move(b2.x + b2.width + 30, b2.y + b2.height + 30, { steps: 8 });
      await page.mouse.up();
      await sleep(900);
      // the pointer rests on Tidy up: the dashed row preview + "One row, even gaps"
      const tidy = page.locator('[data-testid="edit-tidy"]').first();
      const t = (await tidy.count()) ? tidy : fr.locator('[data-testid="edit-tidy"]').first();
      await t.hover({ timeout: 4000 }).catch((e) => console.log('tidy hover', String(e.message).split('\n')[0]));
      await sleep(900);
    });
  }
}
