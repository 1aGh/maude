// home/main.ts — `maude-server --home` (V2-1.1 decision 1, §5.3).
//
// The same compiled binary as a project server (DDR-009/DDR-177), in a different mode: no
// `.design/`, no createContext(), no canvas origin, no ACP, no sync, no file watcher. Rust spawns
// one per app run before any project and supervises it like a sidecar. Inputs, all from env:
//
//   MAUDE_HOME_STATE_DIR   Home-only state (home.json)              default ~/.maude/home
//   MAUDE_INDEX_DIR        the machine index (V2-1.17)              default ~/.maude/index/v1
//   MAUDE_HOME_TOKEN       the internal bearer, 32 random bytes hex  absent → internal routes refuse
//   MAUDE_HOME_PAGE_SECRET the Home PAGE secret, 32 random bytes hex, never the bearer (V2-3.6 H1)
//                          absent → every page route refuses (home_session() hands it to Home)
//   MAUDE_SHELL_INFO_FILE  where to write {pid, port, url, started, mode:'home'}  (0600, atomic)
//   MAUDE_CLOUD_URL        the control plane                        default https://cloud.maude.sh
//   XDG_CONFIG_HOME        passthrough (profile cloud.json lookup)
//   MAUDE_HOME_PROJECTS_DIR create-local's base dir                 default ~/Maude
//
// Binds 127.0.0.1 only: `--port <p>` (the remembered Home port) or, when it is taken, the next
// free one; without `--port`, any free port. `_server.json` is never written (there is no
// `.design/`): the info file is app-owned, outside every project.

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { cloudUrl } from '../cloud/endpoints.ts';
import { SUPPORTED_FORMAT } from '../format.ts';
import { exitWithParent } from '../shell/parent-watch.ts';
import { resolveMaudeVersion } from '../whats-new.ts';
import { createHomeCloud } from './cloud.ts';
import { projectsBaseDir } from './create-local.ts';
import { createHomeFetch, MAX_BODY_BYTES } from './routes.ts';

export interface HomeServerInfo {
  pid: number;
  port: number;
  url: string;
  started: string;
  mode: 'home';
}

function argPort(argv: string[]): number | null {
  const i = argv.indexOf('--port');
  if (i === -1 || !argv[i + 1]) return null;
  const n = Number(argv[i + 1]);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function writeInfoFile(file: string, info: HomeServerInfo) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, `${JSON.stringify(info)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

export function startHomeServer(opts: { argv?: string[]; env?: NodeJS.ProcessEnv } = {}) {
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? process.env;
  const token =
    env.MAUDE_HOME_TOKEN && /^[0-9a-f]{64}$/i.test(env.MAUDE_HOME_TOKEN)
      ? env.MAUDE_HOME_TOKEN
      : null;
  const pageSecret =
    env.MAUDE_HOME_PAGE_SECRET && /^[0-9a-f]{64}$/i.test(env.MAUDE_HOME_PAGE_SECRET)
      ? env.MAUDE_HOME_PAGE_SECRET
      : null;
  const fetch = createHomeFetch({
    stateDir: env.MAUDE_HOME_STATE_DIR || path.join(homedir(), '.maude', 'home'),
    token,
    pageSecret,
    version: resolveMaudeVersion(),
    cloudOrigin: originOf(cloudUrl()),
    formatSupported: SUPPORTED_FORMAT,
    projectsDir: projectsBaseDir(),
    // r1 (img 6): the folder a picked New project location must sit in — the home folder; the e2e lane
    // names a throwaway one, like MAUDE_HOME_PROJECTS_DIR (an env only the shell that spawns Home sets)
    homeDir: env.MAUDE_HOME_LOCATION_ROOT || homedir(),
    cloud: createHomeCloud(),
  });

  const wanted = argPort(argv);
  const tries = wanted ? [...Array.from({ length: 10 }, (_, i) => wanted + i), 0] : [0];
  let server: ReturnType<typeof Bun.serve> | null = null;
  let lastErr: unknown;
  for (const port of tries) {
    try {
      server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        maxRequestBodySize: MAX_BODY_BYTES * 2,
        fetch,
        error: () => new Response('Server error', { status: 500 }),
      });
      break;
    } catch (err) {
      lastErr = err;
      if ((err as { code?: string }).code !== 'EADDRINUSE') throw err;
    }
  }
  if (!server) throw lastErr;

  const port = server.port as number;
  const info: HomeServerInfo = {
    pid: process.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    started: new Date().toISOString(),
    mode: 'home',
  };
  const infoFile = env.MAUDE_SHELL_INFO_FILE || null;
  if (infoFile) writeInfoFile(infoFile, info);
  if (!token)
    console.warn('[home] MAUDE_HOME_TOKEN unset or malformed — internal routes refuse every call');
  if (!pageSecret || pageSecret === token)
    console.warn(
      '[home] MAUDE_HOME_PAGE_SECRET unset or malformed — page routes refuse every call'
    );
  console.log(`[home] Maude Home on ${info.url}`);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    server?.stop(true);
    // only our own record: a successor that already wrote its info file keeps it
    if (infoFile) {
      try {
        const cur = JSON.parse(readFileSync(infoFile, 'utf8')) as { pid?: number };
        if (cur.pid === process.pid) rmSync(infoFile, { force: true });
      } catch {
        /* gone already */
      }
    }
  };
  return { server, info, stop };
}

/** server.ts's `--home` branch: start, and stop cleanly on SIGTERM/SIGINT — or once the app that
 *  spawned it is gone (p8-orphan-sidecars, shell/parent-watch.ts). */
export function runHome() {
  const { stop } = startHomeServer();
  const exit = () => {
    stop();
    process.exit(0);
  };
  process.on('SIGTERM', exit);
  process.on('SIGINT', exit);
  exitWithParent(exit, 'home');
}

if (import.meta.main) runHome();
