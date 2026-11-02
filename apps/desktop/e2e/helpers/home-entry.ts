import { $, browser, expect } from '@wdio/globals';

import { isNativeShell } from './native';
import { waitForSidecar } from './sidecar';
import { activeTab, HOME, labels, pinCurrentWindow, waitWindow } from './windows';

/**
 * S6.15 — the ways INTO a project from the first-run state, through Home (the v1 first-run wizard and its
 * `ob-door-*` doors are retired; every door has a home — see nothing-deleted.json). Shared by the lanes
 * that start on a clean profile: team-hub entry (selfhost-entry, s20-deployment) and cloud sign-in entry
 * (cloud-entry). team-project.e2e.ts keeps its own legs 1h–3h because it asserts between the steps.
 */
const tid = (s: string) => `[data-testid="${s}"]`;

/** Focus the pinned Home tab and wait for the sign-in card (a clean profile shows it). */
export async function focusHome(): Promise<void> {
  await waitWindow(HOME);
  await browser.switchToWindow(HOME);
  await (
    browser as unknown as { tauri?: { switchWindow(l: string): Promise<unknown> } }
  ).tauri?.switchWindow(HOME);
  expect(await isNativeShell()).toBe(true);
  await (await $(tid('signin-card'))).waitForDisplayed({ timeout: 180_000 });
}

/** After a click on Home that opens a project: switch to the one new tab and wait for its studio. */
export async function followNewTab(before: string[], timeout = 60_000): Promise<string> {
  await browser.waitUntil(async () => (await labels()).length === before.length + 1, {
    timeout,
    interval: 250,
    timeoutMsg: 'no project tab opened from Home',
  });
  const created = (await labels()).find((l) => !before.includes(l)) as string;
  await browser.waitUntil(async () => (await activeTab()) === created, { timeout: 15_000 });
  await browser.switchToWindow(created);
  await pinCurrentWindow();
  await waitForSidecar();
  return created;
}

/**
 * Home → Advanced options → Use a self-hosted hub → address, email, password → Connect. Returns the new
 * project tab's label (already switched to and pinned). Does not wait for canvases: the caller names what
 * it expects (and handles a first-sync consent, which sits in the project's own window).
 */
export async function connectHubFromHome(creds: {
  hub: string;
  email: string;
  password: string;
}): Promise<string> {
  await focusHome();
  const before = await labels();
  await (await $(tid('signin-advanced'))).click();
  const row = await $(tid('signin-adv-hub'));
  await row.waitForDisplayed({ timeout: 5_000 });
  await row.click();
  await (await $(tid('onb-hub'))).waitForDisplayed({ timeout: 10_000 });
  await (await $(tid('onb-hub-url'))).setValue(creds.hub);
  await (await $(tid('onb-hub-email'))).setValue(creds.email);
  await (await $(tid('onb-hub-password'))).setValue(creds.password);
  await (await $(tid('onb-hub-go'))).click();
  return followNewTab(before);
}
