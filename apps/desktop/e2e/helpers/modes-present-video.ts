// S3.3 — the `modes-present` step "video plays" (04 Modes · md-present-video).
//
//   it('video plays', videoPlays);          // in apps/desktop/e2e/scenarios/modes-present.e2e.ts (S3.13)
//
// WRITTEN, NOT RUN (S3.3 hand-back): the scenario file is S3.13's; this is the step body it calls.
//
// Needs the active canvas to hold a video-comp artboard that is NOT the first in canvas order, with a
// clip of at least 4 seconds (the project fixture's 9:16 reel). Everything is read from the SHELL DOM
// (the canvas iframe is unreachable by DOM, see the memory note): the transport mirrors the clip, so
// the step needs no coordinates.
//
// IT MEASURES AUTOPLAY WITH SOUND ON WKWEBVIEW and writes the result into the report. The canvas
// iframe has no user gesture of its own; the click on "Present from the start" happens in the shell.
// S3.3's probe (macOS WKWebView, cross-origin iframe, unmuted `play()` without a gesture) resolved,
// so this step expects sound to start. If it does not, the clip falls back to muted and this step
// FAILS with the wry fix named: `WebViewBuilder::with_autoplay(true)` for project webviews (an L4
// patch, not a canvas workaround).
import { $, browser, expect } from '@wdio/globals';
import { capture } from './evidence';

const tid = (id: string) => `[data-testid="${id}"]`;
const text = async (id: string) => (await $(tid(id))).getText();
const attr = async (id: string, name: string) => (await $(tid(id))).getAttribute(name);

const seconds = (t: string) => {
  const m = /^(\d+):(\d{2}) \/ /.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
};

/** Walk the run with the controls' › until the artboard holds a clip (the transport appears). */
async function stepToClip(max = 40): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    if (await $(tid('present-transport')).isExisting()) return;
    const next = await $(tid('present-next'));
    if (!(await next.isEnabled())) break;
    await next.click();
    await browser.pause(150);
  }
  if (!(await $(tid('present-transport')).isExisting()))
    throw new Error(
      'no artboard in the run plays a clip (the fixture needs a video-comp artboard)'
    );
}

export async function videoPlays(): Promise<void> {
  // Present from the start: the person's gesture, in the shell.
  await (await $(tid('mode-present-menu'))).click();
  await (await $(tid('mode-present-from-start'))).click();
  await (await $(tid('present-controls'))).waitForDisplayed({ timeout: 15_000 });

  await stepToClip();
  await capture('present: the reel, pillarboxed, playing');

  // 1 · It started by itself, WITH SOUND (the measurement).
  await browser.waitUntil(
    async () => (await attr('present-media-toggle', 'aria-label')) === 'Pause',
    {
      timeout: 5000,
      timeoutMsg: 'the clip did not start playing when its artboard came up',
    }
  );
  const soundOn = (await attr('present-media-sound', 'aria-pressed')) === 'true';
  if (!soundOn)
    throw new Error(
      'AUTOPLAY WITH SOUND IS BLOCKED on this webview: the clip fell back to muted. The fix is the ' +
        'wry autoplay setting for project webviews (L4 patch), not a workaround in the canvas.'
    );

  // 2 · The shell's transport follows it.
  const t0 = seconds(await text('present-media-time'));
  await browser.waitUntil(async () => seconds(await text('present-media-time')) > t0, {
    timeout: 4000,
    timeoutMsg: 'the transport time did not move while the clip played',
  });

  // 3 · A click on the video pauses it (and does not move on); the counter stays.
  const counter = await text('present-counter');
  const { width, height } = await browser.getWindowSize();
  await browser
    .action('pointer')
    .move({ x: Math.round(width / 2), y: Math.round(height / 2) })
    .down()
    .up()
    .perform();
  await browser.waitUntil(
    async () => (await attr('present-media-toggle', 'aria-label')) === 'Play',
    {
      timeout: 3000,
      timeoutMsg: 'a click on the video did not pause it',
    }
  );
  expect(await text('present-counter')).toBe(counter);
  const frozen = await text('present-media-time');
  await browser.pause(1200);
  expect(await text('present-media-time')).toBe(frozen);
  await capture('present: paused by a click');

  // 4 · The transport resumes it; the sound button mutes it and says so.
  await (await $(tid('present-media-toggle'))).click();
  await browser.waitUntil(
    async () => (await attr('present-media-toggle', 'aria-label')) === 'Pause'
  );
  await (await $(tid('present-media-sound'))).click();
  await browser.waitUntil(
    async () => (await attr('present-media-sound', 'aria-pressed')) === 'false'
  );

  // 5 · → moves on mid-clip: nothing waits for the end.
  await browser.keys(['ArrowRight']);
  await browser.waitUntil(async () => (await text('present-counter')) !== counter, {
    timeout: 3000,
    timeoutMsg: '→ did not move on from the playing clip',
  });
  await capture('present: moved on mid-clip');

  // Leave with esc, back to where Present came from.
  await browser.keys(['Escape']);
  await (await $(tid('present-controls'))).waitForDisplayed({ reverse: true, timeout: 10_000 });
}
