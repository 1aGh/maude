import { base } from './fx.mjs';
import { prepare as prep } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await sleep(1500);
  await h.open('ui-uniformy-2027', 3000);
  await h.step('pn-k-close', D, '⌘K "unifromy 2027" (swapped letter) on a canvas named Uniformy-2027', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('unifromy 2027');
    await sleep(1100);
  });
  await h.esc(3);
  await h.step('pn-k-close-2', D, '⌘K "kalhoty dom" (word order / partial)', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('domaci dres');
    await sleep(1100);
  });
}
