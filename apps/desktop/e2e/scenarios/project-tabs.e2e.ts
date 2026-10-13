import { release } from 'node:os';
import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import {
  closeTab,
  focusTab,
  labels,
  openTab,
  pinCurrentWindow,
  waitWindow,
} from '../helpers/windows';

/**
 * V2-3.2 — one window (native macOS tab) per open project, contract V2-1.1 §5.2.
 *
 * primary   = the github-backed clone the app boots into (branch `main`).
 * secondary = the offline make-git-fixture repo (branch `feat/nav-redesign`).
 *
 * Every animation- or layout-gated check runs only after `focusTab`: a background
 * tab is `document.hidden` with 0 rAF/s (e2e spike "Ceiling").
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
const tid = (s: string) => `[data-testid="${s}"]`;
/** Darwin 23 = macOS 14, where WKWebView gained per-window data stores. */
const DATA_STORES = process.platform === 'darwin' && Number(release().split('.')[0]) >= 23;
/** The shell's grace before a closed window's server stops (windows.rs CLOSE_GRACE). */
const GRACE_MS = 10_000;

async function triggerText(): Promise<string> {
  const t = await $(tid('repo-switcher-trigger'));
  await t.waitForDisplayed({ timeout: 120_000 });
  return t.getText();
}

async function waitBranch(branch: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      try {
        return (await triggerText()).includes(branch);
      } catch {
        return false; // stale element mid-navigation — keep polling
      }
    },
    { timeout: 120_000, interval: 500, timeoutMsg: `repo-switcher-trigger never showed ${branch}` }
  );
}

async function healthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/_health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('project-tabs (native-desktop)', () => {
  let tabA = '';
  let tabB = '';

  before(async () => {
    startReport('project-tabs (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    tabA = await pinCurrentWindow();
    console.log(`[tabs] boot window ${tabA}; handles ${JSON.stringify(await labels())}`);
    expect(tabA).toMatch(/^p-l[0-9a-f]{16}$/);
  });

  it('opens the secondary project in a second tab, on its own server', async () => {
    const opened = await openTab(SECONDARY);
    console.log(`[tabs] open_project → ${JSON.stringify(opened)}`);
    expect(opened.opened).toBe('new');
    tabB = opened.label;
    await waitWindow(tabB);
    expect(await labels()).toHaveLength(2);

    await focusTab(tabB);
    const urlB = await waitForSidecar();
    await focusTab(tabA);
    const urlA = await waitForSidecar();
    console.log(`[tabs] A ${urlA}  B ${urlB}`);
    expect(new URL(urlA).port).not.toBe(new URL(urlB).port);
    await capture('1-two-tabs-two-servers');
  });

  it('each tab shows its own project and branch', async () => {
    await focusTab(tabA);
    await waitBranch('main');
    await capture('2a-tab-a-main');
    await focusTab(tabB);
    await waitBranch('feat/nav-redesign');
    await capture('2b-tab-b-feature-branch');
  });

  it('keeps per-tab browser storage apart', async function () {
    if (!DATA_STORES) this.skip();
    await focusTab(tabA);
    await browser.execute(() => {
      localStorage.setItem('maude-e2e-tabs', 'A');
      // Cookies are NOT port-isolated (localhost:A and localhost:B share a jar
      // in one data store), so this is the probe that proves the stores differ.
      // biome-ignore lint/suspicious/noDocumentCookie: the port-agnostic jar IS the probe
      document.cookie = 'maude_e2e_tabs=A; path=/';
    });
    expect(await browser.execute(() => document.cookie)).toContain('maude_e2e_tabs=A');
    await focusTab(tabB);
    const seen = await browser.execute(() => ({
      ls: localStorage.getItem('maude-e2e-tabs'),
      cookie: document.cookie,
    }));
    console.log(`[tabs] B sees ${JSON.stringify(seen)}`);
    expect(seen.ls).toBeNull();
    expect(seen.cookie).not.toContain('maude_e2e_tabs=A');
  });

  it('opening the secondary again focuses its tab instead of opening a third', async () => {
    await focusTab(tabA);
    const again = await openTab(SECONDARY);
    console.log(`[tabs] open_project again → ${JSON.stringify(again)}`);
    expect(again).toEqual({ label: tabB, opened: 'existing' });
    expect(await labels()).toHaveLength(2);
    // The shell selected B's tab itself (no e2e_focus_window here).
    await browser.switchToWindow(tabB);
    await browser.waitUntil(async () => browser.execute(() => !document.hidden), {
      timeout: 5_000,
      interval: 50,
      timeoutMsg: 'open once did not bring the existing tab to the front',
    });
    await capture('4-open-once-focused-b');
  });

  it("closing tab B stops only B's server, after the grace", async () => {
    const a = readServerInfo(PRIMARY);
    const b = readServerInfo(SECONDARY);
    expect(await healthy(a.url)).toBe(true);
    expect(await healthy(b.url)).toBe(true);

    const closedAt = Date.now();
    await closeTab(tabB, tabA, true); // the user close path (CloseRequested → Destroyed)
    expect(await labels()).toEqual([tabA]);

    // Inside the grace B is still up (a reopen would be instant)…
    await browser.pause(2_000);
    expect(await healthy(b.url)).toBe(true);
    // …then it stops, while A keeps answering.
    await browser.waitUntil(async () => !(await healthy(b.url)), {
      timeout: GRACE_MS + 20_000,
      interval: 250,
      timeoutMsg: "B's server was still up long after the grace",
    });
    const stoppedAfter = Date.now() - closedAt;
    console.log(`[tabs] B stopped ${stoppedAfter} ms after the close`);
    expect(stoppedAfter).toBeGreaterThanOrEqual(GRACE_MS - 500);
    expect(await healthy(a.url)).toBe(true);
    await focusTab(tabA);
    await waitBranch('main');
    await capture('5-b-closed-a-still-live');
  });
});
