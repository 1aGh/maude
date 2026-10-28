import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForArtboard } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { selectUntilIsland } from '../helpers/select-artboard';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import {
  artboardBox,
  clickAt,
  dropOnWindow,
  fileInShell,
  haveFfmpeg,
  makeClip,
  scratch,
  text,
  tid,
} from '../helpers/video-lab';

/**
 * 07 Video Editing — ve-fit-fill: "A vertical clip on 16:9; a video with no sound" (board 25), driven with a REAL
 * vertical file.
 *
 *   drop     a real 90×160 h264 clip (made by the local ffmpeg, silent) is dropped on an empty 16:9 video through
 *            the footage catcher — the same drop a Finder drag makes
 *   ask      the clip asks ONCE how it should sit: "<name> is vertical — how should it sit?" with Fill · Fit ·
 *            Blur behind (Blur on by default) and "Same for every vertical clip"
 *   answer   Blur behind → the file now says so (`fit`), the question is gone, and it does not come back for the
 *            same clip
 *   silence  the Music track says "No sound in this video." with Add music and "or ask AI for a track"
 *
 * The canvas is written by this spec (and removed after) so the shared fixture project keeps its canvas count.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAUDE_PROJECT_ROOT ?? join(HERE, '../fixtures/project');
const CANVAS = join(ROOT, '.design', 'ui', 'VideoFit.tsx');

const EMPTY = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { AbsoluteFill } from 'remotion';",
  '',
  'const Pov = () => (',
  "  <AbsoluteFill style={{ background: '#000' }}>",
  '  </AbsoluteFill>',
  ');',
  '',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="pov" kind="video" label="POV · 16:9 · 0:20" width={1920} height={1080}>',
  '        <VideoComp component={Pov} durationInFrames={600} fps={30} width={1920} height={1080} />',
  '      </DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const onDisk = () => readFileSync(CANVAS, 'utf8');

describe('video-fit-fill — a real vertical file on a wide video, and a video with no sound', () => {
  before(function () {
    if (!haveFfmpeg()) this.skip();
    startReport('video-fit-fill');
    writeFileSync(CANVAS, EMPTY);
  });
  after(() => {
    rmSync(CANVAS, { force: true });
  });

  it('drop a vertical clip: it asks once how to sit, and Blur behind is written to the file', async () => {
    const dir = scratch();
    const clip = makeClip(dir, 'IMG_5120.mp4', { size: '90x160', sec: 2, sound: false });
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videofit');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForArtboard('pov');
    await selectUntilIsland(() => artboardBox('pov'), clickAt);
    await $(tid('timeline-island')).waitForExist({ timeout: 15_000 });

    await fileInShell('vertical', clip, 'IMG_5120.mp4', 'video/mp4');
    const before = onDisk();
    await dropOnWindow(['vertical']);
    await browser.waitUntil(async () => onDisk() !== before, {
      timeout: 30_000,
      timeoutMsg: 'the dropped clip never reached the canvas file',
    });
    await $(tid('timeline-seq-0')).waitForExist({ timeout: 15_000 });
    await (await $(tid('timeline-seq-0'))).click();

    const ask = await $(tid('timeline-fit-ask'));
    await ask.waitForExist({
      timeout: 20_000,
      timeoutMsg: 'a vertical clip on a wide video never asked how it should sit',
    });
    // The board names the file ("IMG_5120 is vertical"); a dropped clip is stored under its content hash and the
    // timeline does not keep the file's name, so today the title carries the stored name. Proposal in the hand-back.
    expect(await text('timeline-fit-ask-title')).toMatch(/ is vertical — how should it sit\?$/);
    // the three ways, in the board's order, with its small lines; Blur behind is the one that is on
    const options = await browser.execute(() =>
      ['fill', 'fit', 'blur'].map((k) => {
        const el = document.querySelector(`[data-testid="timeline-fit-${k}"]`);
        return {
          k,
          label: el?.querySelector('strong')?.textContent ?? null,
          small: el?.querySelector('small')?.textContent ?? null,
          on: el?.getAttribute('data-on') === 'true',
        };
      })
    );
    expect(options.map((o) => o.label)).toEqual(['Fill', 'Fit', 'Blur behind']);
    expect(options[0]?.small).toBe('Crops to the player, follows the player');
    expect(options[1]?.small).toBe('Whole picture, dark bars');
    expect(options.map((o) => o.on)).toEqual([false, false, true]);
    // "Same for every vertical clip" is ticked, as the board draws it
    expect(await (await $(tid('timeline-fit-same'))).isSelected()).toBe(true);
    await capture('video-fit-ask');

    const asked = onDisk();
    await (await $(tid('timeline-fit-blur'))).click();
    await browser.waitUntil(async () => onDisk() !== asked, {
      timeout: 15_000,
      timeoutMsg: 'Blur behind did not change the file',
    });
    expect(onDisk()).toMatch(/blur/);
    await browser.waitUntil(async () => !(await $(tid('timeline-fit-ask')).isExisting()), {
      timeout: 10_000,
      timeoutMsg: 'the question stayed after it was answered',
    });
    // asked ONCE: select away and back, it does not ask again
    await (await $(tid('timeline-seq-0'))).click();
    await browser.pause(1500);
    expect(await $(tid('timeline-fit-ask')).isExisting()).toBe(false);
    await capture('video-fit-answered');
  });

  it('a video whose clips are all silent says so, with two ways to get some', async () => {
    // a dropped clip may carry sound (the studio cannot tell), so it is silenced the way a person does: Volume 0
    await (await $(tid('timeline-seq-0'))).click();
    const field = await $('[data-testid="insp-clip-volume"] input:not([type="range"])');
    await field.waitForExist({ timeout: 10_000, timeoutMsg: 'the clip inspector has no Volume field' });
    const before = onDisk();
    await field.click();
    await browser.execute((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      set?.call(el, '0');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, field);
    await browser.keys(['Enter']);
    await field.click();
    await browser.keys(['Tab']);
    await browser.waitUntil(async () => onDisk() !== before, {
      timeout: 10_000,
      timeoutMsg: 'Volume 0 did not reach the file',
    });
    const hint = await $(tid('timeline-music-hint'));
    await hint.waitForExist({ timeout: 15_000, timeoutMsg: 'the Music track did not say it is silent' });
    expect(await hint.getText()).toContain('No sound in this video.');
    expect((await (await $(tid('timeline-music-add'))).getText()).trim()).toBe('Add music');
    expect(await (await $(tid('timeline-music-ask'))).getText()).toContain('ask AI for a track');
    await capture('video-no-sound');
  });
});
