import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { browser } from '@wdio/globals';

/**
 * The tab session the shell saved in the e2e app-state (V2-3.9 relaunch scenario):
 * `session.tabs` (project tabs in strip order — Home is never one) and `session.focused`
 * (the active label, `home` included). Read from disk: that file is what the next launch
 * restores from.
 */
export interface SavedSession {
  tabs: string[];
  focused: string | null;
}

const STATE = join(
  homedir(),
  'Library',
  'Application Support',
  'com.maude.app.e2e',
  'app-state.json'
);

export function savedSession(): SavedSession | null {
  try {
    const st = JSON.parse(readFileSync(STATE, 'utf8')) as {
      session?: { tabs?: { label: string }[]; focused?: string | null };
    };
    if (!st.session) return null;
    return {
      tabs: (st.session.tabs ?? []).map((t) => t.label),
      focused: st.session.focused ?? null,
    };
  } catch {
    return null;
  }
}

/** The e2e app binary this lane launched (wdio.conf.ts `resolveAppPath`). */
function appBinary(): string {
  const caps = browser.requestedCapabilities as Record<
    string,
    { application?: string } | undefined
  >;
  const app = caps?.['tauri:options']?.application ?? process.env.MAUDE_E2E_APP;
  if (!app) throw new Error('no e2e app path (tauri:options.application / MAUDE_E2E_APP)');
  return realpathSync(app);
}

/** The pid of this lane's own e2e app — matched by its exact binary path, so another Maude on
 *  the machine is never touched. */
export function appPid(): number {
  const bin = appBinary();
  const esc = bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pids: number[] = [];
  try {
    pids = execFileSync('pgrep', ['-f', `^${esc}$`], { encoding: 'utf8' })
      .split('\n')
      .map(Number)
      .filter((n) => n > 0);
  } catch {
    // pgrep exits 1 when nothing matches
  }
  if (pids.length !== 1)
    throw new Error(`expected one e2e app process for ${bin}, found ${pids.length}`);
  return pids[0] as number;
}

/** Where `relaunchApp` records the app it started (wdio.relaunch.conf.ts stops it). */
export const RELAUNCHED_PID_FILE = () =>
  join(process.env.MAUDE_E2E_RUN_DIR ?? tmpdir(), 'relaunched-app.pid');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(what: string, ms: number, ok: () => boolean | Promise<boolean>) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`${what} after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Quit the e2e app the way a person's ⌘Q / a logout does, start it again, and continue on a new
 * WebDriver session — a relaunch inside one spec. Quit = SIGTERM: the shell saves the session
 * and stops its servers (lib.rs `install_signal_handler` → `sidecar::kill_server`). Start = the
 * same binary and env the embedded WebDriver service launched it with (its env plus
 * `TAURI_WEBDRIVER_PORT` / `WDIO_EMBEDDED_SERVER`), so the embedded WebDriver answers on the same
 * port. The service keeps ONE app per lane and cannot relaunch it mid-spec; deleting a session
 * after every hook, its runner would fail the spec on an app that is already gone. Returns the
 * old and the new pid (they must differ: proof that this IS a relaunch).
 */
export async function relaunchApp(): Promise<{ before: number; after: number }> {
  const before = appPid();
  const bin = appBinary();
  const port = process.env.TAURI_WEBDRIVER_PORT ?? '4455';
  process.kill(before, 'SIGTERM');
  await until(`the e2e app (pid ${before}) did not quit on SIGTERM`, 30_000, () => !alive(before));
  const child = spawn(bin, [], {
    env: { ...process.env, TAURI_WEBDRIVER_PORT: port, WDIO_EMBEDDED_SERVER: 'true' },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const after = child.pid as number;
  mkdirSync(dirname(RELAUNCHED_PID_FILE()), { recursive: true });
  writeFileSync(RELAUNCHED_PID_FILE(), String(after));
  await until("the relaunched app's WebDriver never answered", 120_000, async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/status`);
      return r.ok && ((await r.json()) as { value?: { ready?: boolean } }).value?.ready !== false;
    } catch {
      return false;
    }
  });
  await browser.reloadSession();
  return { before, after };
}

/** Wait until the saved session is `want` (the save is debounced, 400 ms). */
export async function waitSavedSession(want: SavedSession, timeout = 15_000): Promise<void> {
  await browser.waitUntil(async () => JSON.stringify(savedSession()) === JSON.stringify(want), {
    timeout,
    interval: 200,
    timeoutMsg: `saved session ${JSON.stringify(savedSession())} ≠ ${JSON.stringify(want)}`,
  });
}
