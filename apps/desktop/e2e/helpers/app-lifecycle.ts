import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
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
 *
 * p8-e2e-fix-r11 (decision maude/v2-p8-e2e-fix-r11-reap-helpers-and-orphan-browsers): the reap ran while the print
 * preflight's `canvas-rects.sh` (a child of the sidecar, which outlives it) was still polling — it killed that run's
 * daemon, the helper's next call started another, and a Chrome whose daemon had died was adopted by launchd, out of
 * the walk's reach. So it also:
 *   - SIGKILLs the e2e app's own helper scripts (a command line naming `<the bundle>/Contents/Resources/apps/studio/
 *     bin/`) and walks their children. Not TERM: bash would run the helper's exit trap, which opens a browser to park
 *     its page — the respawn this stops.
 *   - stops a browser agent-browser starts — under `browserRoots` (~/.agent-browser/browsers/) or a
 *     `chrome-headless-shell` — that launchd adopted (ppid 1) and that started after this lane began (`since`, the
 *     lane start wdio.conf.ts stamps in MAUDE_E2E_LANE_STARTED). Without a lane start, none. The person's own Chrome
 *     or Arc lives under /Applications and is never matched.
 * On the live table it repeats until a pass finds nothing, so a process started between the snapshot and the signal
 * is caught too.
 */
export async function reapE2eAgentBrowsers(
  appBinary: string,
  {
    timeoutMs = 5000,
    table,
    since = laneStarted(),
    browserRoots = [`${join(homedir(), '.agent-browser', 'browsers')}/`],
  }: {
    timeoutMs?: number;
    table?: ProcessRow[];
    since?: number | null;
    browserRoots?: string[];
  } = {}
): Promise<number[]> {
  const ab = join(dirname(appBinary), 'agent-browser');
  const helperBin = `${join(dirname(dirname(appBinary)), 'Resources', 'apps', 'studio', 'bin')}/`;
  const isAgentBrowser = (p: ProcessRow) => p.command === ab || p.command.startsWith(`${ab} `);
  const isHelper = (p: ProcessRow) => p.command.includes(helperBin);
  const isOrphanBrowser = (p: ProcessRow) =>
    since != null &&
    p.ppid === 1 &&
    p.started >= Math.floor(since / 1000) * 1000 &&
    (browserRoots.some((r) => p.command.startsWith(r)) ||
      /^\S*\/chrome-headless-shell(?:\s|$)/.test(p.command));
  const reaped: number[] = [];
  let daemons = 0;
  for (let pass = 0; pass < (table ? 1 : 3); pass++) {
    const rows = table ?? processTable();
    const helpers = rows.filter(isHelper).map((p) => p.pid);
    const roots = rows.filter((p) => isAgentBrowser(p) || isOrphanBrowser(p)).map((p) => p.pid);
    daemons += rows.filter(isAgentBrowser).length;
    const all = new Set<number>();
    const walk = (pid: number) => {
      if (all.has(pid)) return;
      all.add(pid);
      for (const c of rows) if (c.ppid === pid) walk(c.pid);
    };
    for (const r of [...helpers, ...roots]) walk(r);
    if (all.size === 0) break;
    for (const pid of helpers) signal(pid, 'SIGKILL');
    const pids = [...all];
    for (const pid of pids) signal(pid, 'SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && pids.some(alive)) await sleep(200);
    for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
    reaped.push(...pids);
  }
  if (reaped.length)
    console.warn(
      `[app-lifecycle] reaped ${daemons} agent-browser daemon(s) of the e2e app, ${reaped.length} process(es)`
    );
  return reaped;
}

/** The lane's start (ms), stamped once by wdio.conf.ts; null when no lane stamped one. */
function laneStarted(): number | null {
  const n = Number(process.env.MAUDE_E2E_LANE_STARTED);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type ProcessRow = { pid: number; ppid: number; started: number; command: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `ps` as { pid, ppid, started (ms, local time, 1 s resolution), command } rows (the full command line). */
export function processTable(): ProcessRow[] {
  try {
    return execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, // lstart's month names are locale-dependent
    })
      .split('\n')
      .map((l) =>
        /^\s*(\d+)\s+(\d+)\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d\d):(\d\d):(\d\d)\s+(\d{4})\s+(.*)$/.exec(
          l
        )
      )
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({
        pid: Number(m[1]),
        ppid: Number(m[2]),
        started: new Date(
          Number(m[8]),
          MONTHS.indexOf(m[3]),
          Number(m[4]),
          Number(m[5]),
          Number(m[6]),
          Number(m[7])
        ).getTime(),
        command: m[9],
      }));
  } catch {
    return [];
  }
}
