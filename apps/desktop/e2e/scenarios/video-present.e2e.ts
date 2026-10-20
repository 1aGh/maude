import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — the full-screen video preview and the export sheet's video content (S7.19: ve-fullscreen, ve-export).
 *
 *   present   select the Reels video (it has a 16:9 beside it: Add a format first), Present from the selection: only the
 *             video's formats play (counter "1 / 2", never the whole canvas), the top-left switch names them, "esc Back to
 *             the canvas" leaves; the transport has the scrub with loop ticks, loop, sound and captions; switching format
 *             keeps the loop on
 *   export    ⇧⌘E on the canvas: the sheet says "Sound only makes one file — the formats share their sound.", captions are
 *             Off, and the formats of the cut are ticked
 *
 * The chrome is in the SHELL (plain DOM); the artboard is inside the canvas iframe, so it is found by its on-screen
 * rectangle and clicked by coordinates. Gestures WRITE to the fixture `VideoFormats.tsx` — snapshot + byte-exact restore.
 *
 * WRITTEN, NOT RUN in the S7.19 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoFormats.tsx');
const fixtures = createFixtureGuard('video-present', [FIXTURE]);
const onDisk = () => readFileSync(FIXTURE, 'utf8');

type Box = { x: number; y: number; w: number; h: number };
const tid = (id: string) => `[data-testid="${id}"]`;
const text = async (id: string) => (await (await $(tid(id))).getText()).trim();

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

async function clickAt(x: number, y: number): Promise<void> {
  await pointerClick(x, y);
}

const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

describe('video-present — a video presents its formats only; the export sheet speaks for them', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-present');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the Reels video and give it a 16:9 beside it (one write)', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videoformats');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    // the artboard's name strip selects the WHOLE artboard; its body would pick the video player inside it
    await clickAt(box.x + 12, box.y - 10);
    await $(tid('insp-format-add')).waitForExist({ timeout: 15_000 });
    await (await $(tid('insp-format-add'))).click();
    await (await $(tid('insp-format-add-1920x1080'))).click();
    await browser.waitUntil(async () => onDisk().includes('id="reel-16x9"'), { timeout: 15_000 });
  });

  it('Present from the selection plays only the video’s formats', async () => {
    await (await $(tid('mode-present-menu'))).click();
    await (await $(tid('mode-present-from-selection'))).click();
    await $(tid('video-present')).waitForDisplayed({
      timeout: 15_000,
      timeoutMsg: 'a selected video did not open the full-screen video preview',
    });
    // the switch names the two formats of the cut — not the canvas's other artboards
    await $(tid('video-present-formats')).waitForExist({ timeout: 10_000 });
    expect(await text('video-present-format-reel')).toBe('Reels 9:16');
    expect(await text('video-present-format-reel-16x9')).toBe('16:9');
    expect(await text('video-present-leave')).toContain('Back to the canvas');
    // the shell's own ‹ n / m › controls are not drawn over it
    expect(await $(tid('present-controls')).isExisting()).toBe(false);
    await capture('video-present-reels');
  });

  it('the transport has the scrub, loop, sound and captions; the loop comes along to the other format', async () => {
    await $(tid('video-present-bar')).waitForExist({ timeout: 15_000 });
    for (const id of [
      'video-present-toggle',
      'video-present-scrub',
      'video-present-time',
      'video-present-sound',
      'video-present-volume',
      'video-present-captions',
    ])
      expect(await $(tid(id)).isExisting()).toBe(true);
    const loop = await $(tid('video-present-loop'));
    if ((await loop.getAttribute('aria-pressed')) !== 'true') await loop.click();
    expect(await (await $(tid('video-present-loop'))).getAttribute('aria-pressed')).toBe('true');
    await (await $(tid('video-present-format-reel-16x9'))).click();
    await browser.waitUntil(
      async () =>
        (await (await $(tid('video-present-format-reel-16x9'))).getAttribute('aria-checked')) ===
        'true',
      { timeout: 10_000, timeoutMsg: 'the format switch did not move Present to the 16:9' }
    );
    // still Present, still looping
    expect(await $(tid('video-present')).isExisting()).toBe(true);
    expect(await (await $(tid('video-present-loop'))).getAttribute('aria-pressed')).toBe('true');
    await capture('video-present-wide');
    await (await $(tid('video-present-captions'))).click();
    expect(await (await $(tid('video-present-captions'))).getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('esc leaves: back to the canvas, nothing was written by presenting', async () => {
    const before = onDisk();
    await (await $(tid('video-present-leave'))).click();
    await browser.waitUntil(async () => !(await $(tid('video-present')).isExisting()), {
      timeout: 10_000,
      timeoutMsg: '"Back to the canvas" did not leave Present',
    });
    expect(onDisk()).toBe(before);
  });

  it('the export sheet: formats ticked, captions Off, "the formats share their sound"', async () => {
    await key({ key: 'e', code: 'KeyE', metaKey: true, shiftKey: true });
    await $(tid('export-sheet')).waitForExist({ timeout: 15_000 });
    await (await $(tid('export-format-mp4'))).click();
    await $(tid('export-video-formats')).waitForExist({ timeout: 15_000 });
    expect(await (await $(tid('export-captions-off'))).getAttribute('aria-checked')).toBe('true');
    expect(await text('export-sound-shared')).toBe(
      'Sound only makes one file — the formats share their sound.'
    );
    await capture('video-present-export');
    await key({ key: 'Escape', code: 'Escape' });
  });
});
