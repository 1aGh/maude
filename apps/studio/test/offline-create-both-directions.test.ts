// S6.13 — offline create, both directions, against a REAL hub (Node fixture,
// as `sync-accepted-runtime.test.ts`). Desktop and cloud are not symmetric
// (memory: test sync in both directions), so each leg is its own test:
//
//   • desktop makes a canvas while it cannot reach the project, quits, comes
//     back online → the cloud peer gets it, and the project created it ONCE;
//   • the cloud makes a canvas while the desktop is away → the desktop gets it;
//   • both made the same name while apart → the project keeps the cloud's,
//     and the desktop's joins as "<name> 2" (S6.13b; never written over, never lost).
//
// The oracle is always the other peer's disk or the hub's own log.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../collab/registry.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) console.warn('[offline-create-both-directions] SKIPPED — needs apps/hub deps.');

const src = (title: string) =>
  `export default function Canvas() {\n  return <h1 title="${title}">${title}</h1>;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 30_000
): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (err) {
      last = err;
    }
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

function startHub(dataDir: string, port = '0'): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, port, '--transactions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, port: info.port, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) reject(new Error(`hub exited ${code}: ${buf}`));
    });
  });
}

function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGTERM');
  });
}

interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: 'test',
      projectLabel: null,
      designRoot: 'design',
      canvasGroups: [{ label: 'Canvases', path: 'ui' }],
      rootClass: 'app',
      themeDefault: 'dark',
      tokensCssRel: 'system/colors.css',
      teamAccentDefault: null,
      handoffTargets: [],
      newCanvasDir: 'ui',
      newComponentDir: 'ui/components',
      linkedHub: { url, linkedAt: 0, fileEvents: false },
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot,
      designRel: 'design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: 'design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  return {
    ctx,
    runtime,
    read: (rel) => {
      try {
        return readFileSync(file(rel), 'utf8');
      } catch {
        return null;
      }
    },
    write: (rel, text) => {
      writeFileSync(file(rel), text);
      ctx.bus.emit('fs:any', rel);
    },
  };
}

describe.skipIf(!HUB_READY)('offline create — desktop ⇄ cloud on a real hub', () => {
  let root: string;
  let hub: Hub;
  let desktop: Peer;
  let cloud: Peer;
  let desktopUrl: string;
  let cloudUrl: string;
  const saved: Record<string, string | undefined> = {};
  const warnings: string[] = [];
  const realWarn = console.warn;

  const api = async (route: string) => {
    const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const hubDocAt = async (rel: string) =>
    ((await api('bootstrap')).docs as { path: string; retired: boolean }[]).some(
      (d) => d.path === rel && !d.retired
    );
  const createsOf = async (rel: string) =>
    ((await api('history?limit=200')).history as HistoryRow[]).filter(
      (a) => a.kind === 'canvas.create' && a.effects.some((e) => e.afterPath === rel)
    ).length;
  const outboxOf = (p: Peer) => join(p.ctx.paths.designRoot, '_state', 'outbox');
  const queued = (p: Peer) =>
    existsSync(outboxOf(p)) && readdirSync(outboxOf(p)).some((n) => /^\d+-tx_/.test(n));
  const restartHub = async () => {
    hub = await startHub(join(root, 'hub'), hub.port);
  };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'offline-create-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    desktopUrl = `http://127.0.0.1:${hub.port}`;
    cloudUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [desktopUrl]: { token: hub.tokens.alice }, [cloudUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'desktop', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'desktop', 'design', 'ui', 'home.tsx'), src('Home'));
    desktop = await startPeer(join(root, 'desktop'), desktopUrl);
    await waitFor(() => hubDocAt('ui/home.tsx'), 'the project to have ui/home.tsx');
    cloud = await startPeer(join(root, 'cloud'), cloudUrl);
    await waitFor(async () => {
      await cloud.runtime.pullRemoteNow();
      return cloud.read('ui/home.tsx') === src('Home');
    }, 'the cloud peer to have ui/home.tsx');
    console.warn = (...a: unknown[]) => {
      warnings.push(a.map(String).join(' '));
      realWarn(...a);
    };
  }, 90_000);

  // Each leg stands alone: a failed leg must not leave the project down.
  afterEach(async () => {
    if (hub.proc.exitCode !== null || hub.proc.signalCode !== null) await restartHub();
  });

  afterAll(async () => {
    console.warn = realWarn;
    await desktop?.runtime.stop();
    await cloud?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('desktop → cloud: a canvas made offline survives a quit and is created exactly once', async () => {
    await stopHub(hub);
    desktop.write('ui/poster.tsx', src('Poster made offline'));
    await desktop.runtime.rescanNow();
    await waitFor(() => queued(desktop), 'the create to be kept on this Mac');
    // Quit, and launch again while still offline; the network comes back later.
    await desktop.runtime.stop();
    warnings.length = 0;
    desktop = await startPeer(join(root, 'desktop'), desktopUrl);
    await new Promise((r) => setTimeout(r, 1500));
    await restartHub();
    await waitFor(
      async () => {
        await cloud.runtime.pullRemoteNow();
        return cloud.read('ui/poster.tsx') === src('Poster made offline');
      },
      'the offline canvas on the cloud peer',
      60_000
    );
    await waitFor(() => !queued(desktop), 'the desktop outbox to drain');
    expect(await createsOf('ui/poster.tsx')).toBe(1);
    // Exactly once: the replay was not followed by a second, refused create.
    expect(warnings.filter((w) => /did not accept this canvas/.test(w))).toEqual([]);
    // …and the canvas is a live member: the next edit reaches the cloud.
    desktop.write('ui/poster.tsx', src('Poster edited online'));
    await waitFor(
      () => cloud.read('ui/poster.tsx') === src('Poster edited online'),
      'the next edit on the cloud peer'
    );
  }, 150_000);

  test('cloud → desktop: a canvas the cloud made while the desktop was away arrives', async () => {
    await desktop.runtime.stop();
    cloud.write('ui/flyer.tsx', src('Flyer from the cloud'));
    await cloud.runtime.rescanNow();
    await waitFor(() => hubDocAt('ui/flyer.tsx'), 'the project to have the cloud canvas');
    desktop = await startPeer(join(root, 'desktop'), desktopUrl);
    await waitFor(
      async () => {
        await desktop.runtime.pullRemoteNow();
        return desktop.read('ui/flyer.tsx') === src('Flyer from the cloud');
      },
      'the cloud canvas on the desktop',
      60_000
    );
    expect(await createsOf('ui/flyer.tsx')).toBe(1);
  }, 150_000);

  test('the same name made on both sides while apart: the project keeps one, nothing is lost', async () => {
    await stopHub(hub);
    desktop.write('ui/notes.tsx', src('Notes from the desktop'));
    await desktop.runtime.rescanNow();
    await waitFor(() => queued(desktop), 'the desktop create to be kept on this Mac');
    await desktop.runtime.stop();
    await restartHub();
    cloud.write('ui/notes.tsx', src('Notes from the cloud'));
    await cloud.runtime.rescanNow();
    await waitFor(() => hubDocAt('ui/notes.tsx'), 'the cloud canvas in the project');
    desktop = await startPeer(join(root, 'desktop'), desktopUrl);
    await waitFor(() => !queued(desktop), 'the desktop outbox to settle', 60_000);
    // Never written over: the peer's canvas stands, created once.
    await cloud.runtime.pullRemoteNow();
    await new Promise((r) => setTimeout(r, 1000));
    expect(cloud.read('ui/notes.tsx')).toBe(src('Notes from the cloud'));
    expect(await createsOf('ui/notes.tsx')).toBe(1);
    // Never lost: the desktop's canvas joined under the next free name (S6.13b —
    // renamed, not held as a conflict).
    await waitFor(
      async () => {
        await cloud.runtime.pullRemoteNow();
        return cloud.read('ui/notes 2.tsx') === src('Notes from the desktop');
      },
      "the desktop's canvas, renamed, on the cloud peer",
      60_000
    );
    expect(desktop.runtime.conflictVersions?.('design/ui/notes.tsx') ?? null).toBeNull();
  }, 150_000);
});

interface HistoryRow {
  kind: string;
  effects: { afterPath: string | null }[];
}
