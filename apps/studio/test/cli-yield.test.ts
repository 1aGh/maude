// #206 T6.3a (contract 206-cli-reuses-desktop.md §6 "Handover" step 3, DDR-250 decision 1) — a
// server started from a terminal (role `cli`, MAUDE_SERVER_ROLE=cli) steps down for the desktop
// app's sidecar on the same root: once the app's registry names a sidecar for this root AND that
// sidecar answers the attest challenge, the CLI server refuses new writes (409 `yielded`), waits
// for its jobs and unsent work (≤ 120 s), then shuts down (sync stopped, store lock released,
// exit 0). An entry that does not attest is ignored: a planted registry or a squatter on the port
// never makes a server quit. A server the shell spawned is never `cli`.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, Subprocess } from 'bun';

import {
  isCliRole,
  readRegistry,
  registryPath,
  watchForAppSidecar,
  yieldRefusal,
} from '../shell/cli-yield.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = 'ab'.repeat(32);
const WRONG = 'cd'.repeat(32);

const rootIdOf = (root: string) =>
  createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
const mac = (key: string, n: string, rootId: string, port: number) =>
  createHmac('sha256', key).update(`maude-attest/1\n${n}\n${rootId}\n${port}`).digest('hex');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function scratch() {
  const d = mkdtempSync(join(tmpdir(), 'maude-cli-yield-'));
  dirs.push(d);
  return d;
}

/** A stand-in app sidecar: answers the attest challenge with `key` for `rootId` at its own port. */
function fakeSidecar(key: string, rootId: string): Server {
  const srv: Server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== '/_api/shell/attest') return new Response('nope', { status: 404 });
      const n = u.searchParams.get('n') ?? '';
      return Response.json({ mac: mac(key, n, rootId, srv.port ?? 0) });
    },
  });
  return srv;
}

function registry(file: string, entries: object[], appPid = process.pid) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      app: { pid: appPid, version: '2.0.0', socket: '/nowhere', started: 'now' },
      servers: entries,
    }),
    { mode: 0o600 }
  );
  chmodSync(file, 0o600);
}

const entry = (root: string, port: number, attestKey = KEY) => ({
  root: realpathSync(root),
  rootId: rootIdOf(root),
  label: 'p-l1',
  state: 'running',
  port,
  pid: process.pid,
  attestKey,
  profile: 'default',
  kind: 'project',
  branch: null,
  busy: false,
  started: 'now',
});

// ── pure parts ───────────────────────────────────────────────────────────────────────────────

describe('isCliRole', () => {
  test('only MAUDE_SERVER_ROLE=cli, and never a server the shell spawned', () => {
    expect(isCliRole({ MAUDE_SERVER_ROLE: 'cli' })).toBe(true);
    expect(isCliRole({})).toBe(false);
    expect(isCliRole({ MAUDE_SERVER_ROLE: 'CLI' })).toBe(false);
    expect(isCliRole({ MAUDE_SERVER_ROLE: 'app' })).toBe(false);
    for (const shell of [
      { MAUDE_SHELL_SIDECAR: '1' },
      { MAUDE_SHELL_TOKEN: 't' },
      { MAUDE_SHELL_INFO_FILE: '/x/p.json' },
      { MAUDE_HOME_TOKEN: 'h' },
    ])
      expect(isCliRole({ MAUDE_SERVER_ROLE: 'cli', ...shell })).toBe(false);
  });
});

describe('registryPath', () => {
  test('an absolute override wins; a relative one is ignored', () => {
    expect(registryPath({ MAUDE_APP_REGISTRY_FILE: '/r/servers.json' }, 'darwin', '/h')).toBe(
      '/r/servers.json'
    );
    expect(registryPath({ MAUDE_APP_REGISTRY_FILE: 'r.json' }, 'darwin', '/h')).toBe(
      '/h/Library/Application Support/com.maude.app/servers.json'
    );
  });
  test('the app data dir per platform', () => {
    expect(registryPath({}, 'darwin', '/h')).toBe(
      '/h/Library/Application Support/com.maude.app/servers.json'
    );
    expect(registryPath({}, 'linux', '/h')).toBe('/h/.local/share/com.maude.app/servers.json');
    expect(registryPath({ XDG_DATA_HOME: '/x' }, 'linux', '/h')).toBe(
      '/x/com.maude.app/servers.json'
    );
  });
});

describe('readRegistry', () => {
  test('reads a 0600 registry; refuses a writable-by-others one, junk and the wrong version', () => {
    const d = scratch();
    const file = join(d, 'servers.json');
    registry(file, [entry(d, 1234)]);
    expect(readRegistry(file)?.servers.length).toBe(1);
    chmodSync(file, 0o666);
    expect(readRegistry(file)).toBeNull();
    writeFileSync(file, '{junk', { mode: 0o600 });
    chmodSync(file, 0o600);
    expect(readRegistry(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ v: 2, app: { pid: 1 }, servers: [] }));
    expect(readRegistry(file)).toBeNull();
    expect(readRegistry(join(d, 'absent.json'))).toBeNull();
  });
});

// ── the watcher, with an in-process fake sidecar ─────────────────────────────────────────────

describe('watchForAppSidecar', () => {
  const stops: Array<() => void> = [];
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of stops.splice(0)) s();
    for (const s of servers.splice(0)) s.stop(true);
  });

  function setup(opts: { sidecarKey?: string; registryKey?: string; appPid?: number } = {}) {
    const root = scratch();
    const file = join(scratch(), 'servers.json');
    const sidecar = fakeSidecar(opts.sidecarKey ?? KEY, rootIdOf(root));
    servers.push(sidecar);
    registry(file, [entry(root, sidecar.port ?? 0, opts.registryKey ?? KEY)], opts.appPid);
    return { root, file };
  }

  function watch(
    root: string,
    file: string,
    over: Partial<Parameters<typeof watchForAppSidecar>[0]> = {}
  ) {
    let yielded = 0;
    const w = watchForAppSidecar({
      root,
      rootId: rootIdOf(root),
      selfPid: 1,
      selfPort: 1,
      file,
      intervalMs: 20,
      pendingPollMs: 10,
      onYield: () => {
        yielded += 1;
      },
      log: () => {},
      ...over,
    });
    stops.push(w.stop);
    return { w, yielded: () => yielded };
  }

  test('an attested sidecar for this root → steps down once', async () => {
    const { root, file } = setup();
    const { w, yielded } = watch(root, file);
    for (let i = 0; i < 100 && yielded() === 0; i++) await Bun.sleep(10);
    expect(yielded()).toBe(1);
    expect(w.state()).toBe('yielded');
    await Bun.sleep(100);
    expect(yielded()).toBe(1);
  });

  test('a sidecar that does not attest (wrong key) is ignored', async () => {
    const { root, file } = setup({ sidecarKey: WRONG });
    const { w, yielded } = watch(root, file);
    await Bun.sleep(300);
    expect(yielded()).toBe(0);
    expect(w.state()).toBe('watching');
  });

  test('a registry naming another root, this server’s own port, or a dead app is ignored', async () => {
    const a = setup();
    const other = scratch();
    const w1 = watch(other, a.file);
    const b = setup();
    const port = readRegistry(b.file)?.servers[0]?.port ?? 0;
    const w2 = watch(b.root, b.file, { selfPort: port });
    const c = setup({ appPid: 2 ** 22 + 12345 });
    const w3 = watch(c.root, c.file);
    await Bun.sleep(300);
    expect([w1.yielded(), w2.yielded(), w3.yielded()]).toEqual([0, 0, 0]);
  });

  test('work in flight → refuses writes and waits; steps down once it is done', async () => {
    const { root, file } = setup();
    let pending = 2;
    const { w, yielded } = watch(root, file, { pending: () => pending });
    for (let i = 0; i < 100 && w.state() !== 'yielding'; i++) await Bun.sleep(10);
    expect(w.state()).toBe('yielding');
    await Bun.sleep(100);
    expect(yielded()).toBe(0);
    const post = yieldRefusal(new Request('http://127.0.0.1:1/_api/edit', { method: 'POST' }));
    expect(post?.status).toBe(409);
    expect((await post?.json())?.error).toBe('yielded');
    expect(yieldRefusal(new Request('http://127.0.0.1:1/_health'))).toBeNull();
    pending = 0;
    for (let i = 0; i < 100 && yielded() === 0; i++) await Bun.sleep(10);
    expect(yielded()).toBe(1);
  });

  test('work that never finishes is waited for at most maxWaitMs', async () => {
    const { root, file } = setup();
    const { yielded } = watch(root, file, { pending: () => 1, maxWaitMs: 150 });
    await Bun.sleep(80);
    expect(yielded()).toBe(0);
    for (let i = 0; i < 100 && yielded() === 0; i++) await Bun.sleep(10);
    expect(yielded()).toBe(1);
  });
});

// ── a real CLI-role server ───────────────────────────────────────────────────────────────────

describe('a real cli-role server', () => {
  let proc: Subprocess | null = null;
  let sidecar: Server | null = null;
  afterEach(async () => {
    if (proc && proc.exitCode === null) await killProc(proc);
    proc = null;
    sidecar?.stop(true);
    sidecar = null;
  });

  async function boot(sidecarKey: string) {
    const { root } = makeSandbox();
    dirs.push(root);
    const file = join(scratch(), 'servers.json');
    sidecar = fakeSidecar(sidecarKey, rootIdOf(root));
    proc = await bootServer(root, nextPort(), {
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_SERVER_ROLE: 'cli',
      MAUDE_APP_REGISTRY_FILE: file,
      MAUDE_CLI_YIELD_INTERVAL_MS: '200',
    });
    const lock = join(root, '.design', '_state', 'project-store.lock');
    for (let i = 0; i < 100 && !existsSync(lock); i++) await Bun.sleep(50);
    expect(existsSync(lock)).toBe(true);
    // the app starts AFTER the terminal's server, and publishes its sidecar
    registry(file, [entry(root, sidecar.port ?? 0)]);
    return { root, lock };
  }

  test('steps down for an attested app sidecar: lock released, _server.json gone, exit 0', async () => {
    const { root, lock } = await boot(KEY);
    const code = await Promise.race([proc?.exited, Bun.sleep(12_000).then(() => 'timeout')]);
    expect(code).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(join(root, '.design', '_server.json'))).toBe(false);
  });

  test('stays up when the sidecar does not attest', async () => {
    await boot(WRONG);
    await Bun.sleep(1500);
    expect(proc?.exitCode).toBeNull();
  });
});

// fix-bulk B2 — `maude design serve` while the app already serves the project: the terminal's server
// used to boot all the way (its own `_server.json` written over the app's, the store lock taken, sync
// joined), notice the app 2 s later and step down — and its shutdown then removed the `_server.json` it
// had written, so the app's server ran with none. It now decides at boot, before it writes or joins
// anything: an attested app sidecar for this root → one line, exit 0, nothing touched.
describe('a cli-role server booting while the app already serves the root', () => {
  let proc: Subprocess | null = null;
  let sidecar: Server | null = null;
  afterEach(async () => {
    if (proc && proc.exitCode === null) await killProc(proc);
    proc = null;
    sidecar?.stop(true);
    sidecar = null;
  });

  function spawnCli(root: string, file: string) {
    return Bun.spawn({
      cmd: ['bun', 'run', join(import.meta.dir, '..', 'server.ts'), '--port', String(nextPort())],
      cwd: join(import.meta.dir, '..'),
      env: {
        ...process.env,
        NO_OPEN: '1',
        NODE_ENV: 'test',
        MAUDE_EXIT_WITH_PARENT: '1',
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_MACHINE_FILE: join(root, '.design', '_state', 'machine.json'),
        XDG_STATE_HOME: `${root}-state`,
        MAUDE_SERVER_ROLE: 'cli',
        MAUDE_APP_REGISTRY_FILE: file,
        CLAUDE_PROJECT_DIR: root,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
  }

  test('steps down at boot: the app’s _server.json, the store and the key folder are untouched', async () => {
    const { root } = makeSandbox();
    dirs.push(root, `${root}-state`);
    const file = join(scratch(), 'servers.json');
    sidecar = fakeSidecar(KEY, rootIdOf(root));
    registry(file, [entry(root, sidecar.port ?? 0)]);
    const appJson = join(root, '.design', '_server.json');
    const appBytes = JSON.stringify({
      pid: process.pid,
      port: sidecar.port,
      url: `http://localhost:${sidecar.port}`,
      started: '2026-11-10T08:00:00.000Z',
    });
    writeFileSync(appJson, appBytes);
    proc = spawnCli(root, file);
    const code = await Promise.race([proc.exited, Bun.sleep(15_000).then(() => 'timeout')]);
    const out = await new Response(proc.stdout).text();
    expect(code).toBe(0);
    expect(out).toContain(`Maude is serving this project now (port ${sidecar.port})`);
    expect(readFileSync(appJson, 'utf8')).toBe(appBytes);
    expect(existsSync(join(root, '.design', '_state', 'project-store.lock'))).toBe(false);
    expect(existsSync(join(`${root}-state`, 'maude', 'servers', `${rootIdOf(root)}.json`))).toBe(
      false
    );
  }, 20_000);

  test('a sidecar that does not attest: the server boots as usual', async () => {
    const { root } = makeSandbox();
    dirs.push(root, `${root}-state`);
    const file = join(scratch(), 'servers.json');
    sidecar = fakeSidecar(WRONG, rootIdOf(root));
    registry(file, [entry(root, sidecar.port ?? 0)]);
    proc = spawnCli(root, file);
    const json = join(root, '.design', '_server.json');
    for (let i = 0; i < 300 && !existsSync(json); i++) await Bun.sleep(50);
    expect(existsSync(json)).toBe(true);
    expect(proc.exitCode).toBeNull();
  }, 20_000);
});
