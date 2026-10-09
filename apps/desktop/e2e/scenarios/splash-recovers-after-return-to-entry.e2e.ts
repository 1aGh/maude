import { $, browser, expect } from '@wdio/globals';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * Regression guard for the desktop "Starting…" hang, return-to-entry flavor
 * (#92): ANY event that puts the webview back on its entry document
 * (apps/desktop/src/index.html) used to strand the app forever. The splash was
 * static HTML with no JavaScript and the Rust startup navigate (lib.rs setup)
 * is a one-shot, so nothing ever navigated away a second time. The reporter hit
 * it as "a command finished and Maude went black with a loading screen"; the
 * only recovery was a force-quit.
 *
 * The dominant trigger is a WKWebView content-process crash, because WebKit
 * reloads the window's ORIGINAL url — the splash — and NOT via session history.
 * So this spec reproduces it the same way: navigate the webview straight at the
 * bundled entry document (`tauri://localhost`, Tauri v2's custom protocol
 * origin for `frontendDist`), which is the state a crash-reload lands in.
 *
 * Sibling spec: backspace-no-active-canvas-no-hang.e2e.ts guards one specific
 * KEYBOARD path to this same state.
 */
const ENTRY_URL = 'tauri://localhost';
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1):\d+/;

/**
 * The dev-server a URL points at — scheme, host and PORT.
 *
 * Recovery is "back on the same dev-server", and that is the origin. The rest
 * of the URL is the studio's own address state: since 04321806 (share file
 * links, 2026-09-14) the shell pushes `?open=<canvas>` for whatever is open,
 * and the splash recovers to the server ROOT it gets from
 * `resolve_dev_server_url` — it cannot know which canvas was showing. Comparing
 * whole URLs made this spec depend on whether an earlier spec in the same app
 * process (the default lane shares one) had left a canvas open: it failed on
 * `http://localhost:4401/?open=ui/Export.tsx` vs `http://localhost:4401/`.
 */
const serverOf = (url: string) => new URL(url).origin;

describe('splash-recovers-after-return-to-entry (native-desktop)', () => {
  before(() => startReport('splash-recovers-after-return-to-entry (native-desktop)'));

  it('self-heals back to the dev-server after the webview returns to the splash', async () => {
    expect(await isNativeShell()).toBe(true);

    const appUrl = await waitForSidecar();
    await (await $('[data-testid="canvas-list"]')).waitForDisplayed({ timeout: 60_000 });
    await capture('webview-on-localhost');

    // Put the webview back on the entry document — the crash-reload state.
    // Driving it through WebDriver (not the page) keeps the simulation
    // independent of whatever the page's own CSP allows.
    await browser.url(ENTRY_URL);

    // No assertion that we can still SEE the splash here: with the fix the
    // recovery can complete in well under a WebDriver round-trip, so sampling
    // for the intermediate state would be a race. We do not need it — we put
    // the webview there ourselves, so a return to loopback can only mean the
    // splash navigated itself back. Pre-fix this times out on the splash.
    let urlAfter = '';
    await browser.waitUntil(
      async () => {
        urlAfter = await browser.getUrl();
        return LOOPBACK.test(urlAfter);
      },
      {
        timeout: 20_000,
        interval: 250,
        timeoutMsg: `splash never recovered to the dev-server (parked at "${urlAfter}")`,
      }
    );
    expect(serverOf(urlAfter)).toBe(serverOf(appUrl));
    await capture('recovered-to-localhost');

    // The shell actually re-rendered — a URL flip alone is not recovery.
    await (await $('[data-testid="canvas-list"]')).waitForDisplayed({ timeout: 60_000 });
    await capture('shell-interactive-again');
  });

  it('leaves no splash entry in session history for a back-navigation to land on', async () => {
    // The splash recovers with location.replace(), not .href, so it overwrites
    // its OWN history entry instead of pushing a new one. That closes the
    // back-navigation route into this bug at the source: there is no entry to
    // go back TO. Guards the choice of replace() — a future edit to .href
    // would restore the reachable-splash state and turn this red.
    const appUrl = await waitForSidecar();

    await browser.execute(() => window.history.back());
    await browser.pause(2000);

    // Back lands on an earlier STUDIO entry (possibly one carrying `?open=`),
    // never on the splash: still loopback, still the same dev-server.
    const url = await browser.getUrl();
    expect(url).toMatch(LOOPBACK);
    expect(serverOf(url)).toBe(serverOf(appUrl));
    await capture('back-navigation-cannot-reach-splash');

    await (await $('[data-testid="canvas-list"]')).waitForDisplayed({ timeout: 60_000 });
  });
});
