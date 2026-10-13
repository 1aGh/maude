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
 * V2-3.5 — per-project identity across tabs (old plan T13 scenario 2) and the
 * notification click (contract V2-1.1 §5.2 "Notifications").
 *
 * primary   = the project the app boots into (profile `default`).
 * secondary = bound to a fresh profile `e2e-b`, then reopened so its server
 *             starts on that profile (env is never hot-swapped).
 *
 * wdio.tabs-identity.conf.ts stubs the sign-in state per profile
 * (`MAUDE_E2E_GITHUB_SIGNED_IN_PROFILES=default`, debug builds only) and points
 * the profile registry at a throwaway XDG_CONFIG_HOME.
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SECONDARY = process.env.MAUDE_E2E_SECONDARY_ROOT as string;
/** windows.rs CLOSE_GRACE, plus headroom for the reap. */
const GRACE_MS = 10_000;

async function profileOfTab(): Promise<string> {
  return browser.execute(async () => {
    const res = await fetch('/_config');
    const cfg = (await res.json()) as { profile?: { id?: string } };
    return cfg.profile?.id ?? '';
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
  let profileB = '';

  before(async () => {
    startReport('project-tabs-identity (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    tabA = await pinCurrentWindow();
    console.log(`[identity] boot window ${tabA}; handles ${JSON.stringify(await labels())}`);
  });

  it('binds the secondary project to profile e2e-b; reopened, each tab runs on its own', async () => {
    const created = await invokeTauri<{ id: string }>('profiles_create', { label: 'e2e-b' });
    profileB = created.id;
    expect(profileB).toBe('e2e-b');

    const opened = await openTab(SECONDARY);
    tabB = opened.label;
    await waitWindow(tabB);
    await focusTab(tabB);
    await waitForSidecar();
    expect(await profileOfTab()).toBe('default');

    await focusTab(tabA);
    await invokeTauri('e2e_bind_profile', { root: SECONDARY, profile: profileB });
    // Reopen: close B, let the grace stop its server, open it again — the new
    // server is spawned with the bound profile's env.
    await closeTab(tabB, tabA);
    await browser.waitUntil(async () => serverGone(SECONDARY), {
      timeout: GRACE_MS + 20_000,
      interval: 500,
      timeoutMsg: "the secondary's server outlived the close grace",
    });
    const reopened = await openTab(SECONDARY);
    tabB = reopened.label;
    await waitWindow(tabB);
    await focusTab(tabB);
    await waitForSidecar();
    await browser.waitUntil(async () => (await profileOfTab()) === profileB, {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `tab B never reported profile ${profileB}`,
    });
    await capture('1-tab-b-on-e2e-b');
    await focusTab(tabA);
    expect(await profileOfTab()).toBe('default');
    await capture('1-tab-a-on-default');
  });

  it('sign-in state follows each tab’s profile', async () => {
    await focusTab(tabA);
    expect(await invokeTauri<boolean>('github_is_signed_in')).toBe(true);
    await focusTab(tabB);
    expect(await invokeTauri<boolean>('github_is_signed_in')).toBe(false);
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

  after(async () => {
    if (!profileB || !tabA) return;
    await focusTab(tabA).catch(() => undefined);
    // The registry is a throwaway XDG dir; deleting is tidy, not load-bearing
    // (it refuses while a project is still bound to the profile).
    await invokeTauri('profiles_delete', { id: profileB }).catch(() => undefined);
  });
});
