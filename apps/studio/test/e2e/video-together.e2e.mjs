// S7.17 — two people, one video, no waiting (07 · ve-together) — browser E2E (node --test).
// A real studio server, the real canvas and shell in headless Chromium, two windows (two browser contexts) on the
// same video canvas: two peers in one collab room, the way two people on a Mac's studio are.
//
//   node --test apps/studio/test/e2e/video-together.e2e.mjs
//
//   T1 both select the video: each one's timeline shows the OTHER's playhead as a thin sky line
//   T2 B opens a caption word to fix it: A sees "… is fixing a caption" over that word, the word wears B's ring,
//      and A's Transcript will not open it
//   T3 B leaves the word (esc): A's ring and tag go, and the word opens for A again
//
// No hub: the relay strip both ways and for followers is test/timeline-awareness.test.ts (+ the hub's
// timeline-awareness-strip.test.mjs). Written for S7.17; the lead runs it at the wave gate (Chromium + a free port).

import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { sleep, startServer } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, '../../../desktop/e2e/fixtures/project/.design');
const FILE = 'ui/VideoTranscript.tsx';

function makeVideoProject() {
  const root = mkdtempSync(join(tmpdir(), 'maude-together-e2e-'));
  const d = join(root, '.design');
  mkdirSync(join(d, 'ui'), { recursive: true });
  mkdirSync(join(d, 'assets'), { recursive: true });
  writeFileSync(join(d, 'config.json'), JSON.stringify({ name: 'together-e2e' }));
  // the fixture video, with its captions already there (the lane and the Transcript need them)
  const src = readFileSync(join(FIX, 'ui/VideoTranscript.tsx'), 'utf8').replace(
    '    </TransitionSeries>\n',
    '    </TransitionSeries>\n    <Captions data-cd-id="captions" words="line" position="bottom" />\n'
  );
  writeFileSync(
    join(d, FILE),
    src.replace(
      'import { DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";',
      'import { Captions, DesignCanvas, DCSection, DCArtboard, VideoComp } from "@maude/canvas-lib";'
    )
  );
  copyFileSync(
    join(FIX, 'assets/aaaa1111.transcript.json'),
    join(d, 'assets/aaaa1111.transcript.json')
  );
  return root;
}

async function openWindow(browser, server) {
  const ctx = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mdcc-usage-tour-seen', '1');
      localStorage.setItem('mdcc-collab-tour-seen', '1');
    } catch {}
  });
  await page.goto(`http://localhost:${server.port}/?open=${FILE}`, {
    waitUntil: 'domcontentloaded',
  });
  let frame = null;
  for (let i = 0; i < 200 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell')) ?? null;
    if (!frame) await page.waitForTimeout(100);
  }
  assert.ok(frame, 'the canvas frame never appeared');
  // the artboard is mounted
  for (let i = 0; i < 60; i++) {
    frame = page.frames().find((f) => f.url().includes('_canvas-shell')) ?? frame;
    const ok = await frame
      .evaluate(() => !!document.querySelector('[data-dc-screen="reel"]'))
      .catch(() => false);
    if (ok) break;
    await page.waitForTimeout(500);
  }
  return { ctx, page, frame };
}

/** Select the video artboard by its name tag (the canvas iframe is DOM-unreachable from the shell: coordinates). */
async function selectVideo(w) {
  const frameBox = await w.page.locator('[data-testid="canvas-frame"]').boundingBox();
  const r = await w.frame.evaluate(() => {
    const el = document.querySelector('[data-dc-screen="reel"]');
    const b = el?.getBoundingClientRect();
    return b ? { x: b.left, y: b.top } : null;
  });
  assert.ok(r, 'the video artboard is not on screen');
  await w.page.mouse.click(frameBox.x + r.x + 12, frameBox.y + r.y - 10);
  await w.page.locator('[data-testid="timeline-island"]').waitFor({ timeout: 15_000 });
  await w.page.locator('[data-testid="timeline-captions-lane"]').waitFor({ timeout: 15_000 });
}

describe('video-together — a teammate’s playhead and caption word', () => {
  let server;
  let browser;
  let A;
  let B;
  before(async () => {
    server = await startServer(makeVideoProject());
    browser = await chromium.launch({ headless: process.env.E2E_HEADED !== '1' });
    A = await openWindow(browser, server);
    B = await openWindow(browser, server);
  });
  after(async () => {
    await browser?.close().catch(() => {});
    server?.stop();
  });

  test('T1 each one’s timeline draws the other’s playhead', async () => {
    await selectVideo(A);
    await selectVideo(B);
    await A.page
      .locator('[data-testid^="timeline-peer-head-"]')
      .first()
      .waitFor({ timeout: 10_000 });
    await B.page
      .locator('[data-testid^="timeline-peer-head-"]')
      .first()
      .waitFor({ timeout: 10_000 });
  });

  test('T2 B fixes a word: A sees whose it is, and cannot open it', async () => {
    // B: the Transcript (double-click a caption word), then open "Ehm…" to fix it
    await B.page.locator('[data-testid="timeline-caption-w0"]').dblclick();
    await B.page.locator('[data-testid="transcript-word-w1"]').dblclick();
    await B.page.locator('[data-testid="transcript-edit"]').waitFor({ timeout: 5_000 });

    const tag = A.page.locator('[data-testid^="timeline-peer-tag-"]').first();
    await tag.waitFor({ timeout: 10_000 });
    assert.match((await tag.textContent()) ?? '', / is fixing a caption$/);
    const held = A.page.locator('[data-testid="timeline-caption-w1"]');
    await A.page.waitForFunction(
      () =>
        document.querySelector('[data-testid="timeline-caption-w1"]')?.getAttribute('data-held') ===
        'true',
      null,
      { timeout: 10_000 }
    );
    assert.match((await held.getAttribute('title')) ?? '', /is fixing a caption/);
    // A's Transcript: her word does not open
    await A.page.locator('[data-testid="timeline-caption-w0"]').dblclick();
    await A.page.locator('[data-testid="transcript-word-w1"]').dblclick();
    await sleep(300);
    assert.equal(await A.page.locator('[data-testid="transcript-edit"]').count(), 0);
  });

  test('T3 B leaves the word: it is free again', async () => {
    await B.page.locator('[data-testid="transcript-edit"]').press('Escape');
    await A.page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="timeline-caption-w1"]')?.hasAttribute('data-held'),
      null,
      { timeout: 10_000 }
    );
    assert.equal(await A.page.locator('[data-testid^="timeline-peer-tag-"]').count(), 0);
    await A.page.locator('[data-testid="transcript-word-w1"]').dblclick();
    await A.page.locator('[data-testid="transcript-edit"]').waitFor({ timeout: 5_000 });
  });
});
