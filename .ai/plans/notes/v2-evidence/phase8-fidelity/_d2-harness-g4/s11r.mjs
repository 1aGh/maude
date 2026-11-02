import { base } from './fx.mjs';
import { prepare as prep, page as pg } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
export const page = pg;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  const ls = async (k, v) => page.evaluate(([a, b]) => localStorage.setItem(a, b), [k, v]);
  await sleep(2500);
  await h.open('ui-wide', 7000);
  await h.step('pn-jump', D, 'open Wide (21 artboards), expand the row’s artboard list (jump toggle)', async () => {
    await page.locator('[data-testid="canvas-jump-toggle-ui-wide"]').first().click({ force: true });
    await sleep(1500);
  });
  await ls('__g4mode', 'restored');
  await page.reload();
  await sleep(9000);
  await h.step('pn-relaunch', D, 'STUBBED take_tabs_restored {count: 20}: the toast the window shows after a restart (the 20 tabs themselves are the native strip)', async () => {}, { notice: true });
}
