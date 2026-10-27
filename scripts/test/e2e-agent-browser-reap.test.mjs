// p8-e2e-fix-r10: the desktop e2e lanes reap the agent-browser daemons the e2e app's sidecar started.
//
// An agent-browser session is a daemon. One a default-lane capture left behind kept
// `localhost:4400/_canvas-shell.html?canvas=.design/ui/Print.tsx` open for hours, and every later spec's sidecar on
// :4400 got that page back as a collab peer — one more copy of Print's source merged into the room per run, until
// the sync refused the body and the cloud lane went red. `reapE2eAgentBrowsers` (helpers/app-lifecycle.ts) signals
// every process whose executable IS `<the e2e app's MacOS dir>/agent-browser`, and everything under it; a process
// with any other path is never touched.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { reapE2eAgentBrowsers } = await import(
  new URL('../../apps/desktop/e2e/helpers/app-lifecycle.ts', import.meta.url).href
);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const exited = (child) =>
  new Promise((r) => (child.exitCode !== null || child.signalCode ? r() : child.once('exit', r)));

test('the e2e app agent-browser and its children go; another agent-browser stays', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-ab-reap-'));
  const macos = join(dir, 'Maude.app', 'Contents', 'MacOS');
  const other = join(dir, 'elsewhere');
  mkdirSync(macos, { recursive: true });
  mkdirSync(other, { recursive: true });
  // an executable at the bundle path (a link: ps shows the path it was started by), and one elsewhere
  symlinkSync('/bin/sleep', join(macos, 'agent-browser'));
  symlinkSync('/bin/sleep', join(other, 'agent-browser'));
  const ours = spawn(join(macos, 'agent-browser'), ['300'], { stdio: 'ignore' });
  const theirs = spawn(join(other, 'agent-browser'), ['300'], { stdio: 'ignore' });
  const browser = spawn('/bin/sleep', ['300'], { stdio: 'ignore' }); // stands in for the daemon's Chrome
  try {
    await new Promise((r) => setTimeout(r, 200));
    // the live process table, plus the stand-in Chrome re-parented under our daemon
    const { processTable } = await import(
      new URL('../../apps/desktop/e2e/helpers/app-lifecycle.ts', import.meta.url).href
    );
    const table = processTable().map((p) => (p.pid === browser.pid ? { ...p, ppid: ours.pid } : p));
    const pids = await reapE2eAgentBrowsers(join(macos, 'maude-desktop'), {
      table,
      timeoutMs: 3000,
    });
    assert.deepEqual([...pids].sort(), [ours.pid, browser.pid].sort());
    await Promise.all([exited(ours), exited(browser)]);
    assert.equal(alive(ours.pid), false);
    assert.equal(alive(browser.pid), false);
    assert.equal(alive(theirs.pid), true);
    // nothing of ours left: a second pass signals nothing
    assert.deepEqual(await reapE2eAgentBrowsers(join(macos, 'maude-desktop')), []);
  } finally {
    for (const c of [ours, theirs, browser]) c.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});

// p8-e2e-fix-r11 (decision maude/v2-p8-e2e-fix-r11-reap-helpers-and-orphan-browsers): the reap ran while the print
// preflight's `canvas-rects.sh` (a child of the sidecar) was still polling. It killed that run's daemon, the helper's
// next `eval` started a new one, and a Chrome whose daemon had died was re-parented to launchd, where the
// agent-browser walk cannot see it. So the reap also (1) SIGKILLs the e2e app's own helper scripts — a TERM would run
// their exit trap, which opens a browser to park it — and (2) stops a browser agent-browser starts (under
// ~/.agent-browser/browsers/, or a chrome-headless-shell) that launchd adopted after this lane began. The person's
// own Chrome or Arc, and anything older than the lane, is never touched.
test('the app’s helper scripts and the browsers orphaned during this lane go; the person’s browsers stay', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'maude-ab-reap-r11-'));
  const macos = join(dir, 'Maude.app', 'Contents', 'MacOS');
  const bin = join(dir, 'Maude.app', 'Contents', 'Resources', 'apps', 'studio', 'bin');
  const browsers = join(dir, 'home', '.agent-browser', 'browsers');
  mkdirSync(macos, { recursive: true });
  const since = Date.now() - 60_000;
  const stand = () => spawn('/bin/sleep', ['300'], { stdio: 'ignore' });
  const helper = stand();
  const cft = stand();
  const cftHelper = stand();
  const shell = stand();
  const older = stand();
  const adopted = stand(); // a Chrome for Testing whose daemon is still alive (not launchd's)
  const chrome = stand();
  const arc = stand();
  const all = [helper, cft, cftHelper, shell, older, adopted, chrome, arc];
  const cftApp = `${browsers}/chrome-152.0.7977.75/Google Chrome for Testing.app`;
  const cftExe = `${cftApp}/Contents/MacOS/Google Chrome for Testing`;
  const rows = new Map([
    [
      helper.pid,
      {
        ppid: 1,
        started: since + 5000,
        command: `bash ${bin}/canvas-rects.sh ui/Print.tsx --root /x`,
      },
    ],
    [
      cft.pid,
      {
        ppid: 1,
        started: since + 6000,
        command: `${cftExe} --remote-debugging-port=0 --headless=new`,
      },
    ],
    [
      cftHelper.pid,
      {
        ppid: 1,
        started: since + 6000,
        command: `${cftApp}/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/152/Helpers/Google Chrome for Testing Helper (Renderer).app/Contents/MacOS/Google Chrome for Testing Helper (Renderer) --type=renderer`,
      },
    ],
    [
      shell.pid,
      {
        ppid: 1,
        started: since + 7000,
        command: `${dir}/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell --headless=old`,
      },
    ],
    [older.pid, { ppid: 1, started: since - 5000, command: `${cftExe} --remote-debugging-port=0` }],
    [
      adopted.pid,
      { ppid: process.pid, started: since + 8000, command: `${cftExe} --remote-debugging-port=0` },
    ],
    [
      chrome.pid,
      {
        ppid: 1,
        started: since + 9000,
        command:
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --restore-last-session',
      },
    ],
    [
      arc.pid,
      { ppid: 1, started: since + 9000, command: '/Applications/Arc.app/Contents/MacOS/Arc' },
    ],
  ]);
  try {
    await new Promise((r) => setTimeout(r, 200));
    const { processTable } = await import(
      new URL('../../apps/desktop/e2e/helpers/app-lifecycle.ts', import.meta.url).href
    );
    const live = processTable();
    // the table carries each process's start time
    assert.ok(live.length > 0 && live.every((p) => Number.isFinite(p.started) && p.started > 0));
    const table = live.map((p) => (rows.has(p.pid) ? { ...p, ...rows.get(p.pid) } : p));
    const pids = await reapE2eAgentBrowsers(join(macos, 'maude-desktop'), {
      table,
      timeoutMs: 3000,
      since,
      browserRoots: [`${browsers}/`],
    });
    assert.deepEqual([...pids].sort(), [helper.pid, cft.pid, cftHelper.pid, shell.pid].sort());
    await Promise.all([helper, cft, cftHelper, shell].map(exited));
    // no exit trap: the helper is killed outright
    assert.equal(helper.signalCode, 'SIGKILL');
    for (const c of [older, adopted, chrome, arc]) assert.equal(alive(c.pid), true);
    // without a lane start, nothing orphaned is touched
    const again = processTable().map((p) =>
      p.pid === older.pid ? { ...p, ppid: 1, started: Date.now(), command: `${cftExe} --x` } : p
    );
    assert.deepEqual(
      await reapE2eAgentBrowsers(join(macos, 'maude-desktop'), {
        table: again,
        since: null,
        browserRoots: [`${browsers}/`],
      }),
      []
    );
  } finally {
    for (const c of all) c.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
