import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';
import { waitForCanvasRects } from '../helpers/canvas-frame';
import { capture, startReport } from '../helpers/evidence';
import { relaunchApp } from '../helpers/session';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 06 Advanced · ad-edge-remember — "An Advanced you open stays open — for that panel. Remembered per panel, on this
 * Mac. Never a mode: the other panels keep their own state."
 *
 *   1  Canvases › Advanced is folded on a clean Mac; opening it writes `fold["left.canvases"]` to THIS Mac's prefs file
 *   2  quit, start again: it is open without a click, on the same Mac — and the fold the person never opened
 *      (the AI panel's) is still folded: no mode
 *   3  another Mac (a different config home, no prefs file): the app starts with it folded — nothing is inherited
 *   4  back on this Mac's home: the choice is still there
 *
 * The inspector's own Advanced and Settings › Advanced › Reset ride the same store (client/v2/fold/); this drives the
 * panel that is on screen without a selection.
 */
const FOLD = 'left.canvases';
const tid = (s: string) => `[data-testid="${s}"]`;

const prefsPath = () => process.env.MAUDE_UI_PREFS_PATH as string;
const folds = (): Record<string, boolean> => {
  try {
    return (
      (JSON.parse(readFileSync(prefsPath(), 'utf8')) as { fold?: Record<string, boolean> }).fold ??
      {}
    );
  } catch {
    return {};
  }
};

async function canvasesAdvanced(): Promise<string | null> {
  const row = await $(tid('canvases-advanced'));
  await row.waitForExist({ timeout: 60_000, timeoutMsg: 'no Canvases › Advanced row' });
  return row.getAttribute('aria-expanded');
}

async function enterApp() {
  await pinCurrentWindow();
  await waitForSidecar();
  const row = await canvasRow('canvas-row-ui-smoke');
  await row.waitForExist({ timeout: 60_000 });
  await waitForCanvasRects().catch(() => undefined);
}

describe('remember-folds (06 ad-edge-remember)', () => {
  const thisMac = { xdg: process.env.XDG_CONFIG_HOME, prefs: process.env.MAUDE_UI_PREFS_PATH };

  before(async () => {
    startReport('remember-folds');
    expect(prefsPath()).toContain('maude-e2e-'); // never the person's own prefs
    await waitForSidecar();
    const row = await canvasRow('canvas-row-ui-smoke');
    await row.waitForExist({ timeout: 60_000 });
  });
  after(() => {
    process.env.XDG_CONFIG_HOME = thisMac.xdg;
    process.env.MAUDE_UI_PREFS_PATH = thisMac.prefs;
  });

  it('a clean Mac has it folded; opening it is written to this Mac’s prefs', async () => {
    expect(await canvasesAdvanced()).toBe('false');
    expect(folds()[FOLD]).not.toBe(true);
    await $(tid('canvases-advanced')).click();
    await browser.waitUntil(
      async () => (await $(tid('canvases-advanced')).getAttribute('aria-expanded')) === 'true',
      {
        timeout: 6_000,
        interval: 150,
      }
    );
    expect(await $(tid('canvases-advanced-fold')).getAttribute('data-open')).toBe('true');
    await browser.waitUntil(() => folds()[FOLD] === true, {
      timeout: 8_000,
      interval: 200,
      timeoutMsg: `prefs.json never recorded fold["${FOLD}"]`,
    });
    await capture('canvases advanced open');
  });

  it('after quit and start it is open without a click — and the panel nobody opened stays folded', async () => {
    const pids = await relaunchApp();
    expect(pids.after).not.toBe(pids.before);
    await enterApp();
    expect(await canvasesAdvanced()).toBe('true');
    expect(folds()).toEqual({ [FOLD]: true }); // only the one panel the person opened
    await capture('canvases advanced remembered');
  });

  it('another Mac does not inherit it', async () => {
    const other = mkdtempSync(join(tmpdir(), 'maude-e2e-othermac-'));
    process.env.XDG_CONFIG_HOME = other;
    process.env.MAUDE_UI_PREFS_PATH = join(other, 'maude', 'prefs.json');
    const pids = await relaunchApp();
    expect(pids.after).not.toBe(pids.before);
    await enterApp();
    expect(await canvasesAdvanced()).toBe('false');
    expect(existsSync(prefsPath()) ? folds()[FOLD] : undefined).not.toBe(true);
    await capture('other mac folded');
  });

  it('back on this Mac the choice is still there', async () => {
    process.env.XDG_CONFIG_HOME = thisMac.xdg;
    process.env.MAUDE_UI_PREFS_PATH = thisMac.prefs;
    await relaunchApp();
    await enterApp();
    expect(await canvasesAdvanced()).toBe('true');
    expect(folds()[FOLD]).toBe(true);
  });
});
