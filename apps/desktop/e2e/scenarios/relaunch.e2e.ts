import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { relaunchApp, savedSession, waitSavedSession } from '../helpers/session';
import {
  activeTab,
  HOME,
  handles,
  labels,
  menuState,
  pinCurrentWindow,
  STRIP,
  strip,
  waitWindow,
} from '../helpers/windows';

/**
 * V2-3.9 T7 — a relaunch restores exactly the previous project tabs and the active one, and never
 * adds a tab (contract V2-3.7 §4; Michal's finding: "a relaunch added a Home tab that had not
 * been open"). Three launches against one kept app-state (wdio.relaunch.conf.ts):
 *   1. a first launch (empty app-state) is Home alone; open A then B from Home → saved [A, B], B;
 *   2. relaunch: A and B back in that order, B active and the only one that runs, no extra tab;
 *      then Show Home and close A → saved [B], Home;
 *   3. relaunch: B alone, resting, Home active — a one-tab session restores; it is not the
 *      pre-V2-3.9 "last project" fallback that opened in front.
 */
const A = process.env.MAUDE_E2E_PRIMARY_ROOT as string;
const B = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
type Opened = { label: string; opened: string };

/** On the app-local splash (a resting tab), never a server origin. */
async function onSplash(label: string): Promise<boolean> {
  await browser.switchToWindow(label);
  return /^tauri:\/\/localhost/.test(await browser.getUrl());
}

describe('relaunch (native-desktop)', () => {
  let tabA = '';
  let tabB = '';

  before(async () => {
    startReport('relaunch (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
  });

  it('1 · first launch: Home alone; open A then B from Home; saved [A, B] with B active', async () => {
    expect(await pinCurrentWindow()).toBe(HOME);
    expect(await handles()).toEqual([HOME, STRIP]);
    // An empty app-state: Home's own activation saves a session with no tab at all.
    expect(savedSession()?.tabs ?? []).toEqual([]);
    await browser.switchToWindow(HOME);
    const a = await invokeTauri<Opened>('open_project', { root: A });
    await waitWindow(a.label);
    await browser.switchToWindow(HOME);
    const b = await invokeTauri<Opened>('open_project', { root: B });
    await waitWindow(b.label);
    [tabA, tabB] = [a.label, b.label];
    expect([a.opened, b.opened]).toEqual(['new', 'new']);
    expect(await labels()).toEqual([tabA, tabB].sort());
    // The strip redraws on the shell's next (debounced) push.
    await browser.waitUntil(
      async () => {
        const s = await strip();
        return s.active === tabB && s.tabs.length === 2;
      },
      { timeout: 10_000, timeoutMsg: `strip ${JSON.stringify(await strip())}` }
    );
    expect((await strip()).tabs).toEqual([tabA, tabB]);
    await waitSavedSession({ tabs: [tabA, tabB], focused: tabB });
    await capture('relaunch-1-a-and-b');
  });

  it('2 · relaunch: exactly A and B, B active and running, A resting, no extra tab', async () => {
    const pids = await relaunchApp();
    console.log(`[relaunch] app ${pids.before} → ${pids.after}`);
    expect(pids.after).not.toBe(pids.before);
    // Home is activated first at boot, the restored active tab last.
    await browser.waitUntil(async () => (await activeTab()) === tabB, {
      timeout: 30_000,
      interval: 200,
      timeoutMsg: 'the saved active tab B is not the shown tab after the relaunch',
    });
    expect(await pinCurrentWindow()).toBe(tabB);
    expect(await handles()).toEqual([HOME, STRIP, tabA, tabB].sort());
    await browser.waitUntil(async () => (await strip()).tabs.length === 2, { timeout: 10_000 });
    const s = await strip();
    expect(s.tabs).toEqual([tabA, tabB]);
    expect(s.active).toBe(tabB);
    // Only the active tab spawns: B leaves its splash for its server, A stays on the splash.
    await browser.switchToWindow(tabB);
    await browser.waitUntil(async () => (await browser.getUrl()).startsWith('http://localhost:'), {
      timeout: 120_000,
      interval: 500,
      timeoutMsg: 'the restored active tab never reached its server',
    });
    expect(await onSplash(tabA)).toBe(true);
    expect(await browser.execute(() => document.hidden)).toBe(true);
    await capture('relaunch-2-restored');

    // Show Home, then close A: the session to relaunch is [B] with Home active.
    await browser.switchToWindow(tabB);
    expect((await menuState('show_home')).active).toBe(HOME);
    await invokeTauri('e2e_close_window', { label: tabA, destroy: false });
    await waitWindow(tabA, false);
    await browser.waitUntil(async () => (await strip()).tabs.length === 1, { timeout: 5_000 });
    expect((await strip()).tabs).toEqual([tabB]);
    await waitSavedSession({ tabs: [tabB], focused: HOME });
  });

  it('3 · relaunch: the one-tab session comes back resting, with Home active', async () => {
    const pids = await relaunchApp();
    expect(pids.after).not.toBe(pids.before);
    expect(await pinCurrentWindow()).toBe(HOME);
    expect(await handles()).toEqual([HOME, STRIP, tabB].sort());
    await browser.waitUntil(async () => (await strip()).tabs.length === 1, { timeout: 10_000 });
    const s = await strip();
    expect(s.tabs).toEqual([tabB]);
    expect(s.active).toBe(HOME);
    expect(await activeTab()).toBe(HOME);
    // B did not spawn: still on its splash after a settle.
    await browser.pause(2_000);
    expect(await onSplash(tabB)).toBe(true);
    await browser.switchToWindow(HOME);
    await capture('relaunch-3-home-active');
  });
});
