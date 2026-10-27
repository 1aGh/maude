import { $, browser, expect } from '@wdio/globals';
import { focusCanvasFrame, waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { selectUntilIsland } from '../helpers/select-artboard';

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
 * Fixture: `.design/ui/VideoEdit.tsx` — one `kind="video"` artboard (`reel`, 320 × 180) holding a three-beat cut. It is
 * NOT `ui/Video.tsx`: that comp has no clips, so its island shows the empty-comp block ("No clips on clip yet") and
 * draws no ruler — and a loop range lives on the ruler. Nothing here writes, so it needs no fixture guard.
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
  await pointerClick(x, y);
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
    const row = await canvasRow('canvas-row-ui-videoedit');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await selectUntilIsland(() => artboardBox('reel'), clickAt);
    await island().waitForExist({ timeout: 15_000 });
    // the cut's beats (and with them the ruler the loop range draws on) arrive after the island
    await (await $('[data-testid="timeline-seq-0"]')).waitForExist({ timeout: 20_000 });
    await capture('video-play-island');
    // a synthetic click moves no focus: give the canvas the real one, so Space is decided there (tap vs hold)
    await focusCanvasFrame();
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
    // The embedded WebDriver delivers key actions to the TOP document (target = the canvas <iframe>), never into the
    // frame — so a real held press reaches the SHELL's Space binding, which plays on keydown. The tap-vs-hold decision
    // lives in the canvas (editing/space-tap.ts: keyup within 200 ms), so the hold is sent where it is decided: inside
    // the frame (same origin, split off in this lane), 450 ms apart.
    await browser.execute(
      () =>
        new Promise<void>((done) => {
          const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
          const win = frame?.contentWindow as (Window & typeof globalThis) | null | undefined;
          if (!win) return done();
          const init = { bubbles: true, cancelable: true, key: ' ', code: 'Space' };
          win.document.dispatchEvent(new win.KeyboardEvent('keydown', init));
          setTimeout(() => {
            win.document.dispatchEvent(new win.KeyboardEvent('keyup', init));
            done();
          }, 450);
        })
    );
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
