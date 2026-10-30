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
  // c8m2: the toast lands while the canvas is still opening (D5 light caught "Opening Uniformy-2027…" / a ring mid-pan): wait for the canvas
  // to be up and the centring pan to settle, THEN shoot (the toast stays ~5 s)
  await page.locator('[data-testid="canvas-loading"]').first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {});
  await sleep(2200);
  if (!(await page.getByText(/Opened from a link/).first().isVisible().catch(() => false))) console.log('toast gone before the shot');
  await h.step('pn-deeplink', D, 'STUBBED take_pending_navigate {canvas, artboard} (what the shell parks for a maude:// link); the toast names the artboard, the artboard is selected', async () => {}, { notice: true });
}
