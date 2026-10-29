import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { createFixtureGuard } from '../helpers/fixture-guard';
import { invokeTauri } from '../helpers/native';
import { artboardLabelPoint, pointerClick } from '../helpers/pointer';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';

/**
 * 04 Modes — the Presenter view on THIS Mac (md-presenter, md-edge-offline). The second display is the soak (a
 * physical screen; a window placed on it); everything on this Mac's screen is driven here.
 *
 *   1  one display: the Present menu's presenter row is drawn greyed, "Needs a second display"; the REAL Rust guard
 *      (`present_audience_open`) refuses this window's own display with its own words and a display that is not
 *      connected with another — nothing opens
 *   2  a second display is REPORTED (the one native seam stubbed: `present_displays`, `present_audience_open`,
 *      `present_audience_close` on `window.__TAURI__.core.invoke`; every other command stays the real one): the row
 *      names it; Present from the selection puts the REAL PresenterView up — Now, Next, the order map, notes, the
 *      clocks, "Audience on <display>", End — and asks for the audience window on that display with the lock the
 *      follower root declares
 *   3  md-edge-offline, the half that does not need a hub: the clip's file is not on this Mac (the fixture's
 *      `assets/aaaa1111.mp4`) → the Now box says so, with Skip, and only presenter view does. The "Offline — kept on
 *      this Mac" line needs a hub-linked project (see presenter-model.js `presenterOffline`) and is pinned at model
 *      level + soaked.
 *   4  End closes the audience window and the view; Present ends back in Edit.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '../fixtures/project/.design/ui/VideoClipInspect.tsx');
const fixtures = createFixtureGuard('presenter-view', [FIXTURE]);

const tid = (id: string) => `[data-testid="${id}"]`;
const text = async (id: string) => (await $(tid(id))).getText() as Promise<string>;
const exists = (id: string) => $(tid(id)).isExisting();

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
const landsOn = (mode: string) =>
  browser.waitUntil(async () => (await pressed()).join() === mode, {
    timeout: 8000,
    interval: 100,
    timeoutMsg: `the switch never landed on ${mode}`,
  });

type Display = { id: string; name: string; primary: boolean; current: boolean };
const SECOND: Display = {
  id: 'e2e-second',
  name: 'E2E Second Display',
  primary: false,
  current: false,
};

describe('presenter-view (04 md-presenter, md-edge-offline)', () => {
  let realDisplays: Display[] = [];

  before(async () => {
    fixtures.snapshot();
    startReport('presenter-view');
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-videoclipinspect');
    await row.waitForExist({ timeout: 60_000 });
    await row.click();
    await waitForCanvasRects();
    await $(tid('canvas-frame')).waitForExist({ timeout: 15_000 });
    realDisplays = (await invokeTauri('present_displays')) as Display[];
  });
  after(async () => {
    // put the real invoke back for whatever runs next in this app
    await browser.execute(() => {
      const w = window as unknown as { __e2eRealTauri?: unknown; __TAURI__: unknown };
      if (w.__e2eRealTauri) w.__TAURI__ = w.__e2eRealTauri;
    });
    fixtures.restore();
  });

  it('one display: the presenter row is greyed, and the Rust guard refuses what it must', async () => {
    expect(realDisplays.length).toBeGreaterThan(0);
    const mine = realDisplays.find((d) => d.current);
    expect(mine).toBeDefined();
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-list')).waitForExist({ timeout: 4000 });
    if (realDisplays.length < 2) {
      expect(await $(tid('mode-present-presenter-view')).getAttribute('aria-disabled')).toBe(
        'true'
      );
      expect(await text('mode-present-presenter-view')).toContain('Needs a second display');
    }
    await capture('presenter row, one display');
    await chord('Escape', 'Escape');
    // the guard, on the real command: this window's own display is refused with the guard's own words …
    const refuse = (displayId: string) =>
      browser.executeAsync((id: string, done: (v: string) => void) => {
        const w = window as unknown as {
          __TAURI__: { core: { invoke: (c: string, a: unknown) => Promise<unknown> } };
        };
        w.__TAURI__.core
          .invoke('present_audience_open', {
            displayId: id,
            canvas: 'ui/VideoClipInspect.tsx',
            sid: 'abcdefgh1234',
            lock: 1,
          })
          .then(
            () => done('OPENED'),
            (e: unknown) => done(String(e))
          );
      }, displayId) as Promise<string>;
    expect(await refuse((mine as Display).id)).toBe(
      'Pick another display — this one shows your presenter view.'
    );
    // … and a display that is not connected gets its own
    expect(await refuse('not-a-display')).toBe("That display isn't connected any more.");
    expect(await invokeTauri('window_labels')).toBeDefined(); // nothing new opened: the shell still answers
  });

  it('a second display is reported: the row names it, Present puts the presenter view up and asks for the audience screen', async () => {
    // select the video artboard (its name strip), so Present from the selection has something to present
    await dismissNotices();
    const name = await artboardLabelPoint('reel');
    expect(name).not.toBeNull();
    await pointerClick((name as { x: number }).x, (name as { y: number }).y);
    await $('[data-testid="inspector-frame"][data-kind="artboard"]').waitForExist({
      timeout: 15_000,
      timeoutMsg: 'selecting the video drew no artboard inspector',
    });
    // the one native seam: a second display, and an audience window that records what it was asked
    const seam = (await browser.executeAsync(
      (second: Display, realList: Display[], done: (v: string) => void) => {
        try {
          const w = window as unknown as {
            __e2eAudience: { open: unknown[]; close: number };
            __TAURI__: { core: { invoke: (c: string, a?: unknown) => Promise<unknown> } };
          };
          // `__TAURI__.core` is frozen and `core.invoke` is bound to the internals at load, so the one seam is the
          // global itself: the client reads `window.__TAURI__` afresh on every call (client/github.js `tauri()`)
          const hold = window as unknown as {
            __e2eRealTauri?: typeof w.__TAURI__;
            __TAURI__: typeof w.__TAURI__;
          };
          hold.__e2eRealTauri ??= hold.__TAURI__;
          const realTauri = hold.__e2eRealTauri as typeof w.__TAURI__;
          const realCore = realTauri.core;
          w.__e2eAudience = { open: [], close: 0 };
          const stub = (cmd: string, args?: unknown, opts?: unknown) => {
            if (cmd === 'present_displays')
              return Promise.resolve([...realList.map((d) => ({ ...d })), second]);
            if (cmd === 'present_audience_open') {
              w.__e2eAudience.open.push(args);
              return Promise.resolve(null);
            }
            if (cmd === 'present_audience_close') {
              w.__e2eAudience.close += 1;
              return Promise.resolve(null);
            }
            return (realCore.invoke as (c: string, a?: unknown, o?: unknown) => Promise<unknown>)(
              cmd,
              args,
              opts
            );
          };
          const fake = { ...realTauri, core: { ...realCore, invoke: stub } };
          try {
            hold.__TAURI__ = fake;
          } catch {
            // frozen global: fall through to the check below
          }
          if (hold.__TAURI__ !== fake) {
            done('the __TAURI__ global cannot be replaced');
            return;
          }
          const core = hold.__TAURI__.core;
          window.dispatchEvent(new Event('focus')); // the display list is re-read on focus
          core.invoke('present_displays').then(
            (l) => done(`ok ${(l as unknown[]).length}`),
            (e) => done(`rejected ${String(e)}`)
          );
        } catch (e) {
          done(`threw ${String(e)}`);
        }
      },
      SECOND,
      realDisplays
    )) as string;
    expect(seam).toBe(`ok ${realDisplays.length + 1}`);
    await $(tid('mode-present-menu')).click();
    await $(tid('mode-present-list')).waitForExist({ timeout: 4000 });
    await browser.waitUntil(
      async () =>
        (await $(tid('mode-present-presenter-view')).getAttribute('aria-disabled')) !== 'true',
      {
        timeout: 6000,
        interval: 150,
        timeoutMsg: 'the presenter row stayed greyed with a second display reported',
      }
    );
    expect(await text('mode-present-presenter-view')).toContain(SECOND.name);
    await capture('presenter row, second display');
    await $(tid('mode-present-presenter-view')).click(); // turns the view on
    await chord('Enter', 'Enter', { altKey: true, metaKey: true }); // Present from the selection
    await $(tid('presenter-view')).waitForExist({ timeout: 12_000 });
    await landsOn('present');
    // 04 md-presenter: now, next, notes, the clock — and the order as the canvas itself
    expect(await text('presenter-now-label')).toMatch(/^Now · 1 of \d+ · /);
    expect(await exists('presenter-now')).toBe(true);
    expect(await text('presenter-elapsed')).toMatch(/^\d{1,2}:\d{2}$/);
    expect(await text('presenter-wall')).not.toBe('');
    expect(await exists('presenter-notes')).toBe(true);
    expect(await text('presenter-order-count')).not.toBe('');
    expect(await text('presenter-end')).toContain('End');
    // the audience window is asked for on THAT display, with the lock the follower root declares
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () =>
            (window as unknown as { __e2eAudience: { open: unknown[] } }).__e2eAudience.open.length
        )) > 0,
      {
        timeout: 10_000,
        interval: 200,
        timeoutMsg: 'the presenter view never asked for the audience screen',
      }
    );
    const asked = (await browser.execute(
      () => (window as unknown as { __e2eAudience: { open: unknown[] } }).__e2eAudience.open[0]
    )) as { displayId: string; canvas: string; sid: string; lock: number };
    expect(asked.displayId).toBe(SECOND.id);
    expect(asked.canvas).toContain('VideoClipInspect');
    expect(asked.sid).toMatch(/^[a-z0-9]{8,32}$/);
    expect(asked.lock).toBe(1);
    await browser.waitUntil(async () => (await text('presenter-audience')).includes(SECOND.name), {
      timeout: 8000,
      interval: 200,
      timeoutMsg: 'the audience line never named the display',
    });
    expect(await text('presenter-audience')).toBe(`Audience on ${SECOND.name}`);
    await capture('presenter view');
  });

  it('md-edge-offline: the clip that is not on this Mac says so in presenter view only, with Skip', async () => {
    // the fixture clip `assets/aaaa1111.mp4` is not among the project's assets
    await $(tid('presenter-clip-missing')).waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the Now box never said the clip is missing',
    });
    expect(await text('presenter-clip-missing')).toContain("Clip isn't on this Mac");
    expect(await exists('presenter-clip-skip')).toBe(true);
    await capture('presenter view, clip missing');
    // offline is the Share cluster's own rule: an unlinked project is "Local project" and has nothing to keep
    expect(await exists('presenter-offline')).toBe(false);
  });

  it('End closes the audience window and the view; Present ends back in Edit', async () => {
    await $(tid('presenter-end')).click();
    await landsOn('edit');
    expect(await exists('presenter-view')).toBe(false);
    const closes = await browser.execute(
      () => (window as unknown as { __e2eAudience: { close: number } }).__e2eAudience.close
    );
    expect(closes).toBeGreaterThan(0);
  });
});
