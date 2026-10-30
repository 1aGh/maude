import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
const ONLY = process.env.ONLY || '';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  const want = (id) => (ONLY ? ONLY.split(',').includes(id) : id !== 'pen'); // 'pen' lives in s14i (a single-use artboard)
  await h.open('ui-homepage', 3000);
  await k.fold();
  await k.inspector(true);
  await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
  if (want('lay-auto')) {
    const vp0 = await k.tall(1200);
    await sleep(600);
    await h.step(`${D}/ed-lay-auto`, 'Auto layout — gap and padding are tokens', 'select Services; drag the gap handle; the ruler clicks onto the stops', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 1);
      const g = await k.ctr('.dc-spacing-handle--gap');
      if (!g) throw new Error('no gap handle');
      await page.mouse.move(g.x, g.y); await sleep(200);
      await page.mouse.down();
      await page.mouse.move(g.x + 3, g.y, { steps: 3 });
      await page.mouse.move(g.x, g.y, { steps: 3 });
      await sleep(500);
    });
    await page.mouse.up(); await sleep(300);
    await page.keyboard.press('Meta+z'); await h.esc(3);
    await k.short(vp0);
  }
  if (want('lay-reorder')) {
    await k.inspector(false); // the board's close-up has no panels: just the canvas and the toolbar
    await h.step(`${D}/ed-lay-reorder`, 'Drag to reorder — the slot opens', 'drag Small apps toward the front of Services', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 1);
      const sv = await k.ctr(hp('[data-cd-id="services"]'));
      await page.mouse.move(sv.x, sv.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < Number(process.env.ZT || 1); i++) { await page.mouse.wheel(0, -120); await sleep(120); }
      await page.keyboard.up('Control');
      await sleep(900);
      await k.dbl(hp('[data-cd-id="card-small"]'));
      await k.inspector(false); await sleep(500);
      const a0 = await k.ctr(hp('[data-cd-id="card-small"]'));
      const a = { x: a0.x - a0.b.width * 0.3, y: a0.y - a0.b.height * 0.32 };
      const cs = [];
      for (const id of ['card-small', 'card-product', 'card-brand']) cs.push(await k.ctr(hp(`[data-cd-id="${id}"]`)));
      const first = cs.reduce((m, c) => (c.x < m.x ? c : m), cs[0]);
      await k.drag(a, { x: first.x - first.b.width / 4, y: first.y - 6 }, 10, 1100);
    });
    await page.mouse.up(); await sleep(400);
    await page.keyboard.press('Meta+z'); await h.esc(3);
  }
  if (want('obj-order')) {
    await k.inspector(true);
    await k.leftTab('layers');
    await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
    // a frame around the two buttons (⌥⌘G)
    await k.deep(hp('[data-cd-id="see-work"]'), 4);
    await k.click(hp('[data-cd-id="see-pricing"]'), { modifiers: ['Meta', 'Shift'] });
    await page.keyboard.press('Alt+Meta+g'); await sleep(1200);
    await h.esc(3);
    // a locked object: the sub line
    await k.deep(hp('[data-cd-id="sub"]'), 3);
    await page.keyboard.press('Shift+Meta+l'); await sleep(700);
    await h.esc(3);
    // a hidden one: the headline, through its object menu
    const art = await k.ctr(hp('[data-cd-id="headline"]'));
    await page.mouse.click(art.x, art.y, { button: 'right' }); await sleep(800);
    const hide = k.fr.locator('[data-testid="canvas-menu-item-hide"]').first();
    if (await hide.count()) { await hide.click(); await sleep(900); } else console.log('NO HIDE ITEM');
    await h.esc(3);
    await h.step(`${D}/ed-obj-order`, 'The object menu — order, lock, hide', 'lock Sub, hide the headline, frame the two buttons; select See the work, right-click it', async () => {
      await k.deep(hp('[data-cd-id="see-work"]'), 4);
      // a pinch about the button so its handles leave the middle of it free for the right-click
      const b0 = await k.ctr(hp('[data-cd-id="see-work"]'));
      await page.mouse.move(b0.x, b0.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -120); await sleep(120); }
      await page.keyboard.up('Control');
      await sleep(900);
      for (let i = 0; i < 4; i++) {
        const c = await k.ctr(hp('[data-cd-id="see-work"]'));
        await page.mouse.click(c.x, c.y, { button: 'right' });
        await sleep(900);
        if (await k.fr.locator('[data-testid^="canvas-menu-item"]').count()) break;
        await sleep(300);
      }
      const t = await page.locator('[data-testid="inspector-title"]').first().innerText().catch(() => '');
      console.log('OBJ-ORDER inspector title:', t);
    });
    await h.esc(3);
  }
  if (want('comp-pick')) {
    await k.inspector(true);
    await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
    await h.step(`${D}/ed-comp-pick`, 'Component ⇧I — from the Design system', 'select the artboard, press ⇧I (the highlighted row rides on the page)', async () => {
      await k.label('desktop');
      // the page slides left so its centre line (where the ghost sits) is clear of the picker panel
      await page.mouse.move(300, 450); await page.mouse.wheel(170, 0); await sleep(700);
      await page.keyboard.press('Shift+i');
      await sleep(900);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); // Brand: Logo, Icon · Components: Button
      await sleep(900);
    });
    await h.esc(3);
  }
  if (want('comp-instance')) {
    await k.inspector(true);
    await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
    await h.step(`${D}/ed-comp-instance`, 'An instance — override, swap, detach', 'select the Footer frame, place a Button from ⇧I, change its text', async () => {
      await k.deep(hp('[data-cd-id="footer"]'), 1);
      await page.keyboard.press('Shift+i'); await sleep(1000);
      await page.keyboard.type('Button'); await sleep(500);
      await page.keyboard.press('Enter'); await sleep(2200);
      console.log('INSTANCE title', await page.locator('[data-testid="inspector-title"]').first().innerText().catch(() => '?'));
      if (process.env.DBGSHOT) await page.screenshot({ path: '.scr/dbg.png' });
      // two overrides: the instance's own text and its fill
      const t = page.locator('[data-testid="insp-content-text"]').first();
      await t.fill('Registruj se'); await t.press('Enter'); await sleep(1500);
      const fillBtn = page.locator('[data-testid="inspector-panel"] [data-testid*="content-fill"]').first();
      console.log('INSTANCE fill control', await fillBtn.count());
      await fillBtn.click({ timeout: 4000 }).catch((e) => console.log('fill click', String(e.message).split('\n')[0]));
      await sleep(700);
      const opts = await page.locator('[role="listbox"] [role="option"], [data-testid^="colour-"], [data-testid*="swatch"]').allInnerTexts().catch(() => []);
      console.log('INSTANCE colour opts', JSON.stringify(opts.slice(0, 8)));
    });
    await h.esc(3);
  }
  if (want('pen')) {
    await k.inspector(true);
    await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400);
    await h.step(`${D}/ed-pen`, 'Pen — draw', 'P, click four points, ↵; double-click the path and pick a point', async () => {
      const c = await k.ctr(hp('[data-cd-id="hero-art"]'));
      await page.keyboard.press('p'); await sleep(500);
      for (const [dx, dy] of [[-150, 60], [-60, 90], [30, 20], [110, -30]]) { await page.mouse.click(c.x + dx, c.y + dy); await sleep(350); }
      await page.keyboard.press('Enter'); await sleep(1500);
      console.log('PEN title', await page.locator('[data-testid="inspector-title"]').first().innerText().catch(() => '?'));
      await page.mouse.dblclick(c.x - 105, c.y + 75); await sleep(900);
      console.log('PEN points', await k.fr.locator('[data-testid^="edit-pen-point-"]').count());
      const pt = k.fr.locator('[data-testid="edit-pen-point-0-1"]').first();
      if (await pt.count()) { const b = await pt.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(700); }
    });
    await h.esc(3);
  }
}
