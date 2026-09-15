// Accepted revisions, studio side, against a REAL hub — DDR-241, plan T13–T17.
//
// Two studio sync runtimes (real HocuspocusProviders, real file watchers, real
// projections) talk to one real hub in `transactions` mode, spawned under Node
// because Bun cannot load the hub's better-sqlite3. Nothing is stubbed between
// "a file changed on Alice's disk" and "Bob's disk changed": the oracle is
// always the OTHER peer's filesystem or replica, plus the hub's own revision
// log — never the proposing side's view of its own success.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { readLaneFromDoc } from '../sync/codec.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn(
    '[sync-accepted-runtime] SKIPPED — apps/hub dependencies are not installed; this suite needs a real hub.'
  );
}

const src = (title: string, color = 'black') =>
  `export default function Home() {\n  return <h1 title="${title}" color="${color}">Home</h1>;\n}\n`;

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

function startHub(dataDir: string, port = '0', transactions = true): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'node',
      [FIXTURE, dataDir, port, ...(transactions ? ['--transactions'] : [])],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
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

interface Peer {
  name: string;
  ctx: Context;
  runtime: SyncRuntime;
  registry: ReturnType<typeof createRegistry>;
  file: (rel: string) => string;
  read: (rel: string) => string | null;
  /** Write like an editor does — the studio's own watcher then reports it. */
  write: (rel: string, text: string) => void;
}

function makeCtx(repoRoot: string, url: string): Context {
  const designRoot = join(repoRoot, 'design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  // A declared project, so neither peer treats itself as a bare fresh link.
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

async function startPeer(name: string, repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry(noopCallbacks());
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error(`${name}: runtime refused to start`);
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const read = (rel: string) => {
    try {
      return readFileSync(file(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const write = (rel: string, text: string) => {
    writeFileSync(file(rel), text);
    ctx.bus.emit('fs:any', rel);
  };
  return { name, ctx, runtime, registry, file, read, write };
}

async function api(hub: Hub, route: string, init: RequestInit = {}) {
  const res = await fetch(`${hub.http}/api/projects/current/v1/${route}`, {
    ...init,
    headers: { authorization: `Bearer ${hub.tokens.owner}`, 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe.skipIf(!HUB_READY)('accepted revisions — studio runtimes on a real hub', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'accepted-runtime-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    // One credential store, two hub spellings — so each peer signs in as a
    // different person against the same hub.
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
    writeFileSync(join(root, 'alice', 'design', 'ui', 'home.tsx'), src('Hello'));
    alice = await startPeer('alice', join(root, 'alice'), aliceUrl);
    // Bob joins a project that has content (an EMPTY project's first canvas is
    // the supervisor's restart cycle, covered by the runtime suite).
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/home.tsx');
    }, 'the hub to accept ui/home.tsx');
    bob = await startPeer('bob', join(root, 'bob'), bobUrl);
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

  test('a local canvas joins the project as one accepted action and reaches the peer', async () => {
    await waitFor(async () => {
      const b = await api(hub, 'bootstrap');
      return (b.body.docs as { doc: string; path: string }[]).some((d) => d.path === 'ui/home.tsx');
    }, 'the hub to accept ui/home.tsx');
    await bob.runtime.pullRemoteNow();
    const got = await waitFor(() => bob.read('ui/home.tsx'), "bob's copy of ui/home.tsx");
    expect(got).toBe(src('Hello'));
    const log = await api(hub, 'history');
    const actions = log.body.history as { kind: string; actor: string }[];
    expect(actions.some((a) => a.kind === 'canvas.create' && a.actor === 'alice@x.test')).toBe(
      true
    );
  }, 60_000);

  test('an edit on disk is proposed, accepted and lands on the peer', async () => {
    const t0 = Date.now();
    alice.write('ui/home.tsx', src('Hello world'));
    await waitFor(() => bob.read('ui/home.tsx') === src('Hello world'), 'bob to see the edit');
    const ms = Date.now() - t0;
    console.log(`[sync-accepted-runtime] alice→bob disk edit crossed in ${ms} ms`);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);

  test('independent concurrent edits both survive (hub three-way merge)', async () => {
    alice.write('ui/home.tsx', src('Title by Alice'));
    bob.write('ui/home.tsx', src('Hello world', 'red'));
    const merged = src('Title by Alice', 'red');
    await waitFor(() => alice.read('ui/home.tsx') === merged, 'alice to converge on the merge');
    await waitFor(() => bob.read('ui/home.tsx') === merged, 'bob to converge on the merge');
  }, 30_000);

  test('an overlapping edit is rejected, kept on disk and reported — never overwritten', async () => {
    const base = src('Title by Alice', 'red');
    alice.write('ui/home.tsx', src('Alice wins?', 'red'));
    bob.write('ui/home.tsx', src('Bob wins?', 'red'));
    // Exactly one of them is the project's version; the other side keeps its
    // candidate on disk with the incoming version saved for recovery.
    const accepted = await waitFor(async () => {
      const b = await api(hub, 'bootstrap');
      const doc = (b.body.docs as { path: string; lanes: Record<string, { hash: string }> }[]).find(
        (d) => d.path === 'ui/home.tsx'
      );
      const hash = doc?.lanes.html?.hash;
      if (!hash) return null;
      const blob = await api(hub, `blobs/${hash}`);
      const body = blob.body.body as string;
      return body === base ? null : body;
    }, 'the hub to accept one of the two');
    const winner = accepted === src('Alice wins?', 'red') ? alice : bob;
    const loser = winner === alice ? bob : alice;
    const loserValue = loser === alice ? src('Alice wins?', 'red') : src('Bob wins?', 'red');
    await waitFor(() => winner.read('ui/home.tsx') === accepted, 'the winner to hold its value');
    // Give the loser's projection every chance to (wrongly) overwrite.
    await new Promise((r) => setTimeout(r, 2_000));
    expect(loser.read('ui/home.tsx')).toBe(loserValue);
    const incoming = join(loser.ctx.paths.historyDir, 'ui-home', 'sync-recovery', 'incoming.tsx');
    await waitFor(() => existsSync(incoming), 'the recovery copy of the accepted version');
    expect(readFileSync(incoming, 'utf8')).toBe(accepted);
    const status = loser.runtime.status() as unknown as { conflicts?: unknown[] } | null;
    expect((status?.conflicts ?? []).length).toBeGreaterThan(0);

    // Resolution is a new save based on what the conflict showed.
    loser.write('ui/home.tsx', src('Resolved together', 'red'));
    await waitFor(
      () => winner.read('ui/home.tsx') === src('Resolved together', 'red'),
      'the resolution to reach the winner'
    );
  }, 40_000);

  test('a comment proposed through the API reaches the peer replica', async () => {
    const r = alice.runtime.proposeLane?.(
      'ui-home',
      'comments',
      JSON.stringify([{ id: 'c1', file: 'design/ui/home.tsx', text: 'hi from alice', thread: [] }]),
      { baseText: '[]' }
    );
    expect(r).not.toBeNull();
    expect((await r)?.status).toBe('accepted');
    const bobDoc = bob.registry.getDoc('ui-home');
    await waitFor(
      () => readLaneFromDoc(bobDoc, 'comments').includes('hi from alice'),
      'bob to see the comment'
    );
  }, 30_000);

  test('an empty folder is a project entry and appears on the peer', async () => {
    // What `createFolder` does: propose, then make the folder locally.
    const r = await alice.runtime.proposeFolder?.({ op: 'dir.create', path: 'ui/Empty' });
    expect(r?.status).toBe('accepted');
    mkdirSync(alice.file('ui/Empty'));
    writeFileSync(alice.file('ui/Empty/.gitkeep'), '');
    await bob.runtime.pullRemoteNow();
    await waitFor(() => existsSync(bob.file('ui/Empty')), "bob's ui/Empty folder");
    expect(readdirSync(bob.file('ui/Empty'))).toEqual(['.gitkeep']);
  }, 30_000);

  test('a canvas move is one project action; the peer follows it and parks the old copy', async () => {
    expect(alice.read('ui/home.tsx')).not.toBeNull();
    const ok = await alice.runtime.retireForMove('ui-home', 'ui/Empty/home.tsx');
    expect(alice.read('ui/home.tsx')).not.toBeNull();
    expect(ok).toBe(true);
    renameSync(alice.file('ui/home.tsx'), alice.file('ui/Empty/home.tsx'));
    await alice.runtime.rescanNow();
    await bob.runtime.pullRemoteNow();
    await waitFor(() => bob.read('ui/Empty/home.tsx'), "bob's moved copy");
    await waitFor(() => !existsSync(bob.file('ui/home.tsx')), "bob's old copy to be parked");
    expect(bob.read('ui/Empty/home.tsx')).toBe(src('Resolved together', 'red'));
  }, 40_000);

  test('a deletion is one project action; the peer removes the canvas', async () => {
    unlinkSync(alice.file('ui/Empty/home.tsx'));
    alice.ctx.bus.emit('canvas-deleted', { slug: 'ui-empty-home' });
    await waitFor(async () => {
      const b = await api(hub, 'bootstrap');
      return !(b.body.docs as { path: string; retired: boolean }[]).some(
        (d) => d.path === 'ui/Empty/home.tsx' && !d.retired
      );
    }, 'the hub to accept the deletion');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return !existsSync(bob.file('ui/Empty/home.tsx'));
    }, "bob's copy to leave");
  }, 40_000);

  test('an edit made while the hub is down is kept durably and lands after it returns', async () => {
    alice.write('ui/offline.tsx', src('before outage'));
    await alice.runtime.rescanNow();
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.read('ui/offline.tsx') === src('before outage');
    }, 'the new canvas on bob');

    const dataDir = join(root, 'hub');
    const port = hub.port;
    await stopHub(hub);
    alice.write('ui/offline.tsx', src('written offline'));
    const outbox = join(alice.ctx.paths.designRoot, '_state', 'outbox');
    await waitFor(
      () => existsSync(outbox) && readdirSync(outbox).some((n) => n.endsWith('.json')),
      'the proposal to be in the durable outbox'
    );
    hub = await startHub(dataDir, port);
    await waitFor(
      () => bob.read('ui/offline.tsx') === src('written offline'),
      'the offline edit on bob',
      45_000
    );
    await waitFor(
      () => readdirSync(outbox).filter((n) => n.endsWith('.json')).length === 0,
      'the outbox to drain'
    );
  }, 90_000);

  test('no raw document write ever reached the project: every change is an accepted action', async () => {
    const log = await api(hub, 'revisions?limit=500');
    const revisions = log.body.revisions as { actor?: string; kind?: string }[];
    expect(revisions.length).toBeGreaterThan(5);
    for (const r of revisions) expect(['alice@x.test', 'bob@x.test']).toContain(r.actor as string);
    // And neither replica was ever written locally (the tripwire).
    expect(alice.runtime.acceptedWriteViolations?.()).toBe(0);
    expect(bob.runtime.acceptedWriteViolations?.()).toBe(0);
  }, 20_000);
});

describe.skipIf(!HUB_READY)('accepted revisions — switching a live project', () => {
  let root: string;
  let hub: Hub;
  let alice: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'accepted-switch-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI']) saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'), '0', false);
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
    alice = await startPeer('alice', join(root, 'alice'), aliceUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/documents`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { documents: { name: string; bytes: number }[] };
      return b.documents.some((d) => d.name.endsWith('ui-board') && d.bytes > 0);
    }, 'the legacy document to be stored');
    bob = await startPeer('bob', join(root, 'bob'), bobUrl);
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

  test('peers learn the switch from their socket; edits around it are neither dropped nor diverged', async () => {
    expect(alice.runtime.acceptedMode?.()).toBe(false);
    // Switch while both peers are live, and edit AT ONCE — the window the
    // hub's notice-then-close ordering exists for.
    const switching = api(hub, 'mode', {
      method: 'POST',
      body: JSON.stringify({ mode: 'transactions' }),
    });
    alice.write('ui/board.tsx', src('edited during the switch'));
    const res = await switching;
    expect(res.status).toBe(200);
    expect((res.body.imported as { created: number }).created).toBe(1);
    await waitFor(
      () => alice.runtime.acceptedMode?.() && bob.runtime.acceptedMode?.(),
      'both peers to learn the mode'
    );
    await waitFor(
      () => bob.read('ui/board.tsx') === src('edited during the switch'),
      'the edit made during the switch to reach bob'
    );
    // After the switch every change is a proposal.
    bob.write('ui/board.tsx', src('after the switch'));
    await waitFor(
      () => alice.read('ui/board.tsx') === src('after the switch'),
      'bob → alice after the switch'
    );
    const b = await api(hub, 'bootstrap');
    const doc = (b.body.docs as { path: string; lanes: Record<string, { hash: string }> }[]).find(
      (d) => d.path === 'ui/board.tsx'
    );
    const blob = await api(hub, `blobs/${doc?.lanes.html?.hash}`);
    expect(blob.body.body).toBe(src('after the switch'));
    expect(alice.runtime.acceptedWriteViolations?.()).toBe(0);
    expect(bob.runtime.acceptedWriteViolations?.()).toBe(0);
  }, 60_000);

  test('a studio that was closed across a switch proposes what was edited while it was away', async () => {
    // Back to legacy, then Bob closes his studio.
    const back = await api(hub, 'mode', {
      method: 'POST',
      body: JSON.stringify({ mode: 'legacy' }),
    });
    expect(back.status).toBe(200);
    await waitFor(() => !alice.runtime.acceptedMode?.(), 'alice to learn legacy');
    await bob.runtime.stop();
    // The project switches while he is away; he edits the file anyway.
    const on = await api(hub, 'mode', {
      method: 'POST',
      body: JSON.stringify({ mode: 'transactions' }),
    });
    expect(on.status).toBe(200);
    writeFileSync(bob.file('ui/board.tsx'), src('edited while the studio was closed'));
    // He reopens: the cold start finds a local edit on top of the base the
    // project still holds, and proposes it.
    bob = await startPeer('bob', join(root, 'bob'), `http://localhost:${hub.port}`);
    await waitFor(
      () => alice.read('ui/board.tsx') === src('edited while the studio was closed'),
      'the offline edit to reach alice'
    );
    expect(bob.runtime.acceptedWriteViolations?.()).toBe(0);
  }, 60_000);
});
