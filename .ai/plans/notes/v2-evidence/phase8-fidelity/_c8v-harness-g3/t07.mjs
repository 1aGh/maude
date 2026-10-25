import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '07';
export async function run(h) {
  const { page, sleep } = h;
  const TR = 'ui-alligators-recruiting-trailer';
  // stage D: the camera moves when a timeline opens/closes, so a fixed point can miss the artboard — click inside its real box
  const sel = async () => {
    const island = page.locator('[data-testid="timeline-island"]').first();
    for (let a = 0; a < 3; a++) {
      const box = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (box) await h.board(box.x + 14, box.y + 14);
      else await h.board(720, 450);
      if (await island.count()) return;
      await page.keyboard.press('Meta+0');
      await sleep(900);
    }
  };
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const openC = async (slug, ms = 3000) => { await h.open(slug, ms); await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200); };

  // --- Trailer canvas: the real 24-beat cut (read-only to the edit engine)
  await openC(TR, 5000);
  await h.step(`${D}/ve-none`, 'Nothing selected — no timeline', 'open the Alligators Recruiting Trailer (24 beats), ⌘0, nothing selected', async () => { await closePanel(); await sleep(600); }, { note: 'one real video artboard (spec: three artboards on a social canvas)' });
  await h.step(`${D}/ve-select`, 'Select it — the timeline slides out of it', 'click the video artboard, then its crumb', sel);
  await h.step(`${D}/ve-long`, '24 clips — zoom out, fold tracks, jump by marker', 'Expand the timeline on the 24-beat cut', async () => {
    await tid('timeline-size').click().catch(() => {});
    await sleep(900);
  }, { reach: 'partial', note: '24 beats not 40; no fold-tracks / marker jump in the app' });
  await h.step(`${D}/ve-advanced`, 'Advanced — frames, curves, the cut as code', 'Expanded timeline, open Advanced', async () => {
    await tid('timeline-advanced-toggle').click().catch(() => {});
    await sleep(2200);
  });
  await tid('timeline-advanced-toggle').click().catch(() => {});
  await tid('timeline-size').click().catch(() => {});
  await h.esc(2); await sel();
  await h.step(`${D}/ve-fullscreen`, 'Full-screen preview', 'Present mode via the share cluster', async () => {
    await h.click('palette-mode-present');
    await sleep(5000);
    // the cut opens on black (a fade up from nothing): hold the stage on the poster moment so the shot shows the picture
    { const s = page.locator('[data-testid="video-present-scrub"]').first(); const b = await s.boundingBox().catch(() => null); if (b) await page.mouse.click(b.x + b.width * 0.37, b.y + b.height / 2); await sleep(800); await page.locator('[data-testid="video-present-toggle"]').first().click({ timeout: 3000 }).catch(() => {}); await sleep(2500); }
    // D2: shoot while the picture is up — a black stage is a tiny JPEG; if the stage is black, scrub back and play again
    for (let k = 0; k < 6; k++) {
      const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
      if (buf.length > 40000) break;
      const s2 = page.locator('[data-testid="video-present-scrub"]').first(); const b2 = await s2.boundingBox().catch(() => null);
      if (b2) await page.mouse.click(b2.x + b2.width * (0.30 + 0.05 * k), b2.y + b2.height / 2);
      await sleep(600);
      const tg = page.locator('[data-testid="video-present-toggle"]').first();
      if (/play/i.test((await tg.getAttribute('aria-label').catch(() => '')) || '')) await tg.click().catch(() => {});
      await sleep(2500);
    }
  });
  await h.esc(2);
  await sel();
  await h.step(`${D}/ve-deselect`, "Switch, deselect, keep it open — the timeline's rules", '⇧⌘T keeps the timeline open, then click away', async () => {
    await page.keyboard.press('Shift+Meta+t');
    await sleep(500);
    await page.mouse.click(30, 450);
    await sleep(900);
  }, { reach: 'partial', note: 'the state (Kept open) is reachable; the four-step diagram and the rules card are board explanation, not app UI' });
  await page.keyboard.press('Shift+Meta+t'); await sleep(300);

  // --- VideoEdit: a 3-beat editable cut (trim / split / transition / move / text / drop)
  await openC('ui-videoedit', 3000);
  await sel();
  await h.step(`${D}/ve-move-transition`, 'Drag a clip to move it', 'mouse down on beat 1, drag right, shot mid-drag', async () => {
    const b = await tid('timeline-seq-0').boundingBox({ timeout: 3000 }).catch(() => null);
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 5 });
      await page.mouse.move(b.x + b.width / 2 + 160, b.y + b.height / 2, { steps: 8 });
      await sleep(500);
    }
  });
  await page.mouse.up(); await sleep(400);
  await h.esc(2); await sel();
  await h.step(`${D}/ve-trim-split`, 'Trim an edge; S splits at the playhead', 'Full timeline, select beat 2, S splits, then hold a trim on the first half (the tip shows)', async () => {
    await tid('timeline-size').click().catch(() => {}); // round 7b: the board draws the Full timeline
    await sleep(900);
    await tid('timeline-seq-1').click().catch(() => {});
    await tid('timeline-readout').click().catch(() => {});
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await sleep(300);
    await page.keyboard.press('s');
    await sleep(900);
    // round 7b: the right edge of the first half, dragged left and held - the trim tip ("Name · 2.4 s / -0.6 s · video 0:14")
    const b = await tid('timeline-seq-1').boundingBox({ timeout: 3000 }).catch(() => null);
    if (b) {
      await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 20, b.y + b.height / 2, { steps: 6 });
      await page.mouse.move(b.x + b.width - 44, b.y + b.height / 2, { steps: 6 });
      await sleep(500);
    }
  });
  await page.mouse.up().catch(() => {}); await sleep(400);
  await tid('timeline-size').click().catch(() => {});
  await h.esc(2); await sel();
  await h.step(`${D}/ve-play`, 'Play in place, loop a range, step frames', 'timeline play, pause, step two frames, loop on', async () => {
    await tid('timeline-playpause').click().catch(() => {});
    await sleep(1500);
    await tid('timeline-playpause').click().catch(() => {}); // pause
    await sleep(300);
    await tid('timeline-loop').click().catch(() => {}); // round 7: the loop is on, as the board draws it
    await tid('timeline-readout').click().catch(() => {});
    for (let i = 0; i < 2; i++) { await page.keyboard.press('ArrowRight'); await sleep(120); } // round 7: "+ 2 frames" and the step tip
    // round 8: the board's main state — a loop range (I … O on the ruler) and the video PLAYING, the pause tip up
    await page.keyboard.press('i'); await sleep(150);
    for (let i = 0; i < 2; i++) { await page.keyboard.press('Shift+ArrowRight'); await sleep(120); }
    await page.keyboard.press('o'); await sleep(250);
    await tid('timeline-playpause').hover().catch(() => {});
    await tid('timeline-playpause').click().catch(() => {});
    await sleep(700);
  });
  await tid('timeline-playpause').click().catch(() => {}); // pause again
  await tid('timeline-loop').click().catch(() => {});
  // round 8: a signed-in workspace offers the cloud render: the estimate answers with the Render row's block
  await page.route('**/_api/export-estimate', async (route) => {
    const r = await route.fetch();
    const j = await r.json().catch(() => null);
    if (j && typeof j === 'object') j.render = { cloud: true, suggest: 'this-mac' };
    await route.fulfill({ response: r, json: j });
  });
  await h.step(`${D}/ve-export`, 'Export — every format at once', '⇧⌘E on the video artboard', async () => {
    await page.keyboard.press('Shift+Meta+e');
    await sleep(1400);
  });
  await page.unroute('**/_api/export-estimate').catch(() => {});
  await h.esc(2);
  const cx = page.locator('[data-testid="export-cancel"]').first();
  if (await cx.count()) await cx.click().catch(() => {});
  await h.esc(2);
  { const cx2 = page.locator('[data-testid="export-cancel"]').first(); if (await cx2.count()) await cx2.click().catch(() => {}); }
  await sel();
  await h.step(`${D}/ve-text`, 'A title with motion', 'timeline Add title (T)', async () => {
    await tid('timeline-add-title').click().catch(() => {});
    await sleep(1200);
  });
  await h.esc(2); await sel();
  await h.step(`${D}/ve-drop`, 'Drop footage — on the artboard or the timeline', 'synthetic dragenter/dragover with a file over the timeline', async () => {
    await h.esc(2); await page.keyboard.press('Meta+0'); await sleep(900); await h.board(640, 380); await sleep(800);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="timeline-storyline"]') || document.querySelector('[data-testid="timeline-row-0"] .tl-row-track') || document.querySelector('[data-testid="timeline-island"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'caaftv-mixzone-8s.mp4', { type: 'video/mp4' }));
      const r = el.getBoundingClientRect();
      for (const t of ['dragenter', 'dragover'])
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    });
    await sleep(700);
  }, { reach: 'partial', note: 'synthetic drag events; a real Finder drag was not driven' });
  await page.evaluate(() => { (document.querySelector('[data-testid="timeline-storyline"]') || document.querySelector('[data-testid="timeline-row-0"] .tl-row-track'))?.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); });

  // --- fixture canvases for the specific inspectors
  await openC('ui-videotranscript', 3000);
  await h.step(`${D}/ve-footage`, 'Footage not here yet; 4K clips still preparing', 'open VideoTranscript (its footage file is absent), select', async () => { await sel(); }, { reach: 'partial', note: 'only the Missing + Relink state; no "waiting for Jonas’s Mac" owner line, no preparing bars' });
  await h.step(`${D}/ve-captions`, 'Edit the talk as text; style the captions', 'Captions tab', async () => {
    await page.getByRole('tab', { name: /captions/i }).first().click().catch(() => {});
    await sleep(800);
  });
  await openC('ui-videomusic', 3000);
  await h.step(`${D}/ve-music`, 'A music bed: beats, lower under speech, volume', 'open VideoMusic, select, click the bed', async () => {
    await sel();
    await h.click('timeline-audio-0').catch(() => {});
    await sleep(800);
  });
  await openC('ui-videoformats', 3000);
  await h.step(`${D}/ve-formats`, 'Three formats, one edit', 'open VideoFormats, select', () => sel());
  await openC('ui-videoclipinspect', 3000);
  await sel();
  await h.step(`${D}/ve-transition`, 'Click a join for a transition', 'click join (seam) 0', async () => {
    await tid('timeline-seam-0').click({ timeout: 4000 }).catch(() => {});
    await sleep(900);
  });
  await h.esc(2);
  await h.step(`${D}/ve-reframe`, 'Re-frame a clip — fit, fill, follow', 'clip block', async () => {
    await sel(); // D2: the esc above deselected the video
    await h.click('timeline-seq-0').catch(() => {});
    await sleep(900);
    await h.click('insp-clip-reframe').catch(() => {}); // Re-frame… opens the window (reframe-island)
    await sleep(1500);
  }, { reach: 'partial', note: 'footage in the fixture is missing, so the window frames a hatch, not a picture' });

  // --- D2: ve-render — the Exports panel's job states; the job LIST is seeded by intercepting GET /_api/export-jobs (same as 09 ex-states)
  await h.esc(2);
  {
    const mk = (over) => ({ id: 'j', format: 'png', scope: 'canvas-as-separate', status: 'done', createdAt: new Date(Date.now() - 20 * 60000).toISOString(), finishedAt: new Date(Date.now() - 19 * 60000).toISOString(), filename: 'Hero.png', ...over });
    const items = Array.from({ length: 115 }, (_, i) => ({ id: `u${i}`, name: i === 114 ? 'Recap' : `Board ${i}`, status: i === 114 ? 'failed' : 'ok', ...(i === 114 ? { reason: 'the music has not synced yet' } : {}) }));
    const running = mk({ id: 'c', runsOn: 'cloud', format: 'mp4', status: 'running', filename: 'Hype trailer.mp4', finishedAt: undefined, createdAt: new Date(Date.now() - 60000).toISOString(), progress: { current: 16, total: 25 } });
    const queued = mk({ id: 'm', runsOn: 'this-mac', format: 'mp4', status: 'queued', filename: 'Reels.mp4', finishedAt: undefined, createdAt: new Date(Date.now() - 30000).toISOString() });
    const done = mk({ id: 'd', runsOn: 'this-mac', format: 'mp4', filename: 'Hype trailer.mp4' });
    const partial = mk({ id: 'social', runsOn: 'this-mac', format: 'mp4', filename: 'Combine-kampan.zip', retryable: true, items });
    await h.step(`${D}/ve-render`, 'Rendering, done, partly done — each says it in one line', 'seeded job list (running cloud, queued this-Mac, done, 114 of 115), ⌘K › Exports', async () => {
      await page.unroute('**/_api/export-jobs').catch(() => {});
      await page.route('**/_api/export-jobs', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { jobs: [running, queued, done, partial] } }) : route.continue()));
      await page.reload();
      await sleep(4500);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Meta+k');
      await sleep(500);
      await page.keyboard.type('exports');
      await sleep(800);
      await page.locator('[data-testid="palette-row-action:view.exports"]').first().click().catch(() => {});
      await sleep(1500);
    }, { reach: 'partial', note: 'job LIST seeded by a route intercept on GET /_api/export-jobs; no render runs' });
  }

  for (const [id, why] of [
    ['ve-ai-cut', 'AI cut: needs a signed-in Claude run on 12 clips; claude is stubbed signed-out'],
    ['ve-ai-watch', 'AI cut in progress: needs a live AI run'],
    ['ve-ai-scrub', 'AI cut in progress: needs a live AI run'],
    ['ve-ai-proposal', 'AI cut done: needs a finished AI run + chat recap'],
    ['ve-ai-adjust', 'swap a take after an AI cut: needs a finished AI cut'],
    ['ve-together', 'two-person collab on one video; needs a second peer on a linked hub'],
    ['ve-fit-fill', 'vertical-clip ask appears on dropping a vertical clip; no real file drag in the lane'],
  ]) h.skip(`${D}/${id}`, why);
}
