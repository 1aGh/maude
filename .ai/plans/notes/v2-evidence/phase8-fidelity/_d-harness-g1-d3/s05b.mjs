import { base } from './fx.mjs';
export const fixture = base;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-smoke', 2500);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(500);
  await h.click('kind-chip-print').catch((e) => console.log('chip fail', e.message.split('\n')[0]));
  await sleep(1200);
  await h.step(`${D}/es-filter`, 'Print filter on, open canvas has no print artboards', 'open Smoke, chip Print', async () => {});
  await h.click('kind-chip-all').catch(() => {});
  await h.click('panel-icon-left').catch(() => {});
  // all trashed: click the artboard label then Backspace
  await page.mouse.click(700, 366);
  await sleep(600);
  await page.keyboard.press('Backspace');
  await sleep(1800);
  await h.step(`${D}/es-all-trashed`, 'All artboards trashed', 'select the artboard label, Backspace', async () => {});
}
