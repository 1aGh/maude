import { base } from './fx.mjs';
import { prepare as prep, page as pg } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
export const page = pg;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await sleep(2500);
  await page.evaluate(() => localStorage.setItem('__g4mode', 'deeplink'));
  await page.reload();
  // the toast names the artboard once the index answers; shoot while it is up (it clears after ~5 s)
  await page.getByText(/Opened from a link/).first().waitFor({ state: 'visible', timeout: 40000 }).catch(() => console.log('no toast'));
  await sleep(600);
  await h.step('pn-deeplink', D, 'STUBBED take_pending_navigate {canvas, artboard} (what the shell parks for a maude:// link); the toast names the artboard, the artboard is selected', async () => {}, { notice: true });
}
