import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

// No relative imports: scripts/test/e2e-prefs-guard.test.mjs loads this file under plain node (type stripping needs
// explicit extensions, which the e2e tsconfig does not allow).

/**
 * The real-config tripwire for a desktop e2e lane (p8-e2e-fix-r12 §0).
 *
 * `ui-prefs.ts` writes `MAUDE_UI_PREFS_PATH`, else `$XDG_CONFIG_HOME/maude/prefs.json`, else
 * `homedir()/.config/maude/prefs.json` — so ANY studio that runs without the lane's isolation writes the person's
 * own prefs the moment a page POSTs `/_api/ui-prefs`. wdio.conf.ts gives the launcher a `maude-e2e-*` home and every
 * child inherits it; a process that does not (an env allowlist, a LaunchServices relaunch, another session's server)
 * used to be visible only afterwards, as a moved mtime, with the lane already green (r11 pass C2).
 *
 * Every `intervalMs` (0.5 s) the guard reads the process table and, for each studio-like process, the environment it
 * started with (`ps eww`). A process the LANE owns — a descendant of the launcher, or born after the lane started —
 * that is not isolated is an offender: the default action kills the e2e app and the offender and fails the launcher
 * (exit 98). A process that was already running and is not the lane's (the person's own Maude) is reported once and
 * left alone: the harness never kills what it did not start, and such a server can still move prefs.json through a
 * browser tab — so the pass's before/after mtime check stays the authority on that.
 */

/** maude-server (app sidecar, Home), `bun … server.ts`, any bun, and a `maude --root` studio (npm channel). */
export function isStudioLike(command: string): boolean {
  const argv0 = command.trim().split(/\s+/)[0] ?? '';
  const name = basename(argv0);
  if (name === 'maude-server' || name === 'bun') return true;
  if (name === 'maude' && /\s--root(\s|=)/.test(command)) return true;
  return /(^|\s)\S*\/apps\/studio\/server\.ts(\s|$)/.test(command);
}

export type StartEnv = {
  readable: boolean;
  XDG_CONFIG_HOME?: string;
  MAUDE_UI_PREFS_PATH?: string;
  HOME?: string;
};

/** The variables that decide where a studio's prefs go, from a `ps eww` line (argv, then `KEY=value …`). */
export function envOf(line: string): StartEnv {
  const get = (k: string) => new RegExp(`(?:^|\\s)${k}=(\\S*)`).exec(line)?.[1];
  const env: StartEnv = { readable: get('PATH') !== undefined || get('HOME') !== undefined };
  for (const k of ['XDG_CONFIG_HOME', 'MAUDE_UI_PREFS_PATH', 'HOME'] as const) {
    const v = get(k);
    if (v !== undefined) env[k] = v;
  }
  return env;
}

export type ProcessRow = { pid: number; ppid: number; started: number; command: string };

/** `[[dd-]hh:]mm:ss` → seconds */
function etimeSeconds(t: string): number {
  const [d, rest] = t.includes('-') ? t.split('-') : ['0', t];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(d) * 86_400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/** Every process as { pid, ppid, started (ms, 1 s resolution), command } — `etime`, so no locale-dependent dates. */
export function processTable(): ProcessRow[] {
  let text = '';
  try {
    text = execFileSync('ps', ['-axo', 'pid=,ppid=,etime=,command='], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return [];
  }
  const now = Date.now();
  const rows: ProcessRow[] = [];
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d:-]+)\s+(.*)$/.exec(l);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      started: Math.floor((now - etimeSeconds(m[3]) * 1000) / 1000) * 1000,
      command: m[4],
    });
  }
  return rows;
}

/** A `maude-e2e-*` path, never under the person's `~/.config` — the rule of config-home.ts `isE2eConfigHome`. */
export function isE2eConfigHome(dir: string | undefined): boolean {
  if (!dir) return false;
  return inE2eDir(dir);
}

function inE2eDir(path: string): boolean {
  const abs = resolve(path);
  const real = join(homedir(), '.config');
  if (abs === real || abs.startsWith(real + sep)) return false;
  return abs.split(sep).some((p) => p.startsWith('maude-e2e-'));
}

/** Why this environment would reach the person's real config, or null when it is the lane's own. */
export function isolationProblem(env: StartEnv): string | null {
  if (!env.readable) return 'environment unreadable (cannot prove isolation)';
  if (!env.XDG_CONFIG_HOME) return `XDG_CONFIG_HOME unset (prefs → ${env.HOME ?? '$HOME'}/.config/maude)`;
  if (!isE2eConfigHome(env.XDG_CONFIG_HOME)) {
    return `XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME} is not a maude-e2e-* home`;
  }
  if (env.MAUDE_UI_PREFS_PATH !== undefined && !inE2eDir(env.MAUDE_UI_PREFS_PATH)) {
    return `MAUDE_UI_PREFS_PATH=${env.MAUDE_UI_PREFS_PATH} is outside a maude-e2e-* dir`;
  }
  return null;
}

/** The pids the lane owns: descendants of `roots` (inclusive), and anything born at or after `laneStarted`. */
export function laneOwned(
  rows: ProcessRow[],
  { roots, laneStarted }: { roots: number[]; laneStarted: number }
): Set<number> {
  const owned = descendants(rows, roots);
  // `ps` start times have 1 s resolution
  for (const r of rows) if (r.started >= laneStarted - 1000) owned.add(r.pid);
  return owned;
}

/** `roots` and everything under them. */
export function descendants(rows: ProcessRow[], roots: number[]): Set<number> {
  const kids = new Map<number, number[]>();
  for (const r of rows) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r.pid]);
  const owned = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const pid = stack.pop() as number;
    if (owned.has(pid)) continue;
    owned.add(pid);
    stack.push(...(kids.get(pid) ?? []));
  }
  return owned;
}

/** `descendant`: under the lane's roots — the only offenders the guard may kill. */
export type Offender = { pid: number; ppid: number; command: string; why: string; descendant: boolean };

/** `ps eww` lines for these pids (pid → line). A pid that exited in between is simply absent. */
function startLines(pids: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (pids.length === 0) return out;
  let text = '';
  try {
    text = execFileSync('ps', ['eww', '-o', 'pid=,command=', '-p', pids.join(',')], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    text = String((e as { stdout?: string }).stdout ?? ''); // ps exits 1 when a pid is gone
  }
  for (const l of text.split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(l);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/** One sample: lane-owned offenders and foreign unisolated studios. */
export function sample(opts: { roots: number[]; laneStarted: number; self?: number }): {
  offenders: Offender[];
  foreign: Offender[];
} {
  const rows = processTable();
  const self = opts.self ?? process.pid;
  const studios = rows.filter((r) => r.pid !== self && isStudioLike(r.command));
  const owned = laneOwned(rows, opts);
  const under = descendants(rows, opts.roots);
  const lines = startLines(studios.map((r) => r.pid));
  const offenders: Offender[] = [];
  const foreign: Offender[] = [];
  for (const r of studios) {
    const line = lines.get(r.pid);
    if (line === undefined) continue; // gone
    const why = isolationProblem(envOf(line));
    if (why === null) continue;
    const o = { pid: r.pid, ppid: r.ppid, command: r.command.slice(0, 300), why, descendant: under.has(r.pid) };
    (owned.has(r.pid) ? offenders : foreign).push(o);
  }
  return { offenders, foreign };
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    /* gone */
  }
}

/**
 * Default action: kill the e2e app (every process whose argv0 is `appPath`) and — when it is under the lane — the
 * offender, then fail the launcher. A process born during the lane but outside its tree (a relaunch through
 * LaunchServices, another session) fails the lane too, but is not the harness's to kill.
 */
function failLane(o: Offender, appPath: string | undefined): void {
  console.error(
    `\n[prefs-guard] FAIL: pid ${o.pid} (parent ${o.ppid}) runs on the person's real config — ${o.why}\n` +
      `[prefs-guard]   ${o.command}\n` +
      `[prefs-guard] killing the e2e app and failing the lane (exit 98); check ~/.config/maude/prefs.json's mtime\n`
  );
  if (appPath) {
    for (const r of processTable()) {
      if (r.command === appPath || r.command.startsWith(`${appPath} `)) signal(r.pid, 'SIGKILL');
    }
  }
  if (o.descendant) signal(o.pid, 'SIGKILL');
  process.exitCode = 98;
  process.on('exit', () => {
    process.exitCode = 98;
  });
  // wdio's launcher shuts its workers down on SIGINT; with nobody listening, exit now
  if (process.listenerCount('SIGINT') > 0) {
    process.kill(process.pid, 'SIGINT');
    setTimeout(() => process.exit(98), 15_000);
  } else {
    process.exit(98);
  }
}

export type PrefsGuard = { stop(): void };

let running: (PrefsGuard & { timer: ReturnType<typeof setInterval> }) | null = null;

export function startPrefsGuard(opts: {
  roots: number[];
  laneStarted: number;
  intervalMs?: number;
  appPath?: string;
  onOffender?: (o: Offender) => void;
  onForeign?: (o: Offender) => void;
}): PrefsGuard {
  const reported = new Set<number>();
  let failed = false;
  const onOffender = opts.onOffender ?? ((o: Offender) => failLane(o, opts.appPath));
  const onForeign =
    opts.onForeign ??
    ((o: Offender) =>
      console.warn(
        `[prefs-guard] note: pid ${o.pid} was running before this lane and is not its own — ${o.why}. ` +
          `It is left alone, but a page open on it can still write ~/.config/maude/prefs.json during the pass.\n` +
          `[prefs-guard]   ${o.command}`
      ));
  const tick = () => {
    if (failed && !opts.onOffender) return;
    const { offenders, foreign } = sample(opts);
    for (const o of foreign) {
      if (reported.has(o.pid)) continue;
      reported.add(o.pid);
      onForeign(o);
    }
    for (const o of offenders) {
      if (reported.has(o.pid)) continue;
      reported.add(o.pid);
      if (!opts.onOffender) failed = true;
      onOffender(o);
      if (failed) return;
    }
  };
  tick();
  const timer = setInterval(tick, opts.intervalMs ?? 500);
  timer.unref();
  const g = {
    timer,
    stop() {
      clearInterval(timer);
      if (running === g) running = null;
    },
  };
  running = g;
  return g;
}

/** Stop the guard this process started (completeLane). */
export function stopPrefsGuard(): void {
  running?.stop();
}
