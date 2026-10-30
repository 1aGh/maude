import { gators } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => gators();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
// P8 c8: ed-edge-huge — INSIDE a 6000 px page: its name rides at the top of the window, "You're looking at … of 6000"
// is in the artboard card, the section the pointer is in is selected.
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-klub-web', 4000);
  await k.fold();
  await k.inspector(true);
  await h.step(`${D}/ed-edge-huge`, 'A 6000 px page', 'open the long page, select it, zoom in and read down it', async () => {
    await k.label('page');
    await page.keyboard.press('Meta+1'); await sleep(1500);
    // into the page: a pinch about the middle, then the scroll wheel reads down it
    await page.mouse.move(720, 450);
    await page.keyboard.down('Control');
    for (let i = 0; i < Number(process.env.ZT || 6); i++) { await page.mouse.wheel(0, -120); await sleep(120); }
    await page.keyboard.up('Control');
    await sleep(900);
    for (let i = 0; i < Number(process.env.ST || 2); i++) { await page.mouse.wheel(0, 260); await sleep(150); }
    await sleep(900);
  });
}
