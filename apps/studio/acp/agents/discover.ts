// Agent discovery (F2 / plan B1, discovery half): which catalog agents are installed on this Mac,
// at which real path and version, and whether that version is one Maude has tested.
// Contract: .ai/plans/notes/universal-acp-contract.md (F2) · DDR-252.
//
//   resolveAgentBin   walk the login-shell PATH (the sidecar's own PATH already is that, sidecar.rs)
//                     for each `detect.bins` name; follow symlinks (realpath); when a hit is a SHELL
//                     script, READ it and follow its `exec` / `export X="<path>"` lines to the real
//                     binary. Nothing but the final version probe is ever executed, and that is the
//                     resolved real binary, never a wrapper. A wrapper that does not resolve to a
//                     non-wrapper is skipped and the search goes on down PATH.
//   probeAgentVersion `<realBin> <versionArgs>` under a hard 5 s kill, scrubbed env, cached by
//                     realpath + mtime (+ the args), never on the boot path.
//   discoverAgents    lazy, process-cached, one row per CATALOG entry; `force` re-probes.
//
// A script whose shebang is a JS/Python runtime (`#!/usr/bin/env node`: an npm-installed agent) is a
// real entry, not a wrapper: it is launched by its shebang, so `CODEX_PATH` may point at it. Only
// shell scripts are read for a forward target.

import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, isAbsolute, join } from 'node:path';

import { resolveClaudePath } from '../probe.ts';
import { scrubAgentEnv } from '../env.ts';
import { CATALOG, isOfferable } from './catalog.ts';
import { type AgentDescriptor, type AgentId, type VersionFit, versionFit } from './descriptor.ts';

type Env = Record<string, string | undefined>;

export const VERSION_PROBE_TIMEOUT_MS = 5000;
/** Wrapper-of-wrapper depth that is still plausible; anything deeper is a loop or a maze. */
const MAX_WRAPPER_DEPTH = 5;
/** A thin wrapper is a few lines; never read more than this of any script. */
const MAX_SCRIPT_BYTES = 64 * 1024;
const MAX_PROBE_OUTPUT_BYTES = 16 * 1024;
/** `?refresh=1` hammered in a loop must not turn into a subprocess storm. */
const REFRESH_THROTTLE_MS = 1000;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'fish']);

// ---------------------------------------------------------------- PATH walk

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    if (!st.isFile()) return false;
    return process.platform === 'win32' || (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Every executable file named `name` on `env.PATH`, in PATH order (first = what a shell would run). */
function pathHits(name: string, env: Env): string[] {
  const pathVar = env.PATH ?? env.Path ?? '';
  if (!pathVar) return [];
  const exts =
    process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)]
      : [''];
  const out: string[] = [];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue; // an empty or relative entry means "cwd": never search it
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      if (isExecutableFile(candidate)) out.push(candidate);
    }
  }
  return out;
}

// ---------------------------------------------------------------- reading scripts

function readHead(path: string, max: number): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(max);
    const n = readSync(fd, buf, 0, max, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* nothing to do */
      }
    }
  }
}

type EntryKind = 'binary' | 'runtime-script' | 'wrapper';

/** A file with no shebang is a binary; a shell shebang is a wrapper; any other interpreter is a runtime entry. */
function classify(head: string): EntryKind {
  if (!head.startsWith('#!')) return 'binary';
  const firstLine = head.slice(2, head.indexOf('\n') === -1 ? undefined : head.indexOf('\n'));
  const words = firstLine.trim().split(/\s+/).filter(Boolean);
  let interp = words[0] ?? '';
  if (basename(interp) === 'env') {
    // `#!/usr/bin/env -S node --flag` / `#!/usr/bin/env FOO=1 bash`
    interp = words.slice(1).find((w) => !w.startsWith('-') && !w.includes('=')) ?? '';
  }
  return SHELLS.has(basename(interp)) ? 'wrapper' : 'runtime-script';
}

/** Split one shell line into words: '…' and "…" quoted, backslash escapes, stops at ; | & #. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(c)) {
      if (has) words.push(cur);
      cur = '';
      has = false;
    } else if (c === ';' || c === '|' || c === '&' || (c === '#' && !has)) {
      break;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) words.push(cur);
  return words;
}

/**
 * Expand `~`, `$NAME` and `${NAME}` against the script's own assignments, then the environment.
 * An unknown variable, a command substitution or a backtick makes the word unresolvable (null):
 * guessing a path is how a wrapper would be pointed somewhere it does not go.
 */
function expandWord(word: string, vars: Map<string, string>, env: Env): string | null {
  if (word.includes('`') || word.includes('$(')) return null;
  const home = env.HOME ?? homedir();
  let w = word;
  if (w === '~' || w.startsWith('~/')) w = home + w.slice(1);
  let unknown = false;
  w = w.replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a: string | undefined, b: string | undefined) => {
    const name = (a ?? b) as string;
    const v = vars.get(name) ?? (name === 'HOME' ? home : env[name]);
    if (v === undefined) {
      unknown = true;
      return '';
    }
    return v;
  });
  return unknown ? null : w;
}

/**
 * The forward targets a shell wrapper names, most direct first:
 *   1. `exec <path> …` (through a leading `command`, `env`, `NAME=value`), when <path> is absolute
 *      after expansion. `exec maude codex "$@"` names a bare command: not a target.
 *   2. an assigned or exported value (`export MAUDE_CODEX_REAL="$HOME/.local/bin/codex"`) that is
 *      an absolute path whose basename is one of the agent's bins: the wrapper's "real binary" knob.
 */
export function wrapperTargets(text: string, bins: readonly string[], env: Env): string[] {
  const vars = new Map<string, string>();
  const execs: string[] = [];
  const assigned: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const asg = /^(?:export\s+|readonly\s+|declare\s+-x\s+)?([A-Za-z_]\w*)=(.*)$/.exec(line);
    if (asg) {
      const word = shellWords(asg[2] as string)[0];
      const value = word === undefined ? '' : expandWord(word, vars, env);
      if (value !== null) {
        vars.set(asg[1] as string, value);
        if (isAbsolute(value) && bins.includes(basename(value))) assigned.push(value);
      }
      continue;
    }
    const ex = /^exec\s+(.*)$/.exec(line);
    if (!ex) continue;
    const words = shellWords(ex[1] as string);
    let i = 0;
    while (i < words.length) {
      const w = words[i] as string;
      if (w === 'command' || w === 'env' || w === '--') i++;
      else if (w.startsWith('-') && i > 0 && (words[i - 1] === 'env' || words[i - 1] === 'command'))
        i++; // env -i / command -p
      else if (/^[A-Za-z_]\w*=/.test(w))
        i++; // env FOO=bar
      else break;
    }
    const head = words[i];
    if (head === undefined) continue;
    const expanded = expandWord(head, vars, env);
    if (expanded !== null && isAbsolute(expanded)) execs.push(expanded);
  }
  return [...new Set([...execs, ...assigned])];
}

// ---------------------------------------------------------------- resolution

function resolveEntry(
  candidate: string,
  bins: readonly string[],
  env: Env,
  depth: number,
  seen: Set<string>
): string | null {
  const real = safeRealpath(candidate);
  if (!real || seen.has(real) || !isExecutableFile(real)) return null;
  seen.add(real);
  const head = readHead(real, 256);
  if (head === null) return null;
  if (classify(head) !== 'wrapper') return real;
  if (depth >= MAX_WRAPPER_DEPTH) return null;
  const text = readHead(real, MAX_SCRIPT_BYTES);
  if (text === null) return null;
  for (const target of wrapperTargets(text, bins, env)) {
    const resolved = resolveEntry(target, bins, env, depth + 1, seen);
    if (resolved) return resolved;
  }
  return null;
}

/** The first executable on `env.PATH` named `bin`: the `which` resolveClaudePath is handed. */
function whichOn(bin: string, env: Env): string | null {
  return pathHits(bin, env)[0] ?? null;
}

/**
 * The real binary of an agent, or null. Claude is whatever `resolveClaudePath()` finds (its
 * `MAUDE_CLAUDE_BIN` override, SHA pin and E2E stubs included), only realpath'd: this module never
 * re-derives it.
 */
export function resolveAgentBin(d: AgentDescriptor, env: Env = process.env): string | null {
  if (d.id === 'claude') {
    // the process environment: resolveClaudePath's own lookup, untouched (the equality the contract asks for);
    // an explicit env (tests, a different PATH) gets the same lookup over THAT env's PATH
    const found =
      env === process.env
        ? resolveClaudePath(env)
        : resolveClaudePath(env, (bin) => whichOn(bin, env));
    return found ? (safeRealpath(found) ?? found) : null;
  }
  const seen = new Set<string>();
  for (const name of d.detect.bins) {
    for (const hit of pathHits(name, env)) {
      const real = resolveEntry(hit, d.detect.bins, env, 0, seen);
      if (real) return real;
    }
  }
  return null;
}

// ---------------------------------------------------------------- version probe

const versionCache = new Map<string, Promise<string | null>>();

/** For tests, and for a "Check again" that should not trust any earlier answer. */
export function clearVersionCache(): void {
  versionCache.clear();
}

async function readCapped(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (total < MAX_PROBE_OUTPUT_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    /* a killed child closes its pipes abruptly */
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* nothing to do */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function runVersion(
  d: AgentDescriptor,
  realBin: string,
  env: Env,
  timeoutMs: number
): Promise<string | null> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([realBin, ...d.detect.versionArgs], {
      env: scrubAgentEnv(env),
      cwd: tmpdir(), // never the served project: a project-local config must not steer a probe
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch {
    return null;
  }
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, timeoutMs);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => {
      const [out, err] = await Promise.all([
        readCapped(proc.stdout as ReadableStream<Uint8Array>),
        readCapped(proc.stderr as ReadableStream<Uint8Array>),
      ]);
      await proc.exited;
      return `${out}\n${err}`;
    })();
    // a grandchild that keeps a pipe open must not outlive the kill
    const late = new Promise<null>((resolve) => {
      deadline = setTimeout(() => resolve(null), timeoutMs + 150);
    });
    const text = await Promise.race([work, late]);
    if (timedOut || text === null || proc.exitCode !== 0) return null;
    const m = d.detect.versionRe.exec(text);
    return m?.[1] ?? null;
  } finally {
    clearTimeout(killer);
    if (deadline) clearTimeout(deadline);
  }
}

export interface ProbeOptions {
  /** Skip the realpath+mtime cache. */
  force?: boolean;
  timeoutMs?: number;
  env?: Env;
}

/**
 * The semver `realBin` reports, or null (no output match, a crash, a timeout). Cached by realpath +
 * mtime (+ the args), so an in-place upgrade re-probes and nothing else does.
 */
export function probeAgentVersion(
  d: AgentDescriptor,
  realBin: string,
  opts: ProbeOptions = {}
): Promise<string | null> {
  const real = safeRealpath(realBin);
  let mtime: number;
  try {
    mtime = statSync(real ?? realBin).mtimeMs;
  } catch {
    return Promise.resolve(null);
  }
  const key = [real ?? realBin, mtime, d.id, ...d.detect.versionArgs].join('\0');
  if (!opts.force) {
    const hit = versionCache.get(key);
    if (hit) return hit;
  }
  const probe = runVersion(
    d,
    real ?? realBin,
    opts.env ?? process.env,
    opts.timeoutMs ?? VERSION_PROBE_TIMEOUT_MS
  );
  versionCache.set(key, probe);
  return probe;
}

// ---------------------------------------------------------------- discovery

export interface DiscoveredAgent {
  id: AgentId;
  label: string;
  vendor: string;
  installed: boolean;
  /** realpath of the agent's own binary (what `CODEX_PATH` etc. is set to), or null. */
  realBin: string | null;
  /** null when not installed or the version could not be read. */
  version: string | null;
  fit: VersionFit | null;
  policy: AgentDescriptor['policy'];
  /** May Studio proactively offer it: bridge-enforced, installed and a tested version. */
  offerable: boolean;
}

export interface DiscoverOptions {
  /** Re-probe everything (throttled to once a second on the process-wide path). */
  force?: boolean;
  /** Lookup environment; absent = the process environment and the process-wide cache. */
  env?: Env;
  catalog?: readonly AgentDescriptor[];
  timeoutMs?: number;
  /** Called as each row settles, so a fast agent is not held back behind a slow probe. */
  onRow?: (row: DiscoveredAgent) => void;
}

async function discoverOne(
  d: AgentDescriptor,
  env: Env,
  opts: DiscoverOptions
): Promise<DiscoveredAgent> {
  const realBin = resolveAgentBin(d, env);
  const version = realBin
    ? await probeAgentVersion(d, realBin, { force: opts.force, timeoutMs: opts.timeoutMs, env })
    : null;
  const fit = version ? versionFit(d, version) : null;
  const row: DiscoveredAgent = {
    id: d.id,
    label: d.label,
    vendor: d.vendor,
    installed: realBin !== null,
    realBin,
    version,
    fit,
    policy: d.policy,
    offerable: isOfferable(d) && realBin !== null && fit === 'ok',
  };
  opts.onRow?.(row);
  return row;
}

let processWide: { promise: Promise<DiscoveredAgent[]>; doneAt: number } | null = null;

/** One row per catalog entry, probed in parallel (one hanging agent never delays another). */
export function discoverAgents(opts: DiscoverOptions = {}): Promise<DiscoveredAgent[]> {
  const run = (env: Env, catalog: readonly AgentDescriptor[]) =>
    Promise.all(catalog.map((d) => discoverOne(d, env, opts)));
  if (opts.env || opts.catalog) {
    return run(opts.env ?? process.env, opts.catalog ?? CATALOG);
  }
  const cached = processWide;
  if (cached && (!opts.force || Date.now() - cached.doneAt < REFRESH_THROTTLE_MS)) {
    return cached.promise;
  }
  const entry = {
    promise: run(process.env, CATALOG).finally(() => {
      entry.doneAt = Date.now();
    }),
    doneAt: Number.POSITIVE_INFINITY, // in flight: a force during it joins it
  };
  processWide = entry;
  entry.promise.catch(() => {
    if (processWide === entry) processWide = null; // a failure is not remembered
  });
  return entry.promise;
}
