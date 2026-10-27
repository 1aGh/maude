import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForArtboard } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { lineDiff, withNetProbe } from '../helpers/net-probe';
import { pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 07 Video Editing — a music bed that knows its beat (S7.12: ve-music).
 *
 *   lane      the Music track draws a tick on every beat (a tall one on the bar), "120 BPM" on the bed
 *   inspector click the bed: the right-hand inspector says "Music" with Volume · Lower under speech · Snap to the beat
 *             · Cut to the beat; Advanced names `bpm 120 (detected)`, Half and Double
 *   writes    Lower under speech wraps the bed in `<Duck>` (one write) and ⌘Z puts the bytes back; Snap to the beat
 *             off writes `artboardMeta.reel.snap: "off"` into the canvas meta and on takes it back
 *
 * The Timeline island and the inspector live in the SHELL (plain DOM); the artboard that raises the island is inside the
 * canvas iframe, so it is found by its on-screen rectangle and CLICKED BY COORDINATES (as video-play does). The beat
 * grid is the committed `assets/song.beats.json` — no audio is decoded, no analysis service is called. Gestures WRITE
 * to the fixture `VideoMusic.tsx` / `.meta.json` — snapshot + byte-exact restore (helpers/fixture-guard.ts).
 *
 * WRITTEN, NOT RUN in the S7.12 hand-back (the lead runs the desktop lane: an unlocked screen and the e2e lock).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = join(HERE, '../fixtures/project/.design/ui');
const FIXTURE = join(UI, 'VideoMusic.tsx');
const META = join(UI, 'VideoMusic.meta.json');
const fixtures = createFixtureGuard('video-music', [FIXTURE, META]);
const onDisk = () => readFileSync(FIXTURE, 'utf8');
const metaOnDisk = () => {
  try {
    return readFileSync(META, 'utf8');
  } catch {
    return '';
  }
};

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

describe('video-music — a music bed with its beat: ticks, Music inspector, Lower under speech, Snap', () => {
  before(() => {
    fixtures.snapshot();
    startReport('video-music');
  });
  after(() => {
    fixtures.restore();
  });

  it('select the video: the island comes out under it and the Music track draws the beat', async () => {
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videomusic');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForArtboard('reel'); // a comp with no element boxes never fills the rects hook
    const box = (await artboardBox('reel')) as Box;
    expect(box).not.toBeNull();
    await clickAt(box.x + 12, box.y - 10);
    await $('[data-testid="timeline-island"]').waitForExist({ timeout: 15_000 });
    await dismissNotices(); // first-run notices stack over the island's bottom edge
    await $('[data-testid="timeline-beat-ticks"]').waitForExist({
      timeout: 20_000,
      timeoutMsg: 'the Music track drew no beat ticks',
    });
    await $('[data-testid="timeline-bar-ticks"]').waitForExist({ timeout: 5000 });
    expect(await text('timeline-music-bpm')).toBe('120 BPM');
    await capture('video-music-lane');
  });

  it('click the bed: the inspector is Music; Lower under speech wraps it in <Duck> once, ⌘Z undoes it', async () => {
    const before = onDisk();
    await withNetProbe(async () => {
      await (await $('[data-testid="timeline-audio-0"] .tl-audio-block')).click();
      await $('[data-testid="inspector-frame"][data-kind="music"]').waitForExist({
        timeout: 10_000,
        timeoutMsg: 'a music pick did not fill the inspector',
      });
      expect(await text('inspector-kind')).toBe('Music');
      await $('[data-testid="insp-music-volume"]').waitForExist({ timeout: 5000 });
      await $('[data-testid="insp-music-snap"]').waitForExist({ timeout: 5000 });
      await $('[data-testid="insp-music-cut-to-beat"]').waitForExist({ timeout: 5000 });
      await capture('video-music-inspector');
      await (await $('[data-testid="insp-music-duck"] input')).click();
      await browser.waitUntil(async () => onDisk() !== before && onDisk().includes('<Duck'), {
        timeout: 15_000,
        timeoutMsg: 'Lower under speech never reached the file',
      });
      await key({ key: 'z', metaKey: true });
      await browser
        .waitUntil(async () => onDisk() === before, {
          timeout: 15_000,
          timeoutMsg: '⌘Z did not put the file back exactly',
        })
        .catch((e: Error) => {
          throw new Error(`${e.message}\n${lineDiff(before, onDisk())}`);
        });
    });
  });

  it('Snap to the beat off writes artboardMeta.snap, on takes it back to the default', async () => {
    const before = metaOnDisk();
    await (await $('[data-testid="insp-music-snap"] input')).click();
    await browser.waitUntil(async () => /"snap":\s*"off"/.test(metaOnDisk()), {
      timeout: 15_000,
      timeoutMsg: 'Snap to the beat off never reached the canvas meta',
    });
    await (await $('[data-testid="insp-music-snap"] input')).click();
    await browser.waitUntil(async () => !/"snap"/.test(metaOnDisk()) || metaOnDisk() === before, {
      timeout: 15_000,
      timeoutMsg: 'Snap to the beat on did not clear the stored choice',
    });
  });

  it('Advanced names the tempo with Half and Double', async () => {
    const toggle = await $('[data-testid="fold-inspector-toggle"]');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    // the fold opens on the next render, not inside the click
    await browser
      .waitUntil(
        async () =>
          (await $('[data-testid="insp-adv-music-bpm"]').isExisting()) &&
          (await text('insp-adv-music-bpm')).includes('120 (detected)'),
        { timeout: 5000, interval: 100 }
      )
      .catch(() => undefined);
    expect(await text('insp-adv-music-bpm')).toContain('120 (detected)');
    await $('[data-testid="insp-music-half"]').waitForExist({ timeout: 5000 });
    await $('[data-testid="insp-music-double"]').waitForExist({ timeout: 5000 });
    await capture('video-music-advanced');
  });
});
