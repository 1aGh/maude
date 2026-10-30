import { execFileSync } from 'node:child_process';
import { lstatSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';

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
 * started with (`ps eww`). A process the LANE owns — a descendant of the launcher, or one that carries THIS lane's
 * `MAUDE_E2E_LANE_STARTED` stamp (p8-e2e-isolation-r13: never "born after the lane started"; another session's server
 * from the same debug bundle is born mid-lane too) — that is not isolated is an offender, and so is any `claude` in
 * the lane's tree that is not the lane's stub (the V2-8.3 record: the person's real `~/.local/bin/claude`, real
 * keychain). The default action kills the lane-owned tree — the e2e app, its sidecars and their ACP/claude children —
 * and fails the launcher (exit 98). A process that is not the lane's is reported once ("foreign process writes the
 * real prefs") and left alone: the harness never kills what it did not start, and such a server can still move
 * prefs.json through a browser tab — so the pass's before/after mtime check stays the authority on that.
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
  MAUDE_CLOUD_CONFIG?: string;
  HUBS_CONFIG_PATH?: string;
  HOME?: string;
  /** the lane stamp wdio.conf.ts sets in the launcher; every child of the lane inherits it */
  MAUDE_E2E_LANE_STARTED?: string;
};

/** The variables that decide where a studio's prefs go, from a `ps eww` line (argv, then `KEY=value …`). */
export function envOf(line: string): StartEnv {
  const get = (k: string) => new RegExp(`(?:^|\\s)${k}=(\\S*)`).exec(line)?.[1];
  const env: StartEnv = { readable: get('PATH') !== undefined || get('HOME') !== undefined };
  for (const k of [
    'XDG_CONFIG_HOME',
    'MAUDE_UI_PREFS_PATH',
    'MAUDE_CLOUD_CONFIG',
    'HUBS_CONFIG_PATH',
    'HOME',
    'MAUDE_E2E_LANE_STARTED',
  ] as const) {
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

/**
 * Where `path` really is, resolved top-down with lstat/readlink (symlinks followed, at most 40), and whether it reached
 * one of `stops` — the person's real `~/.config` — on the way. Resolution STOPS at the first resolved prefix inside a
 * stop, so nothing under the real `~/.config/maude` is ever even stat'ed. A missing component ends the walk: the rest
 * of the path is taken as written (the deepest existing ancestor is what decides).
 */
export function whereItLands(path: string, stops: string[]): { real: string; underReal: boolean } {
  const inStop = (p: string) => stops.some((s) => p === s || p.startsWith(s + sep));
  let todo = resolve(path).split(sep).filter(Boolean);
  let cur: string = sep;
  let links = 0;
  while (todo.length) {
    const next = join(cur, todo[0]);
    if (inStop(next)) return { real: join(next, ...todo.slice(1)), underReal: true };
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(next);
    } catch {
      return { real: join(next, ...todo.slice(1)), underReal: false };
    }
    if (st.isSymbolicLink() && links++ < 40) {
      const target = resolve(dirname(next), readlinkSync(next));
      todo = [...target.split(sep).filter(Boolean), ...todo.slice(1)];
      cur = sep;
      continue;
    }
    cur = next;
    todo = todo.slice(1);
  }
  return { real: cur, underReal: inStop(cur) };
}

/** The person's real `~/.config` (the lane's os.homedir()), as written and as it resolves. */
function realConfigs(realHome: string): string[] {
  const config = join(resolve(realHome), '.config');
  const out = [config];
  const r = whereItLands(config, []).real;
  if (r !== config) out.push(r);
  return out;
}

/**
 * p8-e2e-fix-r12 (lead's option A) — where this process's prefs actually land, as `ui-prefs.ts` resolves them:
 * MAUDE_UI_PREFS_PATH, else `$XDG_CONFIG_HOME/maude/prefs.json`, else `$HOME/.config/maude/prefs.json`. It passes only
 * when that path, symlinks resolved, is inside a `maude-e2e-*` dir and not under the real `~/.config`. A cloud or hubs
 * pointer, when set, is held to the same rule (unset, the prefs resolution above decides). Null = the lane's own.
 */
export function isolationProblem(env: StartEnv, opts: { realHome?: string } = {}): string | null {
  if (!env.readable) return 'environment unreadable (cannot prove isolation)';
  const stops = realConfigs(opts.realHome ?? homedir());
  const judge = (what: string, path: string): string | null => {
    const { real, underReal } = whereItLands(path, stops);
    if (underReal) return `${what} → ${real} is under the real ~/.config`;
    if (!real.split(sep).some((p) => p.startsWith('maude-e2e-')))
      return `${what} → ${real} is outside a maude-e2e-* dir`;
    return null;
  };
  let prefs: string | null;
  if (env.MAUDE_UI_PREFS_PATH)
    prefs = judge(`MAUDE_UI_PREFS_PATH=${env.MAUDE_UI_PREFS_PATH}`, env.MAUDE_UI_PREFS_PATH);
  else if (env.XDG_CONFIG_HOME)
    prefs = judge(
      `XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`,
      join(env.XDG_CONFIG_HOME, 'maude', 'prefs.json')
    );
  else if (env.HOME)
    prefs = judge(
      `XDG_CONFIG_HOME unset, HOME=${env.HOME}`,
      join(env.HOME, '.config', 'maude', 'prefs.json')
    );
  else prefs = 'XDG_CONFIG_HOME unset and no HOME (cannot tell where prefs land)';
  if (prefs) return prefs;
  for (const k of ['MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH'] as const) {
    const v = env[k];
    if (v) {
      const p = judge(`${k}=${v}`, v);
      if (p) return p;
    }
  }
  return null;
}

/**
 * The pids the lane owns, by ANCESTRY: descendants of `roots` (inclusive), and of any process whose start environment
 * carries this lane's stamp (`MAUDE_E2E_LANE_STARTED` = `laneStarted`, so a sidecar launchd adopted when its app died
 * stays the lane's). A start time proves nothing (p8-e2e-isolation-r13): another session's `maude-server` from the same
 * debug bundle, born mid-lane under its own zsh, is not the lane's.
 */
export function laneOwned(
  rows: ProcessRow[],
  { roots, laneStarted }: { roots: number[]; laneStarted: number },
  envs: Map<number, StartEnv> = new Map()
): Set<number> {
  const stamp = String(laneStarted);
  const stamped = [...envs]
    .filter(([, e]) => e.MAUDE_E2E_LANE_STARTED === stamp)
    .map(([pid]) => pid);
  const live = new Set(rows.map((r) => r.pid));
  return descendants(rows, [...roots, ...stamped.filter((pid) => live.has(pid))]);
}

/**
 * p8-e2e-isolation-r13 — the `claude` a command line runs, or null: argv0 named `claude`, a script runner (sh, bash,
 * zsh, node, bun) whose script is named `claude`, or Claude Code's JS entry. The lane's own stubs are recognised by the
 * caller's path list, not here; a stub named otherwise (`claude-stub.sh`) is simply not a claude.
 */
export function claudeInvocation(command: string): string | null {
  const argv = command.trim().split(/\s+/);
  const name = (p: string | undefined) => basename(p ?? '');
  if (/^claude(\.exe)?$/.test(name(argv[0]))) return argv[0];
  if (/^(sh|bash|zsh|dash|node|bun)$/.test(name(argv[0]))) {
    const script = argv.slice(1).find((a) => !a.startsWith('-'));
    if (
      script &&
      (name(script) === 'claude' ||
        /\/@anthropic-ai\/claude-(code|agent-sdk)\/cli\.m?js$/.test(script))
    )
      return script;
  }
  return null;
}

/** A lane claude: exactly a named path, or anything under a named directory. Empty/undefined entries are ignored. */
export function isLaneClaude(path: string, allowed: (string | undefined)[]): boolean {
  if (!path.startsWith(sep)) return false; // resolved through PATH — cannot be proven to be the stub
  const abs = resolve(path);
  return allowed.some((a) => !!a && (abs === resolve(a) || abs.startsWith(resolve(a) + sep)));
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

/** `descendant`: under the lane's roots. Every offender is lane-owned (ancestry or the lane stamp). */
export type Offender = {
  pid: number;
  ppid: number;
  command: string;
  why: string;
  descendant: boolean;
};

/** `ps eww` lines for these pids (pid → line). A pid that exited in between is simply absent. */
export function startLines(pids: number[]): Map<number, string> {
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

/**
 * The judgement of one sample, pure: lane-owned studios that are not isolated and lane-owned `claude`s that are not
 * the lane's stub are offenders; an unisolated studio the lane does not own is foreign (reported, never killed). A
 * foreign `claude` is not the lane's business.
 */
export function classify(opts: {
  rows: ProcessRow[];
  envs: Map<number, StartEnv>;
  roots: number[];
  laneStarted: number;
  self?: number;
  laneClaudes?: (string | undefined)[];
  realHome?: string;
}): { offenders: Offender[]; foreign: Offender[] } {
  const self = opts.self ?? process.pid;
  const owned = laneOwned(opts.rows, opts, opts.envs);
  const under = descendants(opts.rows, opts.roots);
  const offenders: Offender[] = [];
  const foreign: Offender[] = [];
  const of = (r: ProcessRow, why: string): Offender => ({
    pid: r.pid,
    ppid: r.ppid,
    command: r.command.slice(0, 300),
    why,
    descendant: under.has(r.pid),
  });
  for (const r of opts.rows) {
    if (r.pid === self) continue;
    const claude = claudeInvocation(r.command);
    if (claude !== null) {
      if (owned.has(r.pid) && !isLaneClaude(claude, opts.laneClaudes ?? []))
        offenders.push(
          of(
            r,
            `a claude outside the lane's stub: ${claude} (the lane names its own in MAUDE_CLAUDE_BIN)`
          )
        );
      continue;
    }
    if (!isStudioLike(r.command)) continue;
    const env = opts.envs.get(r.pid);
    if (env === undefined) continue; // gone
    const why = isolationProblem(env, { realHome: opts.realHome });
    if (why === null) continue;
    (owned.has(r.pid) ? offenders : foreign).push(of(r, why));
  }
  return { offenders, foreign };
}

/** Start environments for the processes a sample judges (studios and claudes), from `ps eww`. */
function startEnvs(rows: ProcessRow[]): Map<number, StartEnv> {
  const pids = rows
    .filter((r) => isStudioLike(r.command) || claudeInvocation(r.command) !== null)
    .map((r) => r.pid);
  const envs = new Map<number, StartEnv>();
  for (const [pid, line] of startLines(pids)) envs.set(pid, envOf(line));
  return envs;
}

/** One sample: lane-owned offenders and foreign unisolated studios. */
export function sample(opts: {
  roots: number[];
  laneStarted: number;
  self?: number;
  laneClaudes?: (string | undefined)[];
}): {
  offenders: Offender[];
  foreign: Offender[];
} {
  const rows = processTable();
  return classify({ ...opts, rows, envs: startEnvs(rows) });
}

const isApp = (command: string, appPath: string) =>
  command === appPath || command.startsWith(`${appPath} `);

/**
 * p8-e2e-isolation-r13 — what the guard kills when it fails the lane: the lane-owned e2e app(s), the offender, and any
 * lane-owned process launchd adopted from the app bundle (a sidecar whose app already died) — each with its whole
 * subtree, so the sidecars (`maude-server --home`/`--root`) and their ACP agent and `claude` children go too. Nothing
 * the lane does not own, even from the same debug bundle.
 */
export function laneKillSet(opts: {
  rows: ProcessRow[];
  envs: Map<number, StartEnv>;
  roots: number[];
  laneStarted: number;
  appPath?: string;
  offender?: { pid: number };
}): Set<number> {
  const owned = laneOwned(opts.rows, opts, opts.envs);
  const bundle = opts.appPath ? `${dirname(dirname(opts.appPath))}${sep}` : null;
  const tops: number[] = [];
  for (const r of opts.rows) {
    if (!owned.has(r.pid) || opts.roots.includes(r.pid)) continue;
    if (opts.appPath && isApp(r.command, opts.appPath)) tops.push(r.pid);
    else if (bundle && r.ppid === 1 && r.command.includes(bundle)) tops.push(r.pid);
  }
  if (opts.offender && owned.has(opts.offender.pid)) tops.push(opts.offender.pid);
  return descendants(opts.rows, tops);
}

/**
 * The end-of-lane net: e2e processes of THIS debug bundle that launchd adopted because their app died — a sidecar
 * (`maude-server --home`/`--root`), an ACP agent under `Contents/Resources`, a `claude` — and everything under them.
 * An e2e process is one whose start environment carries a lane stamp (`MAUDE_E2E_LANE_STARTED`, any lane: an earlier
 * lane's orphan is dead weight too). A live app's sidecars are its children, not launchd's; another session's server
 * and the person's own Maude carry no stamp — none of them is touched.
 */
export function orphanLaneProcesses(
  rows: ProcessRow[],
  envs: Map<number, StartEnv>,
  appBinary: string
): Set<number> {
  const bundle = `${dirname(dirname(appBinary))}${sep}`;
  const tops = rows
    .filter(
      (r) =>
        r.ppid === 1 &&
        !!envs.get(r.pid)?.MAUDE_E2E_LANE_STARTED &&
        !isApp(r.command, appBinary) &&
        (r.command.includes(bundle) || claudeInvocation(r.command) !== null)
    )
    .map((r) => r.pid);
  return descendants(rows, tops);
}

/** All start environments (for the orphan reap: an ACP agent is neither a studio nor a claude). */
function allStartEnvs(rows: ProcessRow[]): Map<number, StartEnv> {
  const envs = new Map<number, StartEnv>();
  for (const [pid, line] of startLines(rows.map((r) => r.pid))) envs.set(pid, envOf(line));
  return envs;
}

/** SIGTERM `orphanLaneProcesses`, then SIGKILL what is left; repeats while a pass finds any. Returns the pids. */
export async function reapOrphanE2eSidecars(
  appBinary: string,
  timeoutMs = 5000
): Promise<number[]> {
  const reaped: number[] = [];
  for (let pass = 0; pass < 3; pass++) {
    const rows = processTable();
    const bundle = `${dirname(dirname(appBinary))}${sep}`;
    // only the candidates' environments: launchd's children that name the bundle or a claude, and their subtrees
    const cand = descendants(
      rows,
      rows
        .filter(
          (r) =>
            r.ppid === 1 && (r.command.includes(bundle) || claudeInvocation(r.command) !== null)
        )
        .map((r) => r.pid)
    );
    const pids = [
      ...orphanLaneProcesses(rows, allStartEnvs(rows.filter((r) => cand.has(r.pid))), appBinary),
    ];
    if (pids.length === 0) break;
    for (const pid of pids) signal(pid, 'SIGTERM');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && pids.some(alive)) await new Promise((r) => setTimeout(r, 200));
    for (const pid of pids.filter(alive)) signal(pid, 'SIGKILL');
    reaped.push(...pids);
  }
  if (reaped.length)
    console.warn(
      `[prefs-guard] reaped ${reaped.length} orphaned e2e process(es) of the debug app (sidecars, agents)`
    );
  return reaped;
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
    /* gone */
  }
}

/**
 * Default action: kill the lane-owned tree (`laneKillSet`: the e2e app, its sidecars and their ACP/claude children, the
 * offender) and fail the launcher. Repeats on the live table so a child spawned between the snapshot and the signal
 * goes too. Never a process the lane does not own.
 */
function failLane(
  o: Offender,
  opts: { appPath?: string; roots: number[]; laneStarted: number }
): void {
  const claude = o.why.startsWith('a claude outside');
  console.error(
    `\n[prefs-guard] FAIL: pid ${o.pid} (parent ${o.ppid}) ${claude ? 'is' : "runs on the person's real config —"} ${o.why}\n` +
      `[prefs-guard]   ${o.command}\n` +
      `[prefs-guard] killing the lane's app tree and failing the lane (exit 98); check ~/.config/maude/prefs.json's mtime\n`
  );
  for (let pass = 0; pass < 3; pass++) {
    const rows = processTable();
    const pids = laneKillSet({ ...opts, rows, envs: allStartEnvs(rows), offender: o });
    pids.delete(process.pid);
    if (pids.size === 0) break;
    for (const pid of pids) signal(pid, 'SIGKILL');
  }
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

/** consecutive samples a lane-owned process may show no environment before it is an offender (≥ 1 s at 0.5 s) */
const UNREADABLE_SAMPLES = 3;

let running: (PrefsGuard & { timer: ReturnType<typeof setInterval> }) | null = null;

export function startPrefsGuard(opts: {
  roots: number[];
  laneStarted: number;
  intervalMs?: number;
  appPath?: string;
  /** the lane's own `claude` paths or directories, read at every sample (a lane conf may name its stub later) */
  laneClaudes?: () => (string | undefined)[];
  onOffender?: (o: Offender) => void;
  onForeign?: (o: Offender) => void;
  /** tests: the sample instead of the live process table */
  sampleImpl?: () => { offenders: Offender[]; foreign: Offender[] };
}): PrefsGuard {
  const reported = new Set<number>();
  // r12 pass f1: right after a spawn `ps eww` can show a process with no environment yet (a sidecar, the fake ACP
  // agent), and the guard killed two green lanes. Unreadable counts only once it stays so for UNREADABLE_SAMPLES.
  const unreadable = new Map<number, number>();
  let failed = false;
  const onOffender = opts.onOffender ?? ((o: Offender) => failLane(o, opts));
  const onForeign =
    opts.onForeign ??
    ((o: Offender) =>
      console.warn(
        `[prefs-guard] WARNING: foreign process writes the real prefs — pid ${o.pid} (parent ${o.ppid}) is not this ` +
          `lane's (not under its launcher, no MAUDE_E2E_LANE_STARTED=${opts.laneStarted}): ${o.why}. It is left ` +
          `running and does not fail the lane, but ~/.config/maude/prefs.json's mtime can move during the pass.\n` +
          `[prefs-guard]   ${o.command}`
      ));
  const tick = () => {
    if (failed && !opts.onOffender) return;
    const got = opts.sampleImpl
      ? opts.sampleImpl()
      : sample({ ...opts, laneClaudes: opts.laneClaudes?.() ?? [] });
    const blind = (o: Offender) => o.why.startsWith('environment unreadable');
    const stillBlind = new Set(got.offenders.filter(blind).map((o) => o.pid));
    for (const pid of [...unreadable.keys()]) if (!stillBlind.has(pid)) unreadable.delete(pid);
    for (const pid of stillBlind) unreadable.set(pid, (unreadable.get(pid) ?? 0) + 1);
    const offenders = got.offenders.filter(
      (o) => !blind(o) || (unreadable.get(o.pid) ?? 0) >= UNREADABLE_SAMPLES
    );
    const foreign = got.foreign.filter((o) => !blind(o));
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
