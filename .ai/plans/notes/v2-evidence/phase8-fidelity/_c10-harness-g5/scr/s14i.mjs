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
    // c10: the board's path — a sharp start, two smooth points, a sharp end — in point editing with a smooth point picked
    // (its handles, the Point card with Corner Smooth) and the pointer resting on the sharp end (its quiet "Sharp" tag)
    await h.step(`${D}/ed-pen`, 'Pen — draw', 'P: click, drag, drag, click, ↵; double-click the path, pick the third point, rest on the end', async () => {
      await h.esc(3); await page.mouse.click(1100, 380); await sleep(300); await page.keyboard.press('Alt+Meta+2'); await sleep(1300); await h.esc(3);
      await page.keyboard.press('p'); await sleep(500);
      await page.mouse.click(450, 262); await sleep(350);
      for (const [x, y, dx, dy] of [[540, 300, 42, 9], [650, 244, 42, -8]]) {
        await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up(); await sleep(400);
      }
      await page.mouse.click(770, 276); await sleep(400);
      await page.keyboard.press('Enter'); await sleep(2500);
      const frm = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
      const fb = await page.locator('[data-testid="canvas-frame"]').boundingBox();
      const on = await frm.evaluate(() => {
        const p = document.querySelector('svg[data-shape="path"] path');
        if (!p) return null;
        const q = p.getPointAtLength(p.getTotalLength() * 0.22); const m = p.getScreenCTM();
        return { x: q.x * m.a + q.y * m.c + m.e, y: q.x * m.b + q.y * m.d + m.f };
      });
      console.log('PEN on-path', JSON.stringify(on));
      if (on) await page.mouse.dblclick(fb.x + on.x, fb.y + on.y);
      await sleep(900);
      console.log('PEN points', await k.fr.locator('[data-testid^="edit-pen-point-"]').count());
      const mid = await k.fr.locator('[data-testid="edit-pen-point-0-2"]').boundingBox();
      if (mid) { await page.mouse.click(mid.x + mid.width / 2, mid.y + mid.height / 2); await sleep(900); }
      console.log('PEN chip', await k.fr.locator('[data-testid="edit-pen-chip-type"]').innerText().catch(() => '-'), '| Point card', await page.locator('[data-testid="insp-point-corner"]').count());
      const end = await k.fr.locator('[data-testid="edit-pen-point-0-3"]').boundingBox();
      if (end) { await page.mouse.move(end.x + end.width / 2 - 6, end.y + end.height / 2 - 6); await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2); await sleep(700); }
      console.log('PEN hover tag', await k.fr.locator('[data-testid="edit-pen-chip-hover"]').innerText().catch(() => '-'));
    });
    await h.esc(3);
  }
  if (want('pen-draw')) {
    // the side state: a path being drawn — the pointer over the first point shows the ring and "Click here to close"
    await h.step(`${D}/ed-pen-draw`, 'Pen — close the path', 'P: three clicks, the pointer back on the first point', async () => {
      await h.esc(3); await page.mouse.click(1100, 380); await sleep(300); await page.keyboard.press('Alt+Meta+2'); await sleep(1300); await h.esc(3);
      await page.keyboard.press('p'); await sleep(500);
      await page.mouse.click(430, 270); await sleep(350);
      await page.mouse.click(560, 220); await sleep(350);
      await page.mouse.click(690, 285); await sleep(350);
      await page.mouse.move(470, 274); await page.mouse.move(432, 271); await sleep(700);
      console.log('PENDRAW ring', await k.fr.locator('[data-testid="edit-pen-close"]').count(), 'chip', await k.fr.locator('[data-testid="edit-pen-chip-close"]').count());
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
