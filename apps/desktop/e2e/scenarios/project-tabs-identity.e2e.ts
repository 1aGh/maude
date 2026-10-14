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

  it('an in-tab switch A→B→A keeps each project’s identity', async () => {
    // Open once: B must not be open elsewhere, or the switch focuses that tab.
    await closeTab(tabB, tabA);
    await browser.waitUntil(async () => serverGone(SECONDARY), {
      timeout: GRACE_MS + 20_000,
      interval: 500,
      timeoutMsg: "the secondary's server outlived the close grace",
    });
    await focusTab(tabA);
    await invokeTauri('open_local_project', { path: SECONDARY }).catch(() => undefined);
    await waitForProfile(profileY, 'tab A on B');
    expect(await identityOfTab()).toEqual({ profile: profileY, signedIn: true, login: Y });
    await capture('4-a-switched-to-b');

    await invokeTauri('open_local_project', { path: PRIMARY }).catch(() => undefined);
    await waitForProfile('default', 'tab A back on A');
    expect(await identityOfTab()).toEqual({ profile: 'default', signedIn: true, login: X });
    await capture('4-a-back-on-a');
  });
});
