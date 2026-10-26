import { execFileSync } from 'node:child_process';

/**
 * One app per spec file — the launcher half (wdio.conf.ts `onWorkerEnd`).
 *
 * @wdio/tauri-service's embedded provider spawns the app ONCE, in the launcher's `onPrepare`, and every spec file
 * then opens a new WebDriver session against that same running app. So a spec inherited the previous spec's live
 * page (an open chat with its transcript, a composer draft, a pinned panel, a version-history panel) — and the
 * per-session "clean identity" in `beforeSession` ran in the worker AFTER that app was up: it deleted the running
 * sidecar's `_server.json` and the stores under its feet ("ENOENT … _server.json" in a later spec).
 *
 * The service health-checks its embedded server before each worker (`ensureEmbeddedServersHealthy`) and respawns
 * the app when the port does not answer. Stopping the app between spec files therefore gives each one a fresh app,
 * started after the reset. SIGTERM is the app's own clean exit (lib.rs: it stops its sidecars in order) — the same
 * signal the service sends at the end of a lane.
 *
 * The process is found by the lane's own embedded WebDriver port and must be a `maude-desktop` binary: nothing
 * else listening there is touched.
 */
export async function stopE2eApp(port: number, timeoutMs = 20_000): Promise<number[]> {
  const pids = listeners(port).filter((pid) => isMaudeDesktop(pid));
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(alive)) await sleep(200);
  for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
  // the port is free before the next spawn binds it
  while (Date.now() < deadline + 5000 && listeners(port).length > 0) await sleep(200);
  return pids;
}

function listeners(port: number): number[] {
  try {
    return execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return []; // lsof exits 1 when nothing listens
  }
}

function isMaudeDesktop(pid: number): boolean {
  try {
    const cmd = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], { encoding: 'utf8' });
    return /(^|\/)maude-desktop\s*$/.test(cmd.trim());
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* already gone */
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
