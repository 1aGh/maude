// p8-update-to-accepted — end to end on a REAL hub (loopback, spawned here — never a real hub):
// a linked project that still saves the old way (legacy shared documents) runs Update project
// (the migrator, as `POST /_api/project/migrate` runs it in-process). Afterwards the hub saves with
// accepted revisions; a second studio that has the project open picks that up from its socket with
// no reload; nothing either studio wrote is lost, and an edit after the switch still reaches the
// other studio (through a proposal now).
//
// The hub is already at format 2 here (the v2 studios' link raises it), so this is the format-2 +
// legacy case: the switch runs alone. The format flip + epoch re-read order is pinned against the
// hub's own epoch rule in migrate-v2-save-mode.test.ts.
//
// Shape: the `accepted revisions — switching a live project` suite in sync-accepted-runtime.test.ts,
// with the owner's Update in place of a raw POST.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { applyMigration, EXIT, planMigration } from '../migrate/engine.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
/** serve-hub.mjs's operator secret — the project owner on that hub (`source: 'env'`). */
const OWNER_SECRET = 'test-secret';

const src = (title: string) =>
  `export default function Home() {\n  return <h1 title="${title}">Home</h1>;\n}\n`;

async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  ms = 20_000
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

/** A LEGACY hub: no `--transactions`, so the project saves the old way until Update switches it. */
function startLegacyHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
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

const noop = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

interface Peer {
  repoRoot: string;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  write: (rel: string, text: string) => void;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  const linkedHub = { url, linkedAt: 0, fileEvents: false };
  // On disk too: the migrator reads the link from config.json, the way the app's project does.
  writeFileSync(
    join(designRoot, 'config.json'),
    JSON.stringify({ canvasGroups: [{ label: 'Canvases', path: 'ui' }], linkedHub })
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
      linkedHub,
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
  const file = (rel: string) => join(designRoot, rel);
  return {
    repoRoot,
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

async function api(hub: Hub, route: string) {
  const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
    headers: { authorization: `Bearer ${hub.tokens.owner}`, 'x-maude-format': '2' },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!HUB_READY)('Update project on a legacy hub — to accepted revisions', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'p8-update-to-accepted-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI']) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startLegacyHub(join(root, 'hub'));
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
    writeFileSync(join(root, 'alice', 'design', 'ui', 'board.tsx'), src('legacy start'));
    alice = await startPeer(join(root, 'alice'), aliceUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/documents`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { documents: { name: string; bytes: number }[] };
      return b.documents.some((d) => d.name.endsWith('ui-board') && d.bytes > 0);
    }, 'the legacy document to be stored');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await waitFor(
      () => bob.read('ui/board.tsx') === src('legacy start'),
      'bob to pull the legacy canvas'
    );
  }, 60_000);

  afterAll(async () => {
    await alice?.runtime.stop();
    await bob?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  test('Update switches the mode; the open second studio follows without a reload; nothing is lost', async () => {
    expect((await api(hub, 'mode')).body.mode).toBe('legacy');
    expect(bob.runtime.acceptedMode?.()).toBe(false);
    // Bob's work in the old mode, before the update.
    bob.write('ui/board.tsx', src('bob before the update'));
    await waitFor(
      () => alice.read('ui/board.tsx') === src('bob before the update'),
      'bob → alice in the old mode'
    );

    // The owner's Update project (in-process, as the studio route runs it).
    const opts = {
      repoRoot: alice.repoRoot,
      designRel: 'design',
      direction: 'forward' as const,
      hub: { url: `http://127.0.0.1:${hub.port}`, token: OWNER_SECRET, role: 'owner' },
      viaStudio: true,
      liveStudio: () => false,
      dsEmitter: null,
    };
    const dry = await planMigration(opts);
    expect(dry.refusals).toEqual([]);
    expect(dry.exitCode).toBe(EXIT.done);
    expect(dry.project.linked).toMatchObject({ mode: 'legacy', modeDue: true });
    expect((await api(hub, 'mode')).body.mode).toBe('legacy'); // the dry run switched nothing
    const report = await applyMigration(opts, dry);
    expect(report.exitCode).toBe(EXIT.done);
    expect(report.project.linked).toMatchObject({ modeSwitched: true });
    expect(report.notes ?? []).not.toContainEqual(expect.stringContaining('old way'));

    const after = await api(hub, 'mode');
    expect(after.body.mode).toBe('transactions');
    expect(after.body.formatVersion).toBe(2);

    // Both studios learn it from their sockets — neither restarts.
    await waitFor(
      () => alice.runtime.acceptedMode?.() && bob.runtime.acceptedMode?.(),
      'both studios to save with accepted revisions'
    );
    // Nothing lost: the hub's accepted head holds Bob's pre-update text, and so do both disks.
    const head = async () => {
      const b = await api(hub, 'bootstrap');
      const doc = (b.body.docs as { path: string; lanes: Record<string, { hash: string }> }[]).find(
        (d) => d.path === 'ui/board.tsx'
      );
      return (await api(hub, `blobs/${doc?.lanes.html?.hash}`)).body.body;
    };
    expect(await head()).toBe(src('bob before the update'));
    expect(alice.read('ui/board.tsx')).toBe(src('bob before the update'));
    expect(bob.read('ui/board.tsx')).toBe(src('bob before the update'));

    // And the second studio keeps working: its next edit is a proposal that reaches Alice.
    bob.write('ui/board.tsx', src('bob after the update'));
    await waitFor(
      () => alice.read('ui/board.tsx') === src('bob after the update'),
      'bob → alice after the update'
    );
    await waitFor(async () => (await head()) === src('bob after the update'), 'the hub head');
    expect(alice.runtime.acceptedWriteViolations?.()).toBe(0);
    expect(bob.runtime.acceptedWriteViolations?.()).toBe(0);

    // A second Update has nothing left to do.
    expect((await planMigration(opts)).exitCode).toBe(EXIT.atTarget);
  }, 90_000);
});
