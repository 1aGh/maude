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
    await sleep(900);
  });
  await tid('timeline-advanced-toggle').click().catch(() => {});
  await tid('timeline-size').click().catch(() => {});
  await h.esc(2); await sel();
  await h.step(`${D}/ve-fullscreen`, 'Full-screen preview', 'Present mode via the share cluster', async () => {
    await h.click('palette-mode-present');
    await sleep(7000);
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
  await h.step(`${D}/ve-trim-split`, 'Trim an edge; S splits at the playhead', 'select beat 2, press S', async () => {
    await tid('timeline-seq-1').click().catch(() => {});
    await tid('timeline-readout').click().catch(() => {});
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await sleep(300);
    await page.keyboard.press('s');
    await sleep(900);
  });
  await h.esc(2); await sel();
  await h.step(`${D}/ve-play`, 'Play in place, loop a range, step frames', 'timeline play', async () => {
    await tid('timeline-playpause').click().catch(() => {});
    await sleep(1500);
  });
  await tid('timeline-playpause').click().catch(() => {});
  await h.step(`${D}/ve-export`, 'Export — every format at once', '⇧⌘E on the video artboard', async () => {
    await page.keyboard.press('Shift+Meta+e');
    await sleep(1400);
  });
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
      const el = document.querySelector('[data-testid="timeline-storyline"]') || document.querySelector('[data-testid="timeline-island"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'caaftv-mixzone-8s.mp4', { type: 'video/mp4' }));
      const r = el.getBoundingClientRect();
      for (const t of ['dragenter', 'dragover'])
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    });
    await sleep(700);
  }, { reach: 'partial', note: 'synthetic drag events; a real Finder drag was not driven' });
  await page.evaluate(() => { document.querySelector('[data-testid="timeline-storyline"]')?.dispatchEvent(new DragEvent('dragleave', { bubbles: true })); });

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
    await h.click('timeline-seq-0').catch(() => {});
    await sleep(900);
  }, { reach: 'partial', note: 'clip inspector with a Framing row; no re-frame window / follow-the-player preview' });

  for (const [id, why] of [
    ['ve-ai-cut', 'AI cut: needs a signed-in Claude run on 12 clips; claude is stubbed signed-out'],
    ['ve-ai-watch', 'AI cut in progress: needs a live AI run'],
    ['ve-ai-scrub', 'AI cut in progress: needs a live AI run'],
    ['ve-ai-proposal', 'AI cut done: needs a finished AI run + chat recap'],
    ['ve-ai-adjust', 'swap a take after an AI cut: needs a finished AI cut'],
    ['ve-render', 'render states need running/finished export jobs; none run in the browser lane'],
    ['ve-together', 'two-person collab on one video; needs a second peer on a linked hub'],
    ['ve-fit-fill', 'vertical-clip ask appears on dropping a vertical clip; no real file drag in the lane'],
  ]) h.skip(`${D}/${id}`, why);
}
