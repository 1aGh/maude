import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import {
  closeTab,
  focusTab,
  labels,
  openTab,
  pinCurrentWindow,
  strip,
  waitWindow,
} from '../helpers/windows';

/**
 * V2-3.5 + V2-3.8 — per-project identity across tabs (old plan T13 scenario 2),
 * "each project keeps its own sign-in" (Michal's finding), and the notification
 * click (contract V2-1.1 §5.2 "Notifications").
 *
 * primary   = the project the app boots into (profile `default`).
 * secondary = opened after primary signed in, so it follows that profile; it
 *             then signs in as another account and moves to its own profile.
 *
 * Sign-in goes through the REAL write path (`oauth::complete_github_sign_in`:
 * pick the profile, store the token, bind, restart the server) via the
 * debug-only `e2e_github_sign_in_as` seam, against the debug-only in-memory
 * keychain (`MAUDE_E2E_FAKE_KEYCHAIN`, wdio.tabs-identity.conf.ts) — only the
 * GitHub device flow itself is skipped. The profile registry lives in a
 * throwaway XDG_CONFIG_HOME.
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
/** windows.rs CLOSE_GRACE, plus headroom for the reap. */
const GRACE_MS = 10_000;
const X = 'e2e-x';
const Y = 'e2e-y';

/** The calling tab's profile id as its own server reports it (`''` while the
 *  page is reloading onto a restarted server). */
async function profileOfTab(): Promise<string> {
  return browser
    .execute(async () => {
      const res = await fetch('/_config');
      const cfg = (await res.json()) as { profile?: { id?: string } };
      return cfg.profile?.id ?? '';
    })
    .catch(() => '');
}

/** What the current tab is signed in as: its profile, whether the shell finds a
 *  token for it, and the GitHub login recorded on that profile. */
async function identityOfTab(): Promise<{ profile: string; signedIn: boolean; login: string }> {
  const profile = await profileOfTab();
  const signedIn = await invokeTauri<boolean>('github_is_signed_in');
  const all = await invokeTauri<Array<{ id: string; githubLogin?: string }>>('profiles_list');
  return { profile, signedIn, login: all.find((p) => p.id === profile)?.githubLogin ?? '' };
}

async function waitForProfile(id: string, what: string): Promise<void> {
  await browser.waitUntil(async () => (await profileOfTab()) === id, {
    timeout: 60_000,
    interval: 500,
    timeoutMsg: `${what} never reported profile ${id}`,
  });
}

/** `open_local_project` from the calling tab, with the refusal handed back instead of thrown. */
async function openLocalProject(path: string): Promise<{ ok: boolean; error: string }> {
  return browser.executeAsync((p: string, done: (r: { ok: boolean; error: string }) => void) => {
    // biome-ignore lint/suspicious/noExplicitAny: __TAURI__ is an injected global
    const tauri = (window as any).__TAURI__;
    tauri.core.invoke('open_local_project', { path: p }).then(
      () => done({ ok: true, error: '' }),
      (e: unknown) => done({ ok: false, error: String(e) })
    );
  }, path) as Promise<{ ok: boolean; error: string }>;
}

function serverGone(root: string): boolean {
  try {
    readServerInfo(root);
    return false;
  } catch {
    return true;
  }
}

/** Is `label` the selected, visible tab? Read without focusing it. */
async function visible(label: string): Promise<boolean> {
  await browser.switchToWindow(label);
  return browser.execute(() => !document.hidden).catch(() => false);
}

describe('project-tabs-identity (native-desktop)', () => {
  let tabA = '';
  let tabB = '';
  let profileY = '';

  before(async () => {
    startReport('project-tabs-identity (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    tabA = await pinCurrentWindow();
    console.log(`[identity] boot window ${tabA}; handles ${JSON.stringify(await labels())}`);
  });

  it('A signs in as X; B, never signed in, follows the most recent profile', async () => {
    expect(await profileOfTab()).toBe('default');
    expect(await invokeTauri<boolean>('github_is_signed_in')).toBe(false);
    // A first sign-in stays on the project's own profile — no profile made.
    expect(await invokeTauri<string>('e2e_github_sign_in_as', { login: X })).toBe('default');
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });

    const opened = await openTab(SECONDARY);
    tabB = opened.label;
    await waitWindow(tabB);
    await focusTab(tabB);
    await waitForSidecar();
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });
    await capture('1-b-follows-x');
  });

  it('B signs in as Y: B moves to its own profile, A still reports X', async () => {
    await focusTab(tabB);
    profileY = await invokeTauri<string>('e2e_github_sign_in_as', { login: Y });
    expect(profileY).not.toBe('default');
    // B's server restarts onto the new profile and its page reloads on it.
    await waitForProfile(profileY, 'tab B');
    expect(await identityOfTab()).toEqual({ profile: profileY, signedIn: true, login: Y });
    await capture('2-b-on-y');

    await focusTab(tabA);
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });
    await capture('2-a-still-x');
  });

  // V2-3.9 T6 (contract V2-3.7 §6): the activity poller's dot, set before the notification
  // cooldown. The fixture has no agent to finish a turn, so `e2e_ai_transition` runs the dot
  // half of one poll tick (notify.rs); activation clears it.
  it('a background tab whose AI finishes gets the dot; activating it clears the dot', async () => {
    await focusTab(tabA);
    expect((await strip()).dots).toEqual({});
    // The active tab never takes a dot.
    expect(
      await invokeTauri<boolean>('e2e_ai_transition', { root: PRIMARY, state: 'finished' })
    ).toBe(false);
    expect(
      await invokeTauri<boolean>('e2e_ai_transition', { root: SECONDARY, state: 'finished' })
    ).toBe(true);
    await browser.waitUntil(async () => (await strip()).dots[tabB] === 'done', {
      timeout: 5_000,
      timeoutMsg: `no done dot on ${tabB}: ${JSON.stringify((await strip()).dots)}`,
    });
    await invokeTauri('e2e_ai_transition', { root: SECONDARY, state: 'awaiting-input' });
    await browser.waitUntil(async () => (await strip()).dots[tabB] === 'needs-you', {
      timeout: 5_000,
    });
    expect((await strip()).dots[tabA]).toBeUndefined();
    await capture('2b-dot-on-background-b');
    await focusTab(tabB);
    await browser.waitUntil(async () => (await strip()).dots[tabB] === undefined, {
      timeout: 5_000,
      timeoutMsg: 'activating B did not clear its dot',
    });
    expect((await strip()).dots).toEqual({});
  });

  it('a notification click focuses that project’s tab', async () => {
    await focusTab(tabA);
    expect(await visible(tabB)).toBe(false);
    // Native notifications are not DOM-reachable: invoke the click handler the
    // OS callback calls (notify::on_click), from tab A, naming project B.
    await browser.switchToWindow(tabA);
    await invokeTauri('e2e_notification_click', { root: SECONDARY });
    await browser.waitUntil(async () => visible(tabB), {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: "the click did not bring project B's tab to the front",
    });
    expect(await visible(tabA)).toBe(false);
    await focusTab(tabB);
    await capture('3-click-focused-b');
    // And back: a click for A focuses A.
    await invokeTauri('e2e_notification_click', { root: PRIMARY });
    await browser.waitUntil(async () => visible(tabA), {
      timeout: 5_000,
      interval: 100,
      timeoutMsg: "the click did not bring project A's tab to the front",
    });
  });

  // S1.22b / V2-3.6 M3 (`windows::in_tab_open_rule`, `home::tab_may_open`): an in-tab switch keeps the tab on ITS
  // account — a project another profile owns is refused ("That project isn't one this tab can open."), never
  // adopted by the tab that asks. B belongs to profile Y since its sign-in (step 2), so A (default) cannot switch
  // onto it; B comes back in a tab of its own, still on Y.
  it('an in-tab switch never moves a tab onto another account’s project; B reopens on its own', async () => {
    // Open once: B must not be open elsewhere, or the switch would focus that tab instead of being refused.
    await closeTab(tabB, tabA);
    await browser.waitUntil(async () => serverGone(SECONDARY), {
      timeout: GRACE_MS + 20_000,
      interval: 500,
      timeoutMsg: "the secondary's server outlived the close grace",
    });
    await focusTab(tabA);
    const refused = await openLocalProject(SECONDARY);
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('one this tab can open');
    // A did not move: same profile, same server, same sign-in
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });
    expect(serverGone(SECONDARY)).toBe(true);
    await capture('4-a-refused-b');

    // B opened on its own keeps what it signed in as
    tabB = (await openTab(SECONDARY)).label;
    await waitWindow(tabB);
    await focusTab(tabB);
    await waitForSidecar();
    await waitForProfile(profileY, 'tab B reopened');
    expect(await identityOfTab()).toEqual({ profile: profileY, signedIn: true, login: Y });
    await capture('4-b-reopened-on-y');

    // and A, which never moved, is still on X
    await focusTab(tabA);
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });
    await capture('4-a-still-on-a');
  });
});
