import { studio } from './fx4.mjs';
export const fixture = studio;
export const page = { w: 1440, h: 900, channel: true };
const D = '04-modes';
export async function run(h) {
  const { page, sleep } = h;
  const f = page.frameLocator('[data-testid="canvas-frame"]');
  const el = (id) => f.locator(`[data-cd-id="${id}"]`).first();
  const same = async () => {};
  const mc = async (name, meta = false) => {
    for (const pre of ['desktop', 'tablet']) {
      const b = await el(`${pre}-${name}`).boundingBox().catch(() => null);
      if (!b || b.x < 10 || b.y < 100 || b.x + b.width > 1430 || b.y + b.height > 800) continue;
      if (meta) await page.keyboard.down('Meta');
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      if (meta) await page.keyboard.up('Meta');
      return;
    }
    throw new Error('no visible ' + name);
  };
  await h.open('ui-homepage', 4000);
  await page.mouse.click(328, 301); // the Desktop artboard (label)
  await sleep(600);
  await h.step(`${D}/md-model`, 'Edit: the default, toolbar for Edit, Desktop selected', 'open Homepage, click the artboard', same);
  // md-edit first, while the Canvases panel is folded: selecting hands the Inspector the right and the left stays out
  await h.step(`${D}/md-edit`, 'Edit: a link element selected (On click)', 'zoom to the Desktop artboard, meta-click "See pricing →"', async () => {
    await page.keyboard.press('Meta+Equal'); await sleep(300); await page.keyboard.press('Meta+Equal'); await sleep(300); await page.keyboard.press('Meta+Equal');
    await sleep(1200);
    await el('desktop-pricing').click({ modifiers: ['Meta'], timeout: 5000 });
    await sleep(1200);
  });
  await h.esc(2);
  await page.mouse.click(328, 301); // back on the Desktop artboard
  await sleep(500);
  await h.step(`${D}/md-edit-image`, 'Assets open beside the canvas', 'Assets tab; the hero picture selected', async () => {
    const ic = page.locator('[data-testid="panel-icon-left"]').first();
    if (await ic.count()) { await ic.click(); await sleep(900); }
    await page.locator('[data-testid="panel-tab-assets"]').first().click({ timeout: 4000 });
    await sleep(900);
    await el('desktop-art').click({ timeout: 5000 });
    await sleep(900);
  });
  await h.click('panel-tab-tree').catch(() => {});
  await h.esc(2);
  await page.keyboard.press('Shift+1');
  await sleep(900);
  // round 8 (md-edit-component): the board has no left panel under the picker - fold Canvases / Assets first
  await h.click('panel-fold-left').catch(() => {});
  await sleep(700);
  await h.step(`${D}/md-edit-component`, 'Components slot of the Edit toolbar', 'toolbar Components', async () => { await f.locator('[data-testid="toolbar-slot-components"]').first().click({ timeout: 4000 }); await sleep(1000); });
  await h.esc(2);
  // Preview, entered from the Desktop artboard (the camera lands on the board in view)
  await page.mouse.click(328, 301);
  await sleep(500);
  await h.click('palette-mode-preview');
  await sleep(1800);
  await h.step(`${D}/md-annotate`, "Preview's toolbar: annotation tools only", 'press Preview in the Share cluster', same);
  await h.step(`${D}/md-preview`, 'Previewing Homepage', 'same frame', same);
  await sleep(1500); // the camera has settled on the board
  // round 8 (md-inspect): fit the camera first (the board is at 60 % or lower) so the target and its spec tags clear the island
  await page.keyboard.press('Meta+0');
  await sleep(1300);
  // round 10: Meta+0 fits at ~81 % and "Book a call" sits under the Inspect island: step the camera out until the readout is <= 69 %
  for (let i = 0; i < 4; i++) {
    const t = (await page.locator('[data-testid="zoom-only"]').first().textContent().catch(() => '')) || '';
    const pct = Number.parseInt(t.replace(/[^0-9]/g, ''), 10);
    console.log('zoom readout', JSON.stringify(t), pct);
    if (Number.isFinite(pct) && pct <= 69) break;
    await page.keyboard.press('Meta+Minus');
    await sleep(900);
  }
  await h.step(`${D}/md-inspect`, 'Inspect "Book a call"', '⌘-click in Preview, Advanced open', async () => {
    await mc('book', true);
    await sleep(2200);
    // the board draws Advanced open with the raw CSS rows
    const tg = page.locator('[data-testid="fold-inspect-toggle"]').first();
    if ((await tg.count()) && (await tg.getAttribute('aria-expanded')) !== 'true') await tg.click({ timeout: 3000 }).catch(() => {});
    await sleep(800);
  });
  await h.esc(1);
  await sleep(600);
  await h.step(`${D}/md-preview-follow`, 'Followed a link to Pricing', 'click "See pricing →" in Preview', async () => { await el('desktop-pricing').dispatchEvent('click'); await sleep(4500); });
  await h.click('preview-bar-back').catch(() => {});
  await sleep(1500);
  await h.step(`${D}/md-comment`, 'Comment tool: a pin and a composer', 'Comment tool, click on the artboard, type', async () => {
    await f.locator('[data-testid="toolbar-slot-comment"]').first().click({ timeout: 4000 });
    await sleep(400);
    await mc('h1');
    await sleep(900);
    await page.keyboard.type('Cards on tablet — tighten the gap');
    await sleep(500);
  });
  await page.keyboard.press('Meta+Enter');
  await sleep(1200);
  await h.step(`${D}/md-comment-thread`, 'the thread after sending', '⌘↵', same);
  await h.esc(1);
  await sleep(500);
  if (!(await f.locator('[data-testid="toolbar-slot-sticky"]').first().isVisible().catch(() => false))) { await h.click('palette-mode-preview'); await sleep(1800); }
  await h.step(`${D}/md-draw`, 'Sticky in Preview', 'Sticky tool, click, type', async () => {
    await h.click('comments-panel-close').catch(() => {});
    await sleep(400);
    await f.locator('[data-testid="toolbar-slot-sticky"]').first().click({ timeout: 4000, force: true }).catch(async () => { await h.step(`${D}/dbg-draw`, 'dbg', 'dbg', async () => {}); throw new Error('sticky'); });
    await sleep(500);
    await page.mouse.click(760, 330);
    await sleep(900);
    await page.keyboard.type('Cards: one row on mobile');
    await h.esc(1);
    await sleep(700);
  });
  await h.esc(1);
  // Present
  await h.click('mode-present-menu');
  await sleep(700);
  await h.step(`${D}/md-present-menu`, 'Present, and its small menu', 'Present ⌄', same);
  await h.esc(1);
  await h.click('palette-mode-edit').catch(() => {});
  await sleep(900);
  await page.mouse.click(328, 301);
  await sleep(500);
  await page.keyboard.press('Alt+Meta+Enter');
  await sleep(450);
  await h.step(`${D}/md-present-lift`, 'Present lifts the artboard out of the canvas', '⌥⌘↵ from the selected artboard (0.45 s in)', same);
  await sleep(2200);
  await h.step(`${D}/md-present-full`, 'Full screen, counter', 'a moment later', same);
  await h.esc(2);
  await sleep(800);
  await h.click('mode-present-menu').catch(() => {});
  await h.click('mode-present-canvas').catch(() => {});
  await sleep(1800);
  await h.step(`${D}/md-present-canvas`, 'Present the canvas — pan freely', 'Present ⌄ › Present the canvas', same);
  await h.esc(2);
  // mixed kinds
  await h.open('ui-combine-kampan', 3500);
  await h.click('mode-present-menu').catch(() => {});
  await h.click('mode-present-canvas').catch(() => {});
  await sleep(1800);
  await h.step(`${D}/md-edge-mixed`, 'Present the canvas on Combine-kampan', 'Present ⌄ › Present the canvas', same);
  await h.esc(2);
  await sleep(600);
  await h.step(`${D}/md-preview-combine`, 'Preview on a canvas with no links', 'Preview Combine-kampan', async () => { await h.click('palette-mode-preview'); await sleep(1800); });
  await h.step(`${D}/md-esc`, 'esc ladder: from Preview, one esc', 'press esc once', async () => { await h.esc(1); await sleep(700); });
}
