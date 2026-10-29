// p8-ab-park-race (decision maude/v2-p8-ab-park-waits-for-daemon): back-to-back captures on ONE agent-browser
// session all succeed.
//
// A capture closes its session on exit (_ab-park.sh, p8-e2e-fix-r10). `close` returns while the daemon is still
// shutting down — its socket is on disk for another ~200 ms — so the NEXT `maude design screenshot` on the same
// session name, started right away (an agent looping /design:new step-9 per-artboard checks, --all-screens in a
// shell loop, a critic), reached the dying daemon and failed with "Invalid response: EOF". ab_park now returns only
// once the session's socket is gone, so the next call starts a fresh daemon.
//
// This runs the REAL agent-browser against a real headless Chromium, so it is skipped where neither is installed.
// It is a probabilistic reproduction (the window is a few hundred ms): five captures give four transitions, and
// with the wait reverted the pair fails ~60 % of the time, so a run is red ≥ 97 % of the time.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A Chromium agent-browser can drive: the caller's, else the one agent-browser itself installed. */
function findBrowser(): string | null {
  const fromEnv = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const root = join(homedir(), '.agent-browser', 'browsers');
  if (!existsSync(root)) return null;
  for (const v of readdirSync(root).sort().reverse()) {
    for (const rel of [
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      'chrome',
      'chrome-headless-shell',
    ]) {
      const p = join(root, v, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const abOnPath = Bun.spawnSync(['bash', '-c', 'command -v agent-browser']).exitCode === 0;
const browser = findBrowser();
const live = abOnPath && browser !== null;

describe('screenshot.sh on one shared session', () => {
  test.skipIf(!live)(
    'five captures in a row on the same session name all produce a PNG',
    async () => {
      // a short throwaway socket dir (macOS caps a socket path at 103 bytes) and a throwaway HOME
      const dir = mkdtempSync(join(tmpdir(), 'abp-'));
      dirs.push(dir);
      const sockDir = join(dir, 's');
      mkdirSync(sockDir);
      mkdirSync(join(dir, 'home'));
      const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: () => new Response('<h1>hello</h1>', { headers: { 'content-type': 'text/html' } }),
      });
      const failures: string[] = [];
      try {
        for (let i = 1; i <= 5; i++) {
          const out = join(dir, `shot${i}.png`);
          const proc = Bun.spawn(
            [
              'bash',
              join(BIN, 'screenshot.sh'),
              '--url',
              `http://127.0.0.1:${server.port}/`,
              '--full',
              '--out',
              out,
              '--engine',
              'agent-browser',
              '--timeout',
              '1',
            ],
            {
              env: {
                PATH: process.env.PATH ?? '/usr/bin:/bin',
                HOME: join(dir, 'home'),
                AGENT_BROWSER_SOCKET_DIR: sockDir,
                AGENT_BROWSER_SESSION: 'abp-race',
                AGENT_BROWSER_EXECUTABLE_PATH: browser as string,
                NO_OPEN: '1',
              },
              stdout: 'pipe',
              stderr: 'pipe',
            }
          );
          const code = await proc.exited;
          const err = await new Response(proc.stderr).text();
          const ok = code === 0 && existsSync(out) && statSync(out).size > 100;
          if (!ok)
            failures.push(
              `capture ${i}: exit ${code} — ${err.split('\n').filter(Boolean).pop() ?? ''}`
            );
        }
      } finally {
        server.stop(true);
        // a daemon this test started, and only that one
        Bun.spawnSync(['agent-browser', 'close'], {
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: join(dir, 'home'),
            AGENT_BROWSER_SOCKET_DIR: sockDir,
            AGENT_BROWSER_SESSION: 'abp-race',
          },
        });
      }
      expect(failures).toEqual([]);
    },
    120_000
  );
});
