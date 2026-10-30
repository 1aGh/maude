// A studio sync peer on a REAL hub (Node fixture `apps/hub/test/fixtures/serve-hub.mjs`), shared by
// `offline-create-collision-rename.test.ts` and its crash fixture `create-rename-crash.ts`. The same
// shape `offline-create-both-directions.test.ts` builds inline.

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRegistry } from '../../collab/registry.ts';
import type { Context } from '../../context.ts';
import { createBus } from '../../context.ts';
import {
  type CreateSyncRuntimeOptions,
  createSyncRuntime,
  type SyncRuntime,
} from '../../sync/index.ts';

export const HUB_DIR = join(import.meta.dir, '..', '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
export const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

export async function waitFor<T>(
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

export interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
}

export function startHub(dataDir: string, port = '0'): Promise<Hub> {
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

export function stopHub(hub: Hub): Promise<void> {
  return new Promise((resolve) => {
    if (hub.proc.exitCode !== null) return resolve();
    hub.proc.once('exit', () => resolve());
    hub.proc.kill('SIGTERM');
  });
}

export interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
}

export function makeCtx(repoRoot: string, url: string): Context {
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

export async function startPeer(
  repoRoot: string,
  url: string,
  extra: Partial<CreateSyncRuntimeOptions> = {}
): Promise<Peer> {
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
    ...extra,
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
