// c7-g15b: the GESTURE states the board draws (a pointer held mid-gesture, a menu open, a toast up).
// G=g1: arrow-bind (snap ring + tag), arrow-kinds (heads menu), follow (elbow), dangling
// Run through the same run.mjs: G=g1 bun .scr/run.mjs .scr/s15g.mjs light
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { REPO } from './lib.mjs';
import { studioSite } from './fx5.mjs';
import { base } from './fx.mjs';
import { kit } from './g5.mjs';
export const fixture = async () => (process.env.G === 'g3' ? base() : studioSite());
export const page = { w: 1440, h: 900 };
const D = '15-annotations';
const G = process.env.G || 'g1';
const REL = 'ui/Homepage.tsx';
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const af = () => k.fr.locator('.dc-annot-el');
  await h.open('ui-homepage', 3000);
  await k.fold();
  await k.fit();
  const frame = async (out = 1) => { await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1200); for (let i = 0; i < out; i++) { await page.keyboard.press('Meta+-'); await sleep(500); } await sleep(400); };
  const preview = async () => { await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(1300); await page.keyboard.press('Escape'); await sleep(300); };
  const edit = async () => { await page.keyboard.press('Escape'); await sleep(900); await page.keyboard.press('Escape'); await sleep(600); };
  // the midpoint (page px) of an arrow's drawn line; `which` = null: the first human-made arrow, else the first
  const arrowMid = async (which) => {
    const fe = await page.locator('[data-testid="canvas-frame"]').first().boundingBox();
    const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
    const pt = await f.evaluate((which) => {
      const els = [...document.querySelectorAll('.dc-annot-el[data-type="arrow"]')];
      const el = which ? els.find((e) => e.getAttribute('data-id') === which) : (els.find((e) => !e.hasAttribute('data-author')) || els[0]);
      if (!el) return null;
      const path = [...el.querySelectorAll('path')].find((q) => q.getTotalLength && q.getTotalLength() > 20 && getComputedStyle(q).fill === 'none') || el.querySelector('path');
      if (!path) return null;
      const m = path.getPointAtLength(path.getTotalLength() / 2);
      const ctm = path.getScreenCTM();
      return { x: ctm.a * m.x + ctm.c * m.y + ctm.e, y: ctm.b * m.x + ctm.d * m.y + ctm.f };
    }, which);
    return pt ? { x: fe.x + pt.x, y: fe.y + pt.y } : null;
  };
  if (G === 'g1') {
    const R = await k.seed(REL, [
      { op: 'create', type: 'sticky', ref: '@s1', text: 'Make See the work bigger — it is the point of the page', x: 40, y: 700, w: 190, h: 130 },
      { op: 'create', type: 'sticky', ref: '@s2', text: 'Is this the right CTA?', to: 'el:desktop/see-work' },
    ]);
    await frame();
    await preview();
    await h.step(`${D}/an-arrow-bind`, 'Aim at the thing you mean: the end snaps to the button under it', 'Preview, A, drag from the sticky to the button and hold', async () => {
      await page.keyboard.press('a'); await sleep(600);
      const s = await k.ctr('.dc-annot-el[data-type="sticky"]');
      const t = await k.ctr('[data-dc-screen="desktop"] [data-cd-id="see-work"]');
      await page.mouse.move(s.x, s.y - 20); await page.mouse.down();
      await page.mouse.move((s.x + t.x) / 2, (s.y + t.y) / 2, { steps: 12 });
      await page.mouse.move(t.x + 4, t.y + 2, { steps: 12 });
      await sleep(800);
    });
    await page.mouse.up(); await sleep(500);
    await h.esc(2);
    await edit();
    await k.seed(REL, [{ op: 'connect', from: R['@s1'], to: 'el:desktop/see-work', label: 'bigger' }]);
    await frame();
    await preview();
    await h.step(`${D}/an-arrow-kinds`, 'Every arrow can change its line and ends from the small toolbar above it', 'select an arrow, open the Arrowhead menu', async () => {
      const p = await arrowMid(null);
      if (p) await page.mouse.click(p.x, p.y);
      await sleep(900);
      const t = k.fr.locator('[aria-label^="Arrowhead"]').first();
      if (await t.count()) { await t.click({ timeout: 3000 }).catch(() => {}); await sleep(700); }
    });
  }
  if (G === 'g2') {
    const R = await k.seed(REL, [
      { op: 'create', type: 'sticky', ref: '@s1', text: 'Photo feels small next to the headline', x: 760, y: 120, w: 200, h: 140 },
      { op: 'create', type: 'sticky', ref: '@s2', text: 'Is this the right CTA?', x: 560, y: 380, w: 200, h: 130 },
    ]);
    await frame();
    await preview();
    const stk = async (i) => { const b = await af().nth(i).boundingBox(); return b; };
    // convert the first note (menu → Turn into a comment), then open the same menu on the second
    {
      const b = await stk(0);
      if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await sleep(700);
        const it = k.fr.getByText('Turn into a comment').first(); if (await it.count()) { await it.click().catch(() => {}); await sleep(1500); } }
      await page.mouse.click(700, 120); await sleep(600);
    }
    await h.step(`${D}/an-convert`, 'A note that needs an answer becomes a comment', 'right-click a sticky > Turn into a comment; the menu again on the other note', async () => {
      const b = await stk(0);
      if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' }); await sleep(900); }
    });
    await page.mouse.click(700, 120); await sleep(500);
    await h.step(`${D}/an-visibility`, 'Quiet in Edit, hidden with Shift+P', 'Shift+P: annotations hidden, the toast up', async () => {
      await page.keyboard.press('Shift+P'); await sleep(450);
    });
    await page.keyboard.press('Shift+P'); await sleep(400);
  }
  if (G === 'g3') {
    await h.open('ui-video', 3500);
    await k.fold();
    await k.fit();
    await h.step(`${D}/an-video`, 'A sticky on a video, pinned to its moment', 'Preview, N, click on the video artboard (pins at the playhead)', async () => {
      await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(1300);
      const c = await k.ctr('[data-dc-screen] .dc-artboard-body');
      if (c) { await page.mouse.click(c.x - c.b.width / 4, c.y - c.b.height / 4); await sleep(1000); await page.keyboard.type('Cut here'); await sleep(400); await page.keyboard.press('Escape'); await sleep(900); }
    });
  }
  if (G === 'g4') {
    await frame();
    await h.step(`${D}/an-vote`, 'Start a vote', 'cmd-K > Start a vote', async () => {
      await page.keyboard.press('Meta+k'); await sleep(600); await page.keyboard.type('start a vote'); await sleep(900); await page.keyboard.press('Enter'); await sleep(1500);
    });
    await h.step(`${D}/an-stamps`, 'The vote is running: the bar, the stamps', 'Start the vote', async () => {
      const go = page.locator('[data-testid="vote-sheet-start"]').first();
      console.log('go count', await go.count());
      if (await go.count()) { await go.click(); await sleep(1800); }
    });
  }
  if (G === 'g5') {
    await k.seed(REL, [
      { op: 'create', type: 'sticky', ref: '@s1', text: 'Photo feels small next to the headline', x: 760, y: 120, w: 200, h: 140 },
      { op: 'create', type: 'sticky', ref: '@s2', text: 'Is this the right CTA?', x: 560, y: 380, w: 200, h: 130 },
    ]);
    await frame();
    await h.step(`${D}/an-visibility`, 'Quiet in Edit, hidden with Shift+P', 'Edit: Shift+P, the toast up', async () => {
      const vis = async () => k.fr.locator('.dc-annot-el').first().isVisible().catch(() => 'err');
      for (const v of ['Shift+P', 'Shift+KeyP']) { await page.keyboard.press(v); await sleep(500); const a = await vis(); console.log(v, a); if (a === false) break; }
      console.log('annot visible?', await k.fr.locator('.dc-annot-el').first().isVisible().catch(() => 'err'), await k.fr.locator('.dc-annot-el').count());
    });
  }
}
