import { $, $$, browser, expect } from '@wdio/globals';

import { openHistory } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-133 — git branch select: fast, trustworthy, plain.
 *
 * Boots the bundled `.app` into a generated multi-branch git repo (wdio.git.conf.ts
 * → make-git-fixture) and drives Menu › Version history › Advanced (S11.10 — it retired the
 * bottom-dock branch switcher) via data-testid. Proves the three things the fix is about:
 *   1. the Branch select POPULATES with multiple branches (local + remote-tracking),
 *      not just `main`, and fills fast (the iso-git statusMatrix crash / 10s-timeout
 *      regression would leave it empty / hung);
 *   2. the words are the fold's ("Add to main · opens a pull request", "from your team, not
 *      downloaded yet") and a branch is a branch;
 *   3. NO phantom `origin` row (the origin/HEAD `%(refname:short)` leak we fixed).
 *
 * Fixture branch graph: main (both), feat/local-work (local), feat/nav-redesign
 * (local, current), feat/teammate-draft (remote-only), origin/HEAD (phantom source).
 */
describe('git-branch-switcher (native-desktop)', () => {
  before(async () => {
    startReport('git-branch-switcher (native-desktop)');
    // Cold start may run boot-self-heal (bun install + build) — give injected
    // scripts (isNativeShell / getText) generous headroom so they don't time out
    // while the webview is still bringing the app shell up.
    await browser.setTimeout({ script: 60_000 });
  });

  it('lists all branches fast, in plain words, no phantom origin', async () => {
    // 1 — sidecar booted; webview navigated to the loopback dev-server (getUrl-based,
    // robust during the loading phase) BEFORE we run any injected script.
    const url = await waitForSidecar();
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);

    // 2 — the shell renders AT ALL (the project dock is up).
    const trigger = await $('[data-testid="repo-switcher-trigger"]');
    await trigger.waitForDisplayed({ timeout: 120_000 });
    await capture('booted-into-git-repo');

    // 3 — confirm we're in the real native shell (now that the shell has mounted)
    expect(await isNativeShell()).toBe(true);

    // 4 — open Version history › Advanced; time how fast the Branch select fills. The regression
    // (iso-git on a many-branch repo) crashed / hit the 10s Bun.serve idle timeout
    // and left the list empty; system-git reads paint in well under a second.
    const t0 = Date.now();
    await openHistory();
    const select = await $('[data-testid="vh-git-branch"]');
    await select.waitForDisplayed({ timeout: 10_000 });
    const mainRow = await $('[data-testid="branch-row-main"]');
    await mainRow.waitForExist({ timeout: 8_000 });
    const paintMs = Date.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[git-branch-select] branch list painted in ${paintMs} ms`);
    expect(paintMs).toBeLessThan(18_000); // not the 10s-timeout/crash path (the panel opens too)
    // current branch is the non-default feature branch
    expect(await select.getValue()).toBe('feat/nav-redesign');
    await capture('branch-select-on-feature-branch');

    // 5 — MULTIPLE branches present (local + remote-tracking), not just main
    expect(await $('[data-testid="branch-row-main"]').isExisting()).toBe(true);
    expect(await $('[data-testid="branch-row-feat-local-work"]').isExisting()).toBe(true);
    expect(await $('[data-testid="branch-row-feat-teammate-draft"]').isExisting()).toBe(true);
    const rows = await $$('[data-testid^="branch-row-"]');
    expect(rows.length).toBeGreaterThanOrEqual(3);

    // 6 — NO phantom "origin" row (origin/HEAD short-form leak — the bug we fixed)
    expect(await $('[data-testid="branch-row-origin"]').isExisting()).toBe(false);

    // 7 — the fold's words: a teammate's branch is marked, and on a branch the way in is
    // "Add to main"
    expect(await $('[data-testid="branch-row-feat-teammate-draft"]').getText()).toContain(
      'not downloaded yet'
    );
    const merge = await $('[data-testid="switcher-merge"]');
    await merge.waitForDisplayed({ timeout: 8_000 });
    expect(await merge.getText()).toContain('Add to main');
    await capture('git-words-asserted');
  });
});
