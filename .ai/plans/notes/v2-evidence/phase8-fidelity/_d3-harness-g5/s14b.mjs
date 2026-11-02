import { gators, studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => (process.env.FX === 'gators' ? gators() : studioSite());
export const page = { w: 1440, h: 900 };
const D = '14-editing';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  if (process.env.FX !== 'gators') {
    await h.open('ui-homepage', 3000);
    await k.fold();
    await k.inspector(true);
    await h.step(`${D}/ed-obj-enter`, 'Double-click goes inside a frame', 'double-click Services, then Brand systems', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 2);
      await k.dbl(hp('[data-cd-id="card-brand"]'));
    });
    await h.esc(3);
    await h.step(`${D}/ed-obj-multi`, 'Multi-select — shared properties', 'click headline, shift-click sub and the button', async () => {
      await k.deep(hp('[data-cd-id="headline"]'), 3);
      await k.click(hp('[data-cd-id="sub"]'), { modifiers: ['Meta', 'Shift'] });
      await k.click(hp('[data-cd-id="see-work"]'), { modifiers: ['Meta', 'Shift'] });
    });
    await h.esc(3);
    await h.step(`${D}/ed-obj-order`, 'The object menu — order, lock, hide', 'right-click the button', async () => {
      // c3-inspect: no selection first — the small button's own handles would cover the point; a right-click on the
      // object opens its menu and selects it
      const c = await k.ctr(hp('[data-cd-id="see-work"]'));
      await page.mouse.click(c.x, c.y, { button: 'right' });
      await sleep(800);
    });
    await h.esc(3);
    await h.step(`${D}/ed-lay-auto`, 'Auto layout — gap and padding are tokens', 'select the Services row; inspector Layout', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 2);
    });
    await h.esc(2);
    await h.step(`${D}/ed-lay-reorder`, 'Drag to reorder — the slot opens', 'drag Small apps toward the front of Services', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 2);
      const a = await k.ctr(hp('[data-cd-id="card-small"]'));
      const t = await k.ctr(hp('[data-cd-id="card-product"]'));
      await k.drag(a, { x: t.x - 60, y: t.y }, 10, 900);
    });
    await page.mouse.up(); await sleep(400);
    await page.keyboard.press('Meta+z'); await h.esc(3);
    await h.step(`${D}/ed-text-edit`, 'Edit text in place', 'double-click the headline and type', async () => {
      await k.deep(hp('[data-cd-id="headline"]'), 3);
      await k.dbl(hp('[data-cd-id="headline"]'));
      if (await k.fr.locator('.dc-text-editing').count()) { await page.keyboard.press('End'); await page.keyboard.type(' v Brně'); }
      await sleep(500);
    });
    await h.esc(3);
    await h.step(`${D}/ed-inspector`, 'The inspector for one button', 'select the button; inspector open', async () => {
      await k.deep(hp('[data-cd-id="see-work"]'), 4);
    });
    await h.esc(3);
    await h.step(`${D}/ed-comp-pick`, 'Component ⇧I — from the Design system', 'press ⇧I', async () => {
      await k.label('desktop'); // D3: the artboard selected, as the board draws it
      await page.keyboard.press('Shift+i');
      await sleep(1200);
    });
    await h.esc(2);
    await h.step(`${D}/ed-pen`, 'Pen — draw', 'press P, click three points', async () => {
      const c = await k.ctr(hp('[data-cd-id="hero-art"]'));
      await page.keyboard.press('p'); await sleep(400);
      await page.mouse.click(c.x - 80, c.y + 40); await sleep(250);
      await page.mouse.click(c.x, c.y - 40); await sleep(250);
      await page.mouse.click(c.x + 90, c.y + 30); await sleep(600);
    });
    await h.esc(3);
    await h.step(`${D}/ed-edge-huge-fit`, 'Page fit (placeholder)', 'n/a', async () => {});
  } else {
    await h.open('ui-combine-kampan', 3500);
    await k.fold();
    await k.inspector(true);
    await k.fit();
    await h.step(`${D}/ed-lay-free`, 'Free placement with constraints', 'select the date badge on a post', async () => {
      await k.deep('[data-dc-screen="p1"] [data-cd-id="datum"]', 1);
    });
    await h.esc(2);
    await h.step(`${D}/ed-shape`, 'Shape — fill, stroke, each corner', 'select the shape behind the date', async () => {
      const c = await k.ctr('[data-dc-screen="p1"] [data-cd-id="date-bg"]');
      await page.mouse.click(c.b.x + 3, c.y); await sleep(500); await page.mouse.dblclick(c.b.x + 3, c.y); await sleep(800);
    });
    await h.esc(2);
    await h.step(`${D}/ed-text-style`, 'A style, an override', 'select the title', async () => {
      await k.deep('[data-dc-screen="p1"] [data-cd-id="title"]', 1);
    });
    await h.esc(2);
    await h.step(`${D}/ed-img`, 'Image — place, then crop', 'select the photo, double-click for crop', async () => {
      await k.deep('[data-dc-screen="p1"] [data-cd-id="photo"]', 1);
      await k.dbl('[data-dc-screen="p1"] [data-cd-id="photo"]');
    });
  }
}
