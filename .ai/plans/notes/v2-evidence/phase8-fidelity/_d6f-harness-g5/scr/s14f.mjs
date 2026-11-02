import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
// c7-edit3: ed-obj-order with the board's panels in frame — Layers hide/lock rows (a locked object, a hidden one),
// the Frame selection result (a wrapped pair), the object menu on Book a call. The nudge chips and the locked tip are
// side states (shot apart below: ed-obj-order-nudge, ed-obj-order-locked).
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  await h.open('ui-homepage', 3000);
  await k.leftTab('layers');
  await k.inspector(true);
  await page.mouse.click(720, 120); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400); // the Desktop board (~60 %)
  // nudge (side): Book a call one step down — the Y tag
  await h.step(`${D}/ed-obj-order-nudge`, 'Arrows move 1 px', 'select Book a call, ArrowDown', async () => {
    await k.deep(hp('[data-cd-id="book"]'), 3);
    await page.keyboard.press('ArrowDown'); await sleep(250);
  });
  await page.keyboard.press('ArrowUp'); await sleep(1500);
  await h.esc(3);
  // a frame around the two buttons (⌥⌘G)
  await k.deep(hp('[data-cd-id="see-work"]'), 4);
  await k.click(hp('[data-cd-id="see-pricing"]'), { modifiers: ['Meta', 'Shift'] });
  await page.keyboard.press('Alt+Meta+g'); await sleep(1200);
  await h.esc(3);
  // a locked object: the sub line
  await k.deep(hp('[data-cd-id="sub"]'), 3);
  await page.keyboard.press('Shift+Meta+l'); await sleep(700);
  await h.esc(3);
  // the locked tip (side): point at the locked Sub line
  await h.step(`${D}/ed-obj-order-locked`, 'A locked object — the click goes to its parent', 'point at the locked Sub line', async () => {
    const c = await k.ctr(hp('[data-cd-id="sub"]'));
    await page.mouse.move(c.x - 20, c.y); await sleep(200); await page.mouse.move(c.x, c.y, { steps: 6 }); await sleep(900);
  });
  // a hidden one: the headline, through its object menu (the hero picture would shorten the page: the page root then
  // no longer fills the artboard and Layers lists it as a row)
  const art = await k.ctr(hp('[data-cd-id="headline"]'));
  await page.mouse.click(art.x, art.y, { button: 'right' }); await sleep(800);
  const hide = k.fr.locator('[data-testid="canvas-menu-item-hide"]').first();
  if (await hide.count()) { await hide.click(); await sleep(900); } else console.log('NO HIDE ITEM');
  await h.esc(3);
  await h.step(`${D}/ed-obj-order`, 'The object menu — order, lock, hide', 'lock Sub, hide the headline, frame the two buttons, right-click See the work', async () => {
    // no selection first: the small button's own handles would cover the point
    for (let i = 0; i < 4; i++) {
      const c = await k.ctr(hp('[data-cd-id="see-work"]'));
      await page.mouse.click(c.x, c.y, { button: 'right' });
      await sleep(900);
      if (await k.fr.locator('[data-testid^="canvas-menu-item"]').count()) break;
      await h.esc(3); // no menu (the press landed on the selection's handles): clear and again
    }
  });
  await h.esc(3);
}
