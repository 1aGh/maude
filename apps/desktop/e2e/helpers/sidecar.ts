import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browser } from '@wdio/globals';

/**
 * Wait until the native shell's webview has navigated to the loopback dev-server.
 * The Rust shell spawns the Bun sidecar, polls `_server.json`, then navigates the
 * webview to `http://localhost:<port>` (server_json.rs). Cold start runs
 * boot-self-heal (bun install + build) up to ~90 s, so the default timeout is
 * generous. Returns the resolved URL.
 */
/**
 * tsx compiles with esbuild's `keepNames`: any named function or `const f = () => ...` inside a function
 * passed to `browser.execute` is shipped as `__name(f, "f")`, and the page has no `__name` ("Can't find
 * variable: __name"), which the driver reports as a bare "JavaScript exception". Give the shell window the
 * one-line helper so a spec's page-side code may declare local helpers.
 */
export async function installNameShim(): Promise<void> {
  await browser
    .execute(() => {
      const w = window as unknown as { __name?: unknown };
      if (!w.__name) w.__name = (f: unknown) => f;
    })
    .catch(() => {});
}

export async function waitForSidecar(timeout = 150_000): Promise<string> {
  let url = '';
  await browser.waitUntil(
    async () => {
      url = await browser.getUrl();
      return /^http:\/\/(localhost|127\.0\.0\.1):\d+/.test(url);
    },
    {
      timeout,
      interval: 1000,
      timeoutMsg: `webview never navigated to the loopback dev-server (last url: "${url}")`,
    }
  );
  // The lane keeps one app across specs: start each with no sheet or popover left open by the last
  // one, and on the Files tab of the left dock.
  await installNameShim();
  await browser.keys(['Escape', 'Escape']).catch(() => {});
  await browser
    .execute(() => {
      const tab = document.querySelector<HTMLElement>('[data-testid="panel-tab-tree"]');
      if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    })
    .catch(() => {});
  return url;
}

/** `{ pid, port, url, canvasOrigin? }` as the sidecar publishes it (server.ts). */
export interface ServerInfo {
  pid: number;
  port: number;
  url: string;
  canvasOrigin?: string;
}

/**
 * Read `<project>/.design/_server.json` — the shell↔sidecar handshake file.
 * Throws if absent/unparseable, which for these scenarios IS the failure worth
 * reporting (no server ever came up).
 */
export function readServerInfo(projectRoot = process.env.MAUDE_PROJECT_ROOT ?? ''): ServerInfo {
  const file = join(projectRoot, '.design', '_server.json');
  return JSON.parse(readFileSync(file, 'utf8')) as ServerInfo;
}

/**
 * SIGKILL the running dev-server sidecar — a simulated CRASH, not a shutdown.
 *
 * The distinction is the whole point (issue #115): a graceful stop unlinks
 * `_server.json`, a crash leaves the dead process's `{pid, port, canvasOrigin}`
 * on disk. That corpse is the precondition for the bug, so the scenario must
 * kill in a way that leaves it behind. SIGKILL also denies the process any
 * chance to run its cleanup handler, which SIGTERM would not.
 *
 * Returns the info of the process we killed, so a caller can compare the
 * respawned server's ports against it.
 */
export function killSidecar(projectRoot = process.env.MAUDE_PROJECT_ROOT ?? ''): ServerInfo {
  const info = readServerInfo(projectRoot);
  process.kill(info.pid, 'SIGKILL');
  return info;
}

/**
 * Wait until `_server.json` describes a DIFFERENT, live process than `previous`
 * — i.e. the supervisor's respawn has completed and published itself.
 *
 * Identity is the pid, not the port: the main listener walks a deterministic
 * ladder from 4399 and usually reclaims the very same port, so a port compare
 * would report "no respawn yet" forever.
 */
export async function waitForRespawn(previous: ServerInfo, timeout = 120_000): Promise<ServerInfo> {
  let latest: ServerInfo | null = null;
  await browser.waitUntil(
    async () => {
      try {
        latest = readServerInfo();
      } catch {
        return false; // file removed by spawn_for, not yet rewritten — keep waiting
      }
      return latest.pid !== previous.pid;
    },
    {
      timeout,
      interval: 500,
      timeoutMsg: `sidecar never respawned (still pid ${previous.pid} after ${timeout} ms)`,
    }
  );
  return latest as unknown as ServerInfo;
}
