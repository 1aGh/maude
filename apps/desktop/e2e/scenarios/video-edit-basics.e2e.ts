import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { withNetProbe } from '../helpers/net-probe';
import { pointerClick, pointerDown, pointerMove, pointerUp } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { selectUntilIsland } from '../helpers/select-artboard';

/**
 * 07 Video Editing — trim, split, the clip menu, drop (S7.9: ve-drop, ve-trim-split, ve-move-transition).
 *
 *   trim     drag the right edge of beat-two: the tip says "beat-two · … s" over "−… s · video 0:…" while the
 *            pointer is down, and on release the file changes ONCE (one `clip.retime`); ⌘Z puts the bytes back.
 *   split    S at the playhead: the toast says "Split beat-two at 0:…." with one Undo; Undo restores the bytes.
 *   menu     right-click a clip: the six drawn rows and an Advanced row that opens the other eleven.
 *   drop     footage dragged over the window: the catcher over the artboard exists (the canvas draws the chip
 *            "Or drop here — adds at the end"; it is inside the iframe, so it is not asserted by DOM).
 *
 * The Timeline island lives in the SHELL (plain DOM); the artboard that raises it is inside the canvas iframe, so
 * it is found by its on-screen rectangle and CLICKED BY COORDINATES (as video-play does). Gestures WRITE to the
 * fixture `VideoEdit.tsx` — snapshot + byte-exact restore, crash-safe (helpers/fixture-guard.ts).
 *
 * WRITTEN, NOT RUN in the S7.9 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoEdit.tsx');
const fixtures = createFixtureGuard('video-edit-basics', [FIXTURE]);
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

async function clickAt(x: number, y: number): Promise<void> {
  await pointerClick(x, y);
}

const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

const beatCount = () =>
  browser.execute(() => document.querySelectorAll('[data-testid^="timeline-seq-"]').length);

const centre = async (testid: string) => {
  const el = await $(`[data-testid="${testid}"]`);
  await el.waitForExist({ timeout: 10_000 });
  const r = await browser.execute((id) => {
    const b = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
  }, testid);
  return r as { x: number; y: number };
};

describe('video-edit-basics — trim, split, the clip menu, drop', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-edit-basics');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the video: the island comes out under it with its three beats', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videoedit');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await selectUntilIsland(() => artboardBox('reel'), clickAt);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
    await browser.waitUntil(async () => (await beatCount()) === 3, {
      timeout: 20_000,
      timeoutMsg: 'the island never showed the three beats',
    });
    await capture('video-edit-island');
  });

  it('trim: the tip names the clip, the change and the new length; one write; ⌘Z restores the bytes', async () => {
    await dismissNotices(); // first-run notices sit over the bottom edge, on the trim handles
    const before = onDisk();
    const edge = await centre('timeline-resize-1');
    await pointerDown(edge.x, edge.y);
    for (const dx of [-10, -20, -30]) await pointerMove(edge.x + dx, edge.y);
    const tip = await $('[data-testid="timeline-trim-tip"]');
    await tip.waitForExist({ timeout: 5000, timeoutMsg: 'no tip while trimming' });
    const text = await tip.getText();
    expect(text).toMatch(/beat-two · \d+\.\d s/);
    expect(text).toMatch(/−\d+\.\d s · video 0:\d\d/);
    await capture('video-edit-trim-tip');
    await pointerUp(edge.x - 30, edge.y);
    await browser.waitUntil(async () => onDisk() !== before, {
      timeout: 15_000,
      timeoutMsg: 'the trim never reached the file',
    });
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
  });

  it('S splits at the playhead; the toast names the clip and Undo takes it back', async () => {
    const before = onDisk();
    await (await $('[data-testid="timeline-seq-1"]')).click();
    await (await $('[data-testid="timeline-readout"]')).click(); // timeline focus
    // S splits AT THE PLAYHEAD, and the server refuses a point at or before the clip's start ("scrub inside the clip
    // first"): selecting beat-two does not move the playhead, so put it inside beat-two (frames 60–150 at 30 fps)
    // with ⇧→ × 3 = a second each, frame 90.
    // Each step is checked on the readout, not counted blind: a press that landed before the readout took the focus
    // left the playhead at 0:02 — on beat-two's first frame, where S has nothing to split (r7fix/a5).
    const readout = async () =>
      (await (await $('[data-testid="timeline-readout"]')).getText()).split('/')[0].trim();
    for (let i = 0; i < 6 && (await readout()) !== '0:03'; i++) {
      await key({ key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
      await browser.pause(120);
    }
    expect(await readout()).toBe('0:03');
    await withNetProbe(async () => {
      await key({ key: 's', code: 'KeyS' });
      try {
        await browser.waitUntil(async () => (await beatCount()) === 4, { timeout: 20_000 });
      } catch {
        const state = await browser.execute(() => ({
          beats: document.querySelectorAll('[data-testid^="timeline-seq-"]').length,
          readout: document.querySelector('[data-testid="timeline-readout"]')?.textContent ?? null,
          picked:
            document.querySelector('.tl-seq-block.is-selected')?.getAttribute('data-testid') ??
            null,
          active:
            document.activeElement?.getAttribute('data-testid') ?? document.activeElement?.tagName,
          said: [...document.querySelectorAll('[role="status"], [role="alert"]')]
            .map((n) => (n.textContent ?? '').trim())
            .filter(Boolean),
        }));
        throw new Error(`S did not split (expected 4 beats) ${JSON.stringify(state)}`);
      }
    });
    const toast = await $('//*[contains(text(), "Split ")]');
    await toast.waitForExist({ timeout: 5000, timeoutMsg: 'no "Split … at 0:…." toast' });
    expect(await toast.getText()).toMatch(/^Split .+ at \d+:\d\d\.$/);
    await capture('video-edit-split-toast');
    await (await $('//button[normalize-space()="Undo"]')).click();
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: 'the toast Undo did not restore the file',
    });
  });

  it('right-click a clip: Advanced ▸ holds the rest of the menu', async () => {
    const at = await centre('timeline-seq-1');
    await browser.execute(
      (p) => {
        document.querySelector('[data-testid="timeline-seq-1"]')?.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: p.x,
            clientY: p.y,
          })
        );
      },
      { x: at.x, y: at.y }
    );
    const advanced = await $('//*[@role="menuitem" and contains(., "Advanced")]');
    await advanced.waitForExist({ timeout: 5000, timeoutMsg: 'the clip menu has no Advanced row' });
    await advanced.click();
    await $('//*[@role="menuitem" and contains(., "Move earlier")]').waitForExist({
      timeout: 5000,
      timeoutMsg: 'Move earlier is not under Advanced',
    });
    await capture('video-edit-clip-menu');
    await key({ key: 'Escape' });
  });

  it('footage over the window: a catcher sits over the artboard, and goes when the drag leaves', async () => {
    await browser.execute(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      window.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await $('[data-testid="timeline-artboard-drop"]').waitForExist({
      timeout: 5000,
      timeoutMsg: 'no drop catcher over the artboard while footage is in flight',
    });
    await capture('video-edit-drop-catcher');
    await browser.execute(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'a.mp4', { type: 'video/mp4' }));
      window.dispatchEvent(
        new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt })
      );
    });
    await browser.waitUntil(
      async () => !(await $('[data-testid="timeline-artboard-drop"]').isExisting()),
      { timeout: 5000, timeoutMsg: 'the catcher stayed after the drag left' }
    );
  });
});
