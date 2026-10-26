import { execFileSync } from 'node:child_process';
import { $, browser, expect } from '@wdio/globals';
import type {} from '@wdio/tauri-service';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

const tid = (id: string) => `[data-testid="${id}"]`;
/** S1.18 — the row menu's Copy link: `maude://open/<project>?c=<kernel entry>`. */
const STABLE_LINK = /^maude:\/\/open\/project\?c=[A-Za-z0-9_-]{8,128}$/;
let stableLink = '';
/** The shell delivers the link to THIS window (parked + `maude://deep-link`),
 *  exactly as it delivers one routed here. Pages can no longer `emit` events
 *  (V2-3.6 M5), so the debug-only `e2e_deliver_deep_link` does the delivery. */
async function arrive(url: string) {
  await invokeTauri('e2e_deliver_deep_link', { url });
}
async function active(path: string) {
  await browser.waitUntil(
    async () => (await $(tid('canvas-frame'))).getAttribute('data-path').then((p) => p === path),
    { timeout: 30_000, timeoutMsg: `Expected active canvas ${path}` }
  );
}

describe('share-link — addresses, row sharing, same-project open and foreign-project decision', () => {
  before(async () => {
    startReport('share-link');
    await waitForSidecar();
    // This scenario only uses the main window. Explicit selection suppresses
    // the service's per-command auto-focus probe, whose mock bridge disappears
    // when the shell navigates from the bundled page to the loopback studio.
    await pinCurrentWindow();
    await (await canvasRow('canvas-row-ui-smoke')).waitForDisplayed({ timeout: 30_000 });
  });

  afterEach(async () => {
    await browser.execute(() => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Close share dialog"]')?.click();
    });
  });

  it('a local project’s Share offers Move to cloud; a row’s Copy link shares it without opening it', async () => {
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await active('.design/ui/Smoke.tsx');
    await (await $(tid('share-cluster-share'))).click();
    await (await $(tid('share-dialog'))).waitForDisplayed();
    // S9.20: sharing needs the cloud, so a LOCAL project's Share (desktop) is the Move to cloud door — the raw
    // links (Advanced · Other ways in) belong to a linked project's sheet (share-sheet.jsx `offerMove`).
    await (await $(tid('share-move'))).waitForDisplayed();
    expect(await (await $('#share-move-title')).getText()).toBe('Move “e2e-fixture” to the cloud?');
    expect(await $(tid('share-app-url')).isExisting()).toBe(false);
    await capture('topbar share');
    // Cancel leaves the project where it is
    await (await (await $(tid('share-move'))).$('button=Cancel')).click();
    await (await $(tid('share-dialog'))).waitForExist({ reverse: true, timeout: 5000 });
    // S1.2: another row's link comes from its row menu's "Copy link" (the Share sheet is the open canvas's)
    if (process.platform === 'darwin') {
      execFileSync('/usr/bin/pbcopy', { input: 'share-link-before-copy' });
    } else {
      await browser.execute(() => navigator.clipboard.writeText('share-link-before-copy'));
    }
    await (await $(tid('tree-row-menu-ui-export'))).click();
    await (await $(tid('canvas-menu-copy-link'))).click();
    // S1.18: the row's link names the canvas's kernel entry, never its path — it survives a move or rename.
    await browser.waitUntil(
      async () => {
        const copied =
          process.platform === 'darwin'
            ? execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' })
            : await browser.execute(() => navigator.clipboard.readText());
        if (!STABLE_LINK.test(copied)) return false;
        stableLink = copied;
        return true;
      },
      {
        timeout: 5000,
        timeoutMsg: 'Copy link did not write the row’s stable link to the clipboard',
      }
    );
    await active('.design/ui/Smoke.tsx');
    await capture('copy link of another row');
  });

  it('S1.18: a stable link opens its canvas at the artboard and says where it came from', async () => {
    expect(stableLink).toMatch(STABLE_LINK);
    // The shell rebuilds a canvas link before a window sees it: the `#<artboard>` anchor rides as `a=`
    // (deep_link.rs `parse_link`). The debug delivery hands the window that rebuilt form directly.
    await arrive(`${stableLink}&a=export-a4`);
    await active('.design/ui/Export.tsx');
    // a toast is short-lived: poll fast, keep what it said
    let said = '';
    await browser.waitUntil(
      async () => {
        const t = await browser.execute(
          () => document.body.innerText.split('\n').find((l) => l.includes('Opened from')) ?? ''
        );
        if (t) said = t;
        return !!t;
      },
      { timeout: 10_000, interval: 50, timeoutMsg: 'no "Opened from a link" toast' }
    );
    expect(said).toContain('Opened from a link — Export · export-a4.');
    await capture('stable link with artboard anchor');
    // An entry this project never had: the calm "isn't in <project> any more", and nothing moves.
    await arrive('maude://open/project?c=n_neverwashere0');
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.body.innerText)).includes("This canvas isn't in"),
      { timeout: 10_000, timeoutMsg: 'no "isn’t in … any more" toast' }
    );
    await active('.design/ui/Export.tsx');
    await capture('stable link to a canvas that is gone');
  });

  it('opens a same-project file directly and parks a foreign-project link', async () => {
    await arrive('maude://open/project?open=ui/Export.tsx');
    await active('.design/ui/Export.tsx');
    expect(await (await $(tid('file-deeplink-dialog'))).isExisting()).toBe(false);
    await arrive('maude://open/not-on-this-machine?open=ui/Smoke.tsx');
    await (await $(tid('file-deeplink-dialog'))).waitForDisplayed();
    await active('.design/ui/Export.tsx');
    await capture('foreign project asks first');
    // A later event must never replace the decision the person is reading.
    await arrive('maude://open/project?open=ui/Video.tsx');
    expect(await (await $(tid('file-deeplink-dialog'))).getText()).toContain('not-on-this-machine');
    await active('.design/ui/Export.tsx');
    await (await $(tid('file-deeplink-dismiss'))).click();
  });

  it('drops a file link carrying a connect code', async () => {
    await arrive(`maude://open/project?open=ui/Smoke.tsx&code=mhc_${'a'.repeat(64)}`);
    await active('.design/ui/Export.tsx');
    expect(await (await $(tid('cloud-deeplink-dialog'))).isExisting()).toBe(false);
    expect(await (await $(tid('file-deeplink-dialog'))).isExisting()).toBe(false);
  });
});
