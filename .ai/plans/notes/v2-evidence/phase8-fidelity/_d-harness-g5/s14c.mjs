import { gators, studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => (process.env.FX === 'gators' ? gators() : studioSite());
export const page = { w: 1440, h: 900 };
const D = '14-editing';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const hp = (s) => `[data-dc-screen="desktop"] ${s}`;
  if (process.env.FX !== 'gators') {
    await h.open('ui-homepage', 3000);
    await k.fold();
    await k.inspector(true);
    await h.step(`${D}/ed-ab-menu`, 'Right-click an artboard', 'right-click the artboard name', async () => {
      const b = await k.box('[data-dc-screen="desktop"] .dc-artboard-label');
      await page.mouse.click(b.x + 20, b.y + 8, { button: 'right' });
      await sleep(900);
      const it = page.getByRole('menuitem', { name: /another width/i }).first();
      if (await it.count()) { await it.hover().catch(() => {}); await sleep(600); }
    });
    await h.esc(3);
    await h.step(`${D}/ed-comp-instance`, 'An instance — override, swap, detach', 'place a Button from ⇧I, select it', async () => {
      await page.mouse.click(700, 700); await sleep(300);
      await page.keyboard.press('Shift+i'); await sleep(1000);
      const row = page.locator('[data-testid="component-picker-row-Button"]').first();
      if (await row.count()) await row.click();
      await sleep(600);
      const c = await k.ctr(hp('[data-cd-id="hero-art"]'));
      await page.mouse.click(c.x, c.y); await sleep(1200);
    });
    await h.esc(3);
    await h.step(`${D}/ed-edge-ask`, '⌘/ on a selection — AI works in place', 'select the Services row, press ⌘/', async () => {
      await k.deep(hp('[data-cd-id="services"]'), 2);
      await page.keyboard.press('Meta+/'); await sleep(1200);
    });
    await h.esc(3);
    await h.step(`${D}/ed-edge-ai`, 'AI edits the footer, you edit the headline', 'AI panel, type a request, send', async () => {
      await k.ai(true);
      const c = page.locator('[data-testid="chat-composer"] textarea, [data-testid="chat-composer"] [contenteditable]').first();
      if (await c.count()) { await c.click(); await page.keyboard.type('Make the footer quieter and add a line'); await page.keyboard.press('Enter'); }
      await sleep(2500);
    });
    await h.esc(3);
    await k.ai(false);
    await h.step(`${D}/ed-edge-undo`, 'Undo across AI and you', 'edit, then ⌘K › Undo history', async () => {
      await k.deep(hp('[data-cd-id="see-work"]'), 4);
      await page.keyboard.press('ArrowRight'); await sleep(300);
      await page.keyboard.press('ArrowRight'); await sleep(300);
      await page.keyboard.press('Meta+k'); await sleep(500);
      await page.keyboard.type('undo history'); await sleep(900);
      await page.keyboard.press('Enter'); await sleep(1200);
    });
    await h.esc(3); await page.mouse.click(140, 600); await sleep(500); await h.esc(3); await page.mouse.click(140, 600); await sleep(400);
    await h.step(`${D}/ed-edge-paste`, 'Pasted from Figma', 'ClipboardEvent with a Figma copy on the selected artboard', async () => {
      await k.label('desktop');
      await page.evaluate(() => {
        const meta = btoa(JSON.stringify({ fileKey: 'AbC123xyz', pasteID: 4242, dataType: 'scene' }));
        const html = `<meta charset='utf-8'><span data-metadata="<!--(figmeta)${meta}(/figmeta)-->"></span><span data-buffer="<!--(figma)ZmlnLWthd2k=(/figma)-->"></span><span style="white-space:pre-wrap;"></span>`;
        const dt = new DataTransfer(); dt.setData('text/html', html);
        document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await sleep(2500);
    });
    await h.esc(3);
    await h.step(`${D}/ed-edge-keys`, 'Keyboard only', 'tab walks the objects', async () => {
      await k.label('desktop');
      await page.keyboard.press('Enter'); await sleep(300);
      for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); await sleep(250); }
    });
  } else {
    await h.open('ui-klub-web', 4000);
    await k.fold();
    await k.inspector(true);
    await h.step(`${D}/ed-edge-huge`, 'A 6000 px page', 'open the long page, select it, zoom in', async () => {
      await k.label('page');
      await page.keyboard.press('Meta+1'); await sleep(1500);
      await page.keyboard.press('Enter'); await sleep(600);
    });
  }
}
