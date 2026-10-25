// Round 9 (p8-c9-video): 07 ids that need more than the e2e fixture holds - run AFTER t07 / t07c so these overwrite theirs.
//   ve-formats   HypeFormats (3 formats): the Formats list, link badges, "Shared by 3 formats"
//   ve-reframe   HypeFormats: Re-frame on a clip with a real picture - the format pills in the header
//   ve-export    HypeFormats: the Export sheet's three-format grid
//   ve-long      ZapasLong (40 clips): Full timeline, Text / Graphics folded, the ruler's markers
//   ve-advanced  NaborKeyframes: a keyframed title - diamonds on the clip, the Easing card's curve
import { vid } from './fxv.mjs';
export const fixture = vid;
export const page = { w: 1440, h: 900 };
const D = '07';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const island = page.locator('[data-testid="timeline-island"]').first();
  const sel = async () => {
    for (let a = 0; a < 3; a++) {
      const box = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (box) await h.board(box.x + 14, box.y + 14);
      else await h.board(720, 450);
      if (await island.count()) return;
      await page.keyboard.press('Meta+0');
      await sleep(900);
    }
  };
  const full = async () => {
    for (let a = 0; a < 2; a++) {
      if ((await tid('timeline-panel').getAttribute('data-size').catch(() => null)) === 'full') return;
      await tid('timeline-size').click().catch(() => {});
      await sleep(900);
    }
  };
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const openC = async (slug, ms = 3000) => { await h.open(slug, ms); await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200); };

  // --- three formats, one edit
  await openC('ui-hypeformats', 5000);
  await h.step(`${D}/ve-formats`, 'Three formats, one edit', 'open HypeFormats (Reels · 16:9 · 1:1 mount one comp), select the Reels video, fit again so all three show', async () => {
    await sel();
    await page.keyboard.press('Meta+0'); // fit again with the inspector open, so all three formats sit left of it
    await sleep(1200);
  });
  await h.step(`${D}/ve-reframe`, 'Re-frame a clip — a window per format', 'select Touchdown, Re-frame…', async () => {
    await h.click('timeline-seq-2').catch(() => {});
    await sleep(900);
    await h.click('insp-clip-reframe').catch(() => {});
    await sleep(2000);
  });
  await h.esc(2);
  await sel();
  await h.step(`${D}/ve-export`, 'Export — every format at once', '⇧⌘E on the selected video: the three formats are ticked', async () => {
    await page.route('**/_api/export-estimate', async (route) => {
      const r = await route.fetch();
      const j = await r.json().catch(() => null);
      if (j && typeof j === 'object') j.render = { cloud: true, suggest: 'this-mac' };
      await route.fulfill({ response: r, json: j });
    });
    await page.keyboard.press('Shift+Meta+e');
    await sleep(1600);
  });
  await page.unroute('**/_api/export-estimate').catch(() => {});
  await h.esc(2);
  { const cx = page.locator('[data-testid="export-cancel"]').first(); if (await cx.count()) await cx.click().catch(() => {}); }
  await h.esc(2);

  // --- a whole match
  await openC('ui-zapaslong', 6000);
  await h.step(`${D}/ve-long`, '40 clips — zoom out, fold tracks, jump by marker', 'select, Expand to the Full timeline, fold Text and Graphics', async () => {
    await sel();
    await full();
    // a pointer click on the track name is eaten by the lane's own press handling; the button's click is the product's fold
    await page.evaluate(() => { for (const id of ['text', 'gfx']) document.querySelector(`[data-testid="timeline-track-fold-${id}"]`)?.click(); });
    await sleep(900);
    await tid('timeline-zoom-fit').click().catch(() => {});
    await sleep(900);
  });
  await h.esc(2);

  // --- a title that animates
  await openC('ui-naborkeyframes', 5000);
  await h.step(`${D}/ve-advanced`, 'Advanced — frames, curves, the cut as code', 'select, Expand, open Advanced, pick the title\'s first keyframe', async () => {
    await sel();
    await full();
    await tid('timeline-advanced-toggle').click().catch(() => {});
    await sleep(2200);
    await page.locator('[data-testid^="timeline-kf-"]').first().click({ timeout: 4000 }).catch((e) => console.log('kf', e.message.split('\n')[0]));
    await sleep(1200);
  });
}
