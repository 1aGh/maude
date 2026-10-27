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
