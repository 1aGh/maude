import { gators } from './fx5.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => gators();
export const page = { w: 1440, h: 900 };
const D = '14-editing';
const ONLY = process.env.ONLY || '';
// P8 c8: the Alligators group of 14 — ed-text-edit, ed-lay-free, ed-shape, ed-text-style, ed-img (and the side shots
// ed-text-style-uses / -detached), each on the object the board draws.
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const want = (id) => !ONLY || ONLY.split(',').includes(id);
  const P1 = (s) => `[data-dc-screen="p1"] ${s}`;
  const P2 = (s) => `[data-dc-screen="p2"] ${s}`;
  const editing = () => k.fr.locator('.dc-text-editing').count();
  await h.open('ui-combine-kampan', 3500);
  await k.leftTab('layers');
  await k.inspector(true);
  await k.fit();
  await page.mouse.click(1100, 380); await sleep(300); await page.keyboard.press('Alt+Meta+2'); await sleep(1200); // the Zapiš se post
  if (want('text-edit')) {
    await h.step(`${D}/ed-text-edit`, 'Edit text in place', 'double-click the headline: edit mode, the second line selected', async () => {
      await k.click(P2('[data-cd-id="title"]'));
      for (let i = 0; i < 3 && !(await editing()); i++) { await k.dbl(P2('[data-cd-id="title"]')); await sleep(500); }
      console.log('TEXT-EDIT editing:', await editing());
      await page.keyboard.press('End');
      await page.keyboard.press('Alt+Shift+ArrowLeft'); // the last word, selected: the typed-selection highlight
      await sleep(600);
    });
    await h.esc(3);
  }
  if (want('img')) {
    await h.step(`${D}/ed-img`, 'Image — place, then crop', 'select the photo, Fit Crop at 128 %, double-click for crop mode', async () => {
      await k.leftTab('assets');
      await k.deep(P2('[data-cd-id="foto"]'), 1);
      await page.locator('[data-testid="inspector-panel"]').getByText('Image', { exact: true }).first().click({ timeout: 3000 }).catch(() => {}); await sleep(700);
      console.log('IMG fit ctl', await page.locator('[data-testid="insp-ctl-image-fit"]').count(), 'tabs', JSON.stringify(await page.locator('[data-testid="inspector-panel"] [role="tab"], [data-testid="inspector-panel"] button').allInnerTexts().then((a) => a.slice(0, 6))));
      await page.locator('[data-testid="insp-ctl-image-fit"]').getByText('Crop', { exact: true }).first().click({ timeout: 4000 }).catch((e) => console.log('IMG crop seg', String(e.message).split('\n')[0]));
      await sleep(1200);
      const z = page.locator('[data-testid="insp-image-zoom"] input').first();
      if (await z.count()) { await z.fill('128'); await z.press('Enter'); await sleep(1200); } else console.log('IMG no zoom field');
      await k.dbl(P2('[data-cd-id="foto"]'));
      console.log('IMG adjust rows', await page.locator('[data-testid="inspector-panel"]').getByText('Remove background').count());
    });
    await h.esc(2);
  }
  if (want('pen')) {
    await h.step(`${D}/ed-pen`, 'Pen — draw', 'P: click, drag a smooth point, click, drag, ↵; double-click the path and pick a point', async () => {
      await h.esc(3); await page.mouse.click(1100, 380); await sleep(300); await page.keyboard.press('Alt+Meta+2'); await sleep(1300); await h.esc(3);
      await page.keyboard.press('p'); await sleep(500);
      const pts = [[450, 250], [540, 290], [650, 240], [740, 270]];
      for (const [x, y] of pts) { await page.mouse.click(x, y); await sleep(350); }
      if (process.env.DBGSHOT) await page.screenshot({ path: '.scr/dbg-pen1.png' });
      await page.keyboard.press('Escape'); await sleep(2500);
      if (process.env.DBGSHOT) await page.screenshot({ path: '.scr/dbg-pen2.png' });
      
      // into point editing: double-click the path, then pick the middle point
      const seg = await page.locator('[data-testid="canvas-frame"]').boundingBox();
      void seg;
      await page.mouse.dblclick(595, 266); await sleep(900);
      const T = async (w) => console.log('PEN', w, 'title:', await page.locator('[data-testid="inspector-title"]').first().innerText().catch(() => '?'), '| kind:', await page.locator('[data-testid="inspector-kind"], .insp-kind').first().innerText().catch(() => '?'));
      await T('after dbl');
      console.log('PEN points', await k.fr.locator('[data-testid^="edit-pen-point-"]').count());
    });
    await h.esc(3);
  }
  await page.mouse.click(1100, 380); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1200); // the post the board frames: Post 1:1 · Combine 2026
  if (want('lay-free')) {
    await h.step(`${D}/ed-lay-free`, 'Free placement with constraints', 'select the Datum frame (pinned right and top)', async () => {
      await k.deep(P1('[data-cd-id="datum"]'), 1);
    });
    await h.esc(2);
  }
  if (want('shape')) {
    await h.step(`${D}/ed-shape`, 'Shape — fill, stroke, each corner', 'select the shape behind the date (Podklad)', async () => {
      // the Datum frame sits over the shape; the shape's own margin (16 px around it) is the way to its handle
      const c = await k.ctr(P1('[data-cd-id="podklad"]'));
      await page.mouse.click(c.b.x + c.b.width / 2, c.b.y + 3); await sleep(900);
      console.log('SHAPE title', await page.locator('[data-testid="inspector-title"]').first().innerText().catch(() => '?'));
    });
    await h.esc(2);
  }
  if (want('text-style')) {
    await h.step(`${D}/ed-text-style`, 'A style, an override', 'select the title: it wears the Title style with its size set over it', async () => {
      await k.deep(P1('[data-cd-id="title"]'), 1);
    });
    await h.esc(2);
  }
}
