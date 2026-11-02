// p8-orphan-sidecars — a server the desktop shell spawned ends when the shell is gone.
//
// Found 2026-10-30: `bun apps/studio/server.ts` processes reparented to launchd (ppid 1), alive for
// 5–13 h, each with a `_thumbs-playwright.mjs` child. When Maude.app is force-quit, crashes or is
// SIGKILLed, its own cleanup (sidecar.rs `kill_server`, SIGTERM-first) never runs, and nothing in
// a project server or the Home server noticed its parent was gone. The server now watches its
// parent (shell/parent-watch.ts) when the shell spawned it — or a harness opted in with
// MAUDE_EXIT_WITH_PARENT=1 — and leaves through the same shutdown() as SIGTERM. A server started
// from a terminal (`maude design serve`, server-up.sh's nohup respawn) must keep outliving the
// shell that started it.
//
// Each case spawns a stand-in for Maude.app (test/_orphan-parent.ts) that spawns the server the
// way the Tauri shell plugin does, then SIGKILLs the stand-in.

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Subprocess, spawn } from 'bun';

import { writeStubClaude } from '../../../scripts/lib/stub-claude.mjs';
import { wantsExitWithParent, watchParent } from '../shell/parent-watch.ts';
import { makeSandbox, nextPort } from './_helpers.ts';

const STUDIO = join(import.meta.dir, '..');
const SERVER = join(STUDIO, 'server.ts');
const PARENT = join(import.meta.dir, '_orphan-parent.ts');
/** the bound the shell-spawned server must leave within, once its parent is gone */
const EXIT_BOUND_MS = 10_000;

const CANVAS = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function C() {
  return (<DesignCanvas><DCSection id="s" title="S">
    <DCArtboard id="a" label="A" width={960} height={600}><div>a</div></DCArtboard>
  </DCSection></DesignCanvas>);
}
`;

const cleanups: Array<() => void> = [];
afterAll(() => {
  for (const c of cleanups.reverse()) {
    try {
      c();
    } catch {
      /* best-effort */
    }
  }
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function killPid(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* gone */
  }
}

/** every live descendant of `pid`: [pid, command] */
function descendants(pid: number): Array<[number, string]> {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] as string }));
  const out: Array<[number, string]> = [];
  const walk = (p: number) => {
    for (const r of rows)
      if (r.ppid === p) {
        out.push([r.pid, r.cmd]);
        walk(r.pid);
      }
  };
  walk(pid);
  return out;
}

async function until(fn: () => boolean | Promise<boolean>, ms: number, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await Bun.sleep(step);
  }
  return false;
}

/** a throwaway machine: HOME, XDG config, index dir, a stub `claude` first on PATH */
function isolatedEnv(): Record<string, string> {
  const work = mkdtempSync(join(tmpdir(), 'maude-orphan-'));
  cleanups.push(() => rmSync(work, { recursive: true, force: true }));
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    // nothing of a real shell spawn or an opt-in leaks in from the runner's own environment
    if (v === undefined || /^MAUDE_(SHELL|HOME|TOKEN)_|^MAUDE_EXIT_WITH_PARENT$/.test(k)) continue;
    env[k] = v;
  }
  const stubBin = writeStubClaude(join(home, 'bin'));
  return {
    ...env,
    // the real browser cache stays reachable, so the thumbs shim behaves as on a real Mac
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH ??
      join(process.env.HOME ?? home, 'Library/Caches/ms-playwright'),
    HOME: home,
    PATH: `${stubBin}:${process.env.PATH ?? ''}`,
    MAUDE_CLAUDE_BIN: '',
    NO_OPEN: '1',
    NODE_ENV: 'test',
    MAUDE_NO_AUTOBUILD: '1',
    XDG_CONFIG_HOME: join(work, 'config'),
    MAUDE_MACHINE_FILE: join(work, 'config', 'maude', 'machine.json'),
    MAUDE_INDEX_DIR: join(work, 'index'),
    MAUDE_HOME_STATE_DIR: join(work, 'home-state'),
    MAUDE_CLOUD_URL: 'http://127.0.0.1:9',
    MAUDE_SYNC_IN_CI: '1',
    // keep the thumbs shim up for the whole test once it exists (its own idle exit is 60 s)
    MAUDE_THUMBS_IDLE_MS: '600000',
  };
}

/** Spawn the app stand-in, which spawns `cmd`; resolves once the stand-in reports the child pid. */
async function underParent(cmd: string[], cwd: string, env: Record<string, string>) {
  const parent: Subprocess<'ignore', 'pipe', 'inherit'> = spawn({
    cmd: ['bun', 'run', PARENT],
    cwd: STUDIO,
    env: { ...process.env, MAUDE_TEST_CHILD_SPEC: JSON.stringify({ cmd, cwd, env }) },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
  });
  cleanups.push(() => killPid(parent.pid));
  const reader = parent.stdout.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let child = 0;
  const end = Date.now() + 15_000;
  while (!child && Date.now() < end) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const m = buf.match(/child (\d+)/);
    if (m) child = Number(m[1]);
  }
  reader.releaseLock();
  if (!child) throw new Error('the app stand-in never reported its child');
  cleanups.push(() => {
    for (const [pid] of descendants(child)) killPid(pid);
    killPid(child);
  });
  return { parent, child };
}

async function up(port: number, pid: number, headers: Record<string, string> = {}) {
  return until(
    async () => {
      if (!alive(pid)) throw new Error(`server ${pid} exited during boot`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/_health`, {
          headers,
          signal: AbortSignal.timeout(300),
        });
        return r.status > 0;
      } catch {
        return false;
      }
    },
    30_000,
    150
  );
}

/** a project with one canvas and no cover yet: the boot's background cover pass starts the shim */
function projectWithCanvas() {
  const box = makeSandbox();
  cleanups.push(() => rmSync(box.root, { recursive: true, force: true }));
  writeFileSync(join(box.designRoot, 'ui', 'a.tsx'), CANVAS);
  return box;
}

async function bootProject(extraEnv: Record<string, string>) {
  const box = projectWithCanvas();
  const port = nextPort();
  const env = { ...isolatedEnv(), ...extraEnv };
  const { parent, child } = await underParent(
    ['bun', 'run', SERVER, '--port', String(port), '--root', box.root],
    STUDIO,
    env
  );
  expect(await up(port, child)).toBe(true);
  return { parent, child, port };
}

async function waitForShim(server: number) {
  let shim = 0;
  await until(
    () => {
      shim = descendants(server).find(([, c]) => c.includes('_thumbs-playwright'))?.[0] ?? 0;
      return shim > 0;
    },
    30_000,
    200
  );
  return shim;
}

function shellProjectEnv(work: string): Record<string, string> {
  // what sidecar.rs `spawn_for` sets on every project spawn (APP_SIDECAR_ENV + the shell probe)
  return {
    MAUDE_SHELL_SIDECAR: '1',
    MAUDE_SHELL_TOKEN: 'ab'.repeat(32),
    MAUDE_SHELL_INFO_FILE: join(work, 'shell-info.json'),
  };
}

describe('a project server and the app that spawned it', () => {
  test('spawned by the shell: the app is SIGKILLed → the server and its thumbs shim end', async () => {
    const work = mkdtempSync(join(tmpdir(), 'maude-orphan-shell-'));
    cleanups.push(() => rmSync(work, { recursive: true, force: true }));
    // the bun test preload turns the boot's cover pass off (MAUDE_NO_BOOT_COVERS=1); this case needs it
    const { parent, child } = await bootProject({
      ...shellProjectEnv(work),
      MAUDE_NO_BOOT_COVERS: '0',
    });
    const shim = await waitForShim(child);
    expect(shim).toBeGreaterThan(0);

    parent.kill('SIGKILL');
    await parent.exited;
    expect(await until(() => !alive(child), EXIT_BOUND_MS)).toBe(true);
    // the shim exits when its stdin closes; give it the same bound after the server
    expect(await until(() => !alive(shim), EXIT_BOUND_MS)).toBe(true);
  }, 120_000);

  test('a harness opts in with MAUDE_EXIT_WITH_PARENT=1 → the server ends with its parent', async () => {
    const { parent, child } = await bootProject({ MAUDE_EXIT_WITH_PARENT: '1' });
    parent.kill('SIGKILL');
    await parent.exited;
    expect(await until(() => !alive(child), EXIT_BOUND_MS)).toBe(true);
  }, 120_000);

  test('started from a terminal (no shell env, no opt-in) → still running after the same wait', async () => {
    const { parent, child, port } = await bootProject({});
    parent.kill('SIGKILL');
    await parent.exited;
    await Bun.sleep(EXIT_BOUND_MS);
    expect(alive(child)).toBe(true);
    // and it still serves
    expect((await fetch(`http://127.0.0.1:${port}/_health`)).ok).toBe(true);
  }, 120_000);
});

describe('the Home server and the app that spawned it', () => {
  const PAGE = 'cd'.repeat(32);

  async function bootHome(extraEnv: Record<string, string>) {
    const cwd = mkdtempSync(join(tmpdir(), 'maude-orphan-home-')); // empty: no .design/
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }));
    const port = nextPort();
    const env = { ...isolatedEnv(), CLAUDE_PROJECT_DIR: cwd, ...extraEnv };
    const { parent, child } = await underParent(
      ['bun', 'run', SERVER, '--home', '--port', String(port)],
      cwd,
      env
    );
    expect(await up(port, child, { 'x-maude-home': PAGE })).toBe(true);
    return { parent, child };
  }

  test('spawned by the shell: the app is SIGKILLed → Home ends', async () => {
    const state = mkdtempSync(join(tmpdir(), 'maude-orphan-homeinfo-'));
    cleanups.push(() => rmSync(state, { recursive: true, force: true }));
    // what home.rs `spawn_home` sets
    const { parent, child } = await bootHome({
      MAUDE_HOME_TOKEN: 'ef'.repeat(32),
      MAUDE_HOME_PAGE_SECRET: PAGE,
      MAUDE_SHELL_INFO_FILE: join(state, 'home.json'),
    });
    parent.kill('SIGKILL');
    await parent.exited;
    expect(await until(() => !alive(child), EXIT_BOUND_MS)).toBe(true);
  }, 90_000);

  test('no shell env, no opt-in → Home is still running after the same wait', async () => {
    const { parent, child } = await bootHome({});
    parent.kill('SIGKILL');
    await parent.exited;
    await Bun.sleep(EXIT_BOUND_MS);
    expect(alive(child)).toBe(true);
  }, 90_000);
});

describe('who ends with its parent (shell/parent-watch.ts)', () => {
  test('the shell spawns and the opt-in do; a terminal start does not', () => {
    expect(wantsExitWithParent({ MAUDE_SHELL_SIDECAR: '1' })).toBe(true);
    expect(wantsExitWithParent({ MAUDE_SHELL_TOKEN: 'x' })).toBe(true);
    expect(wantsExitWithParent({ MAUDE_HOME_TOKEN: 'x' })).toBe(true);
    expect(wantsExitWithParent({ MAUDE_SHELL_INFO_FILE: '/x/home.json' })).toBe(true);
    expect(wantsExitWithParent({ MAUDE_EXIT_WITH_PARENT: '1' })).toBe(true);
    // an explicit 0 wins over a shell spawn
    expect(wantsExitWithParent({ MAUDE_SHELL_SIDECAR: '1', MAUDE_EXIT_WITH_PARENT: '0' })).toBe(
      false
    );
    // `maude design serve` / server-up.sh: none of the above
    expect(wantsExitWithParent({ NO_OPEN: '1', PORT: '4399', MAUDE_PROFILE_ID: 'default' })).toBe(
      false
    );
    expect(wantsExitWithParent({ MAUDE_SHELL_SIDECAR: '0' })).toBe(false);
  });

  test('fires once when the parent changes, never while it stays', async () => {
    let ppid = 4242;
    let fired = 0;
    const stop = watchParent(() => fired++, {
      bootPpid: 4242,
      intervalMs: 10,
      getPpid: () => ppid,
    });
    await Bun.sleep(60);
    expect(fired).toBe(0);
    ppid = 1;
    await Bun.sleep(60);
    ppid = 777;
    await Bun.sleep(60);
    expect(fired).toBe(1);
    stop();
  });

  test('a parent already gone at the first tick (ppid 1 at boot) fires', async () => {
    let fired = 0;
    const stop = watchParent(() => fired++, { bootPpid: 1, intervalMs: 10, getPpid: () => 1 });
    await Bun.sleep(60);
    expect(fired).toBe(1);
    stop();
  });
});
