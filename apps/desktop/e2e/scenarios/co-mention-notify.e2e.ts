import { $, browser, expect } from '@wdio/globals';

import { alice, type Cell, cellOrNull } from '../helpers/cell-peers';
import { dismissNotices } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';
import { canvasRow } from '../helpers/tree';
import { pinCurrentWindow } from '../helpers/windows';

/**
 * 10 Share and Collaboration · co-mention-notify — an @mention reaches the person it names (T2.6c, issue #172).
 *
 * The in-app half, on a cell with two people: alice (the headless studio the lane started, signed in as alice) writes a
 * comment on the teammate's canvas through her own `POST /_api/comments/op`; bob is the app under test.
 *
 *   quiet     a comment that mentions SOMEONE ELSE (@tereza) tells bob nothing: no toast, no count
 *   mention   a comment that mentions @bob → the toast "alice… mentioned you on <canvas>" with one action, Open
 *             (`callout-mention`), and the Comments button carries the unread count: "Comments — 1 unread" (S9.22 —
 *             the count is the unread mentions, not the open comments, so the earlier comment is not in it)
 *   open      the toast's Open opens the Comments panel on that thread; reading it takes the count and the toast away
 *
 * NOT driven here, and said so: the Mac notification banner and the Dock badge (the native shell's `notify.rs`, which a
 * WebDriver session cannot see) and the e-mail (the cloud's `mentions.mjs`; a self-hosted local hub has no mailer). Those
 * stay with the rc soak. The toast and the count are derived from the comments themselves (client/v2/comments/
 * mention-model.js), so they hold whether the mention arrived live or over sync.
 *
 * Preconditions: the cell lane (wdio.co-mention-notify.conf.ts: Node 24 for the hub, a built test app, a stub `claude`).
 * WRITTEN, NOT RUN in the T2.6c hand-back — the lead runs it once, alone.
 */
const tid = (s: string) => `[data-testid="${s}"]`;
const FILE = '.design/ui/welcome.tsx';

const CELL = cellOrNull();

describe('co-mention-notify (native-desktop) — an @mention toasts and counts for the person it names', () => {
  before(async function () {
    if (!CELL) this.skip();
    startReport('co-mention-notify (native-desktop) — alice mentions bob on a cell');
    await browser.setTimeout({ script: 60_000 });
    await pinCurrentWindow().catch((error: unknown) =>
      console.warn(`[co-mention-notify] window pin failed: ${String(error)}`)
    );
  });

  it('0 · the copy is open on the teammate’s canvas; nobody has mentioned bob yet', async () => {
    await waitForSidecar();
    await (await canvasRow('canvas-row-ui-welcome')).waitForDisplayed({ timeout: 120_000 });
    await (await canvasRow('canvas-row-ui-welcome')).click();
    await (await $(tid('canvas-frame'))).waitForExist({ timeout: 60_000 });
    await dismissNotices();
    // the toast fires only for a mention that appears AFTER the page's first load (a relaunch counts, it does not shout):
    // give the baseline its moment before alice writes
    await browser.pause(6_000);
    expect(await $(tid('callout-mention')).isExisting()).toBe(false);
    expect(await $(tid('share-cluster-comments-count')).isExisting()).toBe(false);
    await capture('00-mention-before');
  });

  it('1 · a comment that mentions someone else says nothing to bob', async () => {
    const c = CELL as Cell;
    const r = await alice(c, 'POST', '/_api/comments/op', {
      op: 'add',
      file: FILE,
      text: '@tereza could you check the spacing here?',
    });
    expect(r.status).toBe(200);
    // the comment reaches bob (his open-comment state sees it); the toast and the count must stay away
    await browser.pause(15_000);
    expect(await $(tid('callout-mention')).isExisting()).toBe(false);
    expect(await $(tid('share-cluster-comments-count')).isExisting()).toBe(false);
  });

  it('2 · @bob: the toast names who and where and offers Open; the Comments button counts it as unread', async () => {
    const c = CELL as Cell;
    const r = await alice(c, 'POST', '/_api/comments/op', {
      op: 'add',
      file: FILE,
      text: '@bob the headline is the first thing people read — can you look?',
    });
    expect(r.status).toBe(200);

    const toast = await $(tid('callout-mention'));
    await toast.waitForExist({
      timeout: 120_000,
      timeoutMsg:
        'no mention toast for bob (the comment never arrived, or it was not read as a mention)',
    });
    const words = (await toast.getText()).replace(/\s+/g, ' ');
    expect(words).toMatch(/alice\S* mentioned you/i);
    expect((await (await $(tid('callout-mention-action'))).getText()).trim()).toBe('Open');
    await capture('01-mention-toast');

    const count = await $(tid('share-cluster-comments-count'));
    await count.waitForExist({ timeout: 15_000, timeoutMsg: 'the Comments button has no count' });
    expect((await count.getText()).trim()).toBe('1'); // the @tereza comment is not a mention of bob
    expect(await (await $(tid('share-cluster-comments'))).getAttribute('aria-label')).toContain(
      '1 unread'
    );
    // and only one toast stands: the stack shows the newest mention
    expect(
      await browser.execute(
        () => document.querySelectorAll('[data-testid="callout-mention"]').length
      )
    ).toBe(1);
  });

  it('3 · Open opens the thread in the Comments panel; having looked, the count and the toast go', async () => {
    await (await $(tid('callout-mention-action'))).click();
    await (await $(tid('comments-panel'))).waitForExist({
      timeout: 15_000,
      timeoutMsg: 'Open did not open the Comments panel',
    });
    await capture('02-mention-opened');
    await $(tid('callout-mention')).waitForExist({ reverse: true, timeout: 15_000 });
    await $(tid('share-cluster-comments-count')).waitForExist({
      reverse: true,
      timeout: 15_000,
      timeoutMsg: 'the unread count stayed after the thread was opened',
    });
  });
});
