import { empty } from './fx.mjs';
export const fixture = empty;
const D = '05';
export async function run(h) {
  const { page, sleep } = h;
  const palette = async (q, enter = true) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(700);
    if (enter) { await page.keyboard.press('Enter'); await sleep(1200); }
  };
  const act = async (id, q) => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type(q);
    await sleep(800);
    await page.locator(`[data-testid="palette-row-action:${id}"]`).first().click();
    await sleep(1200);
  };
  // stage D: Esc no longer closes Version history (the panel stays); close it by its own button
  const closeHist = async () => { await h.esc(1); const c = page.locator('[data-testid="vh-close"]').first(); if (await c.count()) { await c.click().catch(() => {}); await sleep(600); } };
  await h.step(`${D}/es-project-new`, 'A new project with no canvases', 'empty project, nothing open', async () => {});
  await h.step(`${D}/es-search-k.nothing-recent`, '⌘K with nothing recent (a new Mac)', '⌘K on the empty project', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(900);
  });
  await h.esc(2);
  await h.step(`${D}/es-search-k`, '⌘K — nothing called “pricng”', '⌘K, type pricng', async () => { await palette('pricng', false); });
  await h.esc(2);
  await h.step(`${D}/es-panels-make-assets`, 'Assets — no images or footage yet', 'left panel › Assets', async () => { await h.click('panel-tab-assets'); });
  await h.step(`${D}/es-search-more.assets`, 'Assets search with no hits', 'Assets search: zzz', async () => {
    await h.tid('assets-search').click().catch(() => {});
    await page.keyboard.type('zzz');
    await sleep(700);
  });
  await h.click('panel-tab-tree').catch(() => {});
  await h.step(`${D}/es-panels-make-exports`, 'Exports panel — nothing exported yet', '⌘K › Exports', async () => { await act('view.exports', 'exports'); });
  await h.esc(2);
  await act('canvas.new', 'new canvas');
  await sleep(2500);
  await h.step(`${D}/es-canvas-ai`, 'A new canvas — “Your canvas is ready.”', '⌘K › New canvas', async () => {});
  await h.step(`${D}/es-panels-canvas-comments`, 'Comments — nothing yet', 'share cluster › Comments', async () => { await act('view.comments', 'comments'); });
  await h.click('share-cluster-comments').catch(() => {});
  await h.step(`${D}/es-panels-canvas-history`, 'Version history — nothing to restore yet', '⌘K › Version history', async () => { await act('history.open', 'version history'); });
  await closeHist();
  await h.step(`${D}/es-panels-make-ai`, 'AI chat — empty', 'panel-icon-assistant', async () => { await h.click('panel-icon-assistant'); });
  await h.step(`${D}/es-canvas-three.connect`, 'First send with no Claude connected', 'AI panel › type › Enter', async () => {
    await h.tid('chat-composer').locator('textarea, [contenteditable]').first().click({ timeout: 4000 });
    await page.keyboard.type('An About us page: three team portraits and a short story');
    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1800);
  });
  await h.esc(2);
  await h.click('ai-chat-hide').catch(() => {});
  await sleep(500);
  await closeHist();
  await h.step(`${D}/es-artboard-new.panels`, 'before New artboard (panels state check)', 'after closing AI + history', async () => {});
  await h.step(`${D}/es-artboard-new`, 'Empty artboard after “New artboard”', 'New artboard door on the empty canvas', async () => {
    await h.click('empty-canvas-door');
    await sleep(3500);
  });
  await h.step(`${D}/es-artboard-new.layers`, 'Layers tab on the empty artboard', 'Layers tab', async () => { await h.click('panel-icon-left').catch(() => {}); await sleep(700); await h.click('panel-tab-layers'); await page.mouse.move(800, 500); });
  await h.click('panel-tab-tree').catch(() => {});
  await h.step(`${D}/es-panels-make-trash`, 'Trash — empty', 'Advanced › Trash', async () => { const f = h.tid('canvases-advanced'); if ((await f.getAttribute('aria-expanded')) !== 'true') await f.click(); await sleep(400); await h.click('canvases-advanced-trash'); });
  await h.esc(2);
}
