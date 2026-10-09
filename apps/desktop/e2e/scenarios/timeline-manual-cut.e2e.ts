import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { canvasRow } from '../helpers/tree';

/**
 * timeline-manual-cut — feature-enhanced-video-editing (Task 25).
 *
 * Drives the iMovie-style manual Timeline against the deterministic 3-beat
 * `Cut.tsx` fixture: open → three-band storyline renders → select → ⌘B split
 * → Delete (ripple) → ⌘Z undo → zoom. The Timeline lives in the SHELL (top
 * document), so unlike the canvas-iframe scenarios everything here is plain
 * DOM on the top frame; keyboard chords are dispatched synthetically (the
 * house DOM-driven style — never computer-use).
 *
 * Split/Delete WRITE THROUGH to the fixture .tsx — snapshot + byte-exact
 * restore in before/after so the repo never dirties. The guard also survives a
 * killed run; see helpers/fixture-guard.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/Cut.tsx');
const fixtures = createFixtureGuard('timeline-manual-cut', [FIXTURE]);

const key = (init: Record<string, unknown>) =>
  browser.execute((k) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...k }));
  }, init);

/**
 * How many beats the Timeline is showing, in WHICHEVER projection it chose.
 *
 * This used to count `[data-testid="timeline-storyline"] .tl-beat` only — the
 * banded (iMovie) layout — and that made the scenario permanently red against
 * its own fixture. `TimelinePanel`'s `bandMode` is
 * `storyline.length > 0 && sequences.some((s) => rowKind(s) !== 'jsx')`, and
 * `Cut.tsx` is deliberately media-free (three JSX scenes, so the harness needs
 * no assets and stays deterministic) — every sequence is `rowKind === 'jsx'`,
 * so the panel deliberately renders the stacked row-per-sequence projection
 * instead. That was a product decision (dogfood 2026-07-30: a purely digital
 * comp keeps "the truthful, layer-expandable view"), not a regression, and the
 * scenario simply outlived its premise.
 *
 * Counting `timeline-seq-*` covers BOTH projections — it is the per-sequence
 * block either way — so the select / split / delete / undo assertions test what
 * the product actually renders for this comp. Verified by hand against a live
 * panel: split 3 → 4, delete 4 → 3, undo 3 → 4, with the fixture rewritten on
 * disk each time.
 */
const beatCount = () =>
  browser.execute(() => document.querySelectorAll('[data-testid^="timeline-seq-"]').length);

describe('timeline — manual cut (select · split · delete · undo · zoom)', () => {
  before(async () => {
    fixtures.snapshot();
    startReport('timeline-manual-cut');
  });

  after(() => {
    fixtures.restore();
  });

  it('opens the Cut canvas and the Timeline shows all three beats', async () => {
    const row = await canvasRow('canvas-row-ui-cut');
    await row.waitForExist({ timeout: 30000 });
    await row.click();
    await $('[data-testid="canvas-frame"]').waitForExist({ timeout: 30000 });

    // ⌘⇧T toggles the Timeline dock (shell-level shortcut).
    await key({ key: 't', metaKey: true, shiftKey: true });
    await $('[data-testid="timeline-panel"]').waitForExist({ timeout: 15000 });

    // The comp announce + source parse settle async — wait for the storyline.
    await browser.waitUntil(async () => (await beatCount()) === 3, {
      timeout: 20000,
      timeoutMsg: 'timeline never showed 3 beats',
    });
    // The TRACK, not the storyline row — see `beatCount`. `timeline-storyline`
    // exists only in band mode, which this media-free fixture deliberately does
    // not trigger; asserting it here is what made this scenario permanently red.
    await expect($('[data-testid="timeline-track"]')).toExist();
    await expect($('[data-testid="timeline-zoom"]')).toExist();
    await capture('timeline-3-beats');
  });

  it('click selects a beat (accent outline), Esc deselects', async () => {
    const beat = $('[data-testid="timeline-seq-1"]');
    await beat.waitForExist({ timeout: 10000 });
    await beat.click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('.tl-seq-block.is-selected').length
        )) === 1,
      { timeout: 5000, timeoutMsg: 'click did not select the beat' }
    );
    await capture('beat-selected');
    await key({ key: 'Escape' });
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('.tl-seq-block.is-selected').length
        )) === 0,
      { timeout: 5000, timeoutMsg: 'Esc did not deselect' }
    );
  });

  it('⌘B splits the selected beat at the playhead → 4 beats', async () => {
    // Park the playhead inside beat-two (frames 60–150): seek to 100 via the
    // shell transport (ArrowRight is 1-frame; use the track scrub instead).
    await browser.execute(() => {
      const track = document.querySelector('[data-testid="timeline-track"]') as HTMLElement;
      const r = track.getBoundingClientRect();
      // axis starts after the 96px gutter; 210 total frames → frame 100
      const x = r.left + 96 + ((r.width - 96) * 100) / 210;
      track.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: r.top + 10 })
      );
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    const beat = $('[data-testid="timeline-seq-1"]');
    await beat.click();
    await key({ key: 'b', metaKey: true });
    await browser.waitUntil(async () => (await beatCount()) === 4, {
      timeout: 20000,
      timeoutMsg: '⌘B did not split the beat (expected 4 beats)',
    });
    await capture('after-split');
  });

  it('Delete removes the selected beat with ripple → 3 beats; ⌘Z restores → 4', async () => {
    const beat = $('[data-testid="timeline-seq-1"]');
    await beat.waitForExist({ timeout: 10000 });
    await beat.click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelectorAll('.tl-seq-block.is-selected').length
        )) === 1,
      { timeout: 5000 }
    );
    await key({ key: 'Delete' });
    await browser.waitUntil(async () => (await beatCount()) === 3, {
      timeout: 20000,
      timeoutMsg: 'Delete did not remove the beat',
    });
    await capture('after-delete');
    await key({ key: 'z', metaKey: true });
    await browser.waitUntil(async () => (await beatCount()) === 4, {
      timeout: 20000,
      timeoutMsg: '⌘Z did not restore the removed beat',
    });
    await capture('after-undo');
  });

  /**
   * The track is laid out on ONE px-per-frame scale: its width is the 96 px
   * label gutter plus `totalFrames × pxPerFrame` (TimelinePanel `axisPx`). The
   * slider is log-scaled from fit-to-width (0) to MAX_PX_PER_FRAME (100), which
   * is 40 px/frame (panels/timeline-scale.js).
   *
   * This used to assert "slider 80 makes the track > 3× wider", and that ratio
   * is a property of the WINDOW, not the zoom: fit already spans the dock, so
   * the wider the window, the less room is left above it. Measured on a
   * 2545 px-wide window (DPR 1): fit 2529 px → slider 80 6648 px (2.6×) →
   * slider 100 8496 px — the zoom was fine, the threshold was not. So assert
   * the scale itself: max zoom is exactly 40 px/frame on any window, 80 sits
   * strictly between fit and max with a real expansion, and 0 returns to fit.
   */
  it('zoom slider expands the scaled track (px-per-frame scale)', async () => {
    const LABEL_GUTTER = 96;
    const TOTAL_FRAMES = 210; // Cut.tsx: 60 + 90 + 60 frames (split/delete/undo keep the total)
    const MAX_PX_PER_FRAME = 40;
    const widthOf = () =>
      browser.execute(
        () =>
          (
            document.querySelector('[data-testid="timeline-track"]') as HTMLElement
          ).getBoundingClientRect().width
      );
    const setSlider = (v: number) =>
      browser.execute((val: number) => {
        const z = document.querySelector('[data-testid="timeline-zoom"]') as HTMLInputElement;
        const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        desc?.set?.call(z, val);
        z.dispatchEvent(new Event('input', { bubbles: true }));
        z.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
    const sliderValue = () =>
      browser.execute(
        () => (document.querySelector('[data-testid="timeline-zoom"]') as HTMLInputElement).value
      );

    const fit = await widthOf();

    await setSlider(80);
    await browser.waitUntil(async () => (await widthOf()) > fit * 1.5, {
      timeout: 5000,
      timeoutMsg: 'zoom did not expand the track',
    });
    const at80 = await widthOf();
    expect(await sliderValue()).toBe('80');
    await capture('zoomed');

    // Max zoom = exactly MAX_PX_PER_FRAME px per frame, whatever the window.
    const atMax = LABEL_GUTTER + TOTAL_FRAMES * MAX_PX_PER_FRAME;
    await setSlider(100);
    await browser.waitUntil(async () => Math.abs((await widthOf()) - atMax) <= 1, {
      timeout: 5000,
      timeoutMsg: `max zoom did not lay the track out at ${MAX_PX_PER_FRAME} px/frame (${atMax} px)`,
    });
    expect(at80).toBeGreaterThan(fit);
    expect(at80).toBeLessThan(atMax);
    await capture('zoomed-max');

    // Back to 0 = fit-to-width again.
    await setSlider(0);
    await browser.waitUntil(async () => Math.abs((await widthOf()) - fit) <= 1, {
      timeout: 5000,
      timeoutMsg: 'slider 0 did not return the track to fit-to-width',
    });
  });
});
