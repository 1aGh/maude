import { base } from './fx.mjs';
import { prepare as prep, page as pg } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
export const page = pg;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await sleep(2500);
  await h.open('ui-uniformy-2027', 4500);
  await h.step('pn-k-across', D, '⌘K "mobil": STUBBED Tauri index_search answers two other projects (browser lane has no Rust shell)', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(600);
    await page.keyboard.type('mobil');
    await sleep(1800);
  });
}
