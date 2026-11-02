import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '08';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const openC = async (slug, ms = 2500, fit = true) => { await h.open(slug, ms); await closePanel(); await sleep(900); if (fit) { await page.keyboard.press('Meta+0'); await sleep(1200); } };
  const frame = () => page.frameLocator('[data-testid="canvas-frame"]');
  // click an artboard by its id (the label chip of the placed artboard), through the canvas frame
  // c7: the artboard is selected by its label chip (a click in the middle lands on the photo / text inside it)
  const pick = async (id) => {
    await closePanel();
    const el = frame().locator(`[data-dc-screen="${id}"]`).first();
    let b = await el.boundingBox().catch(() => null);
    if (!b) return false;
    // a label above the window (the camera sits low after the page grew) cannot be clicked: fit first
    if (b.y - 14 < 60 || b.x + 44 < 0) {
      await page.keyboard.press('Meta+0');
      await sleep(1300);
      b = await el.boundingBox().catch(() => null);
      if (!b) return false;
    }
    await page.mouse.click(b.x + 44, b.y - 14);
    await sleep(900);
    return true;
  };
  const regionOf = async (id, pad = 24) => {
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return undefined;
    const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad);
    return { x, y, width: Math.min(1440 - x, b.width + 2 * pad), height: Math.min(900 - y, b.height + 2 * pad) };
  };

  // F picker on a canvas
  await openC('ui-smoke', 1500, false);
  await h.step(`${D}/ak-picker`, 'F — pick what you’re making', 'click the canvas, press F: the size picker', async () => {
    await page.mouse.click(1000, 200); await sleep(400);
    await page.keyboard.press('f'); await sleep(900);
  });
  await h.step(`${D}/ak-picker-full`, 'All sizes, the four kinds, a custom print size', 'size picker › Print › All', async () => {
    await h.click('size-picker-all-print');
  });
  await h.step(`${D}/ak-picker-custom`, 'A custom print size, in millimetres (extra frame)', 'size picker › Print › All › Custom size…', async () => {
    await h.click('size-picker-tile-print-custom');
    await sleep(900);
  });
  await h.esc(3);

  // Matchday: web hug / widths / social / safe zones / video / mixed
  await openC('ui-matchday', 3500);
  await h.step(`${D}/ak-web-hug`, 'A web page grows with its content', 'select the web artboard (Nábor · web), add a section to its file: the page grows and the tag says by how much', async () => {
    await pick('nabor');
    // c7: the page grows to the right of the inspector's edge - pan the board left first so the "+ N px" tag and the
    // new section's frame are on the canvas, not under the inspector card
    await page.mouse.move(600, 520);
    await page.mouse.wheel(420, 0);
    await sleep(700);
    const f = join(h.project, '.design/ui/Matchday.tsx');
    const src = readFileSync(f, 'utf8');
    writeFileSync(f, src.replace('["Tréninky", "Tým", "Kontakt", "Často kladené otázky"]', '["Tréninky", "Rozpis zápasů", "Tým", "Kontakt", "Často kladené otázky"]'));
    await sleep(2600);
  });
  await h.esc(2);
  await h.step(`${D}/ak-social`, 'Matchday post and story', 'select the story artboard', async () => { await pick('story'); });
  await h.step(`${D}/ak-safe-zones`, 'Safe zones, close up', 'story selected, Safe zones → Instagram story', async () => {
    const sel = page.locator('select:has(option:text-matches("Instagram", "i"))').first();
    if (await sel.count()) { await sel.selectOption({ index: 1 }).catch(() => {}); }
    await sleep(900);
  }, { reach: 'partial', note: 'inspector safe-zone select driven by option index; the board shows a menu of platforms next to three overlays' });
  await h.esc(2);
  await h.step(`${D}/ak-print-letak`, 'A6 flyer — the inspector speaks mm', 'select the A6 print artboard', async () => { await pick('a-front'); });
  await h.step(`${D}/ak-warnings`, 'Warnings — one place, one verb', 'print artboard selected (label mark + inspector line)', async () => {}, { reach: 'partial', note: 'same selection as ak-print-letak; whether a warning line shows depends on the fixture QR box' });
  await h.step(`${D}/ak-advanced`, 'Advanced — exact values and the code', 'print artboard, inspector Advanced fold', async () => {
    await tid('fold-inspector-toggle').click({ timeout: 3000 }).catch(async () => { await page.getByText('Advanced', { exact: true }).last().click().catch(() => {}); }); // D2: the fold's own testid
    await sleep(2000);
    // c7: the fold is taller than the card (Exact size … In code). Scroll the card AND the fold body to their ends, so Guides, Look and
    // layout (Theme, Body layout, Grid tracks, Convert to absolute) and In code are in view as the board draws them
    await page.evaluate(() => { const o = document.querySelector('.st-rp-body'); if (o) o.scrollTop = o.scrollHeight; const f = document.querySelector('[data-testid="fold-inspector-body"]'); if (f) f.scrollTop = f.scrollHeight; }); // the fold's own body scrolls (max-height 40vh)
    await sleep(500);
  });
  await h.esc(2);
  await h.step(`${D}/ak-video`, 'A video artboard summons the timeline', 'select the video artboard', async () => { await pick('hype'); await sleep(1200); });
  await h.esc(2);
  await page.keyboard.press('Meta+0'); await sleep(800);
  await h.step(`${D}/ak-mixed-fit`, '⌘0 fits all — Layers filters by kind', '⌘0, Layers tab', async () => {
    await tid('panel-icon-left').click().catch(() => {});
    await sleep(500);
    await h.click('panel-tab-layers').catch(() => {});
    await h.click('layers-kind-chip-print').catch(() => {}); // c7: the Layers panel's own chip testid
    await sleep(700);
  }, { reach: 'partial', note: 'a 7-artboard mixed canvas, not 21' });
  await h.click('panel-tab-tree').catch(() => {});
  await h.step(`${D}/ak-mixed-filter`, 'Canvases filtered by kind', 'Canvases panel, kind chip: Print', async () => { await h.click('kind-chip-print'); }, { reach: 'partial', note: '13 canvases not 93' });
  await h.click('kind-chip-all').catch(() => {});
  await h.step(`${D}/ak-mixed-select`, 'Two kinds selected', '⌘A selects every artboard', async () => {
    // D2: two kinds, by shift-clicking two artboard labels (social story + print flyer), like the board
    await page.keyboard.press('Escape'); await sleep(300);
    const lb = async (id) => { const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox(); return [b.x + 50, b.y - 14]; };
    let [lx, ly] = await lb('story'); await page.mouse.click(lx, ly); await sleep(600);
    [lx, ly] = await lb('a-front'); await page.keyboard.down('Shift'); await page.mouse.click(lx, ly); await page.keyboard.up('Shift'); await sleep(1100);
  });
  await h.esc(2);
  await h.step(`${D}/ak-real-print`, 'A · přední (FLAG) — real print artboard', 'the real print artboard in the canvas, cropped', async () => { await pick('a-front'); }, { reach: 'partial', note: 'the fixture’s print artboard, not the Alligators flyer', clip: () => regionOf('a-front') });
  await h.step(`${D}/ak-real-web`, 'Nábor FLAG — real web artboard (hug)', 'the real web artboard in the canvas, cropped', async () => { await h.esc(2); }, { reach: 'partial', note: 'the fixture’s web artboard, not the Alligators page', clip: () => regionOf('nabor') });
  await h.step(`${D}/ak-print-view`, 'Print guides from View, next to the web page', 'palette: print guides', async () => {
    // D2: Menu › View › Advanced › Print guides (the project pill's menu), the way the board opens it
    await page.keyboard.press('Escape'); await sleep(300);
    await tid('project-pill').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-sub-view').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-sub-advanced').click({ timeout: 3000 }); await sleep(700);
    await tid('project-menu-row-view.print-guides').click({ timeout: 3000 }); await sleep(1200);
    await tid('project-pill').click({ timeout: 3000 }).catch(() => {}); await sleep(700);
    await tid('project-menu-row-sub-view').click({ timeout: 3000 }).catch(() => {}); await sleep(700);
    await tid('project-menu-row-sub-advanced').click({ timeout: 3000 }).catch(() => {}); await sleep(2200);
  }, { note: 'Menu › View › Advanced › Print guides, opened again after the toggle so the checked row shows' });
  // D2: the web artboard's Other widths › Add a width (last: it adds artboards to the canvas)
  await h.esc(3);
  await page.keyboard.press('Meta+0'); await sleep(900);
  await h.step(`${D}/ak-web-widths`, 'Duplicate at another width', 'web artboard selected › Other widths › Add a width › Desktop, Mobile', async () => {
    if (!(await tid('project-pill').isVisible().catch(() => false))) { await page.keyboard.press('Meta+\\'); await sleep(1000); }
    const nb = await frame().locator('[data-dc-screen="nabor"]').first().boundingBox();
    await page.mouse.click(nb.x + 60, nb.y - 14); await sleep(1200);
    await page.screenshot({ path: '.scr/d5-g3/out/widths-pre.png' });
    for (const w of ['1440', '390']) {
      await tid('insp-ab-add-width').click({ timeout: 3000 }); await sleep(500);
      await tid('insp-ab-add-width-' + w).click({ timeout: 3000 }).catch(async (e) => { await page.screenshot({ path: '.scr/d5-g3/out/widths-fail-' + w + '.png' }); throw e; }); await sleep(1400);
    }
    await page.keyboard.press('Meta+0'); await sleep(1200);
  }, { note: 'Desktop and Mobile added beside the 834 page; the menu itself is closed' });
  // D2: the convert goes LAST (it adds an A6 copy to the canvas, which moves every later crop)
  // stage D: the convert dialog is reached through the Size select's paper option (testid insp-ab-preset, value paper:a6)
  await h.esc(2);
  // D2: fit first (the post sits half off the left edge) so the click lands on the ARTBOARD, not the photo inside it
  await page.keyboard.press('Meta+0'); await sleep(1200);
  { const b = await frame().locator('[data-dc-screen="post"]').first().boundingBox().catch(() => null); if (b) { await page.mouse.click(b.x + 50, b.y - 14); await sleep(1200); } } // the label chip selects the artboard
  if (false) {
    const b =await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen="post"]').first().boundingBox().catch(() => null);
    if (b) {
      const x0 = Math.max(b.x, 0), x1 = Math.min(b.x + b.width, 1440);
      await page.mouse.click((x0 + x1) / 2, b.y + Math.min(b.height / 2, 120));
      await sleep(700);
      const c = page.locator('[data-testid="inspector-crumb-0"]').first();
      if (await c.count()) await c.click().catch(() => {});
      await sleep(1000);
    }
  }
  await h.step(`${D}/ak-convert`, 'Post 4:5 → A6 print', 'select the post, Size select › A6', async () => {
    await page.screenshot({ path: '.scr/d5-g3/out/conv-pre.png' });
    await page.locator('[data-testid="insp-ab-preset"]').first().selectOption('paper:a6', { timeout: 5000 });
    // round 4: the "Check after" list resolves in ~3 s (a headless render) — wait for it, a shot at 1.8 s caught "Checking…"
    for (let i = 0; i < 30; i++) { await sleep(1000); const t = await page.locator('[data-testid="convert-check"]').first().innerText().catch(() => ''); if (t && !/Checking/.test(t)) break; }
    await sleep(400);
  });
  await h.step(`${D}/ak-convert-after`, 'After — the post stays, the A6 copy sits beside it', 'dialog › Make A6 print', async () => {
    const go = page.getByRole('button', { name: /make a6 print/i }).first();
    await go.click({ timeout: 4000 });
    await sleep(9000);
  });
  await h.esc(2);
  h.skip(`${D}/ak-real-about`, 'a note card on the board, not an app state');
}
