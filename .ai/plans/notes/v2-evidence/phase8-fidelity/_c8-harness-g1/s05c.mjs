import { g1 } from './fx3.mjs';
export const fixture = g1;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-smoke', 2500);
  await h.click('panel-icon-left').catch(() => {});
  await sleep(600);
  await h.step(`${D}/es-panels-canvas.folder`, 'Canvases folder, empty', 'click the 2027 folder', async () => {
    await h.click('tree-folder-ui-2027');
    await sleep(800);
  });
  await h.click('panel-tab-layers').catch(() => {});
  await sleep(500);
  await h.click('layers-kind-chip-print').catch((e) => console.log('layers chip fail', e.message.split('\n')[0]));
  await sleep(1000);
  await h.step(`${D}/es-filter`, 'Layers panel, Print filter on, open canvas has no print artboard', 'open Smoke › Layers tab › Print chip', async () => {});
  await h.click('layers-kind-chip-all').catch(() => {});
  await h.click('panel-tab-tree').catch(() => {});
  await h.open('ui-emptyvideo', 3500);
  await page.mouse.click(810, 278);
  await sleep(1500);
  await h.step(`${D}/es-timeline`, 'Timeline on a video artboard with no clips', 'open the empty video canvas, click the artboard label', async () => {});
}
