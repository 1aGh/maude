// S1.7b — the shared Trash of a LINKED project, on a real hub (S1-trash.md, V2-1.16 L18).
//
// Two studio sync runtimes talk to one real hub in `transactions` mode: Carol is the project
// owner, Bob a member. Nothing between "Bob deleted a canvas" and "Carol's Trash lists it" is
// stubbed; the oracle is always the OTHER peer's disk / runtime / bus, never the proposer's view.
//
//   - a teammate's delete reaches the owner's Trash (`acceptedTrash`) and refreshes her view
//     (`trash:changed` on HER bus — live refresh across Macs);
//   - a member's clear-out is refused by the hub (`forbidden`, the kernel's per-op role gate);
//   - the owner's restore (`trash.restore` through the proposal lane) brings the canvas back on
//     the teammate's disk, and his view refreshes;
//   - the owner's clear-out removes exactly the cleared canvas's parked copies on BOTH Macs and
//     nothing else under `_trash/`; a restore is then `cleared`.

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

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[sync-accepted-trash] SKIPPED — apps/hub dependencies are not installed.');

const src = (title: string) =>
  `export default function Doomed() {\n  return <h1 title="${title}">Doomed</h1>;\n}\n`;

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

/** The fixture reuses `test-tokens.json` when present: mint Carol, a real project owner, first. */
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
      bob: addToken(d, { label: 'bob-laptop', scope: '*', role: 'member', owner: 'bob@x.test' }).value,
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
  ctx: Context;
  runtime: SyncRuntime;
  file: (rel: string) => string;
  trash: () => string[];
  events: unknown[];
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
  const events: unknown[] = [];
  ctx.bus.on('trash:changed', (p: unknown) => events.push(p));
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const trash = () => {
    try {
      return readdirSync(file('_trash')).sort();
    } catch {
      return [];
    }
  };
  return { ctx, runtime, file, trash, events };
}

/** `DELETE /_api/canvas`, the way api.ts does it: park a bundle, unlink, say so. */
function deleteLikeTheApp(peer: Peer, stamp: string): string {
  const body = readFileSync(peer.file('ui/doomed.tsx'), 'utf8');
  const name = `${stamp}__ui-doomed`;
  mkdirSync(peer.file(`_trash/${name}`), { recursive: true });
  writeFileSync(peer.file(`_trash/${name}/doomed.tsx`), body);
  writeFileSync(
    peer.file(`_trash/${name}/_trash-manifest.json`),
    JSON.stringify({ canvas: 'ui/doomed.tsx', slug: 'ui-doomed', trashed: ['ui/doomed.tsx'] })
  );
  unlinkSync(peer.file('ui/doomed.tsx'));
  peer.ctx.bus.emit('canvas-deleted', { slug: 'ui-doomed' });
  return name;
}

/** What must survive a clear-out of ui/doomed.tsx: other canvases' copies, moves, loose files. */
function plantUnrelated(peer: Peer): string[] {
  const keep = '2026-10-18T09-00-00-000Z__ui-keep';
  mkdirSync(peer.file(`_trash/${keep}`), { recursive: true });
  writeFileSync(peer.file(`_trash/${keep}/keep.tsx`), src('keep'));
  writeFileSync(
    peer.file(`_trash/${keep}/_trash-manifest.json`),
    JSON.stringify({ canvas: 'ui/keep.tsx', slug: 'ui-keep', trashed: ['ui/keep.tsx'] })
  );
  const moved = '2026-10-18T09-00-01-000Z__moved-ui-doomed';
  mkdirSync(peer.file(`_trash/${moved}`), { recursive: true });
  writeFileSync(peer.file(`_trash/${moved}/doomed.tsx`), src('Doomed'));
  writeFileSync(peer.file('_trash/notes.txt'), 'mine');
  return [keep, moved, 'notes.txt'];
}

describe.skipIf(!HUB_READY)('the shared Trash of a linked project — real hub', () => {
  let root: string;
  let hub: Hub;
  let carol: Peer;
  let bob: Peer;
  let entry = '';
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'accepted-trash-'));
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
    writeFileSync(join(root, 'carol', 'design', 'ui', 'doomed.tsx'), src('Doomed'));
    carol = await startPeer(join(root, 'carol'), carolUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === 'ui/doomed.tsx');
    }, 'the hub to accept ui/doomed.tsx');
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return existsSync(bob.file('ui/doomed.tsx'));
    }, "bob's copy of ui/doomed.tsx");
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

  test('a teammate’s delete reaches the owner’s Trash, and her view refreshes', async () => {
    // Carol has seen the project's revision once (her watch's first pass).
    await carol.runtime.pullRemoteNow();
    carol.events.length = 0;
    deleteLikeTheApp(bob, '2026-10-18T10-00-00-000Z');
    const listing = await waitFor(async () => {
      const l = await carol.runtime.acceptedTrash?.();
      return l?.canvases.find((c) => c.path === 'ui/doomed.tsx') ? l : null;
    }, 'the canvas in the owner’s Trash');
    const item = listing.canvases.find((c) => c.path === 'ui/doomed.tsx');
    expect(item?.actor).toBe('bob@x.test');
    entry = item?.entry ?? '';
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return carol.events.length > 0;
    }, 'trash:changed on the OTHER Mac');
    // The delete reached Carol's disk too: her copy is parked, not lost.
    await waitFor(
      () => carol.trash().some((n) => n.startsWith('ui-doomed-deleted-')),
      'carol’s parked copy'
    );
  }, 60_000);

  test('a member cannot clear out; the owner restores and the teammate gets it back', async () => {
    const refused = await bob.runtime.acceptedTrashClear?.();
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect((await carol.runtime.acceptedTrash?.())?.canvases.map((c) => c.entry)).toContain(entry);

    bob.events.length = 0;
    const r = await carol.runtime.acceptedTrashRestore?.(entry);
    expect(r).toMatchObject({ status: 'accepted', path: 'ui/doomed.tsx' });
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return existsSync(bob.file('ui/doomed.tsx'));
    }, "the restored canvas on bob's disk");
    expect(readFileSync(bob.file('ui/doomed.tsx'), 'utf8')).toBe(src('Doomed'));
    // …and on the restorer's own Mac, whose copy the delete had parked.
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return existsSync(carol.file('ui/doomed.tsx'));
    }, "the restored canvas on carol's disk");
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.events.length > 0;
    }, 'trash:changed on bob’s Mac after the restore');
    expect((await carol.runtime.acceptedTrash?.())?.canvases.map((c) => c.entry)).not.toContain(
      entry
    );
  }, 60_000);

  test('the owner clears out: exactly the cleared copies go, on both Macs; a restore is then cleared', async () => {
    deleteLikeTheApp(bob, '2026-10-18T11-00-00-000Z');
    await waitFor(async () => {
      const l = await carol.runtime.acceptedTrash?.();
      return l?.canvases.some((c) => c.entry === entry);
    }, 'the second delete in the Trash');
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return carol.trash().filter((n) => n.startsWith('ui-doomed-deleted-')).length >= 2;
    }, 'carol’s second parked copy');
    const carolKeeps = plantUnrelated(carol);
    const bobKeeps = plantUnrelated(bob);
    expect(bob.trash().filter((n) => n.endsWith('__ui-doomed'))).toHaveLength(2);

    bob.events.length = 0;
    const r = await carol.runtime.acceptedTrashClear?.([`canvas:${entry}`]);
    expect(r).toMatchObject({ status: 'accepted', cleared: [`canvas:${entry}`] });

    // Carol's own copies went with her clear-out; nothing else of hers did.
    expect(carol.trash().filter((n) => n.startsWith('ui-doomed-deleted-'))).toEqual([]);
    expect(carol.trash()).toEqual(carolKeeps.sort());
    // Bob's Mac catches up from the log on its next pass, and his view refreshes.
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return bob.trash().every((n) => !n.endsWith('__ui-doomed')) && bob.events.length > 0;
    }, 'bob’s copies of the cleared canvas to go');
    expect(bob.trash()).toEqual(bobKeeps.sort());

    expect(await carol.runtime.acceptedTrashRestore?.(entry)).toMatchObject({
      status: 'rejected',
      code: 'cleared',
    });
    expect((await carol.runtime.acceptedTrash?.())?.canvases.map((c) => c.entry)).not.toContain(
      entry
    );
  }, 90_000);
});
