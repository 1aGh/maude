// S1.13 — "Restore only <artboard>" on a linked project, in BOTH directions (memory: cloud and desktop are
// not symmetric — test both). Two studio runtimes on a real hub (the serve-hub fixture, accepted revisions):
// Alice restores one artboard and Bob's disk follows; then Bob restores the other one and Alice's follows.
// Each restore is ONE `restore` action through the hub kernel (lane.replace + baseContent, merged three-way),
// and the artboard nobody restored is byte-identical on both Macs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createHistoryRoutes, type HistoryRuntime } from '../routes/history.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

const MEMBER = resolveAccess({ v: 1, role: 'member' } as AccessClaim);

const two = (
  hero: string,
  away: string
) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';

export default function Two() {
  return (
    <DesignCanvas>
      <DCArtboard id="hero" label="Hero" width={100} height={100}>
        <h1>${hero}</h1>
      </DCArtboard>
      <DCArtboard id="away" label="Away" width={100} height={100}>
        <p>${away}</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

async function waitFor<T>(fn: () => T | Promise<T>, what: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* retry */
    }
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

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions'], {
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
  });
}

const noop = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

interface Peer {
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
  restore: (body: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }] })
  );
  const ctx = {
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
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noop()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const specs = createHistoryRoutes({
    control: () => runtime as unknown as HistoryRuntime,
    designRel: 'design',
    designRoot,
    access: () => MEMBER,
  });
  const spec = specs.find(
    (s) => s.method === 'POST' && s.path === '/_api/project/restore'
  ) as RouteSpec;
  return {
    runtime,
    read: (rel) => {
      try {
        return readFileSync(join(designRoot, rel), 'utf8');
      } catch {
        return null;
      }
    },
    write: (rel, text) => {
      writeFileSync(join(designRoot, rel), text);
      ctx.bus.emit('fs:any', rel);
    },
    restore: async (body) => {
      const res = await spec.handle(
        new Request('http://localhost/_api/project/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        {}
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
  };
}

describe.skipIf(!HUB_READY)('Restore only <artboard> — both directions on a real hub', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 's113-restore-sync-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const aliceUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [aliceUrl]: { token: hub.tokens.alice }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'alice', 'design', 'ui'), { recursive: true });
    writeFileSync(join(root, 'alice', 'design', 'ui', 'two.tsx'), two('Hero v1', 'Away v1'));
    alice = await startPeer(join(root, 'alice'), aliceUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/two.tsx');
    }, 'the hub to accept ui/two.tsx');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await bob.runtime.pullRemoteNow();
    await waitFor(() => bob.read('ui/two.tsx') === two('Hero v1', 'Away v1'), 'bob’s copy');
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub && hub.proc.exitCode === null) {
      const gone = new Promise((r) => hub.proc.once('exit', r));
      hub.proc.kill('SIGTERM');
      await gone;
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('Alice restores Hero → Bob follows; Bob restores Away → Alice follows', async () => {
    const rows =
      (await alice.runtime.acceptedHistory?.({ path: 'design/ui/two.tsx', limit: 5 })) ?? [];
    const v1 = rows[0]?.revision as number;
    expect(v1).toBeGreaterThan(0);
    bob.write('ui/two.tsx', two('Hero v2', 'Away v2'));
    await waitFor(() => alice.read('ui/two.tsx') === two('Hero v2', 'Away v2'), 'bob→alice edit');

    // Alice → Bob
    const a = await alice.restore({ path: 'ui/two.tsx', at: `r${v1}`, artboard: 'hero' });
    expect(a.status).toBe(200);
    expect(a.body.ok).toBe(true);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/two.tsx') === two('Hero v1', 'Away v2');
    }, 'alice’s restore on bob');
    expect(alice.read('ui/two.tsx')).toBe(two('Hero v1', 'Away v2'));
    const [top] =
      (await bob.runtime.acceptedHistory?.({ path: 'design/ui/two.tsx', limit: 1 })) ?? [];
    expect(top?.kind).toBe('restore');
    expect(top?.mine).toBe(false);

    // Bob → Alice
    const b = await bob.restore({ path: 'ui/two.tsx', at: `r${v1}`, artboard: 'away' });
    expect(b.status).toBe(200);
    await waitFor(async () => {
      await alice.runtime.pullRemoteNow();
      return alice.read('ui/two.tsx') === two('Hero v1', 'Away v1');
    }, 'bob’s restore on alice');
    expect(bob.read('ui/two.tsx')).toBe(two('Hero v1', 'Away v1'));

    // Alice undoes HER restore: only Hero goes back to v2; Bob's Away restore stays
    const u = await alice.runtime.acceptedUndo?.(a.body.actionId as string);
    expect(u?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/two.tsx') === two('Hero v2', 'Away v1');
    }, 'the undo of alice’s restore on bob');
  }, 60_000);
});
