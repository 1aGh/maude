// A project spread over several sockets comes back whole after going offline.
//
// A project larger than one socket carries (SOCKET_DOCUMENT_LIMIT) is spread
// over several — see the storm test next to this one. The certification run
// right after that change took its peer offline and back (surface row L20) and
// found 14 of 62 documents still `pending` afterwards, all of them documents the
// copy had picked up late in the session. So: a copy that grows past one socket
// while it runs, a pulled cable, and every document has to reconnect.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, SOCKET_DOCUMENT_LIMIT, type SyncRuntime } from '../sync/index.ts';

const ROOT = join(import.meta.dir, '..', '..', '..');
const HUB_DIR = join(ROOT, 'apps', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const PROXY = join(ROOT, 'scripts', 'dev', 'sync-e2e', 'toggle-proxy.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const FIRST = 40;
const LATER = 40;

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const body = (i: number) =>
  `export default function C${i}() {\n  return <h1>Canvas ${i}</h1>;\n}\n`;
const noop: RoomCallbacks = { async seed() {}, async persistJson() {}, async persistBinary() {} };

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  return {
    canvasOrigin: 'http://canvas.localhost',
    sharedDoc: true,
    cfg: {
      name: 'shards',
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
    projectLabel: 'shards',
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

describe.skipIf(!HUB_READY)('a project on several sockets, cut off and reconnected', () => {
  let root: string;
  let hub: ChildProcess;
  let proxy: ChildProcess;
  let hubHttp = '';
  let tokens: Record<string, string> = {};
  let proxyUrl = '';
  let control = '';
  let runtime: SyncRuntime | null = null;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'shards-offline-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    process.env.MAUDE_SHARED_DOC = '1';
    const hubPort = await freePort();
    hub = spawn('node', [FIXTURE, join(root, 'hub'), String(hubPort), '--transactions'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const info = await new Promise<{ http: string; tokens: Record<string, string> }>(
      (resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error(`hub did not start: ${out}`)), 20_000);
        hub.stdout?.on('data', (c: Buffer) => {
          out += c.toString('utf8');
          const line = out.split('\n').find((l) => l.startsWith('{'));
          if (!line) return;
          clearTimeout(timer);
          resolve(JSON.parse(line));
        });
      }
    );
    hubHttp = info.http;
    tokens = info.tokens;
    const listen = await freePort();
    const ctl = await freePort();
    proxy = spawn('node', [PROXY, String(listen), String(hubPort), String(ctl)], {
      stdio: 'ignore',
    });
    proxyUrl = `http://127.0.0.1:${listen}`;
    control = `http://127.0.0.1:${ctl}`;
    for (let i = 0; i < 50; i++) {
      if (
        await fetch(`${control}/state`).then(
          (r) => r.ok,
          () => false
        )
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    // The whole project exists on the hub; the copy discovers it in two steps.
    const ops = Array.from({ length: FIRST + LATER }, (_, i) => ({
      op: 'doc.create',
      doc: `ws/local/main/ui-c${i}`,
      path: `ui/c${i}.tsx`,
      lanes: { html: body(i) },
    }));
    const mode = (await (
      await fetch(`${hubHttp}/api/projects/current/v1/mode`, {
        headers: { authorization: `Bearer ${tokens.owner}` },
      })
    ).json()) as { epoch: number };
    const r = await fetch(`${hubHttp}/api/projects/local/v1/proposals`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.owner}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 1,
        projectId: 'local',
        epoch: mode.epoch,
        transactionId: `tx_shards_seed_${Date.now()}`,
        origin: { deviceId: 'seed', sessionId: 's' },
        action: { kind: 'edit', label: 'seed', operations: ops },
      }),
    });
    expect(r.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop?.();
    proxy?.kill('SIGTERM');
    hub?.kill('SIGTERM');
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  const synced = () => runtime?.status()?.docs?.synced ?? 0;
  const waitFor = async (pred: () => boolean, ms: number) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !pred()) await new Promise((r) => setTimeout(r, 250));
    return pred();
  };

  test('every document reconnects, including the ones that arrived late', async () => {
    expect(FIRST + LATER).toBeGreaterThan(SOCKET_DOCUMENT_LIMIT);
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [proxyUrl]: { token: tokens.alice, role: 'member', linkedAt: 1 } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    const ctx = makeCtx(join(root, 'copy'), proxyUrl);
    const ui = join(ctx.paths.designRoot, 'ui');
    for (let i = 0; i < FIRST; i++) writeFileSync(join(ui, `c${i}.tsx`), body(i));
    runtime = createSyncRuntime(ctx, {
      registry: createRegistry(noop),
      auth: { renewCredential: async () => null },
    });
    await runtime?.start();
    const booted = await waitFor(() => synced() >= FIRST, 30_000);
    console.log(`[shards] after boot: ${JSON.stringify(runtime?.status()?.docs)}`);
    expect(booted).toBe(true);

    // The project grows past one socket while the copy runs.
    for (let i = FIRST; i < FIRST + LATER; i++) writeFileSync(join(ui, `c${i}.tsx`), body(i));
    await runtime?.rescanNow();
    const all = FIRST + LATER;
    expect(await waitFor(() => synced() === all, 30_000)).toBe(true);

    // A pulled cable, then the cable back.
    await fetch(`${control}/offline`, { method: 'POST' });
    expect(await waitFor(() => runtime?.status()?.state === 'offline', 60_000)).toBe(true);
    await new Promise((r) => setTimeout(r, 3000));
    await fetch(`${control}/online`, { method: 'POST' });
    const back = await waitFor(
      () => runtime?.status()?.state === 'online' && synced() === all,
      90_000
    );
    const docs = runtime?.status()?.docs;
    console.log(
      `[shards] after reconnect: ${JSON.stringify(docs)} state=${runtime?.status()?.state}`
    );
    expect(back).toBe(true);
  }, 240_000);
});
