// fix/205 — a canvas re-created at the path of a deleted one holds ONE body, in both directions.
//
// Two studio sync runtimes (Carol = the desktop, Bob = the cell's studio child) talk to one real
// hub in `transactions` mode, each with a real collab registry. The bug: deleting a canvas only
// unpinned its collab room, so the room — and its Y.Doc, the deleted canvas's whole lineage —
// stayed alive. Re-creating a canvas at the same path re-attached the provider to that old doc
// while the hub had dropped its own copy and written the new body as fresh items: the merge was
// old + new, the body doubled (1580 → 3160 bytes), and the receiving studio refused it
// ("source sync blocked (invalid-source)").
//
// The oracle is always every party: the hub's own document (read over a fresh socket), both
// peers' disks and both peers' docs.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';

import { createRegistry, type Registry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[sync-recreate-fresh-doc] SKIPPED — apps/hub dependencies are not installed.');

// A body long enough that a doubling cannot hide in the noise.
const body = (title: string) =>
  `export default function Re() {\n  return (\n    <main title="${title}">\n${'      <p>line</p>\n'.repeat(
    40
  )}    </main>\n  );\n}\n`;

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
    await new Promise((r) => setTimeout(r, 100));
  }
}

interface Hub {
  proc: ChildProcess;
  http: string;
  port: string;
  tokens: Record<'owner' | 'carol' | 'bob', string>;
}

function mintTokens(dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  const tokensMjs = pathToFileURL(join(HUB_DIR, 'src', 'tokens.mjs')).href;
  const script = `
    import { writeFileSync } from 'node:fs';
    import { addToken } from ${JSON.stringify(tokensMjs)};
    const d = process.argv[1];
    const t = {
      owner: addToken(d, { label: 'owner-machine', scope: '*' }).value,
      carol: addToken(d, { label: 'carol-laptop', scope: '*', role: 'owner', owner: 'carol@x.test' }).value,
      bob: addToken(d, { label: 'bob-cell', scope: '*', role: 'member', owner: 'bob@x.test' }).value,
    };
    writeFileSync(d + '/test-tokens.json', JSON.stringify(t));`;
  const r = spawnSync('node', ['--input-type=module', '-e', script, dataDir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`minting tokens failed: ${r.stderr}`);
}

function startHub(dataDir: string): Promise<Hub> {
  mintTokens(dataDir);
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

const noopCallbacks = (): RoomCallbacks => ({
  async seed() {},
  async persistJson() {},
  async persistBinary() {},
});

interface Peer {
  name: string;
  ctx: Context;
  registry: Registry;
  runtime: SyncRuntime;
  file: (rel: string) => string;
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

async function startPeer(name: string, repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const registry = createRegistry(noopCallbacks());
  const runtime = createSyncRuntime(ctx, {
    registry,
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  return {
    name,
    ctx,
    registry,
    runtime,
    file: (rel: string) => join(ctx.paths.designRoot, rel),
  };
}

/** `POST /_api/canvas`, the way api.ts does it: write the file, say so. */
function createLikeTheApp(peer: Peer, name: string, text: string): void {
  writeFileSync(peer.file(`ui/${name}.tsx`), text);
  const rel = `ui/${name}.tsx`;
  peer.ctx.bus.emit('canvas-list-update', { action: 'added', rel, slug: `ui-${name}` });
  peer.ctx.bus.emit('canvas-created', { slug: `ui-${name}` });
}

/** `DELETE /_api/canvas`, the way api.ts does it: park a bundle, unlink, say so. */
function deleteLikeTheApp(peer: Peer, name: string, stamp: string): void {
  const rel = `ui/${name}.tsx`;
  const text = readFileSync(peer.file(rel), 'utf8');
  const bundle = `${stamp}__ui-${name}`;
  mkdirSync(peer.file(`_trash/${bundle}`), { recursive: true });
  writeFileSync(peer.file(`_trash/${bundle}/${name}.tsx`), text);
  writeFileSync(
    peer.file(`_trash/${bundle}/_trash-manifest.json`),
    JSON.stringify({ canvas: rel, slug: `ui-${name}`, trashed: [rel] })
  );
  unlinkSync(peer.file(rel));
  peer.ctx.bus.emit('canvas-list-update', { action: 'removed', rel, slug: `ui-${name}` });
  peer.ctx.bus.emit('canvas-deleted', { slug: `ui-${name}` });
}

/** The hub's own Y.Doc for the canvas, read over a fresh socket (nobody's stale copy). */
async function hubBody(hub: Hub, slug: string): Promise<string> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: hub.http.replace('http:', 'ws:'),
    name: slug,
    document: doc,
    token: hub.tokens.owner,
  });
  try {
    await waitFor(() => provider.synced, 'the hub document to sync', 10_000);
    return doc.getText('html').toString();
  } finally {
    provider.destroy();
    doc.destroy();
  }
}

function roomBody(peer: Peer, slug: string): string | null {
  const room = peer.registry.peek(slug);
  return room ? room.doc.getText('html').toString() : null;
}

function readOr(abs: string): string {
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
}

function parked(peer: Peer, name: string): string[] {
  try {
    return readdirSync(peer.file('_trash')).filter((n) => n.includes(`ui-${name}`));
  } catch {
    return [];
  }
}

describe.skipIf(!HUB_READY)('a canvas re-created where one was deleted — real hub', () => {
  let root: string;
  let hub: Hub;
  let carol: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};
  const both = () => [carol, bob];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'recreate-fresh-doc-'));
    for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
      saved[k] = process.env[k];
    process.env.MAUDE_SYNC_IN_CI = '1';
    hub = await startHub(join(root, 'hub'));
    const carolUrl = `http://127.0.0.1:${hub.port}`;
    const bobUrl = `http://localhost:${hub.port}`;
    const hubsFile = join(root, 'hubs.json');
    writeFileSync(
      hubsFile,
      JSON.stringify({
        hubs: { [carolUrl]: { token: hub.tokens.carol }, [bobUrl]: { token: hub.tokens.bob } },
      }),
      { mode: 0o600 }
    );
    process.env.HUBS_CONFIG_PATH = hubsFile;
    mkdirSync(join(root, 'carol', 'design', 'ui'), { recursive: true });
    mkdirSync(join(root, 'bob', 'design', 'ui'), { recursive: true });
    // An unrelated canvas, so the project exists on the hub before the one under test.
    writeFileSync(join(root, 'carol', 'design', 'ui', 'keep.tsx'), body('keep'));
    carol = await startPeer('carol', join(root, 'carol'), carolUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/keep.tsx');
    }, 'the hub to accept ui/keep.tsx');
    bob = await startPeer('bob', join(root, 'bob'), bobUrl);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return existsSync(bob.file('ui/keep.tsx'));
    }, "bob's copy of ui/keep.tsx");
  }, 90_000);

  afterAll(async () => {
    await carol?.runtime.stop();
    await bob?.runtime.stop();
    if (hub) await stopHub(hub);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  });

  /** Created on Carol's Mac, live on both, then deleted on Carol's Mac and gone from both. */
  async function createThenDelete(name: string, stamp: string): Promise<void> {
    const rel = `ui/${name}.tsx`;
    createLikeTheApp(carol, name, body('first'));
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return readOr(bob.file(rel)) === body('first');
    }, 'the canvas on both Macs');
    deleteLikeTheApp(carol, name, stamp);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return !existsSync(bob.file(rel)) && parked(bob, name).length > 0;
    }, "the delete on bob's Mac (his copy parked)");
    // Both Macs have seen the delete settle before anyone re-creates the canvas.
    await carol.runtime.pullRemoteNow();
    await new Promise((r) => setTimeout(r, 1_500));
  }

  async function expectOneBody(name: string, text: string): Promise<void> {
    const rel = `ui/${name}.tsx`;
    const slug = `ui-${name}`;
    for (const p of both()) {
      await waitFor(
        async () => {
          await p.runtime.pullRemoteNow();
          return readOr(p.file(rel)) === text && roomBody(p, slug) === text;
        },
        `${p.name}'s disk to hold the re-created body once`,
        20_000
      ).catch(async () => {
        const all = both()
          .map(
            (q) =>
              `${q.name}: disk ${readOr(q.file(rel)).length}, doc ${roomBody(q, slug)?.length ?? 'none'}`
          )
          .join('; ');
        throw new Error(
          `want ${text.length} bytes everywhere — ${all}; hub ${(await hubBody(hub, slug)).length}`
        );
      });
      expect(roomBody(p, slug)).toBe(text);
      // …and nobody refused it ("source sync blocked (invalid-source)").
      const status = p.runtime.status() as {
        conflicts?: { slug?: string }[];
        notices?: { id: string }[];
      } | null;
      expect((status?.conflicts ?? []).filter((c) => c.slug === slug)).toEqual([]);
      expect((status?.notices ?? []).map((n) => n.id)).not.toContain(`source-conflict-${slug}`);
    }
    expect(await hubBody(hub, slug)).toBe(text);
  }

  test('desktop → desktop: re-created on the Mac that deleted it, one body everywhere', async () => {
    await createThenDelete('re', '2026-11-05T10-00-00-000Z');
    // The same template again (the doubling is exact when the bodies are equal).
    createLikeTheApp(carol, 're', body('first'));
    await expectOneBody('re', body('first'));
    // The deleted canvas stays in the Trash, and this Mac's parked copy is untouched.
    const listing = await carol.runtime.acceptedTrash?.();
    expect(listing?.canvases.some((c) => c.path === 'ui/re.tsx')).toBe(true);
    expect(readOr(carol.file('_trash/2026-11-05T10-00-00-000Z__ui-re/re.tsx'))).toBe(body('first'));
  }, 90_000);

  test('desktop → cloud: deleted on the desktop, re-created on the cell, one body everywhere', async () => {
    await createThenDelete('re2', '2026-11-05T11-00-00-000Z');
    createLikeTheApp(bob, 're2', body('first'));
    await expectOneBody('re2', body('first'));
  }, 90_000);

  test('undo of the delete brings back one body everywhere', async () => {
    await createThenDelete('re3', '2026-11-05T12-00-00-000Z');
    const item = await waitFor(async () => {
      const l = await carol.runtime.acceptedTrash?.();
      return l?.canvases.find((c) => c.path === 'ui/re3.tsx');
    }, 'the delete in the Trash');
    const undone = await carol.runtime.acceptedUndo?.(item.actionId);
    expect(undone).toMatchObject({ status: 'accepted' });
    await expectOneBody('re3', body('first'));
  }, 90_000);

  test('restore from the Trash brings back one body everywhere', async () => {
    await createThenDelete('re4', '2026-11-05T13-00-00-000Z');
    const item = await waitFor(async () => {
      const l = await carol.runtime.acceptedTrash?.();
      return l?.canvases.find((c) => c.path === 'ui/re4.tsx');
    }, 'the delete in the Trash');
    const r = await carol.runtime.acceptedTrashRestore?.(item.entry);
    expect(r).toMatchObject({ status: 'accepted', path: 'ui/re4.tsx' });
    await expectOneBody('re4', body('first'));
  }, 90_000);
});
