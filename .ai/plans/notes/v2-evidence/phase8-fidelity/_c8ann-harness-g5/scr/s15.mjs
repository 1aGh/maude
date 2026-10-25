import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { studioSite } from './fx5.mjs';
import { kit } from './g5.mjs';
import { base } from './fx.mjs';
export const fixture = async () => (process.env.G === 'f' ? base() : studioSite());
export const page = { w: 1440, h: 900 };
const D = '15-annotations';
const G = process.env.G || 'a';
const REL = 'ui/Homepage.tsx';
const STK = [
  { op: 'create', type: 'sticky', ref: '@s1', text: 'Tighter, please', to: 'el:desktop/headline' },
  { op: 'create', type: 'sticky', ref: '@s2', text: 'Is this the right CTA?', to: 'el:desktop/see-work' },
  { op: 'create', type: 'sticky', ref: '@s3', text: 'Image too tall', x: 1700, y: 700, w: 200, h: 140 },
  { op: 'create', type: 'sticky', ref: '@s4', text: 'Spacing between the two?', x: 1420, y: 300, w: 180, h: 130 },
];
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  const af = () => k.fr.locator('.dc-annot-el');
  await h.open(process.env.G === 'f' ? 'ui-print' : 'ui-homepage', 3000);
  await k.fold();
  await k.fit();
  const preview = async () => { await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(1300); await page.keyboard.press('Escape'); await sleep(300); };
  const edit = async () => { await page.keyboard.press('Escape'); await sleep(900); await page.keyboard.press('Escape'); await sleep(600); };
  // c7-g15: the board frames Desktop at ~60 % (jump to artboard 1, one step out), so stickies, arrows and chrome read at their drawn size
  const frame = async (out = 1) => { await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('Alt+Meta+1'); await sleep(1200); for (let i = 0; i < out; i++) { await page.keyboard.press('Meta+-'); await sleep(500); } await sleep(400); };
  const zoomIn = async (x, y, n = 6) => { await page.mouse.move(x, y); await page.keyboard.down('Meta'); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, -120); await sleep(120); } await page.keyboard.up('Meta'); await sleep(900); };
  // the midpoint (page px) of an arrow's drawn line: which = 'last' | an element id | null (first)
  const arrowMid = async (which) => {
    const fe = await page.locator('[data-testid="canvas-frame"]').first().boundingBox();
    const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
    const pt = await f.evaluate((which) => {
      const els = [...document.querySelectorAll('.dc-annot-el[data-type="arrow"]')];
      const el = which === 'last' ? els[els.length - 1] : which ? els.find((e) => e.getAttribute('data-id') === which) : els[0];
      if (!el) return null;
      const path = [...el.querySelectorAll('path')].find((q) => q.getTotalLength && q.getTotalLength() > 20 && getComputedStyle(q).fill === 'none') || el.querySelector('path');
      if (!path) return null;
      const m = path.getPointAtLength(path.getTotalLength() / 2);
      const ctm = path.getScreenCTM();
      return { x: ctm.a * m.x + ctm.c * m.y + ctm.e, y: ctm.b * m.x + ctm.d * m.y + ctm.f };
    }, which);
    return pt ? { x: fe.x + pt.x, y: fe.y + pt.y } : null;
  };
  if (G === 'a') {
    await h.step(`${D}/an-enter`, 'N in Edit — Preview opens with Sticky in hand', 'click empty canvas, press N', async () => { await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(1300); await k.fit(); });
    await edit();
    const R = await k.seed(REL, STK);
    await frame();
    await h.step(`${D}/an-place`, 'Stickies on and between artboards; the Sticky tool is armed', 'seeded stickies, Preview with N: the paper dots over the dock', async () => { await page.keyboard.press('n'); await sleep(1300); });
    await page.keyboard.press('Escape'); await sleep(500);
    await h.step(`${D}/an-place-preview`, 'Stickies in Preview', 'Preview mode', async () => {});
    await h.step(`${D}/an-sticky`, 'A sticky, up close', 'click a sticky, zoom to it', async () => {
      const el = af().first(); if (await el.count()) { const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(900); await zoomIn(b.x + b.width / 2, b.y + b.height / 2, 4); const b2 = await el.boundingBox(); if (b2) { await page.mouse.wheel(b2.x + b2.width / 2 - 720, b2.y + b2.height / 2 - 500); await sleep(900); } }
    });
    await page.keyboard.press('Escape'); await sleep(400);
    await frame();
    // c8-ann: what the layer already does, all of it on the canvas (the board's 8 cells): text in five sizes, the
    // shape set, a link card, clips, a dashed arrow, stickies with lists
    await k.seed(REL, [
      { op: 'create', type: 'text', text: 'Hej!', x: 40, y: 1120, w: 200, h: 90, fontSize: 64, color: '#7a7a86' },
      { op: 'create', type: 'text', text: 'So 14. 3.', x: 40, y: 1230, w: 260, h: 50, fontSize: 36, color: '#7a7a86' },
      { op: 'create', type: 'text', text: 'Kraví hora, Brno', x: 40, y: 1296, w: 260, h: 40, fontSize: 24, color: '#7a7a86' },
      { op: 'create', type: 'text', text: 'Registrace do 10. 3.', x: 40, y: 1346, w: 260, h: 30, fontSize: 16, color: '#7a7a86' },
      { op: 'create', type: 'shape', shape: 'rounded', x: 420, y: 1120, w: 120, h: 70, fill: '#bcd2f0', label: 'Start' },
      { op: 'create', type: 'shape', shape: 'ellipse', x: 580, y: 1120, w: 120, h: 70, fill: '#bfe3c0' },
      { op: 'create', type: 'shape', shape: 'diamond', x: 740, y: 1110, w: 120, h: 90, fill: '#fce8a6', label: 'Ano?' },
      { op: 'create', type: 'shape', shape: 'triangle', x: 420, y: 1230, w: 110, h: 100, fill: '#f7c5c0', dashed: true },
      { op: 'create', type: 'shape', shape: 'triangle-down', x: 580, y: 1230, w: 110, h: 100, fill: '#cfc4ec' },
      { op: 'create', type: 'arrow', x1: 900, y1: 1140, x2: 1080, y2: 1210, dashed: true },
      { op: 'create', type: 'sticky', text: 'Logo výš\nDatum tučně\nQR na zadní', x: 1120, y: 1110, w: 200, h: 130, list: 'bullet' },
      { op: 'create', type: 'sticky', text: 'Tisk do pátku\nWeb v neděli', x: 900, y: 1260, w: 200, h: 110, list: 'number', color: '#bcd2f0' },
    ]);
    await k.seed(REL, [{ op: 'create', type: 'link', url: 'https://alligators.cz/combine', title: 'Combine 2026 — registrace', domain: 'alligators.cz', x: 420, y: 1370, w: 260, h: 70 }], 1500);
    await k.seed(REL, [
      { op: 'create', type: 'mediaref', src: 'assets/touchdown.mov', media: 'video', title: 'touchdown.mov', x: 740, y: 1380, w: 240, h: 56 },
      { op: 'create', type: 'mediaref', src: 'assets/hymna-2026.mp3', media: 'audio', title: 'hymna-2026.mp3', x: 740, y: 1450, w: 240, h: 56 },
    ], 1500);
    await k.fit();
    await h.step(`${D}/an-today`, 'Everything the layer already does — kept', 'text sizes + the size menu, the shape set, a link card, clips, a dashed arrow, lists', async () => {
      const t = af().filter({ hasText: 'Hej!' }).first();
      const last = af().last();
      const b = (await last.boundingBox()) || (await t.boundingBox());
      if (b) await zoomIn(b.x - 260, b.y - 40, 3);
      const t2 = af().filter({ hasText: 'Hej!' }).first();
      const tb = await t2.boundingBox();
      if (tb) { await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(900); const fs = k.fr.locator('.dc-annot-ctx-fs-trigger').first(); if (await fs.count()) { await fs.click({ timeout: 2500 }).catch(() => {}); await sleep(600); } }
    });
    await page.keyboard.press('Escape'); await sleep(400);
    await frame();
    await h.step(`${D}/an-arrow-bind`, 'An arrow to the button, not the artboard', 'select the bound arrow', async () => {
      const el = k.fr.locator('.dc-annot-el[data-type="arrow"]').first();
      if (await el.count()) { const b = await el.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(900); }
    });
    await h.step(`${D}/an-arrow-kinds`, 'Edges, elbows, curves and labels', 'arrow selected: the line menu', async () => {
      const t = page.locator('[data-testid^="annot-arrow-kind-"]').first();
      if (await t.count()) { await t.hover().catch(() => {}); }
    });
    await h.esc(2);
    await h.step(`${D}/an-marker`, 'Circle it, highlight it, rub it out', 'M, drag a stroke around the headline', async () => {
      await page.keyboard.press('m'); await sleep(500);
      const c = await k.ctr('[data-dc-screen="desktop"] [data-cd-id="headline"]');
      await page.mouse.move(c.b.x - 10, c.y); await page.mouse.down();
      for (let i = 0; i <= 12; i++) await page.mouse.move(c.x + Math.cos(i / 12 * 6.28) * (c.b.width / 2 + 14), c.y + Math.sin(i / 12 * 6.28) * (c.b.height / 2 + 14), { steps: 2 });
      await page.mouse.up(); await sleep(700);
      await page.keyboard.press('Escape'); await sleep(500); await page.keyboard.press('m'); await sleep(900);
    });
    await h.esc(2);
    // c8-ann: the section carries a tone (lilac), like the board's — not the default grey wrap
    await k.seed(REL, [
      { op: 'create', type: 'section', ref: '@sec', text: "Tereza's feedback", x: 1380, y: 250, w: 600, h: 640, color: '#8a6fd1' },
      { op: 'reparent', id: R['@s3'], parent: '@sec' },
      { op: 'reparent', id: R['@s4'], parent: '@sec' },
    ]);
    await frame();
    await h.step(`${D}/an-section`, "Tereza's feedback, wrapped in a section", 'wrap-section around two stickies; Preview, the section selected', async () => {
      await page.keyboard.press('n'); await sleep(1100); await page.keyboard.press('Escape'); await sleep(500);
      const sec = k.fr.locator('.dc-annot-el[data-type="section"]').first();
      if (await sec.count()) { const b = await sec.boundingBox(); await page.mouse.click(b.x + 70, b.y - 9); await sleep(900); await zoomIn(b.x + b.width / 2, b.y + b.height / 2, 2); const b2 = await sec.boundingBox(); if (b2) { await page.mouse.wheel(b2.x + b2.width / 2 - 720, b2.y + b2.height / 2 - 430); await sleep(900); } }
    });
    await h.esc(2);
    await edit();
    await h.step(`${D}/an-templates`, 'Start from a template', 'S opens the section templates', async () => {
      await page.keyboard.press('s'); await sleep(1200);
    });
  }
  if (G === 'b') {
    const R = await k.seed(REL, [...STK, { op: 'connect', from: '@s3', to: 'el:desktop/see-work', label: 'image' }]);
    await frame(2);
    {
      // c8-ann: board 15 an-follow routes an ELBOW arrow around the artboard in the way — pick the bound arrow, press Elbow
      await page.keyboard.press('n'); await sleep(1100); await page.keyboard.press('Escape'); await sleep(500);
      const p = await arrowMid('last');
      if (p) { await page.mouse.click(p.x, p.y); await sleep(900); const el = k.fr.locator('[data-testid="annot-arrow-kind-elbow"]').first(); if (await el.count()) await el.click({ timeout: 2500 }).catch(() => {}); await sleep(700); }
      await page.keyboard.press('Escape'); await sleep(400);
      await page.keyboard.press('Escape'); await sleep(900);
    }
    await h.step(`${D}/an-follow`, 'Move the artboard — the arrow goes around Mobile, never through', 'Edit: drag Desktop to the right', async () => {
      const b = await k.box('[data-dc-screen="desktop"] .dc-artboard-label');
      await page.mouse.move(b.x + 10, b.y + 8); await page.mouse.down();
      await page.mouse.move(b.x + 120, b.y + 80, { steps: 12 }); await sleep(500);
    });
    await page.mouse.up(); await sleep(400);
    await page.keyboard.press('Meta+z'); await sleep(500);
    await k.seed(REL, [{ op: 'resolve', ids: [R['@s1']] }]);
    await h.step(`${D}/an-ai-apply`, 'AI resolved a sticky; quiet in Edit', 'annotate resolve (as AI), Edit', async () => {});
    await h.step(`${D}/an-visibility`, 'Quiet in Edit, hidden with ⇧P', 'Edit mode stickies quiet; then ⇧P', async () => { await page.keyboard.press('Shift+P'); await sleep(900); });
    await page.keyboard.press('Shift+P'); await sleep(600);
    await h.step(`${D}/an-vs`, 'People talk, people draw', 'comments panel + stickies', async () => { await page.keyboard.press('Shift+Meta+m'); await sleep(1200); });
    await page.keyboard.press('Shift+Meta+m'); await sleep(500);
    await h.step(`${D}/an-layers`, 'Layers in Preview — annotation layer by section', 'Preview › Layers tab', async () => {
      await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(900); await k.fit(); await page.keyboard.press('Escape'); await sleep(400);
      // c8-ann: the board's second moment - one sticky locked and selected (the bar says "Locked · Unlock")
      { const b = await af().first().boundingBox(); if (b) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(700); await page.keyboard.press('Shift+Meta+l'); await sleep(900); } }
      if (!(await page.locator('[data-testid="panel-tab-layers"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
      await page.evaluate(() => document.querySelector('[data-testid="panel-tab-layers"]')?.click()); await sleep(900);
    });
    await h.step(`${D}/an-crowd`, '200 stickies, zoomed out', 'five named sections of coloured stickies, fit, two steps out', async () => {
      const PAPER = ['#fce8a6', '#cfc4ec', '#bcd2f0', '#bfe3c0', '#f7c5c0', '#f8d2a6'];
      const SECS = [['Nápady', 84, 12, [0, 1, 2]], ['Partneři', 37, 8, [3, 0]], ['Video', 41, 8, [1, 4]], ['Tisk', 22, 8, [4, 0]], ['Ostatní', 16, 8, [2, 5]]];
      const CW = 215, CH = 145, PADX = 30, PADY = 80;
      const sec = [], stk = [];
      let ox = 40, oy = 1300, rowH = 0;
      SECS.forEach(([t, n, cols, tones], si) => {
        const rows = Math.ceil(n / cols);
        const w = cols * CW + PADX * 2, hgt = rows * CH + PADY + 30;
        if (si === 2) { ox = 40; oy += 1250; rowH = 0; }
        sec.push({ op: 'create', type: 'section', text: t, x: ox, y: oy, w, h: hgt, color: '#8b8b94' });
        for (let i = 0; i < n; i++) stk.push({ op: 'create', type: 'sticky', text: 'note ' + i, x: ox + PADX + (i % cols) * CW, y: oy + PADY + Math.floor(i / cols) * CH, w: 190, h: 120, color: PAPER[tones[i % tones.length]], parent: null });
        ox += w + 80; rowH = Math.max(rowH, hgt);
      });
      await page.keyboard.press('Escape'); await sleep(600);
      // the Layers panel stays shut for this shot (the board draws the canvas alone)
      if (await page.locator('[data-testid="panel-fold-left"]').count()) await k.fold();
      await k.seed(REL, sec, 2500);
      await k.seed(REL, stk, 5500);
      await page.mouse.click(700, 120); await sleep(300); await k.fit(); await sleep(600);
      await page.mouse.move(60, 520); await sleep(1500);
    });
  }
  if (G === 'c') {
    await frame();
    await preview();
    await h.step(`${D}/an-stk-gallery`, 'E opens the Stickers gallery', 'press E', async () => { await page.keyboard.press('e'); await sleep(1500); });
    await h.step(`${D}/an-stk-search`, 'Search “done” across every pack', 'type in the gallery search', async () => {
      await h.click('stickers-search').catch(() => {});
      await page.keyboard.type('done'); await sleep(1200);
    });
    await h.step(`${D}/an-stk-drop`, 'A Project status sticker on the post, at 160 px', 'click a result, then the canvas', async () => {
      const t = page.locator('[data-testid^="sticker-"]').first();
      if (await t.count()) await t.click();
      await sleep(600);
      await page.mouse.click(1000, 300); await sleep(3800);
    });
    await h.esc(3);
    await h.step(`${D}/an-vote`, 'Start a vote — three directions, three votes each', 'artboard menu › Start a vote…', async () => {
      await edit();
      // the artboard's right-click no longer lists it (V2-3.x menu): ⌘K "Start a vote…" is the door (annotations.start-vote)
      await page.keyboard.press('Meta+k'); await sleep(600); await page.keyboard.type('start a vote'); await sleep(900); await page.keyboard.press('Enter'); await sleep(1500);
    });
    await h.step(`${D}/an-stamps`, 'Votes cast with stamps', 'start the vote, cast on an artboard', async () => {
      const go = page.locator('[data-testid="vote-sheet-start"]').first();
      if (await go.count()) { await go.click(); await sleep(1500); }
    });
  }
  if (G === 'd') {
    await h.step(`${D}/an-figjam`, 'A FigJam board arrives as annotations', '⌘K › Import from Figma…', async () => {
      await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('figma'); await sleep(900); await page.keyboard.press('Enter'); await sleep(1500);
    });
  }
  if (G === 'e') {
    const R = await k.seed(REL, STK);
    await frame();
    await preview();
    const nth = async (i) => { const el = af().nth(i); const b = await el.boundingBox(); return b; };
    await h.step(`${D}/an-convert`, 'A sticky becomes a comment', 'select a sticky › Turn into a comment (hover)', async () => {
      const b = await nth(0); if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(900);
      const t = page.getByText('Turn into a comment').first(); if (await t.count()) await t.hover().catch(() => {});
    });
    await h.esc(2);
    await h.step(`${D}/an-ai-read`, 'These stickies, as the scope — Ask AI', 'select two stickies, Ask AI chip', async () => {
      const b1 = await nth(0), b2 = await nth(1);
      if (b1) await page.mouse.click(b1.x + b1.width / 2, b1.y + b1.height / 2); await sleep(500);
      if (b2) await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2, { modifiers: ['Shift'] }); await sleep(900);
      const t = page.locator('[data-testid="annot-ctx-ask-ai"]').first(); if (await t.count()) { await t.click().catch(() => {}); await sleep(1200); }
    });
    await h.esc(3);
    await edit();
    await k.seed(REL, [{ op: 'sticker', sticker: 'project-status/group-100', to: 'el:desktop/see-work' }, { op: 'resolve', ids: [R['@s1']] }]);
    await h.step(`${D}/an-ai-stickers`, 'AI marks what it resolved with a status sticker', 'annotate sticker --to the button + resolve', async () => {});
    await k.seed(REL, [
      { op: 'create', type: 'text', ref: '@n1', text: 'Review: the hero reads well', x: 1500, y: 1150, w: 260, h: 70 },
      { op: 'create', type: 'text', ref: '@n2', text: 'Services cards: tighten the gap', x: 1500, y: 1300, w: 260, h: 70 },
      { op: 'connect', from: '@n1', to: 'el:desktop/headline', label: 'ok' },
      { op: 'connect', from: '@n2', to: 'el:desktop/sub', label: '24 → 16' },
    ]);
    await h.step(`${D}/an-ai-write`, 'AI writes a review as notes with arrows', 'annotate: notes + connected arrows', async () => {});
    await h.step(`${D}/an-rebind`, 'AI rewrites the button the arrow points at (nearest: bound arrows)', 'no AI run — arrows bound to a button', async () => {});
    const sf = join(h.project, '.design/ui/Homepage.tsx');
    writeFileSync(sf, readFileSync(sf, 'utf8').replace(/<button data-cd-id="see-pricing"[\s\S]*?<\/button>/, '').replace(/<button data-cd-id="see-work"[\s\S]*?<\/button>/, ''));
    await sleep(6000);
    await h.step(`${D}/an-dangling`, 'The button it pointed at is gone', 'delete the button from the canvas source; select the arrow that pointed at it (the card says Point to…)', async () => {
      await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(1100); await page.keyboard.press('Escape'); await sleep(500);
      const n = await k.fr.locator('.dc-annot-el[data-type="arrow"]').count();
      for (let i = 0; i < n; i++) {
        const fe = await page.locator('[data-testid="canvas-frame"]').first().boundingBox();
        const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
        const pt = await f.evaluate((i) => {
          const el = document.querySelectorAll('.dc-annot-el[data-type="arrow"]')[i];
          const path = [...el.querySelectorAll('path')].find((q) => q.getTotalLength && q.getTotalLength() > 20 && getComputedStyle(q).fill === 'none');
          if (!path) return null;
          const m = path.getPointAtLength(path.getTotalLength() / 2); const c = path.getScreenCTM();
          return { x: c.a * m.x + c.c * m.y + c.e, y: c.b * m.x + c.d * m.y + c.f };
        }, i);
        if (!pt) continue;
        await page.mouse.click(fe.x + pt.x, fe.y + pt.y); await sleep(700);
        if (await k.fr.locator('[data-testid="annot-dangling-card"]').count()) break;
      }
    });
    {
      const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
      const rects = await f.evaluate(() => window.__maudeCanvasRects());
      const rf = join(h.project, '.design', '_rects2.json'); writeFileSync(rf, JSON.stringify(rects));
      const { spawnSync } = await import('node:child_process');
      // c8-ann: the board's plan - three toned columns, cards coloured by channel (the AI composes this from a prompt)
      const bf = join(h.project, '.design', '_plan-board.json');
      writeFileSync(bf, JSON.stringify({ layout: 'columns', groups: [
        { title: 'Nápady', tone: 'grey', cards: [{ text: 'Reel: 40 yd sprint ve zpomaleném záběru', color: '#cfc4ec' }, { text: 'Story: odpočet 7 dní do Combine', color: '#bcd2f0' }, { text: 'Plakát do škol v Brně a Blansku', color: '#f7c5c0' }, { text: 'Rozhovor s trenérem O-line', color: '#cfc4ec' }] },
        { title: 'Rozpracované', tone: 'yellow', cards: [{ text: 'Leták A6 — registrace s QR kódem', color: '#f7c5c0' }, { text: 'Web: stránka STAŇ SE GATOREM', color: '#bfe3c0' }, { text: 'Post 1:1 — datum tučně', color: '#bcd2f0' }] },
        { title: 'Hotovo', tone: 'green', cards: [{ text: 'Pozvánka pro partnery', color: '#bfe3c0' }, { text: 'Combine v číslech 2025', color: '#bcd2f0' }] },
      ] }));
      const r = spawnSync('node', [join(REPO, 'cli/bin/maude.mjs'), 'design', 'annotate', REL, '--board', bf, '--rects', rf, '--root', h.project], { encoding: 'utf8' });
      console.log('kanban', r.status, (r.stderr || '').slice(0, 300));
      await sleep(2500); await page.keyboard.press('Escape'); await sleep(300); await page.mouse.click(700, 120); await sleep(400); await k.fit();
      await h.step(`${D}/an-plan`, 'The plan sits next to the work', 'annotate --board kanban', async () => {});
    }
  }
  if (G === 'f') {
    await h.step(`${D}/an-print`, 'Print artboards — notes stay outside', 'sticky over a print artboard', async () => {
      const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
      const rects = await f.evaluate(() => window.__maudeCanvasRects());
      const ab = rects.artboards[0];
      await k.seed('ui/Print.tsx', [{ op: 'create', type: 'sticky', text: 'Check the bleed', x: ab.x + 60, y: ab.y + 60, w: 200, h: 130 }]);
      await page.keyboard.press('n'); await sleep(900); await k.fit(); await page.keyboard.press('Escape'); await sleep(600);
    });
    await h.step(`${D}/an-print-export`, 'Export leaves the layer out unless Include annotations', 'Export sheet', async () => {
      await page.keyboard.press('Meta+e'); await sleep(1500);
    });
    await h.esc(3);
    await h.open('ui-video', 3500);
    await h.step(`${D}/an-video`, 'A sticky on a video, pinned to 0:12', 'sticky over the video artboard (no footage in the fixture; no time pin)', async () => {
      const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
      const rects = await f.evaluate(() => window.__maudeCanvasRects());
      const ab = rects.artboards[0];
      await k.seed('ui/Video.tsx', [{ op: 'create', type: 'sticky', text: 'Cut here', x: ab.x + 80, y: ab.y + 80, w: 200, h: 130 }]);
      await page.mouse.click(150, 800); await sleep(300); await page.keyboard.press('n'); await sleep(900); await k.fit(); await page.keyboard.press('Escape'); await sleep(600);
    });
  }
}
