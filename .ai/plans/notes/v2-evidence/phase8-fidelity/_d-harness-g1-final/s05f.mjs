import { big } from './fx.mjs';
export const fixture = big;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-wide', 3000);
  if (!(await page.locator('[data-testid="canvas-search"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(900); }
  await h.step(`${D}/es-search-panel`, 'Panel search — 93 canvases, none match', 'canvas search: sponzoři 2024', async () => {
    await h.tid('canvas-search').click();
    await page.keyboard.type('sponzoři 2024');
    await sleep(900);
  });
  await h.tid('canvas-search').locator('input').first().fill('').catch(() => {});
  await h.esc(2);
  // comments: drop one, resolve it
  await h.click('palette-mode-preview').catch(() => {});
  await sleep(800);
  await page.keyboard.press('c');
  await sleep(500);
  await page.mouse.click(900, 500);
  await sleep(900);
  await page.keyboard.type('Looks right.');
  await page.keyboard.press('Meta+Enter');
  await sleep(1500);
  await h.step(`${D}/es-panels-canvas.comment-sent`, 'One comment sent', 'Preview, C, click, type, Enter', async () => {});
  await h.esc(2);
  await h.click('share-cluster-comments').catch(() => {});
  await sleep(1000);
  await h.step(`${D}/es-panels-canvas.comments-open`, 'Comments panel with one thread', 'share cluster › Comments', async () => {});
  await page.locator('[data-testid^="comment-resolve-"]').first().click({ timeout: 3000 }).catch((e) => console.log('resolve fail'));
  await sleep(1800);
  await h.step(`${D}/es-panels-canvas.all-done`, 'All resolved — “All done.”', 'resolve the only thread', async () => {});
}
