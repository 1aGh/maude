import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { lineDiff, withNetProbe } from '../helpers/net-probe';
import { pointerClick, pointerDown, pointerMove, pointerUp } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — one video, many formats, and framing each its own way (S7.13: ve-formats, ve-reframe).
 *
 *   formats   select the Reels video: no Formats rows (a lone video, V2-8.5 c4-video); ⌘K Add a format draws them —
 *             "Reels 9:16 · this one" — with the size list open; + Add a format › 16:9 copies the artboard
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
/** The file once it has stopped changing (a write can land in more than one save) — the state ⌘Z must restore. */
async function settled(quietMs = 1200): Promise<string> {
  let last = onDisk();
  let since = Date.now();
  await browser.waitUntil(
    async () => {
      const now = onDisk();
      if (now !== last) {
        last = now;
        since = Date.now();
      }
      return Date.now() - since >= quietMs;
    },
    { timeout: 15_000, interval: 200, timeoutMsg: 'the file never stopped changing' }
  );
  return last;
}

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
  await pointerClick(x, y);
}

const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

const text = async (testid: string) =>
  (await (await $(`[data-testid="${testid}"]`)).getText()).trim();

/**
 * Open "+ Add a format"'s size list. A video with no other format has no Formats rows at all (07 ve-select, V2-8.5
 * c4-video): ⌘K "Add a format" draws them with the list open. With the rows already drawn, "+ Add a format" opens
 * the list — unless it is open already (a click would close it).
 */
async function openAddList(size: string): Promise<void> {
  const option = `[data-testid="insp-format-add-${size}"]`;
  if (await $(option).isExisting()) return;
  if (await $('[data-testid="insp-format-add"]').isExisting()) {
    await (await $('[data-testid="insp-format-add"]')).click();
  } else {
    await key({ key: 'k', metaKey: true });
    const input = await $('[data-testid="palette-input"]');
    await input.waitForExist({ timeout: 10_000 });
    await input.setValue('Add a format');
    const row = await $('[data-testid="palette-row-action:video.format.add"]');
    await row.waitForExist({ timeout: 10_000, timeoutMsg: '⌘K has no "Add a format" row' });
    await row.click();
  }
  await $(option).waitForExist({ timeout: 10_000, timeoutMsg: `the size list has no ${size}` });
}

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
    const row = await canvasRow('canvas-row-ui-videoformats');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    // the artboard's name strip selects the WHOLE artboard; its body would pick the video player inside it
    await dismissNotices(); // a first-run notice over the artboard's label would take the click
    await withNetProbe(async () => {
      await clickAt(box.x + 12, box.y - 10);
      await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
      await dismissNotices(); // first-run notices stack over the island's bottom edge
      await $('[data-testid="inspector-kind"]').waitForExist({ timeout: 15_000 });
    }, false);
    // a lone video: the card is Size · Length · Poster · Sound · Export — no Formats rows until they are asked for
    expect(await $('[data-testid="insp-formats"]').isExisting()).toBe(false);
    await openAddList('1920x1080');
    await $('[data-testid="insp-formats"]').waitForExist({
      timeout: 15_000,
      timeoutMsg: '⌘K Add a format did not list the video’s formats',
    });
    expect(await text('insp-fmt-reel')).toContain('this one');
    await capture('video-formats-inspector');
  });

  it('+ Add a format › 16:9 is one write, the cut is shared, ⌘Z takes it away', async () => {
    const before = onDisk();
    await openAddList('1920x1080');
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
    await openAddList('1920x1080');
    await (await $('[data-testid="insp-format-add-1920x1080"]')).click();
    await browser.waitUntil(async () => onDisk().includes('id="reel-16x9"'), { timeout: 15_000 });
    const withTwo = await settled();
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
    await browser
      .waitUntil(async () => onDisk() === withTwo, {
        timeout: 15_000,
        timeoutMsg: '⌘Z did not put the file back exactly',
      })
      .catch((e: Error) => {
        throw new Error(`${e.message}\n${lineDiff(withTwo, onDisk())}`);
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
    // P8-C8: the hint is said once — the count line ("Centred. Drag the window to frame it."); the note under the
    // buttons is only for someone who cannot edit
    expect(await $('[data-testid="reframe-note"]').isExisting()).toBe(false);
    expect(
      await browser.execute(
        () => document.querySelector('[data-testid="reframe-count"]')?.textContent?.trim() ?? null
      )
    ).toBe('Centred. Drag the window to frame it.');
    await capture('video-formats-reframe');
    const win = await $('[data-testid="reframe-window"]');
    const at = await win.getLocation();
    const size = await win.getSize();
    const cx = at.x + size.width / 2;
    const cy = at.y + size.height / 2;
    await pointerDown(cx, cy);
    for (const dx of [10, 20, 30]) await pointerMove(cx + dx, cy);
    await pointerUp(cx + 30, cy);
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
