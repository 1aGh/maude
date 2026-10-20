import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — the timeline that comes with a video artboard (S7.7, ve-none / ve-select / ve-deselect):
 * nothing selected → no timeline; select the video artboard → the island slides out under it with its notch on
 * the artboard's centre; Expand makes it edge to edge (no notch), Compact brings it back; ⇧⌘T keeps it open
 * ("Kept open") and ⇧⌘T again hides it; select anything else and it slides back.
 *
 * Replaces the dock scenario for the bottom Timeline: the island is the SHELL's, so it is plain wdio DOM on the top
 * frame, but the artboard it follows is inside the canvas iframe — DOM-unreachable when the origin split is on — so
 * the artboard is found by its on-screen rectangle (`__maudeCanvasRects`) and CLICKED BY COORDINATES.
 * Selection only: nothing is written, so no fixture guard is needed. WRITTEN, NOT RUN in the S7.7 hand-back (the lead
 * runs the desktop lane; it needs an unlocked screen and the e2e lock).
 *
 * Fixture: `.design/ui/Video.tsx` — one `kind="video"` artboard (`clip`, 320 × 180).
 */

type Box = { x: number; y: number; w: number; h: number };

/** The artboard's rectangle in WINDOW coordinates (frame offset + the canvas's own rect). */
async function artboardBox(id: string): Promise<Box | null> {
  return browser.execute((artboard) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    const win = frame?.contentWindow as
      | (Window & {
          __maudeCanvasRects?: () => { artboards?: Array<Record<string, number | string>> };
        })
      | null
      | undefined;
    if (!frame || !win) return null;
    const f = frame.getBoundingClientRect();
    try {
      const a = win.__maudeCanvasRects?.().artboards?.find((x) => x.id === artboard);
      if (!a) return null;
      // `x/y/w/h` are WORLD px; the on-screen rect is read from the artboard's own element
      const el = win.document.querySelector(`[data-dc-screen="${artboard}"]`);
      const r = el?.getBoundingClientRect();
      return r ? { x: f.left + r.left, y: f.top + r.top, w: r.width, h: r.height } : null;
    } catch {
      return null;
    }
  }, id) as Promise<Box | null>;
}

const island = () => $('[data-testid="timeline-island"]');
const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

/** A real pointer click at window coordinates (the canvas iframe is not reachable by selectors). */
async function clickAt(x: number, y: number): Promise<void> {
  await pointerClick(x, y);
}

describe('video-timeline-summon — the timeline comes with a video artboard', () => {
  before(() => {
    startReport('video-timeline-summon');
  });

  it('nothing selected: no timeline, and nothing hints that one is missing', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-video');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    expect(await island().isExisting()).toBe(false);
    await capture('timeline-none');
  });

  it('selecting the video artboard slides the island out under it, notch on its centre', async () => {
    const box = await artboardBox('clip');
    expect(box).not.toBeNull();
    // the artboard's label strip sits just above its body: a click there selects the whole artboard
    await clickAt((box as Box).x + 12, (box as Box).y - 10);
    await island().waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the timeline island never came out',
    });
    expect(await island().getAttribute('data-size')).toBe('compact');
    expect(await island().getAttribute('data-artboard')).toBe('clip');
    const notch = await $('[data-testid="timeline-notch"]');
    await notch.waitForExist();
    const n = await notch.getLocation();
    const s = await notch.getSize();
    const b = box as Box;
    // the notch points at the artboard's centre (within the artboard's width; the camera is wherever it is)
    expect(Math.abs(n.x + s.width / 2 - (b.x + b.w / 2))).toBeLessThan(Math.max(8, b.w / 2));
    // once it has settled it tells Fit how much room it takes (V2-4.1)
    await browser.waitUntil(
      async () => (await island().getAttribute('data-occludes')) === 'bottom',
      {
        timeout: 5000,
        timeoutMsg: 'the island never published its occluded inset',
      }
    );
    await capture('timeline-compact');
  });

  it('Expand makes it edge to edge with no notch; Compact brings it back', async () => {
    await (await $('[data-testid="timeline-size"]')).click();
    await browser.waitUntil(async () => (await island().getAttribute('data-size')) === 'full', {
      timeout: 5000,
    });
    expect(await (await $('[data-testid="timeline-notch"]')).isExisting()).toBe(false);
    await capture('timeline-full');
    await (await $('[data-testid="timeline-size"]')).click();
    await browser.waitUntil(async () => (await island().getAttribute('data-size')) === 'compact', {
      timeout: 5000,
    });
    expect(await (await $('[data-testid="timeline-notch"]')).isExisting()).toBe(true);
  });

  it('⇧⌘T keeps it open ("Kept open"); ⇧⌘T again hides it', async () => {
    await key({ key: 't', code: 'KeyT', metaKey: true, shiftKey: true });
    await (await $('[data-testid="timeline-kept"]')).waitForExist({
      timeout: 5000,
      timeoutMsg: '"Kept open" never showed',
    });
    expect(await (await $('[data-testid="timeline-kept"]')).getText()).toContain('Kept open');
    await key({ key: 't', code: 'KeyT', metaKey: true, shiftKey: true });
    await island().waitForExist({ reverse: true, timeout: 5000, timeoutMsg: 'it never hid' });
  });

  it('selecting anything that is not a video slides it back', async () => {
    const box = await artboardBox('clip');
    // the video is still selected from the cases above and the person hid its island with ⇧⌘T: a click on a thing
    // that is already selected is no new selection, so clear it first, then select the video afresh
    await clickAt((box as Box).x + (box as Box).w + 250, (box as Box).y - 150);
    await clickAt((box as Box).x + 12, (box as Box).y - 10);
    await island().waitForExist({ timeout: 15_000 });
    // empty canvas, away from the artboard (the left panel floats over the frame's own left edge): the selection clears
    await clickAt((box as Box).x + (box as Box).w + 250, (box as Box).y - 150);
    await island().waitForExist({ reverse: true, timeout: 5000, timeoutMsg: 'it never slid back' });
    await capture('timeline-away');
  });
});
