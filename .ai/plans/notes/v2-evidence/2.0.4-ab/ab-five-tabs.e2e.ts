import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browser, expect } from '@wdio/globals';
import { readServerInfo } from '../helpers/sidecar';
import { focusTab, labels, openTab, pinCurrentWindow } from '../helpers/windows';

// A/B measurement (not a pin): open five projects one after another, focusing each, and count the
// maude-server processes of THIS app bundle that run. Writes MAUDE_AB_OUT/five-tabs.json.
const OUT = process.env.MAUDE_AB_OUT as string;
const PRIMARY = process.env.MAUDE_PROJECT_ROOT as string;

function makeProject(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `maude-e2e-ab-${name}-`));
  mkdirSync(join(dir, '.design', 'ui'), { recursive: true });
  writeFileSync(
    join(dir, '.design', 'config.json'),
    JSON.stringify({ name, designRoot: '.design', formatVersion: 2, designSystems: [] }, null, 2)
  );
  return dir;
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function serverPid(root: string): number {
  try {
    return readServerInfo(root).pid;
  } catch {
    return 0;
  }
}
function maudeServers(): { pid: number; rssMB: number }[] {
  return execFileSync('ps', ['-axo', 'pid=,rss=,comm='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m) => m && /maude-server$/.test(m[3]) && m[3].includes('/scratchpad/ab/app-'))
    .map((m) => ({ pid: Number(m![1]), rssMB: Math.round(Number(m![2]) / 1024) }));
}

describe('A/B: five open projects', () => {
  it('counts running project servers', async () => {
    await pinCurrentWindow();
    const steps: unknown[] = [];
    const roots: string[] = [PRIMARY];
    for (let i = 1; i < 5; i++) roots.push(makeProject(`p${i}`));
    for (let i = 1; i < roots.length; i++) {
      const opened = await openTab(roots[i]);
      await focusTab(opened.label);
      await browser.waitUntil(async () => serverPid(roots[i]) > 0 && alive(serverPid(roots[i])), {
        timeout: 90_000,
        interval: 500,
      });
      await browser.pause(5000);
      const running = roots.filter((r) => serverPid(r) > 0 && alive(serverPid(r))).length;
      steps.push({ open: i + 1, label: opened.label, tabs: (await labels()).length, runningProjects: running, servers: maudeServers() });
    }
    await browser.pause(20_000);
    const final = {
      tabs: (await labels()).length,
      runningProjects: roots.filter((r) => serverPid(r) > 0 && alive(serverPid(r))).length,
      servers: maudeServers(),
    };
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, 'five-tabs.json'), JSON.stringify({ steps, final }, null, 2));
    console.log(`AB-FIVE-TABS ${JSON.stringify(final)}`);
    expect(final.tabs).toBeGreaterThanOrEqual(5);
  });
});
