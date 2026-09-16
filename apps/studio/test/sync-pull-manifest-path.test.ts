// A canvas pulled onto a fresh copy lands where the PROJECT says it lives.
//
// Found by the surface certification run (2026-09-16, L24 final parity): one
// fresh copy wrote `ui/surfaceboards-peer.tsx` while every other copy had
// `ui/SurfaceBoards-peer.tsx`. A pulled canvas starts at a target derived from
// its slug — lowercase — and was corrected only by the path its document
// carries, read the moment the handshake completes. When the handshake was
// reported before that path was readable, the fallback stood. Under accepted
// revisions the project's manifest already names the path, before anything is
// fetched.
//
// The race is made deterministic by giving the runtime a document that never
// names its path: the real provider syncs a private copy, and everything it
// receives is mirrored into the runtime's document minus that one field.
// Everything else is real: the hub, its accepted-revisions store, the
// manifest, the runtime.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import {
  createDefaultProviderFactory,
  createSyncRuntime,
  type ProviderFactory,
  type SyncRuntime,
} from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const body = `export default function MixedCase() {\n  return <h1>Mixed case</h1>;\n}\n`;
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
      name: 'mixed',
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
    projectLabel: 'mixed',
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

describe.skipIf(!HUB_READY)('a canvas pulled before its document names its path', () => {
  let root: string;
  let hub: ChildProcess;
  let http = '';
  let tokens: Record<string, string> = {};
  let runtime: SyncRuntime | null = null;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'pull-manifest-path-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    process.env.MAUDE_SHARED_DOC = '1';
    hub = spawn('node', [FIXTURE, join(root, 'hub'), '0', '--transactions'], {
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
    http = info.http;
    tokens = info.tokens;
    const mode = (await (
      await fetch(`${http}/api/projects/current/v1/mode`, {
        headers: { authorization: `Bearer ${tokens.owner}` },
      })
    ).json()) as { epoch: number };
    const r = await fetch(`${http}/api/projects/local/v1/proposals`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.owner}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 1,
        projectId: 'local',
        epoch: mode.epoch,
        transactionId: `tx_mixed_${Date.now()}`,
        origin: { deviceId: 'seed', sessionId: 's' },
        action: {
          kind: 'edit',
          label: 'seed',
          operations: [
            {
              op: 'doc.create',
              doc: 'ws/local/main/ui-mixedcase',
              path: 'ui/MixedCase.tsx',
              lanes: { html: body },
            },
          ],
        },
      }),
    });
    expect(r.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop?.();
    hub?.kill('SIGTERM');
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('lands at the path the project manifest names, not at the slug', async () => {
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({ hubs: { [http]: { token: tokens.alice, role: 'member', linkedAt: 1 } } }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    const ctx = makeCtx(join(root, 'fresh'), http);
    const real = createDefaultProviderFactory();
    const MIRROR = { mirror: true };
    // The race, pinned: a document that does not (yet) name its own path.
    const early: ProviderFactory = async (args) => {
      const shown = args.document ?? new Y.Doc();
      const own = new Y.Doc();
      own.on('update', (update: Uint8Array) => {
        Y.applyUpdate(shown, update, MIRROR);
        const meta = shown.getMap('syncMeta');
        if (meta.has('path')) shown.transact(() => meta.delete('path'), MIRROR);
      });
      const p = await real({ ...args, document: own });
      return { ...p, document: shown, isRemoteOrigin: (o: unknown) => o === MIRROR };
    };
    runtime = createSyncRuntime(ctx, {
      registry: createRegistry(noop),
      auth: { renewCredential: async () => null },
      providerFactory: early,
    });
    await runtime?.start();
    // Where the runtime decided the canvas lives. The body itself is written
    // by the collab room's persistence, which this test does not run; the
    // untrusted-content index names the chosen path for every pulled canvas,
    // and it is rewritten the moment a pulled canvas is relocated.
    const index = join(ctx.paths.designRoot, '_untrusted', 'INDEX.json');
    const bodyOf = (): string | null => {
      try {
        const j = JSON.parse(readFileSync(index, 'utf8')) as {
          canvases?: Array<{ slug: string; body: string }>;
        };
        return j.canvases?.find((c) => c.slug === 'ui-mixedcase')?.body ?? null;
      } catch {
        return null;
      }
    };
    // Past the handshake: the decision that used to go wrong is made after it.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && (runtime?.status()?.docs?.synced ?? 0) < 1)
      await new Promise((r) => setTimeout(r, 200));
    expect(runtime?.status()?.docs?.synced ?? 0).toBe(1);
    await new Promise((r) => setTimeout(r, 500));
    expect(bodyOf()).toBe('design/ui/MixedCase.tsx');
    real.dispose();
  }, 60_000);
});
