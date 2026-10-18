import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, browser, expect } from '@wdio/globals';

import { currentBranch } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import {
  activeTab,
  focusTab,
  handles,
  labels,
  menuState,
  openTab,
  pinCurrentWindow,
  STRIP,
  strip,
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
/** wdio.tabs.conf.ts runs the app with MAUDE_E2E_RUNNING_CAP=2 (V2-3.2 part b). */
const RESTING_LINE = 'Opens when you come back to it.';

/** A third project: the same minimal `.design/` the shell scaffolds (lib.rs). */
function makeThirdProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-third-'));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  mkdirSync(join(dir, '.design', 'system'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name: 'third', designRoot: '.design', designSystems: [] }, null, 2)
  );
  return dir;
}

/** What a tab's document shows, read WITHOUT focusing it (a WebDriver switch only). */
async function splashOf(label: string): Promise<{ name: string; status: string; url: string }> {
  await browser.switchToWindow(label);
  return browser
    .execute(() => ({
      name: document.querySelector('[data-testid="splash-name"]')?.textContent ?? '',
      status: document.querySelector('[data-testid="splash-status"]')?.textContent ?? '',
      url: location.href,
    }))
    .catch(() => ({ name: '', status: '', url: '' }));
}

/**
 * Wait until one of `candidates` shows the resting splash; returns it. WHICH tab
 * rests follows the shell's focus bookkeeping, and under WebDriver the app is often
 * not the active app (a SecurityAgent prompt was frontmost in every run), so native
 * focus events are not reliable enough to name the victim here — the LRU order is
 * pinned by `cargo test sidecar::rest_policy`. This asserts the observable rule:
 * over the cap, a non-focused idle tab rests and shows its name + the resting line.
 */
async function waitAnyResting(
  candidates: string[]
): Promise<{ label: string; name: string; url: string }> {
  let hit: { label: string; name: string; url: string } | null = null;
  await browser.waitUntil(
    async () => {
      for (const label of candidates) {
        const seen = await splashOf(label);
        if (seen.status === RESTING_LINE) {
          hit = { label, name: seen.name, url: seen.url };
          return true;
        }
      }
      return false;
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `none of ${candidates} showed the resting splash`,
    }
  );
  console.log(`[tabs] resting: ${JSON.stringify(hit)}`);
  return hit as unknown as { label: string; name: string; url: string };
}

/** The branch HEAD is on — Version history › Advanced › Branch (S11.10); the dock names the project only. */
async function triggerText(): Promise<string> {
  const t = await $(tid('repo-switcher-trigger'));
  await t.waitForDisplayed({ timeout: 120_000 });
  return currentBranch();
}

async function waitBranch(branch: string): Promise<void> {
  try {
    await waitBranchOnce(branch);
  } catch (error) {
    // Say what the window WAS showing — a bare "never showed" can't tell a
    // wrong page from a hidden tab from a dangling handle.
    const state = await browser
      .execute(() => ({
        url: location.href,
        title: document.title,
        hidden: document.hidden,
        testids: document.querySelectorAll('[data-testid]').length,
        text: document.body?.innerText.slice(0, 200) ?? '',
      }))
      .catch((e: unknown) => ({ error: String(e) }));
    console.log(
      `[tabs] waitBranch(${branch}) failed in ${await browser.getWindowHandle()}: ${JSON.stringify(state)}`
    );
    await capture(`fail-wait-${branch.replace(/\W+/g, '-')}`).catch(() => undefined);
    throw error;
  }
}

async function waitBranchOnce(branch: string): Promise<void> {
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

  // V2-3.7 T3: the strip is Maude's own tab bar — Rust's tab list. S1.22c (decision
  // maude/v2-lead-home-tab-first, CONTRACT §1/§6 amended 2026-10-14): Home is pinned FIRST.
  it('the strip lists the tabs in open order, Home pinned icon-only, and switches on a click', async () => {
    expect(await handles()).toEqual([tabA, tabB, 'home', STRIP].sort());
    await browser.waitUntil(async () => (await strip()).tabs.length === 2, { timeout: 10_000 });
    const s = await strip();
    expect(s.tabs).toEqual([tabA, tabB]);
    expect(s.order).toEqual(['home', tabA, tabB]);
    expect(s.home).toEqual({ label: 'Home', text: '' });
    expect(s.active).toBe(tabA);
    // A click on B's tab in the strip makes B the shown tab, and only B.
    await browser.switchToWindow(STRIP);
    await (await $(`[data-testid="tab-${tabB}"]`)).click();
    await browser.waitUntil(async () => (await activeTab()) === tabB, {
      timeout: 5_000,
      timeoutMsg: 'a strip click did not activate B',
    });
    // The strip redraws on the shell's next (debounced) push.
    await browser.waitUntil(async () => (await strip()).active === tabB, { timeout: 5_000 });
    await browser.switchToWindow(tabA);
    expect(await browser.execute(() => document.hidden)).toBe(true);
    await focusTab(tabA);
    await browser.waitUntil(async () => (await strip()).active === tabA, { timeout: 5_000 });
    await capture('1b-strip');
  });

  // V2-3.7 contract §10 q6: children are re-laid-out on a resize and in fullscreen.
  it('the shell re-lays-out the strip and every tab on resize and in fullscreen', async () => {
    type Bounds = {
      inner: [number, number];
      fullscreen: boolean;
      children: Record<string, number[]>;
    };
    const at = (args: Record<string, unknown>) => invokeTauri<Bounds>('e2e_shell_bounds', args);
    const near = (got: number[], want: number[], what: string) =>
      got.forEach((v, i) => {
        if (Math.abs(v - (want[i] as number)) > 1)
          throw new Error(`${what}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      });
    const check = (r: Bounds, when: string) => {
      const [w, h] = r.inner;
      expect(Object.keys(r.children).sort()).toEqual([tabA, tabB, 'home', STRIP].sort());
      for (const [l, b] of Object.entries(r.children))
        near(b, l === STRIP ? [0, 0, w, 38] : [0, 38, w, h - 38], `${when} ${l}`);
    };
    const before = await at({});
    console.log(`[tabs] shell ${JSON.stringify(before)}`);
    check(before, 'boot');
    check(await at({ size: [1100, 760] }), 'resized');
    const fs = await at({ fullscreen: true });
    expect(fs.fullscreen).toBe(true);
    check(fs, 'fullscreen');
    const back = await at({ fullscreen: false });
    expect(back.fullscreen).toBe(false);
    check(back, 'left fullscreen');
    check(await at({ size: before.inner }), 'restored');
    await focusTab(tabA);
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

  // S1.5 (11 · pn-k-across): ⌘K in tab A reaches B's canvases through the shell, and ↵ on one of
  // B's rows switches to B's tab (open once) — ids only, scoped to index_scope(A).
  it('⌘K across projects: A finds B, and ↵ on B’s row switches to B’s tab, never a third', async () => {
    await focusTab(tabA);
    const pidA = tabA.slice(2);
    const pidB = tabB.slice(2);
    const found = await invokeTauri<{
      groups: { pid: string; place: string; rows: { key: string }[] }[];
    }>('index_search', { q: 'a', limit: 50 }).catch((e: unknown) => ({
      groups: [],
      error: String(e),
    }));
    console.log(`[tabs] index_search from A → ${JSON.stringify(found).slice(0, 400)}`);
    expect(found.groups.some((g) => g.pid === pidA)).toBe(false); // never the caller's own
    const b = found.groups.find((g) => g.pid === pidB);
    if (b) expect(b.place).toBe('tab');
    const canvas = b?.rows[0]?.key.split('#')[0] ?? 'ui/does-not-matter.tsx';
    const opened = await invokeTauri('open_search_result', { pid: pidB, canvas, artboard: null });
    console.log(`[tabs] open_search_result → ${JSON.stringify(opened)}`);
    expect(opened).toEqual({ label: tabB, opened: 'existing' });
    expect(await labels()).toHaveLength(2);
    expect(await activeTab()).toBe(tabB);
    await capture('4b-search-across-switched-to-b');
    // Its own project, and a pid outside its scope, are refused.
    await focusTab(tabA);
    for (const pid of [pidA, `l${'0'.repeat(16)}`]) {
      const refused = await invokeTauri('open_search_result', { pid, canvas, artboard: null }).then(
        () => 'opened',
        (e: unknown) => String(e)
      );
      expect(refused).not.toBe('opened');
    }
    expect(await activeTab()).toBe(tabA);
  });

  // V2-3.9 T5: the Window menu's tab items (⌘1…⌘8 / ⌘9 since V2-3.11, ⌃Tab / ⌃⇧Tab) walk the strip
  // from Home (the first slot, S1.22c) through the tabs, wrapping; ⌘1 is the first PROJECT tab.
  it('the tab menu jumps to tab 1 and the last tab, and Next / Previous wrap through Home', async () => {
    await focusTab(tabB);
    expect((await menuState('select_tab_1')).active).toBe(tabA);
    expect(await activeTab()).toBe(tabA);
    expect((await menuState('select_tab_last')).active).toBe(tabB);
    expect(await activeTab()).toBe(tabB);
    expect((await menuState('next_tab')).active).toBe('home');
    expect((await menuState('next_tab')).active).toBe(tabA);
    expect((await menuState('prev_tab')).active).toBe('home');
    expect((await menuState('prev_tab')).active).toBe(tabB);
    expect((await strip()).active).toBe(tabB);
    expect(await activeTab()).toBe(tabB);
  });

  it("⌘W (Close Tab) closes the active tab B; B's server stops only after the grace", async () => {
    const a = readServerInfo(PRIMARY);
    const b = readServerInfo(SECONDARY);
    expect(await healthy(a.url)).toBe(true);
    expect(await healthy(b.url)).toBe(true);

    await focusTab(tabB);
    const closedAt = Date.now();
    // File ▸ Close Tab: the user close path of the ACTIVE tab (the strip's ×, guard first).
    // Asked from A's (hidden) page: the call must outlive the tab it closes.
    await browser.switchToWindow(tabA);
    await menuState('close_tab');
    await waitWindow(tabB, false);
    await browser.switchToWindow(tabA);
    expect(await labels()).toEqual([tabA]);
    await browser.waitUntil(async () => (await strip()).tabs.length === 1, { timeout: 5_000 });
    expect((await strip()).tabs).toEqual([tabA]);

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

  // ── V2-3.2 part b: running cap (2 here) + resting tabs ─────────────────────
  // By pid, not URL: the port a rested server frees is taken by the next server
  // that binds (the third project boots while the rest happens), so its URL
  // answering again proves nothing.
  const pids: Record<string, number> = {};
  const branchOf: Record<string, string> = {};
  let rested = '';

  it('a third running project rests an idle tab: server gone, resting splash', async () => {
    await focusTab(tabA);
    pids[tabA] = readServerInfo(PRIMARY).pid;
    branchOf[tabA] = 'main';
    const b = await openTab(SECONDARY);
    const tabB2 = b.label;
    await waitWindow(tabB2);
    await focusTab(tabB2);
    await waitBranch('feat/nav-redesign');
    pids[tabB2] = readServerInfo(SECONDARY).pid;
    branchOf[tabB2] = 'feat/nav-redesign';

    const c = await openTab(makeThirdProject());
    expect(c.opened).toBe('new');
    await waitWindow(c.label);
    expect(await labels()).toHaveLength(3);

    const hit = await waitAnyResting([tabA, tabB2]);
    rested = hit.label;
    expect(hit.url).toContain('index.html');
    expect(hit.name.length).toBeGreaterThan(0);
    expect(hit.name).not.toBe('Maude'); // the project's name, not the app's
    await browser.waitUntil(async () => !alive(pids[rested] as number), {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: "the rested tab's server process was still running",
    });
    const other = rested === tabA ? tabB2 : tabA;
    expect(alive(pids[other] as number)).toBe(true);
    await capture('6-resting-splash');
  });

  it('focusing the resting tab wakes it, and the cap rests another', async () => {
    await focusTab(rested);
    await waitBranch(branchOf[rested] as string);
    await capture('7-woken');
    const others = (await labels()).filter((l) => l !== rested);
    const next = await waitAnyResting(others);
    expect(next.label).not.toBe(rested);
    await focusTab(rested);
    await waitBranch(branchOf[rested] as string);
  });

  it('the strip’s × closes a background tab; the active tab stays', async () => {
    const before = (await strip()).tabs;
    expect(before).toHaveLength(3);
    const victim = before.find((l) => l !== rested) as string;
    await browser.switchToWindow(STRIP);
    await (await $(`[data-testid="tab-close-${victim}"]`)).click();
    await waitWindow(victim, false, 15_000);
    await browser.switchToWindow(rested);
    // The strip redraws on the shell's next push (debounced).
    await browser.waitUntil(async () => (await strip()).tabs.length === before.length - 1, {
      timeout: 5_000,
      timeoutMsg: 'the strip still lists the closed tab',
    });
    expect((await strip()).tabs).toEqual(before.filter((l) => l !== victim));
    expect(await activeTab()).toBe(rested);
    await capture('8-strip-close');
  });
});
