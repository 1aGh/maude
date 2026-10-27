import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { videoPlays } from '../helpers/modes-present-video';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * S3.13 — `modes-present`: Edit → Preview → follow a link → back → Present from selection → step → video →
 * presenter view (two displays only) → the esc ladder. 04 Modes, canvas rows md-preview … md-esc.
 *
 * The follow-a-link step has its own file (`modes-present-links.e2e.ts`, S3.10a); this one is the Present half
 * and the esc ladder. Everything is read from the SHELL DOM (the canvas iframe is not reachable by DOM — memory
 * maude-canvas-iframe-unreachable-by-dom), through the testids in `client/testids.json`.
 *
 * WRITTEN, NOT RUN by the slice (the lane has no desktop build); the agent-browser half of this scenario ran on a
 * scratch project copy — see `.ai/scenarios/modes-present/spec.md` and `.ai/plans/notes/v2-evidence/S3.13/`.
 * Run it with the `desktop-e2e` skill.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SMOKE = join(HERE, '../fixtures/project/.design/ui/Smoke.tsx');
const fixtures = createFixtureGuard('modes-present', [SMOKE]);

const tid = (id: string) => `[data-testid="${id}"]`;
const text = async (id: string) => (await $(tid(id))).getText();
const exists = (id: string) => $(tid(id)).isExisting();

/** A synthetic chord on the shell document: the shell owns the mode keys (the iframe forwards its own). */
async function chord(key: string, code: string, mods: Partial<KeyboardEventInit> = {}) {
  await browser.execute(
    (k, c, m) => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, code: c, bubbles: true, cancelable: true, ...m })
      );
    },
    key,
    code,
    mods
  );
}

const pressed = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid^="palette-mode-"]'))
      .filter((e) => e.getAttribute('aria-pressed') === 'true')
      .map((e) => (e.getAttribute('data-testid') ?? '').replace('palette-mode-', ''))
  );

/** The switch lands a beat after its key: wait for it, then assert — a step that lands on the wrong mode is still red. */
async function landsOn(mode: string) {
  await browser
    .waitUntil(async () => (await pressed()).join() === mode, { timeout: 4000, interval: 100 })
    .catch(() => undefined);
  expect(await pressed()).toEqual([mode]);
}

describe('modes-present (S3.13)', () => {
  before(async () => {
    fixtures.snapshot();
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await waitForCanvasRects();
    await $(tid('canvas-frame')).waitForExist({ timeout: 15000 });
  });
  after(() => fixtures.restore());

  it('Edit: the switch holds Edit · Preview · Present, and Present has its small menu', async () => {
    startReport('modes-present');
    expect(await pressed()).toEqual(['edit']);
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-list')).waitForExist({ timeout: 4000 });
    // 04 md-present-menu: the rows, each with its key / note. The presenter row needs a second display and
    // "Copy presentation link" a cloud project, so they are asserted only where the fixture has them.
    expect(await text('mode-present-from-selection')).toContain('⌥⌘↵');
    expect(await text('mode-present-from-start')).toContain('⇧⌥⌘↵');
    expect(await text('mode-present-canvas')).toContain('no chrome, no pins');
    expect(await exists('mode-present-order-notes')).toBe(true);
    await capture('present menu');
    await chord('Escape', 'Escape'); // a menu closes first, whatever the mode
    await browser
      .waitUntil(async () => !(await exists('mode-present-list')), { timeout: 4000, interval: 100 })
      .catch(() => undefined);
    expect(await exists('mode-present-list')).toBe(false);
    await landsOn('edit');
  });

  it('Preview ⇄ Edit: ⌥⌘P and esc', async () => {
    await chord('p', 'KeyP', { altKey: true, metaKey: true });
    await $(tid('preview-bar')).waitForExist({ timeout: 6000 });
    await landsOn('preview');
    // 04 md-preview: the faces and the status word step aside (CONTRACT §5.4)
    expect(await $(tid('share-cluster')).getAttribute('data-cluster')).toBe('compact');
    expect(await $(tid('share-cluster-faces')).isDisplayed()).toBe(false);
    await capture('preview');
    await chord('Escape', 'Escape');
    await landsOn('edit');
  });

  it('Present from selection: the counter, the label, then esc back to Edit', async () => {
    await chord('Enter', 'Enter', { altKey: true, metaKey: true });
    await $(tid('present-controls')).waitForExist({ timeout: 8000 });
    await landsOn('present');
    expect(await text('present-counter')).toMatch(/^\d+ \/ \d+$/);
    expect(await text('present-label')).not.toBe('');
    // 04 md-present-full: only the work — no shell chrome
    // the chrome stays mounted and `.maude.is-present` hides it, so "no chrome" is not-displayed
    expect(await $(tid('share-cluster')).isDisplayed()).toBe(false);
    await capture('present from selection');
    await chord('ArrowRight', 'ArrowRight'); // steps (a one-artboard canvas stays put)
    await chord('Escape', 'Escape');
    await browser.waitUntil(async () => (await pressed()).join() === 'edit', { timeout: 6000 });
    expect(await exists('present-controls')).toBe(false);
  });

  it('Present the canvas: the pill, no chrome, esc back to the same view', async () => {
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-canvas')).click();
    await $(tid('present-pill')).waitForExist({ timeout: 8000 });
    expect(await text('present-pill')).toContain('Presenting the canvas');
    await capture('present the canvas');
    await chord('Escape', 'Escape');
    await landsOn('edit');
  });

  // Pending a fixture: the S3.3 helper steps `›` to a SECOND video artboard and checks the first clip stopped
  // (modes-present-video.ts header: "NOT the first in canvas order, a clip of at least 4 seconds"). The
  // project's Video fixture has ONE artboard, so the step ends on "did not move on from the playing clip".
  it.skip('video plays (S3.3 helper — needs a two-artboard video fixture)', async () => {
    await (await canvasRow('canvas-row-ui-video')).click();
    await waitForCanvasRects();
    await videoPlays();
  });

  it('Presenter view needs two displays', async function () {
    await $(tid('mode-present-menu')).click();
    // one display: the row is drawn greyed, "Needs a second display" (v2-p8-c7-presenter-row-greyed) — nothing to drive
    const hasRow =
      (await $(tid('mode-present-presenter-view')).getAttribute('aria-disabled')) !== 'true';
    await chord('Escape', 'Escape');
    if (!hasRow) {
      this.skip();
      return;
    }
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-presenter-view')).click();
    await chord('Enter', 'Enter', { altKey: true, metaKey: true });
    await $(tid('presenter-now')).waitForExist({ timeout: 10000 });
    await capture('presenter view');
    await $(tid('presenter-end')).click(); // End closes both windows
    await browser.waitUntil(async () => (await pressed()).join() === 'edit', { timeout: 8000 });
  });

  it('the esc ladder: each press takes exactly one step', async () => {
    await chord('p', 'KeyP', { altKey: true, metaKey: true }); // Preview
    // Present remembers the mode it was entered FROM (`returnTo`, canvas-mode.js): the Preview switch has
    // to have landed before the next chord, or Present is entered from Edit and esc goes back there.
    await browser.waitUntil(async () => (await pressed()).join() === 'preview', { timeout: 6000 });
    await chord('Enter', 'Enter', { altKey: true, metaKey: true }); // Present from Preview
    await browser.waitUntil(async () => (await pressed()).join() === 'present', { timeout: 6000 });
    expect(await pressed()).toEqual(['present']);
    // each step lands a beat after its key (the 2026-10-27 record read `preview` right after the second esc):
    // wait for it; a step that lands on the wrong mode is still red
    await chord('Escape', 'Escape');
    // returnTo: Present entered from Preview goes back to Preview, not to Edit
    await landsOn('preview');
    await chord('Escape', 'Escape');
    await landsOn('edit');
    await chord('Escape', 'Escape'); // Edit with nothing selected: nothing happens
    await browser.pause(400);
    expect(await pressed()).toEqual(['edit']);
    await capture('esc ladder done');
  });
});
