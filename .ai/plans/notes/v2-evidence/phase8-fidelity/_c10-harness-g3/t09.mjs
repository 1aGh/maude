import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '09';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const openC = async (slug, ms = 2500) => { await h.open(slug, ms); await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200); };
  const frame = () => page.frameLocator('[data-testid="canvas-frame"]');
  const pick = async (id) => {
    await closePanel();
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return false;
    // p8-bugs3: a click on the page now lands on the top OBJECT under the page root (decision
    // v2-c3-page-root-is-the-artboard) — the board's "select the post" is the artboard, picked by its label chip
    await page.mouse.click(b.x + 40, b.y - 12);
    await sleep(1500);
    return true;
  };
  // D2: the sheet AND any menu / list that opens from it (the formats list hangs off the sheet's edge)
  const sheetMenuRegion = async () => {
    const b = await tid('export-sheet').boundingBox().catch(() => null);
    if (!b) return undefined;
    let x0 = b.x, y0 = b.y, x1 = b.x + b.width, y1 = b.y + b.height;
    const extra = await page.evaluate(() => [...document.querySelectorAll('[role="menu"],[role="listbox"],[role="combobox"] + *')].map((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40 ? [r.x, r.y, r.right, r.bottom] : null; }).filter(Boolean));
    for (const [a, b2, c, d] of extra) { x0 = Math.min(x0, a); y0 = Math.min(y0, b2); x1 = Math.max(x1, c); y1 = Math.max(y1, d); }
    const x = Math.max(0, x0 - 20), y = Math.max(0, y0 - 20);
    return { x, y, width: Math.min(1440 - x, x1 - x0 + 40), height: Math.min(900 - y, y1 - y0 + 40) };
  };
  const sheetRegion = async () => {
    const b = await tid('export-sheet').boundingBox().catch(() => null);
    if (!b) return undefined;
    const x = Math.max(0, b.x - 20), y = Math.max(0, b.y - 20);
    return { x, y, width: Math.min(1440 - x, b.width + 40), height: Math.min(900 - y, b.height + 40) };
  };
  const keys = async (k) => { await page.keyboard.press(k); await sleep(1100); };
  const close = async () => {
    await h.esc(2);
    const c = tid('export-cancel');
    if (await c.count()) await c.click().catch(() => {});
    const c2 = page.getByRole('button', { name: /^cancel$/i }).last();
    if (await c2.count()) await c2.click({ timeout: 1500 }).catch(() => {});
    await sleep(500);
  };

  // --- social post
  await openC('ui-matchday', 3500);
  await pick('post');
  await h.step(`${D}/ex-inspector`, 'No sheet at all — the inspector with an artboard selected', 'select the post, inspector open', async () => {});
  await h.step(`${D}/ex-social`, 'A social post → PNG or JPG', 'select the post, ⇧⌘E', async () => { await keys('Shift+Meta+e'); });
  await h.step(`${D}/ex-formats`, 'Other… — every format, one list away', 'click Other…', async () => { await h.click('export-other'); }, { clip: sheetMenuRegion });
  await close(); await close();
  await h.step(`${D}/ex-advanced`, 'Export › Advanced, per kind', 'open the sheet, open the Advanced fold', async () => {
    await keys('Shift+Meta+e');
    await h.click('export-advanced-toggle');
  }, { clip: sheetRegion });
  await h.click('export-advanced-toggle').catch(() => {});
  await close(); await close();
  // --- web
  await pick('nabor');
  await h.step(`${D}/ex-web`, 'A web artboard → full page, or PDF', 'select the web artboard, ⇧⌘E', async () => { await keys('Shift+Meta+e'); });
  await close(); await close();
  // --- print
  await pick('a-front');
  await h.step(`${D}/ex-print`, 'A print artboard → Print PDF, on paper', 'select the A6 print artboard, ⇧⌘E', async () => { await keys('Shift+Meta+e'); });
  await h.step(`${D}/ex-print-warn`, 'Past the safe margin; a font that won’t embed', 'same sheet — the preflight warnings', async () => {}, { reach: 'partial', note: 'same sheet as ex-print; what the preflight says depends on the fixture (a 1 px bleed overflow, no font warning)' });
  await close(); await close();
  // --- video
  await pick('hype');
  await h.step(`${D}/ex-video`, 'A video artboard → MP4, GIF or sound, with a filmstrip', 'select the video artboard, ⇧⌘E', async () => { await keys('Shift+Meta+e'); });
  await h.step(`${D}/ex-offline`, 'Offline — this Mac renders, the cloud waits', 'browser context offline, same sheet', async () => {
    await page.context().setOffline(true);
    await sleep(1500);
  }, { reach: 'partial', note: 'browser-level offline only; the app’s own offline detection may not trip' });
  await page.context().setOffline(false);
  await close(); await close();
  // --- canvas / batch scope
  // c7b: nothing selected = Escape out of whatever the last pick left (a click on the canvas lands on an object),
  // and the sheet is shown on "This canvas" — the board's ex-canvas
  await h.esc(3); await sleep(500);
  await h.step(`${D}/ex-canvas`, '⇧⌘E with nothing selected → this canvas', 'Escape, ⇧⌘E, This canvas', async () => {
    await keys('Shift+Meta+e');
    if ((await tid('export-scope-canvas').getAttribute('aria-checked').catch(() => null)) !== 'true') await h.click('export-scope-canvas').catch(() => {});
    await sleep(700);
  });
  await h.step(`${D}/ex-huge`, 'Whole project, chosen in Scope', 'sheet open, Whole project scope', async () => { await h.click('export-scope-project'); }, { reach: 'partial', note: '13 canvases, not 93 / 524 artboards' });
  await close(); await close();
  await h.esc(3); await sleep(300);
  // c7b: two fixed-size artboards and a print one, picked by their label chips (⌘A selected the sections' frames)
  const chip = async (id, shift) => {
    const b = await frame().locator(`[data-dc-screen="${id}"]`).first().boundingBox().catch(() => null);
    if (!b) return;
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(b.x + 40, b.y - 12);
    if (shift) await page.keyboard.up('Shift');
    await sleep(500);
  };
  await closePanel();
  await chip('post'); await chip('story', true); await chip('a-front', true);
  await h.step(`${D}/ex-batch-pick`, 'Five artboards, two kinds', 'select post, story, A front by their chips, ⇧⌘E', async () => { await keys('Shift+Meta+e'); }, { reach: 'partial', note: 'three artboards of two kinds (the board has five)' });
  // c7b: the cloud door on offer, as on the board (videos in the cloud)
  await page.route('**/_api/export-estimate', async (route) => {
    const r = await route.fetch();
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') { j.lane = 'cloud'; }
    await route.fulfill({ response: r, json: j });
  });
  await h.step(`${D}/ex-batch`, 'Export a folder — grouped by kind', 'Folder scope, the cloud door on offer', async () => { await h.click('export-scope-folder').catch(() => {}); await sleep(900); }, { reach: 'partial', note: 'folder scope; the cloud lane is answered by the harness' });
  await page.unroute('**/_api/export-estimate').catch(() => {});
  await close(); await close();
  // --- handoff
  await h.step(`${D}/ex-handoff`, '⇧⌘H — pick where the code goes', '⇧⌘H', async () => {
    await keys('Shift+Meta+h');
    if (!(await page.getByText(/to production/i).count())) {
      // stage D: the scripted chord missed focus after the batch steps — open it from ⌘K instead
      await h.esc(2);
      await page.keyboard.press('Meta+k');
      await sleep(500);
      await page.keyboard.type('hand off');
      await sleep(800);
      await page.locator('[data-testid="palette-row-action:handoff.open"]').first().click({ timeout: 3000 }).catch(() => {});
      await sleep(1500);
    }
    // p8-bugs3: the cards arrive after the targets request — shoot once they are drawn, never the empty body
    await page.locator('.ho-targets').first().waitFor({ timeout: 15000 }).catch(() => console.log('NO handoff targets'));
    await sleep(600);
  });
  await h.step(`${D}/ex-handoff-edges`, 'Handoff without AI, offline, or with review blockers', 'click Hand off with claude signed out', async () => {
    const go = page.getByRole('button', { name: /hand off/i }).last();
    await go.click({ timeout: 2500 }).catch(() => {});
    await sleep(3500);
  }, { reach: 'partial', note: 'the signed-out path; offline and blockers not driven' });
  await close(); await close();
  // --- share vs export
  await h.step(`${D}/ex-share-vs`, 'Share link vs Export', 'the Share button', async () => {
    await page.getByRole('button', { name: /^share$/i }).first().click({ timeout: 3000 }).catch(() => {});
    await sleep(1200);
  }, { reach: 'partial', note: 'the Share panel only; the Export-points-at-Share hint needs a project with people in it' });
  await h.esc(2);
  // --- stage D: ex-progress / ex-states — the job LIST is seeded by intercepting GET /_api/export-jobs
  // (a hand-made job list in the shapes test/exports-panel.test.tsx uses); the panel, rows, ring are the real client.
  const mk = (over) => ({ id: 'j', format: 'png', scope: 'canvas-as-separate', status: 'done', createdAt: new Date(Date.now() - 20 * 60000).toISOString(), finishedAt: new Date(Date.now() - 19 * 60000).toISOString(), filename: 'Hero.png', ...over });
  const items = Array.from({ length: 115 }, (_, i) => ({ id: `u${i}`, name: i === 114 ? 'Recap' : `Board ${i}`, status: i === 114 ? 'failed' : 'ok', ...(i === 114 ? { reason: 'the music has not synced yet' } : {}) }));
  const cv = 'ui/Matchday.tsx';
  // c7b: every job carries the spec it was made from, so the rows are NAMED (canvas · what it makes) and get a picture
  const running = mk({ id: 'c', runsOn: 'cloud', format: 'mp4', status: 'running', filename: 'Hype trailer.mp4', finishedAt: undefined, createdAt: new Date(Date.now() - 60000).toISOString(), progress: { current: 16, total: 25 }, spec: { v: 2, scope: 'selection', canvas: cv, format: 'mp4', selection: { artboards: ['hype', 'hype2'] }, options: { size: { scale: 2 } } } });
  const social = mk({ id: 's', runsOn: 'cloud', format: 'png', status: 'running', filename: 'social.zip', finishedAt: undefined, createdAt: new Date(Date.now() - 90000).toISOString(), items: items.map((it, i) => ({ ...it, status: i < 100 ? 'ok' : i < 109 ? 'running' : 'queued' })), progress: { current: 4, total: 5 }, spec: { v: 2, scope: 'folder', folder: 'ui/social', format: 'png' } });
  const queued = mk({ id: 'm', runsOn: 'this-mac', format: 'pptx', status: 'running', filename: 'Matchday.pptx', finishedAt: undefined, createdAt: new Date(Date.now() - 30000).toISOString(), progress: { current: 5, total: 12 }, spec: { v: 2, scope: 'canvas', canvas: cv, format: 'pptx' } });
  const done = mk({ id: 'd', runsOn: 'this-mac', format: 'pdf', filename: 'LetakA6 — FLAG.pdf', spec: { v: 2, scope: 'canvas', canvas: cv, format: 'pdf' } });
  const partial = mk({ id: 'social2', runsOn: 'this-mac', format: 'mp4', filename: 'Combine-kampan.zip', retryable: true, items, spec: { v: 2, scope: 'folder', folder: 'ui/social', format: 'png' } });
  const seed = async (list) => {
    await page.unroute('**/_api/export-jobs').catch(() => {});
    await page.route('**/_api/export-jobs', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { jobs: list } }) : route.continue()));
    await page.reload();
    await sleep(3500);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('exports');
    await sleep(800);
    await page.locator('[data-testid="palette-row-action:view.exports"]').first().click().catch(() => {});
    await sleep(1500);
  };
  await h.step(`${D}/ex-progress`, 'A render in progress — ring on the Exports icon, the panel row', 'seeded job list (running cloud + queued this-Mac), ⌘K › Exports', () => seed([running, social, queued, done]), { reach: 'partial', note: 'job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs' });
  await h.esc(2);
  await h.step(`${D}/ex-states`, 'Cloud / this Mac / done / partly done states', 'seeded job list (running, queued, done, 114 of 115), ⌘K › Exports', () => seed([running, queued, done, partial]), { reach: 'partial', note: 'job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs' });
  await h.esc(2);
  // c7b: ex-history — the populated panel (day groups, the 114 of 115 row with Retry, a row without sound)
  const day = 86400000;
  const hist = [
    mk({ id: 'h1', runsOn: 'this-mac', format: 'png', filename: 'social.zip', retryable: true, items, createdAt: new Date(Date.now() - 5 * 60000).toISOString(), finishedAt: new Date(Date.now() - 4 * 60000).toISOString(), spec: { v: 2, scope: 'folder', folder: 'ui/social', format: 'png' } }),
    mk({ id: 'h2', runsOn: 'this-mac', format: 'mp4', filename: 'Nábor trailer.mp4', degraded: { reason: 'no sound', audioDropped: true }, createdAt: new Date(Date.now() - 20 * 60000).toISOString(), finishedAt: new Date(Date.now() - 19 * 60000).toISOString(), spec: { v: 2, scope: 'canvas', canvas: cv, format: 'mp4' } }),
    mk({ id: 'h3', runsOn: 'cloud', format: 'mp4', filename: 'Hype trailer.mp4', createdAt: new Date(Date.now() - 3600000).toISOString(), finishedAt: new Date(Date.now() - 3500000).toISOString(), spec: { v: 2, scope: 'canvas', canvas: cv, format: 'mp4' } }),
    mk({ id: 'h4', runsOn: 'this-mac', format: 'pdf', filename: 'LetakA6 — FLAG.pdf', createdAt: new Date(Date.now() - day - 3600000).toISOString(), finishedAt: new Date(Date.now() - day - 3500000).toISOString(), spec: { v: 2, scope: 'canvas', canvas: cv, format: 'pdf' } }),
    mk({ id: 'h5', runsOn: 'this-mac', format: 'png', filename: 'Matchday.png', createdAt: new Date(Date.now() - day - 7200000).toISOString(), finishedAt: new Date(Date.now() - day - 7100000).toISOString(), spec: { v: 2, scope: 'canvas', canvas: cv, format: 'png' } }),
    mk({ id: 'h6', runsOn: 'this-mac', format: 'pptx', filename: 'Matchday.pptx', createdAt: new Date(Date.now() - day - 9200000).toISOString(), finishedAt: new Date(Date.now() - day - 9100000).toISOString(), spec: { v: 2, scope: 'canvas', canvas: cv, format: 'pptx' } }),
  ];
  await h.step(`${D}/ex-history`, 'Exports panel — again, open folder, retry', 'seeded job list (the last six), ⌘K › Exports', () => seed(hist), { reach: 'partial', note: 'job LIST seeded by a route intercept; the row menu (Show in Finder, Export again with other settings…) is not drawn' });
  await h.esc(2);
  for (const [id, why] of [
    ['ex-handoff-ready', 'the Ready result with a copy command needs a finished AI handoff run (claude is stubbed signed-out)'],
    ['ex-edges', 'viewer-role export and "AI is changing this artboard" need a viewer session / a live AI edit'],
  ]) h.skip(`${D}/${id}`, why);
}
