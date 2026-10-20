import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — play in place, loop a range, step frames (S7.8, ve-play):
 * a quick tap on Space with the video artboard selected plays it ON the canvas, with sound, and a second tap
 * pauses it; HOLDING Space (and dragging) is the Hand and plays nothing. With the timeline focused, I and O set a
 * loop range (the band shows on the ruler), ← steps one frame and the time then reads "0:00 + 1 frame", ⇧→ steps
 * a second, and the time and the length read m:ss.
 *
 * The artboard is inside the canvas iframe — DOM-unreachable when the origin split is on — so it is found by its
 * on-screen rectangle (`__maudeCanvasRects`) and CLICKED BY COORDINATES; the Space press goes to whatever has
 * focus (the canvas, after that click) through real WebDriver key actions. Nothing is written (a loop range is
 * playback state), so no fixture guard is needed. WRITTEN, NOT RUN in the S7.8 hand-back (the lead runs the
 * desktop lane; it needs an unlocked screen and the e2e lock).
 *
 * Fixture: `.design/ui/Video.tsx` — one `kind="video"` artboard (`clip`, 320 × 180) holding a `<VideoComp>`.
 */

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

const island = () => $('[data-testid="timeline-island"]');
const playpause = () => $('[data-testid="timeline-playpause"]');
const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

async function clickAt(x: number, y: number): Promise<void> {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
}

/** A real Space press: down, wait `ms`, up — to the focused element (the canvas iframe after a click on it). */
async function pressSpace(ms: number): Promise<void> {
  await browser.action('key').down(' ').pause(ms).up(' ').perform();
}

const pressed = async () => (await playpause().getAttribute('aria-pressed')) === 'true';

describe('video-play — play in place, loop a range, step frames', () => {
  before(() => {
    startReport('video-play');
  });

  it('select the video: the island comes out under it', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-video');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('clip')) as Box;
    expect(box).not.toBeNull();
    await clickAt(box.x + 12, box.y - 10);
    await island().waitForExist({ timeout: 15_000 });
    // the fixture's clip is one hand-authored scene (no media cut), so the island keeps the layer rows; a media
    // cut shows the four tracks (test/timeline-tracks-render.test.tsx)
    await capture('video-play-island');
  });

  it('a quick tap on Space plays it with sound; a second tap pauses it', async () => {
    expect(await pressed()).toBe(false);
    await pressSpace(60);
    await browser.waitUntil(pressed, {
      timeout: 5000,
      timeoutMsg: 'a tap on Space never played it',
    });
    await capture('video-play-playing');
    await pressSpace(60);
    await browser.waitUntil(async () => !(await pressed()), {
      timeout: 5000,
      timeoutMsg: 'the second tap never paused it',
    });
  });

  it('holding Space is the Hand, never play', async () => {
    await pressSpace(450);
    await browser.pause(400);
    expect(await pressed()).toBe(false);
  });

  it('I and O draw a loop range; ← steps a frame and the time shows it; ⇧→ steps a second', async () => {
    // the timeline has the keys now (a click on its header gives the shell the focus)
    await (await $('[data-testid="timeline-readout"]')).click();
    await key({ key: 'i', code: 'KeyI' });
    await key({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    await key({ key: 'o', code: 'KeyO' });
    await (await $('[data-testid="timeline-loop-band"]')).waitForExist({
      timeout: 5000,
      timeoutMsg: 'I and O never drew the loop range',
    });
    await key({ key: 'ArrowRight', code: 'ArrowRight' });
    const readout = await $('[data-testid="timeline-readout"] b');
    await browser.waitUntil(async () => /\+ \d+ frames?$/.test(await readout.getText()), {
      timeout: 5000,
      timeoutMsg: 'stepping a frame never showed the frame in the time',
    });
    await capture('video-play-loop-step');
  });
});
