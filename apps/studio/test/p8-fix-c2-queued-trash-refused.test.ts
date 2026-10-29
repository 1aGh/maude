// p8-fix-c2 #2 — an offline artboard trash the hub LATER refuses is not silent.
//
// In accepted mode the edit route (routes/edit.ts `land`) proposes the trash as one `lanes.edit`
// action and, when the hub does not answer within its wait, answers "queued" and writes the
// trashed source to disk. The proposal is still in the durable outbox; when the hub comes back and
// refuses it (somebody else changed the canvas first), that refusal used to reach nobody — the
// route had answered long ago, and the runtime's `proposeLanes` went straight to the link,
// bypassing the projection that owns held conflicts. The conflict only appeared because the
// route's own `source-written` made the projection propose the same html a SECOND time, and that
// duplicate was refused too.
//
// The oracles, both directions (memory: sync is not symmetric):
//   - Bob trashes while his link to the hub is cut; Carol trashes another artboard online; Bob's
//     link returns; the hub refuses Bob's queued action → Bob's disk keeps HIS version, the Sync
//     panel's held-conflict notice is up, and Carol's version is kept beside it (sync-recovery).
//   - the same with the roles swapped (Carol offline, Bob online).
//   - and in both: the queued trash went to the hub ONCE — no duplicate html proposal.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { createEditRoutes } from '../routes/edit.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) console.warn('[p8-fix-c2-queued-trash] SKIPPED — apps/hub deps not installed.');

const FILE = 'ui/home.tsx';
const SLUG = 'ui-home';
const board = (id: string, label: string) =>
  `      <DCArtboard id="${id}" label="${label}" width={390} height={844}>\n        <p>${label}</p>\n      </DCArtboard>\n`;
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
${board('one', 'One')}${board('two', 'Two')}${board('three', 'Three')}${board('four', 'Four')}    </DesignCanvas>
  );
}
`;
const ids = (src: string | null) =>
  [...(src ?? '').matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1] as string);

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

function startHub(dataDir: string): Promise<Hub> {
  mkdirSync(dataDir, { recursive: true });
  const tokensMjs = pathToFileURL(join(HUB_DIR, 'src', 'tokens.mjs')).href;
  const mint = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import { writeFileSync } from 'node:fs';
       import { addToken } from ${JSON.stringify(tokensMjs)};
       const d = process.argv[1];
       writeFileSync(d + '/test-tokens.json', JSON.stringify({
         owner: addToken(d, { label: 'owner-machine', scope: '*' }).value,
         carol: addToken(d, { label: 'carol', scope: '*', role: 'owner', owner: 'carol@x.test' }).value,
         bob: addToken(d, { label: 'bob', scope: '*', role: 'owner', owner: 'bob@x.test' }).value,
       }));`,
      dataDir,
    ],
    { encoding: 'utf8' }
  );
  if (mint.status !== 0) throw new Error(`token mint failed: ${mint.stderr}`);
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

/** A TCP relay in front of the hub for ONE peer: `cut()` drops its link, `mend()` brings it back. */
async function relay(target: number): Promise<{ port: number; cut(): void; mend(): void }> {
  const sockets = new Set<Socket>();
  let open = true;
  const server: Server = createServer((client) => {
    if (!open) return void client.destroy();
    const upstream = new Socket();
    upstream.connect(target, '127.0.0.1');
    sockets.add(client);
    sockets.add(upstream);
    client.pipe(upstream);
    upstream.pipe(client);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.on('close', drop);
    upstream.on('close', drop);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    cut() {
      open = false;
      for (const s of sockets) s.destroy();
      sockets.clear();
    },
    mend() {
      open = true;
    },
  };
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
  runtime: SyncRuntime;
  read: (rel: string) => string | null;
  trash: (artboards: string[]) => Promise<Record<string, unknown>>;
  /** distinct html proposals (transaction ids) this peer's link sent — retries are one */
  htmlSends: () => number;
}

async function startPeer(repoRoot: string, url: string, sends: Set<string>): Promise<Peer> {
  const ctx = makeCtx(repoRoot, url);
  // Every proposal this peer's link sends, by transaction id (a retry is the same one): the html
  // lane.replace ones are what the duplicate this fix removes would add to.
  const transactionFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input);
    if (init?.method === 'POST' && /\/v1\/proposals$/.test(u) && init.body != null) {
      try {
        const text =
          typeof init.body === 'string'
            ? init.body
            : new TextDecoder().decode(init.body as Uint8Array);
        const env = JSON.parse(text);
        const ops = (env?.action?.operations ?? []) as Array<{ op?: string; lane?: string }>;
        if (ops.some((o) => o.op === 'lane.replace' && o.lane === 'html'))
          sends.add(String(env.transactionId));
      } catch {
        /* not an envelope */
      }
    }
    return fetch(input, init);
  }) as typeof fetch;
  const runtime = createSyncRuntime(ctx, {
    registry: createRegistry(noopCallbacks()),
    transactionFetch,
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
      load: async () => JSON.parse(read('ui/home.meta.json') ?? '{}'),
      patch: async () => {},
      writeText: async (_f, next) => writeFileSync(file('ui/home.meta.json'), next),
    },
  }) as [RouteSpec];
  const trash = async (artboards: string[]) => {
    const res = await spec.handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: FILE,
          op: 'artboard.trash',
          targets: [],
          params: { artboards },
        }),
      }),
      {}
    );
    return { status: res.status, ...((await res.json()) as Record<string, unknown>) };
  };
  return { runtime, read, trash, htmlSends: () => sends.size };
}

describe.skipIf(!HUB_READY)(
  'p8-fix-c2 — a queued trash the hub refuses is held, not silent',
  () => {
    let root: string;
    let hub: Hub;
    const peers: Record<'carol' | 'bob', Peer> = {} as Record<'carol' | 'bob', Peer>;
    const links: Record<'carol' | 'bob', Awaited<ReturnType<typeof relay>>> = {} as never;
    const sends = { carol: new Set<string>(), bob: new Set<string>() };
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'p8c2-queued-trash-'));
      for (const k of ['HUBS_CONFIG_PATH', 'MAUDE_SYNC_IN_CI', 'MAUDE_SHARED_DOC'])
        saved[k] = process.env[k];
      process.env.MAUDE_SYNC_IN_CI = '1';
      hub = await startHub(join(root, 'hub'));
      links.carol = await relay(Number(hub.port));
      links.bob = await relay(Number(hub.port));
      const url = {
        carol: `http://127.0.0.1:${links.carol.port}`,
        bob: `http://localhost:${links.bob.port}`,
      };
      writeFileSync(
        join(root, 'hubs.json'),
        JSON.stringify({
          hubs: { [url.carol]: { token: hub.tokens.carol }, [url.bob]: { token: hub.tokens.bob } },
        }),
        { mode: 0o600 }
      );
      process.env.HUBS_CONFIG_PATH = join(root, 'hubs.json');
      mkdirSync(join(root, 'carol', 'design', 'ui'), { recursive: true });
      writeFileSync(join(root, 'carol', 'design', FILE), SRC);
      peers.carol = await startPeer(join(root, 'carol'), url.carol, sends.carol);
      await waitFor(async () => {
        const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
          headers: { authorization: `Bearer ${hub.tokens.owner}` },
        });
        const b = (await res.json()) as { docs: { path: string }[] };
        return b.docs.some((d) => d.path === FILE);
      }, `the hub to accept ${FILE}`);
      peers.bob = await startPeer(join(root, 'bob'), url.bob, sends.bob);
      await waitFor(async () => {
        await peers.bob.runtime.pullRemoteNow();
        return ids(peers.bob.read(FILE)).length === 4;
      }, "bob's copy of the canvas");
      await waitFor(() => peers.bob.runtime.acceptedMode?.() === true, 'accepted mode');
    }, 90_000);

    afterAll(async () => {
      await peers.carol?.runtime.stop();
      await peers.bob?.runtime.stop();
      if (hub && hub.proc.exitCode === null) hub.proc.kill('SIGTERM');
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(root, { recursive: true, force: true });
    });

    const conflictNotice = (p: Peer) =>
      (p.runtime.status()?.notices ?? []).some(
        (n: { id?: string }) => n?.id === `source-conflict-${SLUG}`
      );
    const incoming = (who: 'carol' | 'bob') => {
      const f = join(root, who, 'design', '_history', SLUG, 'sync-recovery', 'incoming.tsx');
      return existsSync(f) ? readFileSync(f, 'utf8') : null;
    };

    /** The teammate's online edit of the text inside one artboard (one html action, on disk on return). */
    const editText = async (p: Peer, artboard: string) => {
      const label = `${artboard[0]?.toUpperCase()}${artboard.slice(1)}`;
      const text = (p.read(FILE) ?? '').replace(`<p>${label}</p>`, `<p>${label}, edited</p>`);
      const r = await p.runtime.proposeFiles?.([{ rel: FILE, text }], {
        kind: 'edit',
        label: 'Edit',
      });
      expect(r?.status).toBe('accepted');
      return text;
    };

    // Both directions: the offline side is bob, then carol. The teammate's edit touches the very
    // artboard the queued trash removes, so the hub cannot take both — it refuses the queued one.
    for (const [offline, online, artboard] of [
      ['bob', 'carol', 'one'],
      ['carol', 'bob', 'three'],
    ] as const) {
      test(`${offline}'s queued trash, refused once ${online}'s edit landed first: held with both versions, sent once`, async () => {
        const off = peers[offline];
        const on = peers[online];
        const start = ids(off.read(FILE));
        expect(conflictNotice(off)).toBe(false);
        links[offline].cut();
        const sentBefore = off.htmlSends();
        const queued = await off.trash([artboard]);
        expect(queued.queued).toBe(true);
        const kept = off.read(FILE);
        expect(ids(kept)).toEqual(start.filter((a) => a !== artboard));
        // The teammate changes the same artboard first, online.
        const theirsSrc = await editText(on, artboard);
        expect(on.read(FILE)).toBe(theirsSrc);
        links[offline].mend();
        // The hub refuses the queued action: the person sees the held conflict, keeps their version,
        // and the project's version is kept beside it.
        await waitFor(() => conflictNotice(off), `${offline}'s held-conflict notice`, 60_000);
        expect(off.read(FILE)).toBe(kept);
        expect(incoming(offline)).toBe(theirsSrc);
        // ONE proposal of the trash — the duplicate html proposal is gone.
        expect(off.htmlSends() - sentBefore).toBe(1);
        // and the online side was never asked anything
        expect(conflictNotice(on)).toBe(false);
        // Taking the project's version resolves it (the person's way out).
        const r = await off.runtime.resolveConflict?.(`design/${FILE}`, 'theirs');
        expect(r?.status).toBe('taken');
        await waitFor(() => off.read(FILE) === theirsSrc, `${offline}'s disk back on the project`);
        await waitFor(() => !conflictNotice(off), `${offline}'s notice cleared`);
      }, 120_000);
    }

    // The duplicate was not only redundant, it was WRONG: two disjoint trashes merge on the hub, and
    // the duplicate (based on the version before the trash) was refused against the merge — a held
    // conflict for an action that had in fact been taken.
    test('a queued trash the hub MERGES with a teammate’s: both land everywhere, no conflict, sent once', async () => {
      const off = peers.bob;
      const on = peers.carol;
      const start = ids(off.read(FILE));
      const [mine, theirs] = [start[0] as string, start[start.length - 1] as string];
      links.bob.cut();
      const sentBefore = off.htmlSends();
      expect((await off.trash([mine])).queued).toBe(true);
      expect((await on.trash([theirs])).queued).toBeUndefined();
      links.bob.mend();
      const want = start.filter((a) => a !== mine && a !== theirs).join(',');
      await waitFor(
        () => ids(off.read(FILE)).join(',') === want && ids(on.read(FILE)).join(',') === want,
        'both trashes on both disks',
        60_000
      );
      await new Promise((r) => setTimeout(r, 2_000));
      expect(conflictNotice(off)).toBe(false);
      expect(conflictNotice(on)).toBe(false);
      expect(off.htmlSends() - sentBefore).toBe(1);
    }, 120_000);
  }
);
