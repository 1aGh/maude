// A terminal-started server steps down for the desktop app's sidecar — #206 (DDR-250 decision 1;
// contract `client/v2/contracts/206-cli-reuses-desktop.md` §6 "Handover" step 3).
//
// While the app runs it owns a checkout's server. A server started by `server-up` / `maude design
// serve` runs as role `cli` (MAUDE_SERVER_ROLE=cli; a shell spawn is never `cli`). Such a server
// reads the app's registry (`<app_data_dir>/servers.json`, written only by the app) every 2 s.
// When it names a RUNNING sidecar for this same root AND that sidecar answers the attest
// challenge (shell/attest.ts — only the process the app gave the per-spawn key can), this server:
//   1. refuses every new mutating request with 409 `yielded` (`yieldRefusal`, server.ts);
//   2. waits for its export / generation jobs and unsent work, at most 120 s;
//   3. shuts down the ordinary way (server.ts `shutdown`): sync stopped, the store lock released,
//      `_server.json` removed only if it still names this server, exit 0.
// The sidecar then takes the store lock within LOCK_RETRY_MS. The app never signals this process:
// it steps down by itself, so nothing ever acts on a pid read from a project file.
//
// What it trusts: only an attested answer. The registry is app-owned, but a stale or planted one
// (or a squatter on its port) cannot make this server quit — an entry that does not attest is
// skipped. The registry file is read only when it is a regular file of this user, at most 1 MiB,
// and not writable by group or others.

import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { ATTEST_KEY_RE, attestMac, macMatches } from './attest.ts';

export const SERVER_ROLE_ENV = 'MAUDE_SERVER_ROLE';
/** Where the app's registry is, when not the platform default (harnesses, tests). */
export const REGISTRY_FILE_ENV = 'MAUDE_APP_REGISTRY_FILE';
/** Test seam: the watch interval in ms (default 2000). */
export const YIELD_INTERVAL_ENV = 'MAUDE_CLI_YIELD_INTERVAL_MS';
export const APP_IDENTIFIER = 'com.maude.app';
export const YIELD_INTERVAL_MS = 2000;
export const YIELD_MAX_WAIT_MS = 120_000;
const REGISTRY_MAX_BYTES = 1024 * 1024;
const ATTEST_TIMEOUT_MS = 2000;

/** Role `cli`, and not a server the desktop shell (or Home) spawned. */
export function isCliRole(env: Record<string, string | undefined>): boolean {
  if (env[SERVER_ROLE_ENV] !== 'cli') return false;
  return !(
    env.MAUDE_SHELL_SIDECAR === '1' ||
    !!env.MAUDE_SHELL_TOKEN ||
    !!env.MAUDE_SHELL_INFO_FILE ||
    !!env.MAUDE_HOME_TOKEN
  );
}

/** The registry the app writes: Tauri's `app_data_dir()` + `servers.json`. */
export function registryPath(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir()
): string | null {
  const override = env[REGISTRY_FILE_ENV];
  if (override && isAbsolute(override)) return override;
  if (platform === 'darwin')
    return join(home, 'Library', 'Application Support', APP_IDENTIFIER, 'servers.json');
  if (platform === 'win32')
    return env.APPDATA ? join(env.APPDATA, APP_IDENTIFIER, 'servers.json') : null;
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : null;
  return join(data ?? join(home, '.local', 'share'), APP_IDENTIFIER, 'servers.json');
}

export interface RegistryServer {
  root: string;
  state: string;
  port: number;
  pid?: number;
  attestKey: string;
}

export interface Registry {
  appPid: number;
  servers: RegistryServer[];
}

/** The registry, or null when it is absent, not this user's, writable by others, or malformed. */
export function readRegistry(file: string): Registry | null {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > REGISTRY_MAX_BYTES) return null;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return null;
    if (process.platform !== 'win32' && (st.mode & 0o022) !== 0) return null;
    const doc = JSON.parse(readFileSync(file, 'utf8')) as {
      v?: unknown;
      app?: { pid?: unknown };
      servers?: unknown;
    };
    if (doc?.v !== 1 || !Array.isArray(doc.servers)) return null;
    const appPid = doc.app?.pid;
    if (!Number.isInteger(appPid) || (appPid as number) <= 0) return null;
    const servers: RegistryServer[] = [];
    for (const s of doc.servers as Record<string, unknown>[]) {
      if (!s || typeof s !== 'object') continue;
      const { root, state, port, pid, attestKey } = s;
      if (typeof root !== 'string' || !isAbsolute(root)) continue;
      if (typeof state !== 'string') continue;
      if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) continue;
      if (typeof attestKey !== 'string' || !ATTEST_KEY_RE.test(attestKey)) continue;
      servers.push({
        root,
        state,
        port: port as number,
        ...(Number.isInteger(pid) ? { pid: pid as number } : {}),
        attestKey,
      });
    }
    return { appPid: appPid as number, servers };
  } catch {
    return null;
  }
}

/** Alive and ours to signal. EPERM (another user's process) is not the app. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function real(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/** Does the server at `entry.port` hold `entry.attestKey` for this root? Fresh nonce each call. */
export async function attests(
  entry: RegistryServer,
  rootId: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const n = randomBytes(16).toString('hex');
  try {
    const r = await fetchImpl(`http://127.0.0.1:${entry.port}/_api/shell/attest?n=${n}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(ATTEST_TIMEOUT_MS),
    });
    if (r.status !== 200) return false;
    const body = (await r.json()) as { mac?: unknown };
    return macMatches(body?.mac, attestMac(entry.attestKey, n, rootId, entry.port));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ the write refusal while yielding */

let yielding = false;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 409 `yielded` for a mutating request once this server is stepping down; else null. */
export function yieldRefusal(req: Request): Response | null {
  if (!yielding || SAFE_METHODS.has(req.method.toUpperCase())) return null;
  return Response.json(
    {
      error: 'yielded',
      reason: 'yielded',
      message: 'Maude is taking over this project. Try again in a moment.',
    },
    { status: 409, headers: { 'Cache-Control': 'no-store' } }
  );
}

/* ------------------------------------------------------------------------------- the watcher */

export interface CliYieldOptions {
  /** this server's repo root (realpath'd here) and its http.ts `rootIdentity` */
  root: string;
  rootId: string;
  selfPid: number;
  selfPort: number;
  /** the registry file (registryPath) */
  file: string;
  /** export + generation jobs + unsent work still in flight (routes/shell.ts shellPendingWork) */
  pending?: () => number;
  /** called once, when the work is done or maxWaitMs has passed: shut down */
  onYield: () => void;
  intervalMs?: number;
  pendingPollMs?: number;
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
  alive?: (pid: number) => boolean;
  log?: (line: string) => void;
}

export type CliYieldState = 'watching' | 'yielding' | 'yielded' | 'stopped';

/**
 * The port of a RUNNING app sidecar for `root` that answers the attest challenge, or null. Skips this
 * server's own entry (pid, or port once it has one). Never throws.
 */
export async function attestedSidecarPort(o: {
  root: string;
  rootId: string;
  selfPid: number;
  selfPort?: number;
  file: string;
  fetchImpl?: typeof fetch;
  alive?: (pid: number) => boolean;
}): Promise<number | null> {
  try {
    const reg = readRegistry(o.file);
    if (!reg || !(o.alive ?? pidAlive)(reg.appPid)) return null;
    const ownRoot = real(o.root) ?? o.root;
    for (const e of reg.servers) {
      if (e.state !== 'running' || (o.selfPort !== undefined && e.port === o.selfPort)) continue;
      if (e.pid !== undefined && e.pid === o.selfPid) continue;
      if (real(e.root) !== ownRoot) continue;
      if (await attests(e, o.rootId, o.fetchImpl)) return e.port;
    }
  } catch {
    /* no answer is no sidecar */
  }
  return null;
}

/**
 * fix-bulk B2 — the boot-time half of the handover: a cli-role server asks once, BEFORE it writes its
 * key file or `_server.json`, takes the store lock or joins sync. When the app's sidecar already
 * serves this root (attested), the server prints one line and does not start — so it never writes
 * over the app's `_server.json` and its shutdown never removes the file it wrote there.
 */
export async function appAlreadyServes(o: {
  root: string;
  rootId: string;
  file: string | null;
  fetchImpl?: typeof fetch;
  alive?: (pid: number) => boolean;
}): Promise<number | null> {
  if (!o.file) return null;
  return attestedSidecarPort({ ...o, file: o.file, selfPid: process.pid });
}

export function watchForAppSidecar(o: CliYieldOptions): {
  stop(): void;
  state(): CliYieldState;
} {
  const ownRoot = real(o.root) ?? o.root;
  const alive = o.alive ?? pidAlive;
  const log = o.log ?? ((l: string) => console.log(l));
  let state: CliYieldState = 'watching';
  let checking = false;
  let waitTimer: ReturnType<typeof setInterval> | null = null;

  const finish = () => {
    if (state !== 'yielding') return;
    if (waitTimer) clearInterval(waitTimer);
    waitTimer = null;
    state = 'yielded';
    o.onYield();
  };

  const beginYield = (port: number) => {
    clearInterval(timer);
    state = 'yielding';
    yielding = true;
    log(`  Maude is serving this project now (port ${port}) — this server is stepping down.`);
    const started = Date.now();
    const maxWait = o.maxWaitMs ?? YIELD_MAX_WAIT_MS;
    const left = () => {
      try {
        return o.pending?.() ?? 0;
      } catch {
        return 0;
      }
    };
    if (left() === 0) return finish();
    waitTimer = setInterval(() => {
      if (left() === 0 || Date.now() - started >= maxWait) finish();
    }, o.pendingPollMs ?? 500);
    waitTimer.unref?.();
  };

  const tick = async () => {
    if (state !== 'watching' || checking) return;
    checking = true;
    try {
      const port = await attestedSidecarPort({ ...o, root: ownRoot, alive });
      if (port !== null && state === 'watching') beginYield(port);
    } finally {
      checking = false;
    }
  };

  const timer = setInterval(() => void tick(), o.intervalMs ?? YIELD_INTERVAL_MS);
  timer.unref?.();

  return {
    stop() {
      clearInterval(timer);
      if (waitTimer) clearInterval(waitTimer);
      // a watcher stopped mid-wait (tests) takes its refusal with it
      if (state === 'yielding') yielding = false;
      if (state === 'watching' || state === 'yielding') state = 'stopped';
    },
    state: () => state,
  };
}

/** The watch interval: the test seam when it is a sane number, else 2 s. */
export function yieldIntervalFrom(env: Record<string, string | undefined>): number {
  const n = Number(env[YIELD_INTERVAL_ENV]);
  return Number.isFinite(n) && n >= 50 && n <= 60_000 ? n : YIELD_INTERVAL_MS;
}
