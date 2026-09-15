// Progressive bootstrap — plan T19. Opening a project must not wait for the
// renderer or for every blob, and must not claim readiness it does not have.
//
// Against a REAL hub in `transactions` mode (spawned under Node — Bun cannot
// load better-sqlite3), which here runs WITHOUT a studio child: the renderer
// is absent for the whole suite, which is exactly the "renderer stopped" case.
//
//   • the project's metadata, rights, manifest and folders answer anyway, and
//     health keeps coordinator readiness apart from renderer readiness;
//   • a designer who opens the project gets the canvas they can work on before
//     anything else finishes, and that moment is measured on its own;
//   • a canvas already on this machine reopens with the hub unreachable — the
//     runtime does not block on the network, and says it is not connected
//     instead of pretending to be synced.
//
// Media ordering (referenced assets first, then smallest) and explicit offline
// preparation live beside the file plane in sync-file-plane.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn(
    '[sync-project-bootstrap] SKIPPED — apps/hub dependencies are not installed; this suite needs a real hub.'
  );
}

const DOWN_URL = 'http://127.0.0.1:9';

const src = (title: string) =>
  `export default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
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

function noopCallbacks(): RoomCallbacks {
  return { async seed() {}, async persistJson() {}, async persistBinary() {} };
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

async function startRuntime(repoRoot: string, url: string): Promise<SyncRuntime> {
  const runtime = createSyncRuntime(makeCtx(repoRoot, url), {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  return runtime;
}

describe.skipIf(!HUB_READY)('progressive bootstrap (T19) — no renderer, no waiting', () => {
  let root: string;
  let hub: Hub;
  let aliceUrl: string;
  const saved: Record<string, string | undefined> = {};
  const runtimes: SyncRuntime[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'project-bootstrap-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI']) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    aliceUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: {
          [aliceUrl]: { token: hub.tokens.alice },
          [bobUrl]: { token: hub.tokens.bob },
          // A linked hub that is down: the credential exists, the server does not.
          [DOWN_URL]: { token: hub.tokens.alice },
        },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
  }, 30_000);

  afterAll(async () => {
    for (const r of runtimes) await r.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('the project answers with no renderer, and health keeps the two readinesses apart', async () => {
    const health = (await (await fetch(`${hub.http}/health`)).json()) as {
      ok: boolean;
      coordinator?: { ready: boolean; mode: string; durable: boolean };
      studio?: unknown;
    };
    expect(health.ok).toBe(true);
    expect(health.coordinator).toMatchObject({ ready: true, mode: 'transactions', durable: true });
    // No renderer at all — and the coordinator is ready regardless.
    expect(health.studio ?? null).toBeNull();

    const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
      headers: { authorization: `Bearer ${hub.tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const boot = (await res.json()) as {
      protocol: number;
      docs: unknown[];
      dirs: unknown[];
      you: { actor: string; readOnly: boolean };
      capabilities: { operations: string[] };
    };
    expect(boot.protocol).toBe(1);
    expect(Array.isArray(boot.docs)).toBe(true);
    expect(Array.isArray(boot.dirs)).toBe(true);
    // Rights come with the manifest: the app knows before any render whether
    // this person may edit.
    expect(boot.you.readOnly).toBe(false);
    expect(boot.capabilities.operations).toContain('doc.create');

    const viewer = (await (
      await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.viewer}` },
      })
    ).json()) as { you: { readOnly: boolean } };
    expect(viewer.you.readOnly).toBe(true);
  }, 30_000);

  test('a teammate opening the project can work on the canvas first — measured on its own', async () => {
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), src('Hello'));
    const alice = await startRuntime(join(root, 'alice'), aliceUrl);
    runtimes.push(alice);
    await waitFor(async () => {
      const b = (await (
        await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
          headers: { authorization: `Bearer ${hub.tokens.owner}` },
        })
      ).json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/home.tsx');
    }, 'the hub to accept ui/home.tsx');

    const opened = performance.now();
    const bob = await startRuntime(join(root, 'bob'), `http://localhost:${hub.port}`);
    runtimes.push(bob);
    const canvas = join(root, 'bob', 'design', 'ui', 'home.tsx');
    await waitFor(async () => {
      await bob.pullRemoteNow();
      return existsSync(canvas) && readFileSync(canvas, 'utf8') === src('Hello');
    }, "bob's first canvas");
    const firstInteraction = performance.now() - opened;
    // The number the plan asks to keep apart from "everything downloaded".
    console.log(`[t19] action-to-first-canvas: ${Math.round(firstInteraction)} ms`);
    expect(firstInteraction).toBeLessThan(15_000);
  }, 40_000);

  test('a canvas already on this machine reopens with the hub unreachable — no wait, no false "synced"', async () => {
    const repo = join(root, 'carol');
    mkdirSync(join(repo, 'design', 'ui'), { recursive: true });
    writeFileSync(join(repo, 'design', 'ui', 'cached.tsx'), src('Cached'));
    // A port nothing listens on: the hub is down for this whole start.
    const t0 = performance.now();
    const carol = await startRuntime(repo, DOWN_URL);
    runtimes.push(carol);
    const startMs = performance.now() - t0;
    expect(startMs).toBeLessThan(10_000);
    expect(readFileSync(join(repo, 'design', 'ui', 'cached.tsx'), 'utf8')).toBe(src('Cached'));
    const state = carol.status()?.state;
    expect(state).not.toBe('synced');
  }, 30_000);
});
