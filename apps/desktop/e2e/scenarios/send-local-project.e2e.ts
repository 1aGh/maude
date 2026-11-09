import { $, browser, expect } from '@wdio/globals';

import {
  appShot,
  chipState,
  closeAccountMenu,
  cloudContacts,
  hubDocs,
  openAccountMenu,
  PRE_CONSENT_FIX,
  projectConfig,
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
 * 2.1.1 T3/T5 (canvas 17 · 07 sync, 12–13 link dialog) — a project only on this Mac goes somewhere.
 *
 *   1 · Diagnostics › Sync says "Only on this Mac" with both ways out.
 *   2 · "Create project on Maude Cloud" reaches the existing Move to Maude Cloud ask — and stops there: this lane's
 *       Maude Cloud is a loopback tripwire, and nothing reaches it.
 *   3 · "Link your server" → the one dialog → the address is checked against the (loopback) server → sign in on the
 *       server's own page → THIS folder links to the empty server and its canvases land there. Since the
 *       link-consent fix a server this Mac never linked asks first even when empty (`MAUDE_E2E_PRE_CONSENT_FIX=1`
 *       runs the B5 shape, which links an empty server straight away).
 *   4 · A second local project meets a server that already holds work: the confirm step with counts; Cancel leaves
 *       everything unlinked.
 *
 * Run in wdio.accounts.conf.ts.
 */
const W = world('send-local-project.e2e.ts');
const SECOND = W.me.second as NonNullable<typeof W.me.second>;

async function openSyncPopup(): Promise<void> {
  const word = await $(tid('share-cluster-status'));
  await word.waitForDisplayed({ timeout: 20_000 });
  await word.click();
  await (await $(tid('diag-sync-solo'))).waitForDisplayed({ timeout: 10_000 });
}

/** Sync › Link your server, then the address; resolves once Sign in woke. */
async function linkDialogOn(url: string): Promise<void> {
  await openSyncPopup();
  await (await $(tid('diag-sync-link-server'))).click();
  await (await $(tid('link-server-dialog'))).waitForDisplayed({ timeout: 10_000 });
  await (await $(tid('link-server-url'))).setValue(url);
  await browser.waitUntil(
    async () => (await (await $(tid('link-server-signin'))).getAttribute('disabled')) === null,
    { timeout: 20_000, timeoutMsg: `${url} never answered the address check` }
  );
  expect(await (await $(tid('link-server-check'))).getText()).toMatch(/answers/);
}

/** Sign in on the server's own page (the browser leg played by this process). */
async function signInThere(): Promise<void> {
  await captureTeamServerSignIn();
  await browser.execute(() => {
    (window as unknown as { __e2eHubSignIn?: string }).__e2eHubSignIn = undefined;
  });
  await (await $(tid('link-server-signin'))).click();
  await (await $(tid('link-server-waiting'))).waitForDisplayed({ timeout: 15_000 });
  await signInOnHubPage(await capturedSignInUrl(), W.email, W.password);
}

const counts = async () =>
  browser.execute(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll('[data-testid^="link-server-count-"]').forEach((el) => {
      out[(el.getAttribute('data-testid') || '').replace('link-server-count-', '')] = (
        el.textContent || ''
      ).trim();
    });
    return out;
  });

describe('send-local-project — a project only on this Mac goes to Maude Cloud or your server', () => {
  let first = '';

  before(async () => {
    startReport('send-local-project (native-desktop)');
    await waitForSidecar();
    first = await pinCurrentWindow();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
  });

  it('0 · the chip says this Mac only; the menu offers both ways', async () => {
    await waitConn(['local']);
    const chip = await chipState();
    expect(chip?.kind).toBe('local');
    expect(chip?.badge).toBeNull();
    await appShot('account-chip-local');
    await openAccountMenu();
    for (const id of ['share.move-to-cloud', 'account.link-server'])
      expect(await (await $(tid(`account-menu-action-${id}`))).isExisting()).toBe(true);
    await appShot('account-menu-local');
    await closeAccountMenu();
  });

  it('1 · Sync says Only on this Mac, with both buttons', async () => {
    await openSyncPopup();
    expect(await (await $(tid('diag-sync-solo'))).getText()).toContain('Only on this Mac');
    expect(await (await $(tid('diag-sync-to-cloud'))).isDisplayed()).toBe(true);
    expect(await (await $(tid('diag-sync-link-server'))).isDisplayed()).toBe(true);
    await appShot('sync-popup-local');
  });

  it('2 · Create project on Maude Cloud reaches the Move to Maude Cloud ask — and goes no further', async () => {
    await (await $(tid('diag-sync-to-cloud'))).click();
    const ask = await $(tid('share-move'));
    await ask.waitForDisplayed({ timeout: 10_000 });
    expect(await ask.getText()).toContain('Logo ideas');
    expect(await (await $(tid('share-move-confirm'))).isDisplayed()).toBe(true);
    await appShot('share-move-to-cloud-ask');
    // the point where it would need a real cloud: not pressed. Cancel leaves the project where it was.
    const cancel = await ask.$('button=Cancel');
    await cancel.click();
    await browser.waitUntil(
      async () => !(await (await $(tid('share-move'))).isDisplayed().catch(() => false)),
      {
        timeout: 5_000,
        timeoutMsg: 'Cancel did not close the Move to Maude Cloud ask',
      }
    );
    await browser.keys(['Escape']);
    expect(cloudContacts(W)).toEqual([]);
    expect(projectConfig(W.me.root).linkedHub).toBeUndefined();
  });

  it('3 · Link your server: the address check, sign in, this folder links and its canvases land on the empty server', async () => {
    await linkDialogOn(W.me.hub);
    await appShot('link-server-dialog-checked');
    // Advanced shows the folder this links: this one
    const adv = await $(tid('link-server-advanced'));
    if (await adv.isExisting()) {
      await adv.click();
      const here = await $(tid('link-server-folder-this'));
      if (await here.isExisting()) {
        expect(await here.getText()).toContain('Logo ideas');
        await appShot('link-server-dialog-this-folder');
      }
    }
    await signInThere();
    if (!PRE_CONSENT_FIX) {
      // [after the link-consent fix] a server this Mac never linked asks first, even when it holds nothing
      const confirm = await $(tid('link-server-confirm'));
      await confirm.waitForDisplayed({ timeout: 30_000 });
      await appShot('link-server-dialog-confirm-empty');
      expect(projectConfig(W.me.root).linkedHub).toBeUndefined();
      await (await $(tid('link-server-confirm-sync'))).click();
    }
    await browser.waitUntil(
      async () => !(await (await $(tid('link-server-dialog'))).isExisting()),
      {
        timeout: 60_000,
        timeoutMsg: 'the dialog never closed after the sign-in',
      }
    );
    await browser.waitUntil(async () => projectConfig(W.me.root).linkedHub?.url === W.me.hub, {
      timeout: 30_000,
      timeoutMsg: `config.json never named ${W.me.hub}`,
    });
    await browser.waitUntil(
      async () => {
        const docs = await hubDocs(W.me.hub, W.me.owner);
        return docs.includes('ui/welcome.tsx') && docs.includes('ui/pricing.tsx');
      },
      { timeout: 120_000, interval: 1_000, timeoutMsg: 'the canvases never reached the server' }
    );
    await waitConn(['connected', 'syncing'], 90_000);
    expect((await chipState())?.kind).toBe('server');
    expect(cloudContacts(W)).toEqual([]);
  });

  it('4 · a second local project, a server that already holds work: the counts first; Cancel links nothing', async () => {
    const { label } = await openTab(SECOND.root);
    await focusTab(label);
    await waitForSidecar();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
    await waitConn(['local']);
    await linkDialogOn(SECOND.hub);
    await signInThere();
    const confirm = await $(tid('link-server-confirm'));
    await confirm.waitForDisplayed({ timeout: 30_000 });
    const c = await counts();
    // two canvases only on this Mac; the server's picture only there
    expect(c.here ?? '').toMatch(/2/);
    expect(c.there ?? '').toMatch(/1/);
    await appShot('link-server-dialog-confirm-work');
    await (await $(tid('link-server-confirm-cancel'))).click();
    await browser.waitUntil(
      async () => !(await (await $(tid('link-server-dialog'))).isExisting()),
      {
        timeout: 10_000,
        timeoutMsg: 'Cancel did not close the dialog',
      }
    );
    await browser.pause(3_000);
    expect(projectConfig(SECOND.root).linkedHub).toBeUndefined();
    expect((await chipState())?.conn).toBe('local');
    expect(await hubDocs(SECOND.hub, SECOND.owner)).toEqual([]);
    await openSyncPopup();
    await browser.keys(['Escape']);
    expect(cloudContacts(W)).toEqual([]);
    await closeTab(label, first);
  });
});
