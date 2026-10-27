import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, $$, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { withNetProbe } from '../helpers/net-probe';
import { pointerClick } from '../helpers/pointer';
import { setSelect } from '../helpers/select';
import { selectUntilIsland } from '../helpers/select-artboard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — the clip inspector, the join picker and a title's motion (S7.10: ve-transition, ve-text).
 *
 *   clip      click a beat: the RIGHT-HAND inspector says "Clip" and shows Length · Speed (the ve-transition clip
 *             inspector); Speed 2× writes ONCE (`playbackRate`) and ⌘Z puts the bytes back.
 *   title     click the title: the inspector says "Title" with Text · Motion · Length; Slide up wraps its content in
 *             `<TitleMotion preset="slide-up">` (one write), None takes it off again.
 *   join      click the dot between "oslava" and "logo": a picker titled "oslava → logo" with six tiles and Fade
 *             lit; Wipe rewrites the presentation (one write); Esc closes it.
 *
 * The Timeline island and the inspector live in the SHELL (plain DOM); the artboard that raises the island is inside
 * the canvas iframe, so it is found by its on-screen rectangle and CLICKED BY COORDINATES (as video-play does).
 * Gestures WRITE to the fixture `VideoClipInspect.tsx` — snapshot + byte-exact restore (helpers/fixture-guard.ts).
 *
 * WRITTEN, NOT RUN in the S7.10 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoClipInspect.tsx');
const fixtures = createFixtureGuard('video-clip-inspector', [FIXTURE]);
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

const text = async (testid: string) =>
  (await (await $(`[data-testid="${testid}"]`)).getText()).trim();

describe('video-clip-inspector — the clip inspector, the join picker, a title’s motion', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-clip-inspector');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the video: the island comes out under it', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videoclipinspect');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await selectUntilIsland(() => artboardBox('reel'), clickAt);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
    await dismissNotices(); // first-run notices stack over the island's bottom edge
    await $('[data-testid="timeline-seq-0"]').waitForExist({ timeout: 20_000 });
  });

  it('click a beat: the right-hand inspector is a Clip with Length and Speed; 2× is one write, ⌘Z undoes it', async () => {
    const before = onDisk();
    await withNetProbe(async () => {
      await (await $('[data-testid="timeline-seq-0"]')).click();
      await $('[data-testid="inspector-frame"][data-kind="clip"]').waitForExist({
        timeout: 10_000,
        timeoutMsg: 'a clip pick did not fill the inspector',
      });
    }, false);
    expect(await text('inspector-kind')).toBe('Clip');
    await $('[data-testid="insp-clip-length"]').waitForExist({ timeout: 5000 });
    await $('[data-testid="insp-clip-speed"]').waitForExist({ timeout: 5000 });
    await capture('video-clip-inspector-clip');
    await withNetProbe(async () => {
      expect(await setSelect('insp-clip-speed', '2')).toBe(true);
      await browser.waitUntil(async () => onDisk() !== before, {
        timeout: 15_000,
        timeoutMsg: 'the speed never reached the file',
      });
    });
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
  });

  it('the title: Text · Motion · Length; Slide up wraps it once, None takes it off', async () => {
    const before = onDisk();
    const titleBlock = await browser.execute(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="timeline-seq-"]')];
      // P8 C3 (07 · ve-text): a title block goes by its words, never by the Sequence's name
      // (aria-label carries the name even when the block is too narrow to print it)
      const hit = rows.find((r) => /PROČ ALLIGATORS/i.test(r.getAttribute('aria-label') ?? ''));
      return hit?.getAttribute('data-testid') ?? null;
    });
    expect(titleBlock).not.toBeNull();
    await (await $(`[data-testid="${titleBlock}"]`)).click();
    await $('[data-testid="inspector-frame"][data-kind="title"]').waitForExist({
      timeout: 10_000,
      timeoutMsg: 'the title pick did not fill the inspector',
    });
    expect(await text('inspector-kind')).toBe('Title');
    // P8-C8 (07 ve-text): the card is Font · Colour · Motion · Length and names the title by its words; the words'
    // own field moved under Advanced
    expect(await text('inspector-title')).toBe('PROČ ALLIGATORS');
    expect(await $('[data-testid="insp-title-motion"]').isExisting()).toBe(true);
    expect(await $('[data-testid="insp-clip-length"]').isExisting()).toBe(true);
    const fold = await $('[data-testid="fold-inspector-toggle"]');
    if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
    const words = await $('[data-testid="timeline-inspector-text"]');
    await words.waitForExist({ timeout: 5000, timeoutMsg: 'Advanced holds no words field' });
    expect(await words.getValue()).toBe('PROČ ALLIGATORS');
    await capture('video-clip-inspector-title');
    await (await $('[data-testid="insp-title-motion-slide-up"]')).click();
    await browser.waitUntil(async () => onDisk().includes('<TitleMotion preset="slide-up">'), {
      timeout: 15_000,
      timeoutMsg: 'Slide up never reached the file',
    });
    // the grid lights the preset the Timeline has RE-READ; a tile that is already lit is a no-op, so None is pressed
    // only once Slide up shows as the title's own
    await withNetProbe(
      () =>
        browser.waitUntil(
          async () =>
            (await (
              await $('[data-testid="insp-title-motion-slide-up"]')
            ).getAttribute('aria-checked')) === 'true',
          { timeout: 10_000, timeoutMsg: 'the grid never showed Slide up as the title’s motion' }
        ),
      false
    );
    await (await $('[data-testid="insp-title-motion-none"]')).click();
    await browser.waitUntil(async () => !onDisk().includes('<TitleMotion'), {
      timeout: 15_000,
      timeoutMsg: 'None did not take the wrapper off',
    });
    expect(onDisk().replace(', TitleMotion', '')).toBe(before);
  });

  it('the join: a picker titled with both beats, six tiles, Fade lit; Wipe is one write; Esc closes', async () => {
    const before = onDisk();
    await (await $('[data-testid="timeline-seam-0"]')).click();
    await $('[data-testid="timeline-transition-picker"]').waitForExist({
      timeout: 5000,
      timeoutMsg: 'the join dot opened no picker',
    });
    expect(await text('timeline-transition-title')).toBe('oslava → logo');
    const tiles = await $$('[data-testid="timeline-transition-grid"] button');
    expect(tiles.length).toBe(6);
    expect(
      await (await $('[data-testid="timeline-transition-fade"]')).getAttribute('aria-checked')
    ).toBe('true');
    await capture('video-clip-inspector-join');
    await (await $('[data-testid="timeline-transition-wipe"]')).click();
    await browser.waitUntil(async () => onDisk().includes('presentation={wipe('), {
      timeout: 15_000,
      timeoutMsg: 'Wipe never reached the file',
    });
    await key({ key: 'Escape' });
    await browser.waitUntil(
      async () => !(await $('[data-testid="timeline-transition-picker"]').isExisting()),
      { timeout: 5000, timeoutMsg: 'Esc did not close the picker' }
    );
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => onDisk() === before, {
      timeout: 15_000,
      timeoutMsg: '⌘Z did not put the file back exactly',
    });
  });
});
