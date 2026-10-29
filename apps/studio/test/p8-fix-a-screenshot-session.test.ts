// p8-fix-a F6: a capture closes only an agent-browser session IT opened.
//
// screenshot.sh (canvas modes) used to close the shared "default" session on exit, so an agent that was
// browsing in it lost the session after every /design:screenshot. Now the helper notes, right before its first
// open, whether the session's daemon is already there (its socket is on disk): a session it started is parked
// and closed as before (p8-e2e-fix-r10: no canvas page left behind as a live collab peer); one that was already
// running is parked on about:blank (the capture reused its tab, so the canvas page must not stay open) and
// left running — never closed.

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const dirs: string[] = [];
const listeners: Array<{ stop(): void }> = [];
afterAll(() => {
  for (const l of listeners) l.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function stubAb() {
  const dir = mkdtempSync(join(tmpdir(), 'fa6-'));
  dirs.push(dir);
  const log = join(dir, 'calls.txt');
  const ab = join(dir, 'agent-browser');
  writeFileSync(
    ab,
    `#!/bin/bash
echo "$*" >> "${log}"
case "$1" in
  screenshot) out="\${@: -1}"; printf 'PNGDATA%.0s' {1..40} > "$out" ;;
  eval) echo 3 ;;
esac
exit 0
`
  );
  chmodSync(ab, 0o755);
  return { dir, ab, log };
}

function capture(opts: { sessionRunning: boolean }) {
  const { dir, ab, log } = stubAb();
  // a short socket dir (macOS caps a socket path at 103 bytes)
  const sockDir = mkdtempSync(join(tmpdir(), 'fa6s-'));
  dirs.push(sockDir);
  if (opts.sessionRunning) {
    // the agent's own daemon: a live unix socket under the default session's name
    listeners.push(Bun.listen({ unix: join(sockDir, 'default.sock'), socket: { data() {} } }));
  }
  mkdirSync(join(dir, 'home'));
  const r = Bun.spawnSync(
    [
      'bash',
      join(BIN, 'screenshot.sh'),
      '--url',
      'http://localhost:1/_canvas-shell.html?canvas=.design/ui/Print.tsx',
      '--full',
      '--out',
      join(dir, 'shot.png'),
      '--engine',
      'agent-browser',
      '--timeout',
      '1',
    ],
    {
      env: {
        PATH: `${dir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
        HOME: join(dir, 'home'),
        MAUDE_AGENT_BROWSER: ab,
        AGENT_BROWSER_EXECUTABLE_PATH: '/usr/bin/true',
        AGENT_BROWSER_SOCKET_DIR: sockDir,
        NO_OPEN: '1',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
  let lines: string[] = [];
  try {
    lines = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {}
  return { code: r.exitCode, lines };
}

describe('screenshot.sh and the agent’s own browser session', () => {
  test('a session the capture opened is parked and closed', () => {
    const { code, lines } = capture({ sessionRunning: false });
    expect(code).toBe(0);
    expect(lines.slice(-2)).toEqual(['open about:blank', 'close']);
  }, 30_000);

  test('a session already running is parked on about:blank and NOT closed', () => {
    const { code, lines } = capture({ sessionRunning: true });
    expect(code).toBe(0);
    expect(lines.some((l) => l.startsWith('screenshot --full '))).toBe(true);
    expect(lines.at(-1)).toBe('open about:blank');
    expect(lines).not.toContain('close');
  }, 30_000);
});
