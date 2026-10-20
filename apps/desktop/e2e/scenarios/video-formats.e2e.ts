import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — one video, many formats, and framing each its own way (S7.13: ve-formats, ve-reframe).
 *
 *   formats   select the Reels video: the inspector lists "Reels 9:16 · this one"; + Add a format › 16:9 copies the artboard
 *             at 1920 × 1080 with the SAME comp (one write); the Timeline says "Shared by 2 formats"; ⌘Z takes it away
 *   unlinked  Make an unlinked copy forks the comp as `RecapUnlinked` for the selected artboard (one write);
 *             the canvas tags it "Unlinked copy — its own cut"; ⌘Z puts the bytes back
 *   reframe   click the clip, Re-frame… opens the island titled Frame “shot” for; dragging the window writes ONE `<Reframe
 *             formats={{"9:16":[[sec, x, y]]}}>` keyframe in source time; Reset takes the `<Reframe>` away; Done closes
 *
 * The Timeline island, the inspector and the Re-frame island live in the SHELL (plain DOM); the artboard is inside the
 * canvas iframe, so it is found by its on-screen rectangle and CLICKED BY COORDINATES (as video-play does). Gestures WRITE
 * to the fixture `VideoFormats.tsx` — snapshot + byte-exact restore (helpers/fixture-guard.ts).
 *
 * WRITTEN, NOT RUN in the S7.13 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoFormats.tsx');
const fixtures = createFixtureGuard('video-formats', [FIXTURE]);
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

/** Text of an element INSIDE the canvas iframe (the link glyphs and the unlinked tag are canvas chrome). */
async function canvasText(testid: string): Promise<string | null> {
  return browser.execute((id) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-testid="canvas-frame"]');
    try {
      const el = frame?.contentWindow?.document.querySelector(`[data-testid="${id}"]`);
      return el ? (el.textContent ?? '').trim() : null;
    } catch {
      return null;
    }
  }, testid) as Promise<string | null>;
}

async function clickAt(x: number, y: number): Promise<void> {
  await browser
    .action('pointer')
    .move({ x: Math.round(x), y: Math.round(y) })
    .down()
    .up()
    .perform();
}

const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

const text = async (testid: string) =>
  (await (await $(`[data-testid="${testid}"]`)).getText()).trim();

describe('video-formats — Add a format, Make an unlinked copy, Re-frame a clip per format', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-formats');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the video: the inspector lists its formats and the island comes out under it', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-video-formats');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await clickAt(box.x + box.w / 2, box.y + box.h / 2);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
    await $('[data-testid="insp-formats"]').waitForExist({
      timeout: 15_000,
      timeoutMsg: 'a video artboard pick did not list its formats',
    });
    expect(await text('insp-fmt-reel')).toContain('this one');
    await capture('video-formats-inspector');
  });

  it('+ Add a format › 16:9 is one write, the cut is shared, ⌘Z takes it away', async () => {
    const before = onDisk();
    await (await $('[data-testid="insp-format-add"]')).click();
    await (await $('[data-testid="insp-format-add-1920x1080"]')).click();
    await browser.waitUntil(async () => onDisk().includes('id="reel-16x9"'), {
      timeout: 15_000,
      timeoutMsg: 'Add a format never reached the file',
    });
    // the same comp: a linked copy, not a second cut
    expect(onDisk().match(/component=\{Recap\}/g)?.length).toBe(2);
    await $('[data-testid="timeline-shared"]').waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the Timeline did not say the cut is shared',
    });
    expect(await text('timeline-shared')).toBe('Shared by 2 formats');
    await browser.waitUntil(async () => (await canvasText('video-link-reel-reel-16x9')) !== null, {
      timeout: 10_000,
      timeoutMsg: 'no link glyph between the two formats',
    });
    await capture('video-formats-added');
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
  });

  it('Make an unlinked copy forks the comp for this artboard; the canvas tags it; ⌘Z undoes it', async () => {
    // an unlinked copy needs another format to be a copy of
    await (await $('[data-testid="insp-format-add"]')).click();
    await (await $('[data-testid="insp-format-add-1920x1080"]')).click();
    await browser.waitUntil(async () => onDisk().includes('id="reel-16x9"'), { timeout: 15_000 });
    const withTwo = onDisk();
    await $('[data-testid="insp-format-unlink"]').waitForExist({ timeout: 10_000 });
    await (await $('[data-testid="insp-format-unlink"]')).click();
    await browser.waitUntil(async () => onDisk().includes('RecapUnlinked'), {
      timeout: 15_000,
      timeoutMsg: 'Make an unlinked copy never reached the file',
    });
    await browser.waitUntil(async () => (await canvasText('video-unlinked-reel')) !== null, {
      timeout: 10_000,
      timeoutMsg: 'the canvas did not tag the unlinked copy',
    });
    expect(await canvasText('video-unlinked-reel')).toBe('Unlinked copy — its own cut');
    await capture('video-formats-unlinked');
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === withTwo, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => !onDisk().includes('id="reel-16x9"'), { timeout: 15_000 });
  });

  it('Re-frame: the island opens on the clip; dragging the window writes one keyframe; Reset takes it away', async () => {
    const before = onDisk();
    await (await $('[data-testid="timeline-seq-0"]')).click();
    await $('[data-testid="insp-clip-reframe"]').waitForExist({ timeout: 10_000 });
    await (await $('[data-testid="insp-clip-reframe"]')).click();
    await $('[data-testid="reframe-island"]').waitForExist({
      timeout: 10_000,
      timeoutMsg: 'Re-frame… did not open the island',
    });
    expect(await text('reframe-title')).toBe('Frame “shot” for');
    // B3: no subject following anywhere on it
    expect(await text('reframe-island')).not.toMatch(/follow|subject/i);
    expect(await text('reframe-note')).toBe(
      'Drag the window to frame it. Each format keeps its own.'
    );
    await capture('video-formats-reframe');
    const win = await $('[data-testid="reframe-window"]');
    const at = await win.getLocation();
    const size = await win.getSize();
    await browser
      .action('pointer')
      .move({ x: Math.round(at.x + size.width / 2), y: Math.round(at.y + size.height / 2) })
      .down()
      .move({ duration: 150, x: 30, y: 0, origin: 'pointer' })
      .up()
      .perform();
    await browser.waitUntil(async () => /<Reframe[^>]*formats=\{\{"9:16":\[\[/.test(onDisk()), {
      timeout: 15_000,
      timeoutMsg: 'the drag never wrote a keyframe for this format',
    });
    const framed = onDisk();
    expect(framed.match(/<Reframe/g)?.length).toBe(1);
    await (await $('[data-testid="reframe-reset"]')).click();
    await browser.waitUntil(async () => !onDisk().includes('<Reframe'), {
      timeout: 15_000,
      timeoutMsg: 'Reset did not take the <Reframe> away',
    });
    await (await $('[data-testid="reframe-done"]')).click();
    await browser.waitUntil(async () => !(await $('[data-testid="reframe-island"]').isExisting()), {
      timeout: 5000,
    });
    expect(onDisk().replace(', Reframe', '')).toBe(before.replace(', Reframe', ''));
  });
});
