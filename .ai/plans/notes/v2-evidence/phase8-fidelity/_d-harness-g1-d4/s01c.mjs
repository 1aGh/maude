import { big } from './fx.mjs';
export const fixture = big;
const D = '01';
export async function run(h) {
  const { page, sleep } = h;
  const folder = () => page.getByText('campaign', { exact: true }).first().click().catch(() => {});
  await h.step(`${D}/cf-big-tree`, '93 canvases in folders — the Canvases panel', 'big fixture, one folder expanded', async () => {
    await folder();
    await sleep(600);
  });
  await folder();
  await h.step(`${D}/cf-panel-search`, 'Search inside the panel: "campaign"', 'type into canvas-search', async () => {
    await h.tid('canvas-search').click();
    await page.keyboard.type('campaign');
    await sleep(600);
  });
  await page.keyboard.press('Escape');
  await h.tid('canvas-search').locator('input').first().fill('').catch(() => {});
  await h.step(`${D}/cf-search-k`, '⌘K — canvases first, then tools', 'press Meta+k, type "camp"', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('camp');
    await sleep(600);
  });
  await h.esc(2);
  await h.open('ui-wide', 2500);
  await h.step(`${D}/cf-open-big`, '21 artboards, fit to view', 'open the 21-artboard canvas, ⌘0 fits', async () => {
    await page.keyboard.press('Meta+0');
    await sleep(900);
  });
  await h.open('ui-broken', 3500);
  await h.step(`${D}/cf-render-error`, 'A canvas that won’t render', 'open Broken.tsx (syntax error)', async () => {});
}
