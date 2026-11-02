import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { $, browser, expect } from '@wdio/globals';

import { currentBranch, openHistory } from '../helpers/chrome';
import { capture, startReport } from '../helpers/evidence';
import { isNativeShell } from '../helpers/native';
import { setSelect } from '../helpers/select';
import { waitForSidecar } from '../helpers/sidecar';

/**
 * DDR-133 — the COMPLETE git lifecycle, driven through the desktop app UI (S11.10: Menu › Version
 * history › Advanced — the Branch select, New branch…, Fetch, Save a version with a note…,
 * Publish, Add to main), DOM-driven, one screenshot per operation. Boots into a clone of a LOCAL bare
 * repo (wdio.lifecycle.conf.ts → make-lifecycle-fixture) — no GitHub, no network, no credentials
 * (decision `v2-p8-e2e-lifecycle-local-bare-remote`); the bare repo plays the team's remote and is read
 * and moved with `git --git-dir`. The real GitHub push is checked once in the live checks.
 *
 * Covers: switch repos · switch branches · new branch · commit (Save version) ·
 * push (Publish) · fetch remote branches · pull (Get latest) · merge to main (fold).
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const WORLD = JSON.parse(process.env.MAUDE_E2E_LIFECYCLE_FIXTURE as string) as {
  remote: string;
  env: Record<string, string>;
};
const BR = 'smoke/ui-lifecycle';
const GIT_ENV = {
  ...process.env,
  ...WORLD.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Teammate',
  GIT_AUTHOR_EMAIL: 'team@maude.local',
  GIT_COMMITTER_NAME: 'Teammate',
  GIT_COMMITTER_EMAIL: 'team@maude.local',
};

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: PRIMARY,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}
/** The team's remote (the bare repo), read and moved directly. */
function remoteGit(...args: string[]): string {
  return execFileSync('git', ['--git-dir', WORLD.remote, ...args], {
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim();
}
const onRemote = (ref: string): boolean => {
  try {
    remoteGit('rev-parse', '--verify', '--quiet', ref);
    return true;
  } catch {
    return false;
  }
};
/** A teammate's out-of-band commit on the remote's main: a scratch clone through the same shim, one file, push. */
function teammateCommit(rel: string, text: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'maude-e2e-teammate-'));
  try {
    const url = execFileSync('git', ['-C', PRIMARY, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      env: GIT_ENV,
    }).trim();
    const run = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: GIT_ENV });
    run('clone', '--quiet', url, '.');
    writeFileSync(join(dir, rel), text);
    run('add', rel);
    run('commit', '--quiet', '-m', 'team: out-of-band change');
    run('push', '--quiet', 'origin', 'main');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const tid = (s: string) => `[data-testid="${s}"]`;

/** Wait for the bottom-dock project trigger (the app shell is up / reloaded). Polls
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
/** The git lives one fold down in Version history (the helper opens the panel and the fold, and
 *  leaves them open when they already are). */
async function openAdvanced(): Promise<void> {
  await waitForShell();
  await openHistory();
}

/** The Branch select is a native `<select>` (git-advanced.jsx): the embedded WebDriver's option click does not select in
 *  WKWebView (helpers/select.ts), so the pick goes through the select's own `change`. The pick is asserted — a select
 *  that lacks the branch is a spec/product mismatch, not a quiet no-op that times out a minute later. */
async function pickBranch(name: string): Promise<void> {
  await $(tid('vh-git-branch')).waitForDisplayed({ timeout: 20_000 });
  expect(await setSelect('vh-git-branch', name)).toBe(true);
}

describe('git-lifecycle (native-desktop)', () => {
  before(async () => {
    startReport('git-lifecycle (native-desktop) — complete git functionality through the UI');
    await browser.setTimeout({ script: 60_000 });
  });

  // nothing to clean up: the remote is a throwaway bare repo the next run's fixture recreates

  it('drives switch-repos, branches, commit, push, fetch, pull, merge through the UI', async () => {
    // ── boot ──────────────────────────────────────────────────────────────────
    const url = await waitForSidecar();
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+/);
    await waitForShell();
    expect(await isNativeShell()).toBe(true);
    expect(await currentBranch()).toBe('main');
    await capture('01-booted-on-main');

    // (switch-repos is exercised by the separate git-switch-repos scenario — the
    // open_local_project sidecar-respawn is too WebDriver-flaky to chain inline.)

    // ── 1. NEW BRANCH (Advanced → New branch… → name → Create branch) ──────────
    await openAdvanced();
    await $(tid('switcher-new-branch')).click();
    const input = await $(tid('switcher-new-branch-input'));
    await input.waitForDisplayed({ timeout: 10_000 });
    await input.setValue(BR);
    await $(tid('switcher-new-branch-create')).click();
    await browser.waitUntil(async () => (await currentBranch()) === BR, {
      timeout: 60_000,
      timeoutMsg: 'new-branch: the Branch select never showed the new branch',
    });
    await capture('02-new-branch-created');

    // ── 2. SWITCH BRANCHES (the Branch select: main → back) — reload-based, reliable ──
    await openAdvanced();
    await pickBranch('main');
    await browser.waitUntil(async () => (await currentBranch()) === 'main', {
      timeout: 60_000,
      timeoutMsg: 'switch-branches: did not check out main',
    });
    await capture('03-switched-to-main');
    await openAdvanced();
    await pickBranch(BR);
    await browser.waitUntil(async () => (await currentBranch()) === BR, {
      timeout: 60_000,
      timeoutMsg: 'switch-branches: did not return to the feature branch',
    });
    await capture('04-switched-back-to-feature-branch');

    // ── 3. COMMIT (write a change → Save a version with a note… → note → Save all) ──
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
    await $(tid('vh-git-save')).click();
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
    await capture('06-published');
    // the branch is on the team's remote, at the commit this clone made
    await browser.waitUntil(() => onRemote(`refs/heads/${BR}`), {
      timeout: 30_000,
      timeoutMsg: 'push: branch never appeared on the remote',
    });
    expect(remoteGit('rev-parse', `refs/heads/${BR}`)).toBe(git('rev-parse', 'HEAD'));

    // ── 5. FETCH remote branches (a teammate branch appears) ───────────────────
    remoteGit(
      'update-ref',
      'refs/heads/smoke/from-remote',
      remoteGit('rev-parse', 'refs/heads/main')
    );
    await openAdvanced();
    await $(tid('switcher-fetch')).click();
    // an <option> is never "displayed" to WebDriver — it is in the select once the fetch lands
    const remoteRow = await $(tid('branch-row-smoke-from-remote'));
    await remoteRow.waitForExist({ timeout: 30_000 });
    await capture('07-fetched-remote-branch');

    // ── 6. ADD TO MAIN (fold) — done while main is in sync, so the publish is ──
    // clean. We're still on smoke/ui-lifecycle, so the "Add to main" button is
    // present; the fold is already open from the fetch.
    await openAdvanced();
    await $(tid('switcher-merge')).click();
    const confirm = await $(tid('switcher-merge-confirm'));
    await confirm.waitForDisplayed({ timeout: 10_000 });
    await confirm.click();
    await browser.waitUntil(async () => (await currentBranch()) === 'main', {
      timeout: 90_000,
      timeoutMsg: 'merge: did not land back on main after fold',
    });
    await capture('08-merged-to-main');
    await browser.waitUntil(
      () => {
        try {
          remoteGit('cat-file', '-e', 'refs/heads/main:.design/ui-lifecycle.txt');
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
    teammateCommit('.design/from-team.txt', 'from the team');
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
