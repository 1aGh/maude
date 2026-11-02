import { base } from './fx.mjs';
import { prepare as prep, page as pg } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
export const page = pg;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await sleep(2500);
  await h.open('ui-wide', 5000);
  await page.evaluate(() => localStorage.setItem('__g4mode', 'restored'));
  await page.reload();
  const t = page.getByText(/tabs reopened/).first();
  await t.waitFor({ state: 'visible', timeout: 40000 }).catch(() => console.log('no toast'));
  await h.step('pn-relaunch', D, 'STUBBED take_tabs_restored {count: 20}: the toast the window shows after a restart', async () => {}, { notice: true });
}
