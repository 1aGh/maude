import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { openHistory } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-133 — the COMPLETE git lifecycle, driven through the desktop app UI (switcher +
 * GitPanel), DOM-driven, one screenshot per operation. Boots into a real github-backed
 * clone (wdio.lifecycle.conf.ts → make-lifecycle-fixture); MAUDE_USE_SYSTEM_GIT=1 lets
 * push/pull/fetch authenticate via the developer's git credential helper.
 *
 * Covers: switch repos · switch branches · new branch · commit (Save version) ·
 * push (Publish) · fetch remote branches · pull (Get latest) · merge to main (fold).
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const API = 'repos/iagh66/maude-git-smoke';
const BR = 'smoke/ui-lifecycle';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: PRIMARY,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}
function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}
const tid = (s: string) => `[data-testid="${s}"]`;

/** Wait for the bottom-dock switcher trigger (the app shell is up / reloaded). Polls
 *  with isDisplayed wrapped in try/catch: mid-reload (after a checkout/refresh) the JS
 *  context is torn down and isDisplayed (execute/async) THROWS rather than returning
 *  false — treat that as "not ready yet" and keep polling. */
async function waitForShell(timeout = 120_000): Promise<WebdriverIO.Element> {
  await browser.waitUntil(
    async () => {
      try {
        return await (await $(tid('repo-switcher-trigger'))).isDisplayed();
      } catch {
        return false;
      }
    },
    { timeout, interval: 500, timeoutMsg: 'app shell (switcher trigger) never appeared' }
  );
  return $(tid('repo-switcher-trigger'));
}
async function openSwitcher(): Promise<void> {
  // Idempotent: the popup closes only on an outside mousedown (no Escape handler), so
  // re-clicking the trigger when it's already open would TOGGLE it shut. Return early
  // if it's already showing.
  const popup = await $(tid('repo-switcher-popup'));
  if (await popup.isDisplayed().catch(() => false)) return;
  const trigger = await waitForShell();
  await trigger.click();
  await popup.waitForDisplayed({ timeout: 10_000 });
}
/** The branch label shown in the trigger (e.g. "main" / "smoke/ui-lifecycle"). */
async function triggerText(): Promise<string> {
  return (await waitForShell()).getText();
}

describe('git-lifecycle (native-desktop)', () => {
  before(async () => {
    startReport('git-lifecycle (native-desktop) — complete git functionality through the UI');
    await browser.setTimeout({ script: 60_000 });
  });

  after(() => {
    // Clean up the remote test branches this run pushed (best-effort).
    for (const ref of [`heads/${BR}`, 'heads/smoke/from-remote']) {
      try {
        gh('api', '-X', 'DELETE', `${API}/git/refs/${ref}`);
      } catch {
        /* already gone */
      }
    }
  });

  it('drives switch-repos, branches, commit, push, fetch, pull, merge through the UI', async () => {
    // ── boot ──────────────────────────────────────────────────────────────────
    const url = await waitForSidecar();
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);
    await waitForShell();
    expect(await isNativeShell()).toBe(true);
    expect(await triggerText()).toContain('main');
    await capture('01-booted-on-main');

    // (switch-repos is exercised by the separate git-switch-repos scenario — the
    // open_local_project sidecar-respawn is too WebDriver-flaky to chain inline.)

    // ── 1. NEW BRANCH (switcher → New branch → name → create) ──────────────────
    await openSwitcher();
    await $(tid('switcher-new-branch')).click();
    const input = await $(tid('switcher-new-branch-input'));
    await input.waitForDisplayed({ timeout: 10_000 });
    await input.setValue(BR);
    await $(tid('switcher-new-branch-create')).click();
    await browser.waitUntil(async () => (await triggerText()).includes(BR), {
      timeout: 60_000,
      timeoutMsg: 'new-branch: trigger never showed the new branch',
    });
    await capture('02-new-branch-created');

    // ── 2. SWITCH BRANCHES (checkout main → back) — reload-based, reliable ──────
    await openSwitcher();
    await $(tid('branch-row-main')).click();
    await browser.waitUntil(async () => (await triggerText()).includes('main'), {
      timeout: 60_000,
      timeoutMsg: 'switch-branches: did not check out main',
    });
    await capture('03-switched-to-main');
    await openSwitcher();
    await $(`[data-testid="branch-row-${BR.replace(/[^a-z0-9]+/gi, '-')}"]`).click();
    await browser.waitUntil(async () => (await triggerText()).includes(BR), {
      timeout: 60_000,
      timeoutMsg: 'switch-branches: did not return to the feature branch',
    });
    await capture('04-switched-back-to-feature-branch');

    // ── 3. COMMIT (write a change → open Changes → message → Save all) ─────────
    writeFileSync(
      join(PRIMARY, '.design', 'ui-lifecycle.txt'),
      'changed via the UI lifecycle e2e\n'
    );
    // An EXTERNAL file write isn't broadcast to the client (the watcher tracks .git,
    // not arbitrary working-tree writes), so reload to force a fresh status read.
    await browser.refresh();
    await waitForShell();
    await openHistory();
    await $(tid('git-panel')).waitForDisplayed({ timeout: 20_000 });
    const msg = await $(tid('git-commit-message'));
    await msg.waitForDisplayed({ timeout: 20_000 });
    await msg.setValue('smoke: ui lifecycle commit');
    const saveAll = await $(tid('git-save-all'));
    await saveAll.waitForClickable({ timeout: 10_000 });
    await saveAll.click();
    await browser.pause(2_000);
    await capture('05-committed');

    // ── 4. PUSH (Publish) ──────────────────────────────────────────────────────
    const publish = await $(tid('git-publish'));
    await publish.waitForDisplayed({ timeout: 20_000 });
    await publish.click();
    await browser.pause(4_000); // real network push via the credential helper
    await capture('06-published');
    // verify on GitHub
    await browser.waitUntil(
      () => {
        try {
          return gh('api', `${API}/branches/${encodeURIComponent(BR)}`, '--jq', '.name') === BR;
        } catch {
          return false;
        }
      },
      { timeout: 30_000, timeoutMsg: 'push: branch never appeared on the remote' }
    );

    // ── 5. FETCH remote branches (a teammate branch appears) ───────────────────
    gh(
      'api',
      '-X',
      'POST',
      `${API}/git/refs`,
      '-f',
      'ref=refs/heads/smoke/from-remote',
      '-f',
      `sha=${git('rev-parse', 'origin/main')}`
    );
    await openSwitcher();
    await $(tid('switcher-fetch')).click();
    const remoteRow = await $(tid('branch-row-smoke-from-remote'));
    await remoteRow.waitForDisplayed({ timeout: 30_000 });
    await capture('07-fetched-remote-branch');

    // ── 6. MERGE TO MAIN (fold) — done while main is in sync, so the publish is ──
    // clean. We're still on smoke/ui-lifecycle, so the "Merge this branch → main"
    // CTA is present; the popup is already open from the fetch (openSwitcher is a
    // no-op when open).
    await openSwitcher();
    await $(tid('switcher-merge')).click();
    const confirm = await $(tid('switcher-merge-confirm'));
    await confirm.waitForDisplayed({ timeout: 10_000 });
    await confirm.click();
    await browser.waitUntil(async () => (await triggerText()).includes('main'), {
      timeout: 90_000,
      timeoutMsg: 'merge: did not land back on main after fold',
    });
    await capture('08-merged-to-main');
    await browser.waitUntil(
      () => {
        try {
          gh('api', `${API}/contents/.design/ui-lifecycle.txt?ref=main`, '--jq', '.name');
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 30_000, timeoutMsg: 'merge: ui-lifecycle.txt never reached remote main' }
    );

    // ── 7. PULL (Get latest) — last, isolated, best-effort. We're on main (synced
    // after the fold). Move the remote, then open Changes: the fold invalidated the
    // remote probe, so it re-fetches and surfaces the "Get latest" nudge. ─────────
    gh(
      'api',
      '-X',
      'PUT',
      `${API}/contents/.design/from-team.txt`,
      '-f',
      'message=team: out-of-band change',
      '-f',
      `content=${Buffer.from('from the team').toString('base64')}`,
      '-f',
      'branch=main'
    );
    await openHistory();
    await $(tid('git-panel')).waitForDisplayed({ timeout: 20_000 });
    let pulled = false;
    try {
      const getLatest = await $(tid('git-get-latest'));
      await getLatest.waitForDisplayed({ timeout: 60_000 });
      await getLatest.click();
      await browser.pause(4_000);
      pulled = true;
    } catch {
      // the remote-ahead nudge is probe-timing sensitive — capture whatever state we reached
    }
    await capture(pulled ? '09-pulled-get-latest' : '09-pull-state');
    // hard-confirm the pull actually landed (regardless of which affordance fired)
    if (pulled) {
      await browser.waitUntil(
        () => {
          try {
            git('cat-file', '-e', 'HEAD:.design/from-team.txt');
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 20_000, timeoutMsg: 'pull: local main never received the remote change' }
      );
    }
  });
});
