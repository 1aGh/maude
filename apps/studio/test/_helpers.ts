// Shared test scaffolding. Bun-test only.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Subprocess, spawn } from 'bun';

export interface Sandbox {
  root: string;
  designRoot: string;
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'mdcc-test-'));
  const designRoot = join(root, '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify(
      {
        name: 'test',
        designRoot: '.design',
        // v2 edits only a format-2 project (format.ts FORMAT_GATE_OPTS, CONTRACT §4.1); a test of
        // the format-1 view-only path drops the key itself (format-gate-studio.test.ts).
        formatVersion: 2,
        canvasGroups: [
          { label: 'System', path: 'system' },
          { label: 'UI', path: 'ui' },
        ],
      },
      null,
      2
    )
  );
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'ui', 'fixture.html'),
    '<!doctype html><html><head><title>fix</title></head><body><h1>fixture</h1></body></html>'
  );
  return { root, designRoot };
}

// Base is spread by pid, not a fixed literal — bun test runs different test
// files as separate processes, each importing a fresh copy of this module, so
// a fixed base (e.g. 4500 for everyone) reliably collides across files. The
// pid spread doesn't guarantee uniqueness on its own — bootServer's pid check
// below is the actual safety net — but it makes collisions rare in practice.
let portCounter = 4500 + (process.pid % 4000);
export function nextPort(): number {
  // Bump on every call so parallel tests don't collide, and skip a port something on this machine
  // already listens on: the range crosses long-lived local services (Syncthing's GUI is 8384, and
  // ~/git is a Syncthing folder), and no caller retries — a held port timed out bootServer after
  // 15 s (acl-l21-capture in the V2-5 A3 full suite).
  for (let tries = 0; tries < 64; tries++) {
    portCounter += 1;
    if (portIsFree(portCounter)) return portCounter;
  }
  return portCounter;
}

function portIsFree(port: number): boolean {
  // Both the loopback AND the wildcard address: macOS ControlCenter (AirPlay) holds `*:5000`
  // and `*:7000`, yet a 127.0.0.1 bind there succeeds — and `localhost` then reaches AirPlay
  // over ::1, so the boot's health probe never sees the studio (S9.12b, port 5000).
  for (const hostname of ['127.0.0.1', '0.0.0.0']) {
    try {
      const probe = Bun.listen({ hostname, port, socket: { data() {} } });
      probe.stop(true);
    } catch {
      return false;
    }
  }
  return true;
}

/** The hub a fixture's `.design/config.json` names, as the app's own binding (see bootServer). */
function appBoundHub(root: string): Record<string, string> {
  try {
    const url = JSON.parse(readFileSync(join(root, '.design', 'config.json'), 'utf8'))?.linkedHub
      ?.url;
    return typeof url === 'string' && url ? { MAUDE_APP_BOUND_HUB: url } : {};
  } catch {
    return {};
  }
}

export async function bootServer(
  root: string,
  port: number,
  extraEnv?: Record<string, string>
): Promise<Subprocess> {
  const serverPath = join(import.meta.dir, '..', 'server.ts');
  const proc = spawn({
    cmd: ['bun', 'run', serverPath, '--port', String(port), '--root', root],
    cwd: join(import.meta.dir, '..'),
    env: {
      ...process.env,
      NO_OPEN: '1',
      NODE_ENV: 'test',
      // S5.1b — an unlinked project's boot stamps this install's machine id; a test boot keeps it
      // inside the sandbox (never ~/.config/maude/machine.json). One file per root, so a re-boot of
      // the same project is the same machine and its store is not moved aside (C1).
      MAUDE_MACHINE_FILE: join(root, '.design', '_state', 'machine.json'),
      // gate-b-sec4 — a fixture's committed linkedHub is honoured only for a link made on this Mac
      // (sync/link-consent.ts). The harness IS the app that made it, so it says so the way the
      // desktop does for its own copies. A test of the gate itself passes `MAUDE_APP_BOUND_HUB: ''`.
      ...appBoundHub(root),
      ...extraEnv,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  // Wait for the server to bind — the first spawn cold-compiles the whole
  // studio TS, which under parallel test load regularly blows a 3 s budget
  // (the flaky "server did not start" class of failure).
  //
  // THIS BUDGET IS ONLY REACHABLE BECAUSE THE SUITE RAISES THE PER-TEST TIMEOUT.
  // bun's default is 5 s, so the TEST was killed while this loop still had half
  // its patience left, and the failure never named a boot at all — it named
  // whichever test happened to be booting when the machine was busiest, at
  // exactly 5000ms, a different one every run. `test:dev-server` therefore
  // passes `--timeout 20000` (bunfig's `[test] timeout` is NOT honored on bun
  // 1.3.3 — measured, not assumed). Change one, change the other.
  // 15 s, raised from 10 s. The full 390-file suite still lost ONE boot to this
  // budget per run — a different test each time, which is the signature the
  // comment above already names. It is a flake in the BUDGET, not a defect in
  // whichever test drew the short straw: the suite that reported it passes 21/21
  // in isolation. Still strictly under the runner's per-test 20 s, which is the
  // invariant that matters — exceed that and the failure stops saying "server
  // did not start" and goes back to naming an innocent test at the timeout mark.
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const r = await fetch(`http://localhost:${port}/_health`, {
        signal: AbortSignal.timeout(200),
      });
      if (r.ok) {
        const json = (await r.json()) as { pid?: number };
        // A same-port collision with a concurrently-running test file's server
        // (see the portCounter comment above) would otherwise look "ready" —
        // /_health answers fine, just from someone else's sandbox — and every
        // later request 404s against a designRoot that doesn't have our
        // fixtures. Only trust the health check if it's actually our process.
        if (json.pid === proc.pid) return proc;
      }
    } catch {
      /* not up yet */
    }
    await Bun.sleep(50);
  }
  proc.kill();
  throw new Error(`server did not start on port ${port} within 15 s`);
}

/**
 * Stop a spawned process: SIGTERM, then SIGKILL if it has not exited within
 * `graceMs`.
 *
 * BOUNDED ON PURPOSE (V2-2.13). This used to await `proc.exited` with no limit,
 * and the studio's `shutdown()` (server.ts) awaits teardown steps with no limit
 * either — so one stuck step kept `process.exit(0)` from ever running, and the
 * caller's `afterAll` sat until the 20 s hook timeout. That is exactly how
 * `figma-routes.test.ts` failed in 26 CI runs of the full suite (2026-09-11 →
 * 09-21): every test green, then "killed 1 dangling process" and
 * `(fail) (unnamed)`. A test that is not ABOUT shutdown must not fail on it —
 * but the hang is a real server behaviour, so the escalation is logged rather
 * than absorbed silently (test/helpers-killproc.test.ts holds both halves).
 */
export async function killProc(proc: Subprocess, graceMs = 5000) {
  const exited = proc.exited.then(
    () => true,
    () => true
  );
  proc.kill();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inTime = await Promise.race([
    exited,
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), graceMs);
    }),
  ]);
  clearTimeout(timer);
  if (!inTime) {
    console.warn(
      `[killProc] pid ${proc.pid} ignored SIGTERM for ${graceMs} ms — sending SIGKILL (a shutdown that hangs: see apps/studio/server.ts shutdown())`
    );
    proc.kill('SIGKILL');
    await exited;
  }
}
