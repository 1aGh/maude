import { execFileSync } from 'node:child_process';
import { $, browser, expect } from '@wdio/globals';
import type {} from '@wdio/tauri-service';
import { capture, startReport } from '../helpers/evidence';
import { invokeTauri } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

const tid = (id: string) => `[data-testid="${id}"]`;
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

  it('copies an app link from the topbar and shares a different row without opening it', async () => {
    await (await canvasRow('canvas-row-ui-smoke')).click();
    await active('.design/ui/Smoke.tsx');
    await (await $(tid('share-btn'))).click();
    await (await $(tid('share-dialog'))).waitForDisplayed();
    expect(await (await $(tid('share-app-url'))).getValue()).toBe(
      'maude://open/project?open=ui/Smoke.tsx'
    );
    // A previous run may have left the same link behind; require a fresh write.
    if (process.platform === 'darwin') {
      execFileSync('/usr/bin/pbcopy', { input: 'share-link-before-copy' });
    } else {
      await browser.execute(() => navigator.clipboard.writeText('share-link-before-copy'));
    }
    await (await $(tid('share-copy-app'))).click();
    // Verify the real clipboard, independent of the brief "Copied" label.
    // macOS exposes it without triggering a webview clipboard-read prompt.
    await browser.waitUntil(
      async () => {
        const copied =
          process.platform === 'darwin'
            ? execFileSync('/usr/bin/pbpaste', { encoding: 'utf8' })
            : await browser.execute(() => navigator.clipboard.readText());
        return copied === 'maude://open/project?open=ui/Smoke.tsx';
      },
      { timeout: 5000, timeoutMsg: 'Copy did not write the app link to the clipboard' }
    );
    await capture('topbar share');
    await (await $('button[aria-label="Close share dialog"]')).click();
    await (await $(tid('tree-row-menu-ui-export'))).click();
    await (await $('button=Share…')).click();
    expect(await (await $(tid('share-app-url'))).getValue()).toBe(
      'maude://open/project?open=ui/Export.tsx'
    );
    await active('.design/ui/Smoke.tsx');
    await capture('share another row');
    await (await $('button[aria-label="Close share dialog"]')).click();
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
