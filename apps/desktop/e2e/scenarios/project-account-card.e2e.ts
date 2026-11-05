import { $, browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * 2.0.5 W4 — the avatar's card: your own face in the Share cluster opens THIS project's account
 * (kind · profile · server or project · login), and the sync word opens Diagnostics › Sync.
 *
 * Deliberately clicks neither Sign out nor a sign-in: an e2e run must never touch the person's keychain
 * or start a real device flow. Those paths are pinned in apps/studio/test/w4-account-ui.test.tsx with a
 * stubbed shell. Written for the integration lane; not yet run (see the hand-back).
 */
const tid = (s: string) => `[data-testid="${s}"]`;

describe('project-account-card', () => {
  before(async () => {
    startReport('project-account-card — your face opens the project account; the sync word opens Sync');
    await waitForSidecar();
  });

  it('1 · your face opens the account card with its kind and profile', async () => {
    const you = await $(tid('share-cluster-face-you'));
    await you.waitForDisplayed({ timeout: 30_000 });
    await you.click();
    const card = await $(tid('project-account'));
    await card.waitForDisplayed({ timeout: 5_000 });
    const kind = await (await $(tid('project-account-kind'))).getText();
    expect(['Team server', 'Maude Cloud', 'GitHub', 'This Mac only']).toContain(kind);
    expect(await (await $(tid('project-account-profile'))).getText()).not.toBe('');
    await capture('01-account-card');
  });

  it('2 · Esc closes it', async () => {
    await browser.keys(['Escape']);
    await browser.waitUntil(
      async () => !(await (await $(tid('project-account'))).isDisplayed().catch(() => false)),
      { timeout: 5_000, timeoutMsg: 'the account card did not close' }
    );
  });

  it('3 · the sync word opens Diagnostics › Sync', async () => {
    const word = await $(tid('share-cluster-status'));
    await word.waitForDisplayed({ timeout: 10_000 });
    if ((await word.getAttribute('data-status')) === 'access') return; // a viewer has no sync word
    await word.click();
    const sheet = await $('[data-testid^="diag-"]');
    await sheet.waitForDisplayed({ timeout: 5_000 });
    await capture('03-diagnostics-sync');
  });
});
