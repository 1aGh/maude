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
  const label = async (id) => { await fr.locator(`[data-dc-screen="${id}"] .dc-artboard-label`).first().click(); await sleep(900); };
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
      await page.mouse.move(x - 60, y, { steps: 6 });
      await page.mouse.move(x - 120, y, { steps: 6 });
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
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 30, y - 10, { steps: 5 });
      await page.mouse.move(x + 70, y - 22, { steps: 5 });
      await sleep(600);
    });
    await page.mouse.up();
    await sleep(400);
    await page.keyboard.press('Meta+z');
    await h.esc(2);
    await h.step(`${D}/ed-ab-tidy`, 'Several at once — align, distribute, tidy', 'marquee over four artboards', async () => {
      const b1 = await box('s1'), b2 = await box('s2');
      await page.mouse.move(b1.x - 30, b1.y - 30);
      await page.mouse.down();
      await page.mouse.move(b2.x + b2.width + 30, b2.y + b2.height + 30, { steps: 8 });
      await page.mouse.up();
      await sleep(900);
    });
  }
}
