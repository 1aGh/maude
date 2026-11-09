import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import {
  appShot,
  canvasSource,
  chipState,
  closeAccountMenu,
  openAccountMenu,
  PRE_CONSENT_FIX,
  signInNotices,
  storedSignIn,
  tid,
  waitConn,
  world,
} from '../helpers/accounts';
import { startReport } from '../helpers/evidence';
import {
  capturedSignInUrl,
  captureTeamServerSignIn,
  signInOnHubPage,
} from '../helpers/hub-signin-page';
import { waitForSidecar } from '../helpers/sidecar';
import { closeTab, focusTab, openTab, pinCurrentWindow } from '../helpers/windows';

/**
 * 2.1.1 T2 (canvas 17 · ac-states / ac-toast / ac-menu-broken) — a sign-in the person repairs in one click.
 *
 *   A · MISSING: the folder names a team server and this Mac holds no sign-in for it. One toast says so, once per
 *       session (a reload in the same session does not repeat it); the account chip carries the broken-link
 *       badge; the account menu's project block is red with "Sign in" and the linked address. Signing in (the
 *       server's own page, the browser hop played by this process) clears all three.
 *   B · REJECTED: the server stops accepting the sign-in this Mac holds (the server's admin disables the account,
 *       so its token answers 401). The toast comes again — a new state is told once too — with "Sign in again";
 *       the badge and the menu say the same. The admin lets the account back in, the person signs in again from
 *       the toast, and the badge clears.
 *
 * Run in wdio.accounts.conf.ts (a loopback hub with password accounts; never a real server).
 */
const W = world('broken-signin.e2e.ts');

async function admin(path: 'disable' | 'enable'): Promise<number> {
  const r = await fetch(`${W.me.hub}/admin/api/users/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${W.adminSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: W.email }),
  });
  return r.status;
}

async function waitNotice(state: string, timeout = 30_000): Promise<{ id: string; text: string }> {
  let seen: { id: string; text: string }[] = [];
  await browser.waitUntil(
    async () => {
      seen = await signInNotices();
      return seen.some((n) => n.id === `notice-signin-${state}`);
    },
    { timeout, interval: 300, timeoutMsg: `no ${state} toast — notices ${JSON.stringify(seen)}` }
  );
  return seen.find((n) => n.id === `notice-signin-${state}`) as { id: string; text: string };
}

async function pressNoticeAction(state: string): Promise<void> {
  const btn = await $(`[data-testid="notice-signin-${state}"] .maude-notice-action`);
  await btn.waitForDisplayed({ timeout: 5_000 });
  await btn.click();
}

describe('broken-signin — the toast once, the broken-link badge, Sign in (again) with the address', () => {
  before(async () => {
    startReport('broken-signin (native-desktop)');
    await waitForSidecar();
    await pinCurrentWindow();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
  });

  it('A1 · a missing sign-in: one toast with Sign in, the broken-link badge', async () => {
    expect(storedSignIn(W.me.hubs, W.me.hub)).toBe(false);
    await waitConn(['signin-missing']);
    const toast = await waitNotice('signin-missing');
    expect(toast.text).toMatch(/Sign in/);
    expect(toast.text).not.toMatch(/Sign in again/);
    expect((await signInNotices()).length).toBe(1);
    await appShot('toast-signin-missing');
    const chip = await chipState();
    expect(chip?.badge).toBe('broken');
    expect(chip?.kind).toBe('server');
  });

  it('A2 · the account menu: the project block is red, Sign in, and the linked address', async () => {
    await openAccountMenu();
    expect(await (await $(tid('account-menu-project'))).getAttribute('data-bad')).toBeTruthy();
    const fix = await $(tid('account-menu-fix'));
    expect(await fix.getText()).toMatch(/^Sign in/);
    expect(await fix.getText()).not.toMatch(/again/);
    expect(await (await $(tid('account-menu-fix-address'))).getText()).toContain(
      new URL(W.me.hub).host
    );
    await appShot('account-menu-broken-missing');
    await closeAccountMenu();
    await appShot('account-chip-broken');
  });

  it('A3 · told once: a reload in the same session shows the badge and no second toast', async () => {
    await browser.refresh();
    await waitForSidecar();
    await waitConn(['signin-missing']);
    await browser.pause(6_000);
    expect(await signInNotices()).toEqual([]);
    expect((await chipState())?.badge).toBe('broken');
  });

  it('A4 · Sign in from the menu: the server’s page, the hop back, and the badge clears', async () => {
    await captureTeamServerSignIn();
    await openAccountMenu();
    await (await $(tid('account-menu-fix'))).click();
    let page = '';
    await browser.waitUntil(
      async () => {
        page = await capturedSignInUrl().catch(() => '');
        return !!page;
      },
      { timeout: 15_000, timeoutMsg: 'Sign in never asked for the server’s page' }
    );
    expect(new URL(page).origin).toBe(W.me.hub);
    await signInOnHubPage(page, W.email, W.password);
    await browser.waitUntil(async () => storedSignIn(W.me.hubs, W.me.hub), {
      timeout: 15_000,
      timeoutMsg: 'no sign-in stored after the hop back',
    });
    await waitConn(['connected', 'syncing'], 90_000);
    expect((await chipState())?.badge).not.toBe('broken');
    await appShot('account-chip-server-connected');
  });

  it('B1 · the server refuses the sign-in: the toast again with Sign in again, the badge, the menu', async () => {
    // let the first pass finish, so the refusal is about the sign-in and not about a half-done seed
    await waitConn(['connected'], 120_000);
    expect(await admin('disable')).toBe(200);
    // a change going out meets the refusal
    writeFileSync(
      join(W.me.root, '.design', 'ui', 'welcome.tsx'),
      canvasSource('Broken signin · welcome, after the account was disabled')
    );
    await waitConn(['signin-rejected'], 180_000);
    const toast = await waitNotice('signin-rejected', 30_000);
    expect(toast.text).toMatch(/Sign in again/);
    await appShot('toast-signin-rejected');
    expect((await chipState())?.badge).toBe('broken');
    await openAccountMenu();
    expect(await (await $(tid('account-menu-fix'))).getText()).toMatch(/^Sign in again/);
    expect(await (await $(tid('account-menu-fix-address'))).getText()).toContain(
      new URL(W.me.hub).host
    );
    await appShot('account-menu-broken-rejected');
    await closeAccountMenu();
  });

  it('B2 · let back in, Sign in again from the toast: the badge clears', async () => {
    expect(await admin('enable')).toBe(200);
    await captureTeamServerSignIn();
    await browser.execute(() => {
      (window as unknown as { __e2eHubSignIn?: string }).__e2eHubSignIn = undefined;
    });
    await pressNoticeAction('signin-rejected');
    let page = '';
    await browser.waitUntil(
      async () => {
        page = await capturedSignInUrl().catch(() => '');
        return !!page;
      },
      { timeout: 15_000, timeoutMsg: 'Sign in again never asked for the server’s page' }
    );
    await signInOnHubPage(page, W.email, W.password);
    await waitConn(['connected', 'syncing'], 120_000);
    expect((await chipState())?.badge).not.toBe('broken');
  });

  // [after the link-consent fix] — skipped with MAUDE_E2E_PRE_CONSENT_FIX=1 (helpers/accounts.ts)
  (PRE_CONSENT_FIX ? it.skip : it)(
    'C · a cloned folder that only NAMES the server: not linked on this Mac — no toast, no red badge, Review… asks first',
    async () => {
      const mine = await browser.getWindowHandle();
      const clone = W.me.unconfirmed as NonNullable<typeof W.me.unconfirmed>;
      const { label } = await openTab(clone.root);
      await focusTab(label);
      await waitForSidecar();
      await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
      // give the toast every chance to (wrongly) appear
      await browser.pause(8_000);
      expect(await signInNotices()).toEqual([]);
      const chip = await chipState();
      expect(chip?.badge).not.toBe('broken');
      expect(['signin-missing', 'signin-rejected']).not.toContain(chip?.conn);
      await openAccountMenu();
      expect(await (await $(tid('account-menu-project'))).getAttribute('data-bad')).toBeFalsy();
      // no one-click sign-in for a claim: the way in is Review…, which goes through the link consent
      expect(await (await $(tid('account-menu-fix'))).isExisting()).toBe(false);
      expect(await (await $('[data-testid="account-menu"]')).getText()).toMatch(/Review…/);
      await appShot('account-menu-unconfirmed');
      await closeAccountMenu();
      await closeTab(label, mine);
    }
  );
});
