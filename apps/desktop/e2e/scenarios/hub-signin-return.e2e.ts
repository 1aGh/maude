import { $, browser, expect } from '@wdio/globals';

import {
  appShot,
  chipState,
  closeAccountMenu,
  closeSettings,
  hubDocs,
  openAccountMenu,
  openSettings,
  openThisProject,
  storedSignIn,
  tid,
  waitConn,
  world,
} from '../helpers/accounts';
import { startReport } from '../helpers/evidence';
import {
  browserReturn,
  capturedSignInUrl,
  captureTeamServerSignIn,
  handOffFromHubPage,
} from '../helpers/hub-signin-page';
import { waitForSidecar } from '../helpers/sidecar';
import { focusTab, HOME, labels, pinCurrentWindow } from '../helpers/windows';

/**
 * 2.1.1 T0/T7 — a team-server sign-in lands. The folder names a server this Mac holds no sign-in for; Settings ›
 * General › This project says so and its "Sign in" opens the one Link your server dialog on that address, which
 * asks Rust to open the server's own page in the system browser. The scenario takes that page URL and plays the
 * browser: the page, its password form, and the hop back to the project's loopback server at
 * `/_api/hub-signin/return?state&code` — a plain GET from THIS process, with no app session cookie and no
 * `x-maude-api-key`. 2.1.0 answered that hop `401 api-key-required`, so no team-server sign-in from a project tab
 * could finish in the packaged app. Run in wdio.accounts.conf.ts (a loopback hub; never a real one).
 */
const W = world('hub-signin-return.e2e.ts');

describe('hub-signin-return — the browser hop back to the project lands without the app key', () => {
  let origin = '';
  let tabsBefore: string[] = [];
  let href = '';

  before(async () => {
    startReport('hub-signin-return (native-desktop)');
    origin = new URL(await waitForSidecar()).origin;
    await pinCurrentWindow();
    await $('[data-testid^="canvas-row-"]').waitForExist({ timeout: 60_000 });
    tabsBefore = await labels();
  });

  it('1 · the folder names a server this Mac holds no sign-in for: the chip and This project say so', async () => {
    expect(storedSignIn(W.me.hubs, W.me.hub)).toBe(false);
    await waitConn(['signin-missing']);
    expect((await chipState())?.badge).toBe('broken');
    expect((await chipState())?.kind).toBe('server');
    await openThisProject();
    const fix = await $(tid('settings-project-sign-in-again'));
    await fix.waitForDisplayed({ timeout: 15_000 });
    expect(await fix.getText()).toMatch(/^Sign in/);
    await appShot('settings-general-signin-missing');
  });

  it('2 · Sign in opens the server’s own page on the linked address', async () => {
    await captureTeamServerSignIn();
    await (await $(tid('settings-project-sign-in-again'))).click();
    const dialog = await $(tid('link-server-dialog'));
    await dialog.waitForDisplayed({ timeout: 10_000 });
    // the address the folder already names — never typed again
    expect(await (await $(tid('link-server-url'))).getValue()).toBe(W.me.hub);
    await browser.waitUntil(
      async () => (await (await $(tid('link-server-signin'))).getAttribute('disabled')) === null,
      { timeout: 20_000, timeoutMsg: 'the server address never answered' }
    );
    expect(await (await $(tid('link-server-check'))).getText()).toMatch(/answers/);
    await appShot('link-server-dialog-answers');
    await (await $(tid('link-server-signin'))).click();
    await (await $(tid('link-server-waiting'))).waitForDisplayed({ timeout: 15_000 });
    await appShot('link-server-dialog-waiting');
    const page = await capturedSignInUrl();
    expect(new URL(page).origin).toBe(W.me.hub);
  });

  it('3 · the hop back is a plain GET with no session and no key — and it signs the project in', async () => {
    // control: this process really holds nothing of the app's — any other main-origin route refuses it
    const control = await fetch(`${origin}/_api/cloud/status`);
    expect(control.status).toBe(401);
    expect(await control.text()).toContain('api-key-required');

    href = await handOffFromHubPage(await capturedSignInUrl(), W.email, W.password);
    const back = new URL(href);
    expect(back.origin).toBe(origin);
    expect(back.pathname).toBe('/_api/hub-signin/return');
    expect(back.searchParams.get('state')).toBeTruthy();
    expect(back.searchParams.get('code')).toBeTruthy();

    const answer = await browserReturn(href);
    expect(Object.keys(answer.sent).map((k) => k.toLowerCase())).not.toContain('x-maude-api-key');
    expect(Object.keys(answer.sent).map((k) => k.toLowerCase())).not.toContain('cookie');
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('<h1>Signed in</h1>');

    await browser.waitUntil(async () => storedSignIn(W.me.hubs, W.me.hub), {
      timeout: 15_000,
      timeoutMsg: 'no sign-in stored for the server after the return',
    });
    // the dialog closes by itself; the chip clears
    await browser.waitUntil(
      async () => !(await (await $(tid('link-server-dialog'))).isExisting()),
      {
        timeout: 20_000,
        timeoutMsg: 'the Link your server dialog stayed open after the sign-in',
      }
    );
    await waitConn(['connected', 'syncing'], 90_000);
    expect((await chipState())?.badge).not.toBe('broken');
  });

  it('4 · signing in again on the folder’s own server opens nothing else', async () => {
    // the sign-in was for THIS folder's link: no copy of the same server, in a new tab or in this one (2.1.1 T7
    // found the dialog opening "<host> · copy kept by Maude" here — apps/studio/test/t7-link-server-sign-in-again)
    await browser.pause(3_000);
    expect(await labels()).toEqual(tabsBefore);
    await pinCurrentWindow();
    expect(new URL(await browser.getUrl()).origin).toBe(origin);
    expect(await (await $(tid('project-pill'))).getText()).toContain('Signin return');
  });

  it('5 · the hand-off works once: the same return again signs nothing in', async () => {
    const again = await browserReturn(href);
    expect(again.status).toBe(400);
    expect(again.body).toContain('Not signed in');
  });

  it('6 · This project says Connected, the canvases reach the server, and the account menu agrees', async () => {
    await browser.waitUntil(
      async () => {
        const docs = await hubDocs(W.me.hub, W.me.owner);
        return docs.includes('ui/welcome.tsx') && docs.includes('ui/pricing.tsx');
      },
      { timeout: 120_000, interval: 1_000, timeoutMsg: 'the canvases never reached the server' }
    );
    await openThisProject();
    const connection = await $(tid('settings-project-connection'));
    await connection.waitForDisplayed({ timeout: 15_000 });
    await browser.waitUntil(async () => /^Connected/.test(await connection.getText()), {
      timeout: 60_000,
      timeoutMsg: 'This project never said Connected',
    });
    await appShot('settings-general-connected');
    await openSettings('connections');
    await appShot('settings-connections');
    await openSettings('advanced');
    await appShot('settings-advanced');
    await closeSettings();
    await openAccountMenu();
    expect(await (await $(tid('account-menu-where'))).getText()).toContain(new URL(W.me.hub).host);
    expect(await (await $(tid('account-menu-fix'))).isExisting()).toBe(false);
    await appShot('account-menu-server-connected');
    await closeAccountMenu();
  });

  it('7 · Home: the server account on this Mac, and where the project lives', async () => {
    const mine = await browser.getWindowHandle();
    await focusTab(HOME);
    const row = await $(tid('home-accounts-row'));
    await row.waitForDisplayed({ timeout: 30_000 });
    const host = new URL(W.me.hub).host;
    await browser.waitUntil(async () => (await row.getText()).includes(host), {
      timeout: 30_000,
      timeoutMsg: `Home's accounts row never named ${host}`,
    });
    const card = await $(`[data-testid^="home-account-card-"][data-kind="server"]`);
    expect(await card.getAttribute('data-state')).toBe('ok');
    const where = await $('[data-testid^="home-project-where-"]');
    if (await where.isExisting()) await where.scrollIntoView({ block: 'center' });
    await appShot('home-accounts-row-and-where');
    await focusTab(mine);
  });
});
