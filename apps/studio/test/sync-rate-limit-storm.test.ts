// A rate-limited copy of a project must converge, not storm.
//
// Found by the first complete surface certification run (2026-09-16). A fresh
// copy of a 123-canvas project, opened late in a long session, stayed at
// "0/123 synced" for fifteen minutes. Its own log recorded 437 bursts of
// rate-limit refusals, and the hub recorded 525,514 refused authentications
// for that one token label — the per-minute bucket pegged near 1000/600. A
// fixed 60 s window cannot stay full by itself: a paced client is refused once
// per document per window and then waits the window out. Only a client that
// re-authenticates each document several times a SECOND can keep it full.
//
// The raw Hocuspocus provider on one shared socket does not do that
// (apps/hub/test/rate-limit-storm.test.mjs: exactly the burst, then quiet).
// So this runs the studio's own runtime — the real provider factory, a real
// hub in accepted-revisions mode — and counts what the hub was asked.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

const LIMIT = 20;
const CANVASES = 60;

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<'owner' | 'alice' | 'bob' | 'viewer', string>;
  /** Authentications the hub refused on volume. */
  refused: () => number;
  /** Sockets the hub closed on its own. */
  closed: () => number;
}

function startHub(dataDir: string, flags: string[]): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions', ...flags], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let refused = 0;
    let closed = 0;
    let out = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${out}`)), 20_000);
    proc.stderr?.on('data', (c: Buffer) => {
      const text = c.toString('utf8');
      refused += text.split('rate limit exceeded for token').length - 1;
      closed += text.split('Hocuspocus: closing connection').length - 1;
    });
    proc.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
      for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({
          proc,
          http: info.http,
          tokens: info.tokens,
          refused: () => refused,
          closed: () => closed,
        });
        return;
      }
    });
  });
}

/** Put `count` canvases on the hub before any copy opens the project. */
async function seedProject(hub: Hub, count: number): Promise<void> {
  const ops = Array.from({ length: count }, (_, i) => ({
    op: 'doc.create',
    doc: `ws/local/main/ui-c${i}`,
    path: `ui/c${i}.tsx`,
    lanes: { html: body(i) },
  }));
  const mode = (await (
    await fetch(`${hub.http}/api/projects/current/v1/mode`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    })
  ).json()) as { epoch: number };
  const r = await fetch(`${hub.http}/api/projects/local/v1/proposals`, {
    method: 'POST',
    headers: { authorization: `Bearer ${hub.tokens.owner}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      protocol: 1,
      projectId: 'local',
      epoch: mode.epoch,
      transactionId: `tx_storm_seed_${Date.now()}`,
      origin: { deviceId: 'seed', sessionId: 's' },
      action: { kind: 'edit', label: 'seed', operations: ops },
    }),
  });
  expect(r.status).toBe(200);
}

/** A fresh copy of the project on this machine, signed in as alice. */
function openCopy(root: string, hub: Hub, count: number): SyncRuntime | null {
  const repo = join(root, 'fresh');
  const hubsFile = join(root, 'fresh-hubs.json');
  writeFileSync(
    hubsFile,
    JSON.stringify({
      hubs: { [hub.http]: { token: hub.tokens.alice, role: 'member', linkedAt: 1 } },
    }),
    { mode: 0o600 }
  );
  process.env.HUBS_CONFIG_PATH = hubsFile;
  const ctx = makeCtx(repo, hub.http);
  for (let i = 0; i < count; i++)
    writeFileSync(join(ctx.paths.designRoot, 'ui', `c${i}.tsx`), body(i));
  return createSyncRuntime(ctx, {
    registry: createRegistry(noop),
    auth: { renewCredential: async () => null },
  });
}

const ENV_KEYS = ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'];

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
      name: 'storm',
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
    projectLabel: 'storm',
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

const noop: RoomCallbacks = { async seed() {}, async persistJson() {}, async persistBinary() {} };
const body = (i: number) =>
  `export default function C${i}() {\n  return <h1>Canvas ${i}</h1>;\n}\n`;

describe.skipIf(!HUB_READY)('a rate-limited copy of a large project', () => {
  let root: string;
  let hub: Hub;
  let runtime: SyncRuntime | null = null;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'rate-storm-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    process.env.MAUDE_SHARED_DOC = '1';
    hub = await startHub(join(root, 'hub'), ['--conn-rate-limit', String(LIMIT)]);
    await seedProject(hub, CANVASES);
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop?.();
    hub?.proc.kill('SIGTERM');
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('is refused about once per document, then waits for the window it was told about', async () => {
    runtime = openCopy(root, hub, CANVASES);
    expect(runtime).not.toBeNull();
    await runtime?.start();

    // Well inside one 60 s window.
    await new Promise((r) => setTimeout(r, 20_000));
    const refused = hub.refused();
    const burst = CANVASES - LIMIT;
    console.log(
      `[storm] ${refused} refused in 20 s — a paced copy is refused about ${burst} times`
    );
    // Not vacuous: the ceiling is actually reached.
    expect(refused).toBeGreaterThanOrEqual(burst);
    // The property that failed in production: a handful of retries is noise,
    // hundreds is a storm that keeps the bucket full forever.
    expect(refused).toBeLessThanOrEqual(burst * 3);
  }, 60_000);

  test('keeps pacing while the project is still arriving around it', async () => {
    // What the clean case above does not have and the production copy did: a
    // steady stream of discovery. A fresh copy's file plane lands files for
    // minutes, and every landing re-scans the canvas list — so whatever a
    // rescan does to a document the hub has just refused, it does it again
    // and again. Drive that directly.
    const before = hub.refused();
    const stopAt = Date.now() + 20_000;
    while (Date.now() < stopAt) {
      await runtime?.rescanNow();
      await runtime?.pullRemoteNow?.();
      await new Promise((r) => setTimeout(r, 200));
    }
    const refused = hub.refused() - before;
    console.log(`[storm] ${refused} further refusals across 100 rescans in 20 s`);
    // Still inside the same window the first test was refused in: a paced copy
    // waits it out, so rescanning must not add a refusal per document per scan.
    expect(refused).toBeLessThanOrEqual(CANVASES);
  }, 60_000);
});

// THE STORM ITSELF. The refusals above were the symptom; the hub log of the same
// run held 4 618 × "closing connection … too many pending unauthenticated
// documents (maxPendingDocuments 100)". Hocuspocus 4.3 cuts off a socket with
// more than 100 documents mid-authentication, and the studio used to carry a
// whole project on ONE socket, authenticating every document the moment it
// opened — so a 123-canvas copy was cut off, reconnected, re-sent all 123 and
// was cut off again, for as long as it ran. Newer hubs raise the limit, but the
// hubs already deployed keep it, so the copy has to fit under it on its own.
const BIG = 150;

describe.skipIf(!HUB_READY)('a project larger than one socket may carry', () => {
  let root: string;
  let hub: Hub;
  let runtime: SyncRuntime | null = null;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'socket-storm-'));
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    process.env.MAUDE_SHARED_DOC = '1';
    // A hub as released before the limit was raised.
    hub = await startHub(join(root, 'hub'), ['--max-pending-documents', '100']);
    await seedProject(hub, BIG);
  }, 60_000);

  afterAll(async () => {
    await runtime?.stop?.();
    hub?.proc.kill('SIGTERM');
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('syncs every canvas without the hub ever cutting it off', async () => {
    runtime = openCopy(root, hub, BIG);
    expect(runtime).not.toBeNull();
    await runtime?.start();
    const deadline = Date.now() + 45_000;
    let synced = 0;
    while (Date.now() < deadline) {
      synced = runtime?.status()?.docs?.synced ?? 0;
      if (synced === BIG) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    console.log(`[storm] ${synced}/${BIG} synced, hub closed ${hub.closed()} sockets`);
    expect(hub.closed()).toBe(0);
    expect(synced).toBe(BIG);
  }, 90_000);
});
