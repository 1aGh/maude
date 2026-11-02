import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => studioSite();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
// c7-edit3: ed-edge-keys (tab walks the sections under the page; the focus ring lands on Services) and
// ed-edge-paste (a paste event INSIDE the canvas frame, Figma html + a picture on the clipboard).
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await h.open('ui-homepage', 3000);
  await k.fold();
  await k.inspector(true);
  await page.mouse.click(1000, 800); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1400); // the Desktop board close
  await h.step(`${D}/ed-edge-keys`, 'Keyboard only', 'tab walks the objects; focus on the Services row', async () => {
    await k.label('desktop');
    await page.keyboard.press('Enter'); await sleep(300);
    for (let i = 0; i < 12; i++) {
      const ttl = await page.locator('[data-testid="inspector-title"]').first().innerText({ timeout: 1500 }).catch(() => '');
      console.log('tab', i, ttl.trim());
      if (/^Services$/i.test(ttl.trim())) break;
      await page.keyboard.press('Tab'); await sleep(300);
    }
  });
  await h.esc(3);
  await h.esc(3);
  await h.step(`${D}/ed-edge-paste`, 'Pasted from Figma', 'a paste event in the canvas frame: Figma html + a picture, artboard selected', async () => {
    await k.label('desktop');
    const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
    await f.evaluate(async () => {
      const meta = btoa(JSON.stringify({ fileKey: 'AbC123xyz', pasteID: 4242, dataType: 'scene', name: 'Hero / v3' }));
      const html = `<meta charset='utf-8'><span data-metadata="<!--(figmeta)${meta}(/figmeta)-->"></span><span data-buffer="<!--(figma)ZmlnLWthd2k=(/figma)-->"></span><span style="white-space:pre-wrap;"></span>`;
      const cv = document.createElement('canvas'); cv.width = 720; cv.height = 400;
      const g = cv.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 720, 400); grad.addColorStop(0, '#9fd3f2'); grad.addColorStop(1, '#84dba0');
      g.fillStyle = grad; g.fillRect(0, 0, 720, 400);
      g.fillStyle = '#16181d'; g.font = '600 44px system-ui'; g.fillText('Calm software,', 40, 190); g.fillText('made in Brno.', 40, 244);
      g.font = '400 18px system-ui'; g.fillText('Hero · v3', 40, 360);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.items.add(new File([blob], 'hero.png', { type: 'image/png' }));
      const target = document.querySelector('.dc-artboard-body') || document.body;
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await sleep(3500);
    await page.keyboard.press('Meta+0'); await sleep(1500); // fit: the board and the picture below it
    console.log('pastebar in canvas', await f.locator('[data-testid="edit-paste-bar"]').count());
  });
}
