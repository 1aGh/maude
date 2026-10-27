import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

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

/**
 * p8-e2e-fix-r10 — the agent-browser daemons the e2e app's sidecar started, and every browser under them.
 *
 * `maude design screenshot` (the Report-a-Bug shot, an AI capture) runs the bundled agent-browser, whose session is
 * a DAEMON: it outlives the helper, the sidecar and the app. One a 03:36 default-lane spec left behind still had
 * `localhost:4400/_canvas-shell.html?canvas=.design/ui/Print.tsx` open at 05:43, and every later spec's sidecar on
 * :4400 got that page back as a collab peer, which merged one more copy of Print's source into the room per run
 * until the sync refused it (the cloud lane's "1 source change was not applied" red). The helpers now close their
 * page on exit (apps/studio/bin/_ab-park.sh); this is the harness's own net, run while no app runs.
 *
 * Only processes whose executable IS `<the e2e app's MacOS dir>/agent-browser` (the debug bundle this lane runs)
 * and their descendants. A person's own agent-browser (another path) is never touched. Returns the pids signalled.
 */
export async function reapE2eAgentBrowsers(
  appBinary: string,
  { timeoutMs = 5000, table = processTable() } = {}
): Promise<number[]> {
  const ab = join(dirname(appBinary), 'agent-browser');
  const roots = table
    .filter((p) => p.command === ab || p.command.startsWith(`${ab} `))
    .map((p) => p.pid);
  const all = new Set<number>();
  const walk = (pid: number) => {
    if (all.has(pid)) return;
    all.add(pid);
    for (const c of table) if (c.ppid === pid) walk(c.pid);
  };
  for (const r of roots) walk(r);
  const pids = [...all];
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(alive)) await sleep(200);
  for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
  if (pids.length)
    console.warn(
      `[app-lifecycle] reaped ${roots.length} agent-browser daemon(s) of the e2e app, ${pids.length} process(es)`
    );
  return pids;
}

/** `ps` as { pid, ppid, command } rows (the full command line). */
export function processTable(): { pid: number; ppid: number; command: string }[] {
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    })
      .split('\n')
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }));
  } catch {
    return [];
  }
}
