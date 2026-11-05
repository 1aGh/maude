import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browser, expect } from '@wdio/globals';

import { capture, startReport } from '../helpers/evidence';
import { readServerInfo, waitForSidecar } from '../helpers/sidecar';
import { focusTab, labels, openTab, pinCurrentWindow, waitWindow } from '../helpers/windows';

/**
 * 2.0.4 (decision `v2-michal-running-cap-3-rest-15min`): at most THREE project servers run, and a background tab
 * nobody used for the idle limit rests on its own. wdio.tabs-cap.conf.ts runs the shipped cap (no
 * MAUDE_E2E_RUNNING_CAP) and an idle limit of 60 s (MAUDE_E2E_IDLE_REST_SECS). The cap step and the idle step are
 * told apart by the shell's own decision log (MAUDE_E2E_SHELL_LOG): "over the cap of 3 — resting" vs
 * "unused for … — resting".
 */
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;
const SHELL_LOG = process.env.MAUDE_E2E_SHELL_LOG as string;
const RESTING_LINE = 'Opens when you come back to it.';
const CAP_LINE = /over the cap of 3 — resting (p-\S+)/;
const IDLE_LINE = /(p-\S+) unused for \d+ min — resting/g;

function makeProject(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `maude-e2e-cap-${name}-`));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  mkdirSync(join(dir, '.design', 'system'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name, designRoot: '.design', formatVersion: 2, designSystems: [] }, null, 2)
  );
  return dir;
}

function shellLog(): string {
  return existsSync(SHELL_LOG) ? readFileSync(SHELL_LOG, 'utf8') : '';
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The pid in a project's `_server.json`, or 0 while there is none. */
function serverPid(root: string): number {
  try {
    return readServerInfo(root).pid;
  } catch {
    return 0;
  }
}

async function waitServer(root: string): Promise<number> {
  let pid = 0;
  await browser.waitUntil(
    async () => {
      pid = serverPid(root);
      return pid > 0 && alive(pid);
    },
    { timeout: 60_000, interval: 250, timeoutMsg: `no live server for ${root}` }
  );
  return pid;
}

/** What a tab's document shows, read WITHOUT focusing it (a WebDriver switch only). */
async function splashStatus(label: string): Promise<string> {
  await browser.switchToWindow(label);
  return browser
    .execute(() => document.querySelector('[data-testid="splash-status"]')?.textContent ?? '')
    .catch(() => '');
}

async function waitResting(label: string, timeout: number): Promise<void> {
  await browser.waitUntil(async () => (await splashStatus(label)) === RESTING_LINE, {
    timeout,
    interval: 1_000,
    timeoutMsg: `${label} never showed the resting splash`,
  });
}

describe('project-tabs-cap (native-desktop)', () => {
  const tabs: string[] = [];
  const roots: Record<string, string> = {};
  const pids: Record<string, number> = {};
  let fourth = '';
  let capRested = '';
  let idleRested: string[] = [];

  before(async () => {
    startReport('project-tabs-cap (native-desktop)');
    await browser.setTimeout({ script: 60_000 });
    await waitForSidecar();
    const a = await pinCurrentWindow();
    tabs.push(a);
    roots[a] = PRIMARY;
    pids[a] = await waitServer(PRIMARY);
  });

  it('three projects run side by side under the default cap', async () => {
    for (const name of ['second', 'third']) {
      const root = makeProject(name);
      const opened = await openTab(root);
      expect(opened.opened).toBe('new');
      await waitWindow(opened.label);
      await focusTab(opened.label);
      tabs.push(opened.label);
      roots[opened.label] = root;
      pids[opened.label] = await waitServer(root);
    }
    expect(await labels()).toHaveLength(3);
    await browser.pause(3_000); // a cap rest would have happened by now
    for (const label of tabs) {
      expect(alive(pids[label] as number)).toBe(true);
      expect(await splashStatus(label)).not.toBe(RESTING_LINE);
    }
    expect(shellLog()).not.toMatch(CAP_LINE);
    await focusTab(tabs[2] as string);
    await capture('1-three-running');
  });

  it('a fourth open project rests one idle tab: three servers keep running', async () => {
    const root = makeProject('fourth');
    const opened = await openTab(root);
    expect(opened.opened).toBe('new');
    fourth = opened.label;
    await waitWindow(fourth);
    await focusTab(fourth);
    roots[fourth] = root;
    pids[fourth] = await waitServer(root);
    expect(await labels()).toHaveLength(4);

    await browser.waitUntil(async () => CAP_LINE.test(shellLog()), {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `no cap rest in the shell log:\n${shellLog().slice(-2_000)}`,
    });
    capRested = (shellLog().match(CAP_LINE) as RegExpMatchArray)[1] as string;
    console.log(`[tabs-cap] cap rested ${capRested}`);
    expect(tabs).toContain(capRested); // one of the three earlier tabs, never the new one
    // …and nothing rested by idling first: the cap step is what this proves
    expect([...shellLog().matchAll(IDLE_LINE)]).toHaveLength(0);
    await waitResting(capRested, 30_000);
    await browser.waitUntil(async () => !alive(pids[capRested] as number), {
      timeout: 15_000,
      interval: 250,
      timeoutMsg: "the rested tab's server process was still running",
    });
    const running = [...tabs, fourth].filter((l) => alive(pids[l] as number));
    expect(running).toHaveLength(3);
    expect(running).toContain(fourth);
    await focusTab(fourth);
    await capture('2-fourth-rests-one');
  });

  it('a background tab unused past the idle limit rests on its own; the active tab never does', async () => {
    await focusTab(fourth);
    const background = tabs.filter((l) => l !== capRested);
    expect(background).toHaveLength(2);
    // 60 s limit + a 60 s sweep: both rest within ~2 min of losing focus
    await browser.waitUntil(
      async () => {
        idleRested = [...shellLog().matchAll(IDLE_LINE)].map((m) => m[1] as string);
        return background.every((l) => idleRested.includes(l));
      },
      {
        timeout: 200_000,
        interval: 2_000,
        timeoutMsg: `the background tabs never idle-rested:\n${shellLog().slice(-2_000)}`,
      }
    );
    console.log(`[tabs-cap] idle rested ${JSON.stringify(idleRested)}`);
    expect(idleRested).not.toContain(fourth);
    for (const label of background) {
      await waitResting(label, 15_000);
      await browser.waitUntil(async () => !alive(pids[label] as number), {
        timeout: 15_000,
        interval: 250,
        timeoutMsg: `${label}'s server was still running after its idle rest`,
      });
    }
    expect(alive(pids[fourth] as number)).toBe(true);
    expect(await splashStatus(fourth)).not.toBe(RESTING_LINE);
    await focusTab(fourth);
    await capture('3-idle-rested');
  });

  it('focusing an idle-rested tab wakes it', async () => {
    const label = idleRested[0] as string;
    await focusTab(label);
    await browser.waitUntil(
      async () => {
        const pid = serverPid(roots[label] as string);
        return pid > 0 && pid !== pids[label] && alive(pid);
      },
      { timeout: 60_000, interval: 500, timeoutMsg: `${label} did not get a new server` }
    );
    await browser.waitUntil(async () => (await splashStatus(label)) !== RESTING_LINE, {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: `${label} still shows the resting splash`,
    });
    await focusTab(label);
    await capture('4-woken');
  });
});
