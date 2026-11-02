// S2.10b — on a LINKED project in accepted mode (a real hub, two Macs) an artboard copy and ⌫ Move to
// trash are ONE project action each: the route proposes the source and the layout lane together
// (routes/edit.ts `land` → `proposeLanes` → one `lanes.edit` proposal), then writes the files raw.
//
// Both directions (memory: sync is not symmetric): Carol (owner) copies, Bob's disk gets the copy AND its
// place; Carol's one ⌘Z takes both back on Bob's disk, redo re-applies both. Bob (member) moves an
// artboard to the trash: Carol's Trash lists it, her disk loses it; Bob's one ⌘Z brings the board and its
// place back on Carol's disk. The oracle is always the OTHER peer's disk / runtime.
//
// S2.10c — the artboard's annotations go with it, in the SAME action: Bob's ⌫ takes Mobile's two stickies
// and the arrow between them off Carol's board (Desktop's lines byte-identical), his ⌘Z brings them back
// there; Carol's ⌫ takes them off Bob's board, and Bob's Restore from the Trash brings them back on hers.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { trashArtboardRestorer } from '../history/restore-artboard-action.ts';
import { createEditRoutes } from '../routes/edit.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createTrashRoutes } from '../routes/trash.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[v2-artboard-one-step-hub] SKIPPED — apps/hub dependencies are not installed.');

const FILE = 'ui/home.tsx';
const META = 'ui/home.meta.json';
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={1440} height={900}>
        <p>World</p>
      </DCArtboard>
      <DCArtboard id="mobile" label="Příběh" width={390} height={844}>
        <p>Hi</p>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const PLACES0 = [
  { id: 'desktop', x: 0, y: 0 },
  { id: 'mobile', x: 1520, y: 0 },
];
const META0 = `${JSON.stringify({ title: 'Home', layout: { artboards: PLACES0 } }, null, 2)}\n`;
// S2.10c — Mobile's two stickies + the arrow between them; Desktop's sticky + its own arrow.
const SLUG = 'ui-home';
const BOARD = `${SLUG}.annotations.json`;
const sticky = (id: string, index: string, x: number, parentArtboard: string) =>
  ({
    id,
    type: 'sticky',
    index,
    x,
    y: 40,
    w: 160,
    h: 160,
    text: id,
    parentArtboard,
  }) as AnnotationElement;
const BOARD0 = serializeBoard(
  parseBoard(
    serializeBoard([
      sticky('m-one', 'a0', 1560, 'mobile'),
      sticky('m-two', 'a1', 1760, 'mobile'),
      { id: 'm-arrow', type: 'arrow', index: 'a2', start: { el: 'm-one' }, end: { el: 'm-two' } },
      sticky('d-one', 'a3', 40, 'desktop'),
      {
        id: 'd-arrow',
        type: 'arrow',
        index: 'a4',
        parentArtboard: 'desktop',
        start: { el: 'd-one' },
        end: { x: 900, y: 120 },
      },
    ])
  ).elements
);
const MOBILE_NOTES = ['m-one', 'm-two', 'm-arrow'];
const boardIds = (board: string | null) =>
  board ? parseBoard(board).elements.map((e) => e.id) : [];
const lineOf = (board: string | null, id: string) =>
  (board ?? '').split('\n').find((l) => l.includes(`"id":"${id}"`)) ?? null;
const MEMBER = resolveAccess({ v: 1, role: 'member' } as AccessClaim);

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

interface Peer {
  ctx: Context;
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  op: (name: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** S2.10c — the Trash, as http.ts wires it (S1.13b's splice seam included) */
  trashList: () => Promise<Record<string, unknown>[]>;
  trashRestore: (id: string) => Promise<Record<string, unknown>>;
  board: () => Promise<string | null>;
}

async function startPeer(repoRoot: string, url: string): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noopCallbacks()),
    transactionRetryMs: 100,
    auth: { renewCredential: async () => null },
  });
  if (!runtime) throw new Error('runtime refused to start');
  await runtime.start();
  const file = (rel: string) => join(ctx.paths.designRoot, rel);
  const read = (rel: string) => {
    try {
      return readFileSync(file(rel), 'utf8');
    } catch {
      return null;
    }
  };
  const [spec] = createEditRoutes({
    designRoot: ctx.paths.designRoot,
    designRel: 'design',
    repoRoot,
    emit: (e, p) => ctx.bus.emit(e, p),
    control: () => runtime,
    meta: {
      load: async () => JSON.parse(read(META) ?? '{}'),
      // the legacy layout writer (api.patchCanvasMeta's shape); the op-log path never calls it
      patch: async (_f, patch) => {
        const next = { ...JSON.parse(read(META) ?? '{}'), ...patch };
        writeFileSync(file(META), `${JSON.stringify(next, null, 2)}\n`);
      },
      writeText: async (_f, next) => writeFileSync(file(META), next),
    },
  }) as [RouteSpec];
  const op = async (name: string, params: Record<string, unknown>) => {
    const res = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file: FILE, op: name, targets: [], params }),
      }),
      {}
    );
    return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
  };
  const trash = createTrashRoutes({
    control: () => runtime as object,
    access: () => MEMBER,
    readSource: (rel) => read(rel),
    restoreArtboard: trashArtboardRestorer({
      control: () => runtime as object,
      designRel: 'design',
    }),
  });
  const call = async (method: string, p: string, body?: unknown) => {
    const t = trash.find((s) => s.method === method && s.path === p) as RouteSpec;
    const res = await t.handle(
      new Request(`http://localhost${p}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {}
    );
    return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
  };
  const trashList = async () =>
    ((await call('GET', '/_api/trash')).items ?? []) as Record<string, unknown>[];
  const trashRestore = (id: string) => call('POST', '/_api/trash/restore', { id });
  // S2.10c — the board as the project carries it at its newest revision (this harness's rooms persist
  // nothing to disk, and the room — not the projection — owns the board's doc → file)
  const board = async () => {
    const rev = ((await runtime.acceptedHistory?.({ limit: 1 })) ?? [])[0]?.revision;
    if (!rev) return null;
    return (await runtime.acceptedVersion?.(`design/${FILE}`, rev, 'annotations')) ?? null;
  };
  return { ctx, runtime, read, op, trashList, trashRestore, board };
}

const ids = (src: string | null) =>
  [...(src ?? '').matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1] as string);
const places = (text: string | null) => {
  try {
    return (JSON.parse(text ?? '{}').layout?.artboards ?? []) as { id: string; x: number }[];
  } catch {
    return [];
  }
};
const placeIds = (text: string | null) => places(text).map((a) => a.id);

describe.skipIf(!HUB_READY)('S2.10b — one step on a linked op-log project, real hub', () => {
  let root: string;
  let hub: Hub;
  let carol: Peer;
  let bob: Peer;
  const saved: Record<string, string | undefined> = {};

  /** Every action newer than `rev` on the project, as Carol's runtime reads the hub. */
  const newer = async (rev: number) =>
    ((await carol.runtime.acceptedHistory?.({ limit: 50 })) ?? []).filter(
      (a) => a.revision > rev && a.canvases.includes(FILE)
    );
  const head = async () =>
    ((await carol.runtime.acceptedHistory?.({ limit: 1 })) ?? [])[0]?.revision ?? 0;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 's210b-hub-'));
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
    writeFileSync(join(root, 'carol', 'design', FILE), SRC);
    writeFileSync(join(root, 'carol', 'design', META), META0);
    carol = await startPeer(join(root, 'carol'), carolUrl);
    await waitFor(async () => {
      const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
        headers: { authorization: `Bearer ${hub.tokens.owner}` },
      });
      const b = (await res.json()) as { docs: { path: string }[] };
      return b.docs.some((d) => d.path === FILE);
    }, `the hub to accept ${FILE}`);
    bob = await startPeer(join(root, 'bob'), bobUrl);
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return ids(bob.read(FILE)).length === 2 && placeIds(bob.read(META)).length === 2;
    }, "bob's copy of the canvas and its layout");
    await waitFor(() => carol.runtime.acceptedMode?.() === true, 'accepted mode');
    // S2.10c — the board joins the project as a lane (as the room's projection leaves the disk)
    const seeded = await waitFor(
      () => carol.runtime.proposeLane?.(SLUG, 'annotations', BOARD0, { baseText: '' }) ?? null,
      'the board on the hub'
    );
    expect(seeded.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      const b = await bob.board();
      if (b !== BOARD0) throw new Error(`bob reads ${JSON.stringify(b)?.slice(0, 120)}`);
      return true;
    }, "bob's copy of the board");
    for (const who of ['carol', 'bob']) writeFileSync(join(root, who, 'design', BOARD), BOARD0);
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

  test("Carol's copy is ONE action; Bob gets both lanes; her one ⌘Z takes both back, redo re-applies", async () => {
    const rev0 = await head();
    const r = await carol.op('artboard.duplicate', {
      items: [{ artboard: 'desktop', at: { x: 3000, y: 0 } }],
    });
    expect(r).toMatchObject({ status: 200, ok: true, writeId: '' });
    expect(typeof r.actionId).toBe('string');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        ids(bob.read(FILE)).includes('desktop-2') && placeIds(bob.read(META)).includes('desktop-2')
      );
    }, "the copy and its place on bob's disk");
    expect(places(bob.read(META)).find((p) => p.id === 'desktop-2')?.x).toBe(3000);
    // Settle: nothing on either Mac records the route's own writes a second time.
    await new Promise((res) => setTimeout(res, 1500));
    await carol.runtime.pullRemoteNow();
    const rows = await newer(rev0);
    expect(rows.map((a) => [a.kind, a.label])).toEqual([['edit', 'Duplicate artboard']]);
    expect(rows[0]?.actionId).toBe(r.actionId as string);

    const undo = await carol.runtime.acceptedUndo?.(r.actionId as string);
    expect(undo?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        ids(bob.read(FILE)).join() === 'desktop,mobile' &&
        placeIds(bob.read(META)).join() === 'desktop,mobile'
      );
    }, "bob's disk back to both boards and their two places");
    // …and on her own disk (the route's raw write must not hold her projection's writer).
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return ids(carol.read(FILE)).join() === 'desktop,mobile';
    }, 'carol’s own disk');

    const redo = await carol.runtime.acceptedUndo?.(undo?.actionId as string, true);
    expect(redo?.status).toBe('accepted');
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        ids(bob.read(FILE)).includes('desktop-2') && placeIds(bob.read(META)).includes('desktop-2')
      );
    }, 'the redo on bob’s disk');
  }, 90_000);

  test("Bob's ⌫ Move to trash is ONE trash action in Carol's Trash; his one ⌘Z brings it back on her disk", async () => {
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return ids(bob.read(FILE)).includes('desktop-2');
    }, 'bob caught up');
    const rev0 = await head();
    const r = await bob.op('artboard.trash', { artboards: ['mobile'] });
    expect(r).toMatchObject({ status: 200, ok: true, writeId: '' });
    expect(typeof r.actionId).toBe('string');
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return (
        !ids(carol.read(FILE)).includes('mobile') &&
        !placeIds(carol.read(META)).includes('mobile') &&
        boardIds(await carol.board()).join() === 'd-one,d-arrow'
      );
    }, "the board, its place and its annotations gone from carol's disk");
    // S2.10c — Desktop's annotations are byte-identical
    for (const id of ['d-one', 'd-arrow'])
      expect(lineOf(await carol.board(), id)).toBe(lineOf(BOARD0, id));
    const listing = await waitFor(async () => {
      const l = await carol.runtime.acceptedTrash?.();
      return l?.artboards.some((a) => a.artboard === 'mobile') ? l : null;
    }, "the artboard in carol's Trash");
    expect(listing.artboards.find((a) => a.artboard === 'mobile')).toMatchObject({
      label: 'Příběh',
      actionId: r.actionId,
      actor: 'bob@x.test',
    });
    await new Promise((res) => setTimeout(res, 1500));
    const rows = await newer(rev0);
    expect(rows.map((a) => [a.kind, a.label])).toEqual([['trash', 'Moved “Příběh” to the trash']]);

    const undo = await bob.runtime.acceptedUndo?.(r.actionId as string);
    expect(undo?.status).toBe('accepted');
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return (
        ids(carol.read(FILE)).includes('mobile') &&
        placeIds(carol.read(META)).includes('mobile') &&
        (await carol.board()) === BOARD0
      );
    }, "the board, its place and its annotations back on carol's disk");
    expect(places(carol.read(META)).find((p) => p.id === 'mobile')).toEqual({
      id: 'mobile',
      x: 1520,
      y: 0,
    });
  }, 90_000);

  test("S2.10c — Carol's ⌫ takes Mobile's annotations off Bob's board; Bob's Restore from the Trash brings them back on hers", async () => {
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return ids(bob.read(FILE)).includes('mobile') && (await bob.board()) === BOARD0;
    }, 'bob caught up with the board');
    const rev0 = await head();
    const r = await carol.op('artboard.trash', { artboards: ['mobile'] });
    expect(r).toMatchObject({ status: 200, ok: true, writeId: '' });
    await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (
        !ids(bob.read(FILE)).includes('mobile') &&
        boardIds(await bob.board()).join() === 'd-one,d-arrow'
      );
    }, "the board and its annotations gone from bob's disk");
    for (const id of ['d-one', 'd-arrow'])
      expect(lineOf(await bob.board(), id)).toBe(lineOf(BOARD0, id));
    await new Promise((res) => setTimeout(res, 1500));
    await carol.runtime.pullRemoteNow();
    // ONE action: the board's raw write on Carol's Mac recorded nothing a second time
    expect((await newer(rev0)).map((a) => [a.kind, a.actionId])).toEqual([['trash', r.actionId]]);

    const item = await waitFor(async () => {
      await bob.runtime.pullRemoteNow();
      return (await bob.trashList()).find((i) => i.kind === 'artboard' && i.artboard === 'mobile');
    }, "the artboard in bob's Trash");
    const back = await bob.trashRestore(item.id as string);
    expect(back).toMatchObject({ status: 200, ok: true });
    await waitFor(async () => {
      await carol.runtime.pullRemoteNow();
      return ids(carol.read(FILE)).includes('mobile') && boardIds(await carol.board()).length === 5;
    }, "the artboard and its annotations back on carol's disk");
    const board = await carol.board();
    for (const id of [...MOBILE_NOTES, 'd-one', 'd-arrow'])
      expect(lineOf(board, id)).toBe(lineOf(BOARD0, id));
  }, 90_000);
});
