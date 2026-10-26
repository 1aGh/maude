import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { withNetProbe } from '../helpers/net-probe';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — captions from speech and edit by transcript (S7.11: ve-text, ve-captions; V2-1.10 §7).
 *
 *   captions   the island's Captions from speech tool adds the video's `<Captions>` (one write) and opens the
 *              Transcript panel in the left slot; the words are the sidecar's (no speech engine needed).
 *   cut        select "Ehm…" in the panel and press ⌫: the clip loses 0.4 s (the file changes), the word is struck,
 *              the captions follow with no write to them, and ⌘Z puts the bytes back exactly.
 *
 * The island, the panel and the inspector live in the SHELL (plain DOM); the artboard that raises the island is inside
 * the canvas iframe, so it is clicked by its on-screen rectangle (as video-play does).
 * Gestures WRITE to the fixture `VideoTranscript.tsx` — snapshot + byte-exact restore (helpers/fixture-guard.ts).
 * The words come from fixtures/project/.design/assets/aaaa1111.transcript.json (read-only).
 *
 * WRITTEN, NOT RUN in the S7.11 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoTranscript.tsx');
const fixtures = createFixtureGuard('video-edit-by-transcript', [FIXTURE]);
const onDisk = () => readFileSync(FIXTURE, 'utf8');

type Box = { x: number; y: number; w: number; h: number };

async function artboardBox(id: string): Promise<Box | null> {
  return browser.execute((artboard) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const win = frame?.contentWindow as Window | null | undefined;
    if (!frame || !win) return null;
    const f = frame.getBoundingClientRect();
    try {
      const el = win.document.querySelector(`[data-dc-screen="${artboard}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height } : null;
    } catch {
      return null;
    }
  }, id) as Promise<Box | null>;
}

const key = (target: string, init: Record<string, unknown>) =>
  browser.execute(
    (sel, k) => {
      const el = document.querySelector(sel) ?? window;
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
    },
    target,
    init
  );

describe('video-edit-by-transcript — captions from speech, cut by striking a word', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-edit-by-transcript');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the video: the island comes out under it', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videotranscript');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await pointerClick(box.x + 12, box.y - 10);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
    await dismissNotices(); // first-run notices stack over the island's bottom edge
  });

  it('Captions from speech: one write adds <Captions>, the Transcript opens with the three words', async () => {
    const before = onDisk();
    // the file's own header comment names <Captions>: count the element, not the word
    const captionTags = (src: string) => (src.match(/<Captions\s/g) ?? []).length;
    expect(captionTags(before)).toBe(0);
    await withNetProbe(async () => {
      await (await $('[data-testid="timeline-captions-tool"]')).click();
      await browser.waitUntil(async () => captionTags(onDisk()) === 1, {
        timeout: 20_000,
        timeoutMsg: 'the captions never reached the file',
      });
    });
    await $('[data-testid="transcript-panel"]').waitForExist({ timeout: 10_000 });
    await $('[data-testid="transcript-word-w1"]').waitForExist({ timeout: 10_000 });
    expect((await (await $('[data-testid="transcript-word-w1"]')).getText()).trim()).toBe('Ehm…');
    await $('[data-testid="timeline-captions-lane"]').waitForExist({ timeout: 10_000 });
    await capture('video-edit-by-transcript-captions');
  });

  it('select "Ehm…" and press ⌫: the clip is shorter, the word is struck, ⌘Z restores the file', async () => {
    const before = onDisk();
    // a word is picked on mousedown (a drag across words is a range); WebDriver's element click sends no mousedown
    // in the embedded driver, so press it as a pointer does
    const w1 = await $('[data-testid="transcript-word-w1"]');
    const at = await w1.getLocation();
    const size = await w1.getSize();
    await pointerClick(at.x + size.width / 2, at.y + size.height / 2);
    await browser.waitUntil(async () => (await w1.getAttribute('data-selected')) === 'true', {
      timeout: 5000,
      timeoutMsg: 'a press on "Ehm…" did not select it',
    });
    await key('[data-testid="transcript-panel"]', { key: 'Backspace' });
    await browser.waitUntil(async () => onDisk() !== before, {
      timeout: 15_000,
      timeoutMsg: 'the cut never reached the file',
    });
    await browser.waitUntil(
      async () =>
        (await (await $('[data-testid="transcript-word-w1"]')).getAttribute('data-state')) ===
        'struck',
      { timeout: 10_000, timeoutMsg: 'the cut word was not struck in the transcript' }
    );
    expect((await (await $('[data-testid="transcript-tip"]')).getText()).trim()).toContain(
      'cut 0.4 s'
    );
    await capture('video-edit-by-transcript-cut');
    await key('body', { key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
  });
});
