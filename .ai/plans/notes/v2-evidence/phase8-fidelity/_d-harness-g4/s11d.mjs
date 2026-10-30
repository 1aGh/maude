import { base } from './fx.mjs';
import { prepare as prep } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await sleep(1500);
  await h.open('ui-uniformy-2027', 3000);
  await page.keyboard.press('Meta+k');
  await sleep(500);
  await page.keyboard.type('keyboard shortcuts');
  await sleep(900);
  await page.keyboard.press('Enter');
  await sleep(1500);
  console.log('TIDS', await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => /help|shortcut|keys/.test(t)).join(',')));
  await h.step('pn-switch-ai-keys', D, '⌘K › Keyboard shortcuts', async () => {});
}
