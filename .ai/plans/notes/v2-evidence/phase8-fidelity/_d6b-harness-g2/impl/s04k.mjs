import { studio } from './fx4.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
const D = '04-modes';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-homepage', 4000);
  await page.mouse.click(700, 760);
  await sleep(600);
  await h.step(`${D}/md-keys`, 'View menu: the amended rows with their keys; the mode glyphs and toolbar behind', 'project menu, View', async () => {
    await h.click('project-pill');
    await sleep(500);
    await h.click('project-menu-row-sub-view');
    await sleep(700);
  });
}
