import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import {
  appPid,
  relaunchApp,
  savedSession,
  startApp,
  waitGone,
  waitSavedSession,
} from '../helpers/session';
import {
  activeTab,
  focusTab,
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
    // S1.22a (GAP-RELAUNCH-3): the front tab says what just happened, in the words of
    // `tabsRestoredWords` (client/shell-events.js; pinned at model level by shell-events.test.ts).
    // The shell sends `shell://tabs-restored {count}` to the active tab only, once, for two or more
    // tabs; the toast is a notification card in the TOP document.
    const reopened = '2 tabs reopened. Each one starts when you open it.';
    await browser.switchToWindow(tabB);
    await browser.waitUntil(
      async () =>
        browser.execute(
          (want: string) =>
            Array.from(document.querySelectorAll('[data-testid^="notice-"]')).some((el) =>
              (el.textContent ?? '').includes(want)
            ),
          reopened
        ),
      {
        timeout: 30_000,
        interval: 200,
        timeoutMsg: `no on-screen toast said "${reopened}" in the restored front tab`,
      }
    );
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

  // S11.16 (C37) — the crash leg. `<app data>/running.json` is written at launch and removed on
  // a clean quit (lifecycle.rs); a kill -9 leaves it, and the next launch tells each tab it
  // reopened — once — through `take_crash_notice` (`{kind: 'app://crashed', startedAt}`).
  // S11.17's callout may take it first on mount; then its words are the proof instead.
  const crashed = 'Maude quit unexpectedly.';

  /** Open B (it rests after a relaunch) and wait until its page is on its own server. */
  async function openB(): Promise<void> {
    await focusTab(tabB);
    await browser.waitUntil(async () => (await browser.getUrl()).startsWith('http://localhost:'), {
      timeout: 120_000,
      interval: 500,
      timeoutMsg: 'tab B never reached its server after the relaunch',
    });
  }

  const calloutSays = (want: string) =>
    browser.execute(
      (w: string) => (document.body?.textContent ?? '').includes(w),
      want
    ) as Promise<boolean>;

  it('4 · kill -9, relaunch: the reopened tab hears app://crashed once', async () => {
    const before = appPid();
    const started = runningMarker();
    expect(started?.pid).toBe(before);
    process.kill(before, 'SIGKILL');
    await waitGone(before, 30_000);
    // Nothing ran on the way out: the marker is still the killed run's.
    expect(runningMarker()?.pid).toBe(before);
    const after = await startApp();
    expect(after).not.toBe(before);
    await browser.waitUntil(async () => runningMarker()?.pid === after, {
      timeout: 30_000,
      timeoutMsg: 'the relaunch never marked its own run',
    });
    await openB();
    const notice = await invokeTauri<{ kind: string; startedAt: number | null } | null>(
      'take_crash_notice'
    );
    if (notice) {
      expect(notice.kind).toBe('app://crashed');
      expect(notice.startedAt).toBe(started?.startedAt ?? null);
    } else {
      // Taken by the page itself on mount (S11.17): its callout is on screen.
      await browser.waitUntil(() => calloutSays(crashed), {
        timeout: 15_000,
        timeoutMsg: `the reopened tab neither had a crash notice nor said "${crashed}"`,
      });
      // S11.17 (C37) — the one line, with the time of the last work when the project home knows it,
      // and Report a bug… opens the dialog (crash logs ticked when there are any; the consent step
      // itself is report-bug-dialog.e2e.ts).
      const line = await $('[data-testid="callout-crashed"]');
      expect(await line.getText()).toMatch(
        /Maude quit unexpectedly\. Your work (up to (\w{3} \d{1,2}, )?\d{2}:\d{2} )?is here\./
      );
      await (await $('[data-testid="callout-crashed-action"]')).click();
      const dialog = await $('[data-testid="report-bug-dialog"]');
      await dialog.waitForDisplayed({ timeout: 10_000 });
      await capture('relaunch-4-crash-report-bug');
      await browser.keys(['Escape']);
      if (await dialog.isDisplayed().catch(() => false))
        await (await $('[data-testid="report-bug-dialog"] .st-dialog-hd .st-iconbtn')).click();
    }
    // Once: a second ask (a reload) hears nothing.
    expect(await invokeTauri('take_crash_notice')).toBe(null);
    await capture('relaunch-4-after-kill-9');
  });

  it('5 · a clean quit (SIGTERM) leaves no marker and the next launch says nothing', async () => {
    const before = appPid();
    process.kill(before, 'SIGTERM');
    await waitGone(before, 30_000);
    expect(runningMarker()).toBe(null);
    const after = await startApp();
    expect(after).not.toBe(before);
    await openB();
    expect(await invokeTauri('take_crash_notice')).toBe(null);
    await browser.pause(2_000);
    expect(await calloutSays(crashed)).toBe(false);
    await capture('relaunch-5-after-clean-quit');
  });
});

/** `<app data>/running.json` of the e2e app (lifecycle.rs), or null when there is none. */
function runningMarker(): { pid: number; startedAt: number } | null {
  try {
    // The e2e app's data dir (the same folder helpers/session.ts reads app-state.json from).
    const dir = join(homedir(), 'Library', 'Application Support', 'com.maude.app.e2e');
    return JSON.parse(readFileSync(join(dir, 'running.json'), 'utf8'));
  } catch {
    return null;
  }
}
