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

  it('zoom slider expands the scaled track (px-per-frame scale)', async () => {
    const widthOf = () =>
      browser.execute(
        () =>
          (
            document.querySelector('[data-testid="timeline-track"]') as HTMLElement
          ).getBoundingClientRect().width
      );
    const before = await widthOf();
    await browser.execute(() => {
      const z = document.querySelector('[data-testid="timeline-zoom"]') as HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      desc?.set?.call(z, 80);
      z.dispatchEvent(new Event('input', { bubbles: true }));
      z.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => (await widthOf()) > before * 3, {
      timeout: 5000,
      timeoutMsg: 'zoom did not expand the track',
    });
    await capture('zoomed');
  });
});
