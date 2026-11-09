// 2.1.1 S1/T14 — what a FIRST link to a server that already holds work does to each kind, through the
// real route + `cloudApi.attachStored` → `linkFolder` → a live `createSyncRuntime` against the fixture
// hub in WORKSPACE mode, WITHOUT `fileEvents:false`: that is the v2 file plane the desktop runs
// (`hub-link-folder-route.test.ts` sets it, which runs the v1 lane and shows none of this).
// Contract: client/v2/contracts/S1-first-link-sync.md (outcome table).
//
//   canvas, only here · only there · differs  → pushed · pulled · held conflict (both sides kept)
//   file,   only here · only there · differs  → pushed · pulled · the server's, this Mac's beside it
//   same source, layout differs               → the server's, this Mac's kept + a set-aside notice
//   same source, comments / sticky notes      → both sets (union by id)

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudEndpoints } from '../cloud/endpoints.ts';
import { createRegistry } from '../collab/registry.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { guardTableRoute } from '../http.ts';
import { createHubLinkFolderRoutes, HUB_LINK_FOLDER_PATH } from '../routes/hub-link-folder.ts';
import type { RouteSpec } from '../routes/table.ts';
import { unionById } from '../sync/accepted-cold-start.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { storeFixtureHubCredential } from './_hub-password-login.ts';
import { board, sticky } from './fixtures/annotations-v2/boards.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) console.warn('[hub-link-folder-first-link-table] SKIPPED — needs apps/hub deps.');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const canvasSrc = (title: string) =>
  `import { DesignCanvas } from '@maude/canvas-lib';\nexport default function Canvas() {\n  return <DesignCanvas><h1>${title}</h1></DesignCanvas>;\n}\n`;

const SERVER_COMMENTS = JSON.stringify([{ id: 'c-server', text: 'server comment' }]);
const MY_COMMENTS = JSON.stringify([{ id: 'c-mine', text: 'my comment' }]);
const SERVER_BOARD = board(sticky('s1', 'server note'));
const MY_BOARD = board(sticky('m1', 'my note', { x: 300, index: 'a1' }));

let tmp = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['HUBS_CONFIG_PATH', 'MAUDE_MACHINE_FILE', 'MAUDE_CLOUD_CONFIG'];

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<string, string>;
}
function startHub(dataDir: string): Promise<Hub> {
  mkdirSync(join(dataDir, 'repo', '.design'), { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions', '--users'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // workspace mode: /health is ok and the hub carries the file journal (what a real team server is)
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_CELL_PAIRING: '1',
        MAUDE_STUDIO_CHILD: '0',
        MAUDE_REPO_DIR: join(dataDir, 'repo'),
      },
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      const info = JSON.parse(line);
      resolve({ proc, http: info.http.replace(/\/$/, ''), tokens: info.tokens });
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

type Folder = { repoRoot: string; designRoot: string };
function makeFolder(name: string, files: Record<string, string>): Folder {
  const repoRoot = join(tmp, name);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    `${JSON.stringify({ name, canvasGroups: [{ label: 'Canvases', path: 'ui' }] }, null, 2)}\n`
  );
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(designRoot, rel, '..'), { recursive: true });
    writeFileSync(join(designRoot, rel), text);
  }
  return { repoRoot, designRoot };
}
const readCfg = (d: string) => JSON.parse(readFileSync(join(d, 'config.json'), 'utf8'));

/** A live sync runtime per restart — no `fileEvents:false`, so it is the v2 file plane. */
function liveSync(folder: Folder) {
  const runtimes: SyncRuntime[] = [];
  const syncControl = {
    async restart(linkedHub: { url: string }) {
      const ctx = {
        canvasOrigin: 'http://canvas.localhost',
        sharedDoc: true,
        cfg: {
          ...readCfg(folder.designRoot),
          designRoot: '.design',
          newCanvasDir: 'ui',
          linkedHub: { ...linkedHub },
        },
        projectLabel: 'test',
        paths: {
          repoRoot: folder.repoRoot,
          designRel: '.design',
          designRoot: folder.designRoot,
          serverInfoFile: join(folder.designRoot, '_server.json'),
          activeFile: join(folder.designRoot, '_active.json'),
          commentsDir: join(folder.designRoot, '_comments'),
          canvasStateDir: join(folder.designRoot, '_canvas-state'),
          historyDir: join(folder.designRoot, '_history'),
          tokensUrlRel: '.design/system/colors.css',
          systemDirRel: 'system',
        },
        bus: createBus(),
      } as unknown as Context;
      mkdirSync(ctx.paths.commentsDir, { recursive: true });
      const registry = createRegistry({
        async seed() {},
        async persistJson() {},
        async persistBinary() {},
      });
      const rt = createSyncRuntime(ctx, {
        registry,
        transactionRetryMs: 100,
        auth: { renewCredential: async () => null },
      });
      if (!rt) return { syncing: false, canvases: 0, reason: 'no-runtime' };
      runtimes.push(rt);
      await rt.start();
      return { syncing: true, canvases: 1 };
    },
  };
  return {
    syncControl,
    runtimes,
    stop: async () => {
      for (const rt of runtimes) await rt.stop?.();
    },
  };
}

function routeFor(folder: Folder, syncControl: unknown) {
  const cloud = createCloudEndpoints({ paths: folder, syncControl } as Parameters<
    typeof createCloudEndpoints
  >[0]);
  const [spec] = createHubLinkFolderRoutes({
    designRoot: folder.designRoot,
    canvasGroups: () => readCfg(folder.designRoot).canvasGroups,
    localFormat: () => readCfg(folder.designRoot).formatVersion ?? 1,
    attachStored: (url) => cloud.attachStored(url),
    worktreeOf: () => null,
    // the fixture runs no paired studio child, so its /health says 503; the real self-hosted hub runs one
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      if (!String(input).endsWith('/health') || res.status !== 503) return res;
      const j = (await res.json()) as Record<string, unknown>;
      return Response.json({ ...j, ok: true }, { status: 200 });
    }) as typeof fetch,
  }).map(guardTableRoute);
  return async (body: unknown) => {
    const res = await (spec as RouteSpec).handle(
      new Request(`http://127.0.0.1:4399${HUB_LINK_FOLDER_PATH}`, {
        method: 'POST',
        headers: {
          host: '127.0.0.1:4399',
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(body),
      }),
      {}
    );
    // biome-ignore lint/suspicious/noExplicitAny: a route reply, read by field
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
}

/** The server's own manifest (owner bearer — the oracle, not the code under test). */
async function hubState(hub: Hub) {
  const h = { authorization: `Bearer ${hub.tokens.owner}` };
  const boot = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, { headers: h });
  // biome-ignore lint/suspicious/noExplicitAny: a hub reply, read by field
  const b = (await boot.json()) as any;
  const fl = await fetch(`${hub.http}/api/files`, { headers: h });
  // biome-ignore lint/suspicious/noExplicitAny: a hub reply, read by field
  const f = (await fl.json()) as any;
  const docs: Record<string, Record<string, string>> = {};
  for (const d of b.docs ?? []) {
    if (d.retired || !d.path) continue;
    docs[d.path] = {};
    for (const [lane, v] of Object.entries((d.lanes ?? {}) as Record<string, { hash?: string }>)) {
      if (v?.hash) docs[d.path][lane] = v.hash;
    }
  }
  const files: Record<string, string> = {};
  for (const x of f.files ?? []) files[x.path] = x.sha256;
  return { docs, files };
}

async function waitFor<T>(
  fn: () => Promise<T | false | null | undefined> | T | false | null | undefined,
  ms = 25_000
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out');
    await Bun.sleep(150);
  }
}

describe.skipIf(!HUB_READY)(
  'first link to a server that already holds work — the outcome table',
  () => {
    let hub: Hub;
    let hubDir: string;
    let mine: Folder;
    let stop: () => Promise<void> = async () => {};
    let ask: Awaited<ReturnType<ReturnType<typeof routeFor>>>;
    let hubBefore: Awaited<ReturnType<typeof hubState>>;
    let hubAfter: Awaited<ReturnType<typeof hubState>>;
    // biome-ignore lint/suspicious/noExplicitAny: the runtime's status payload, read by field
    let status: any;

    beforeAll(async () => {
      for (const k of ENV) saved[k] = process.env[k];
      tmp = mkdtempSync(join(tmpdir(), 'first-link-table-'));
      mkdirSync(join(tmp, 'machine'));
      process.env.HUBS_CONFIG_PATH = join(tmp, 'machine', 'hubs.json');
      process.env.MAUDE_MACHINE_FILE = join(tmp, 'machine', 'machine.json');
      process.env.MAUDE_CLOUD_CONFIG = join(tmp, 'machine', 'cloud.json');
      hubDir = mkdtempSync(join(tmpdir(), 'first-link-table-hub-'));
      hub = await startHub(hubDir);
      await storeFixtureHubCredential(hub.http, 'designer@x.test', 'designer-pass-1');

      // the server's side: a first folder links to the empty server and seeds it
      const seed = makeFolder('seed', {
        'ui/both.tsx': canvasSrc('Server'),
        'ui/server-only.tsx': canvasSrc('ServerOnly'),
        'components/both.css': '.server{}\n',
        'components/server-only.css': '.so{}\n',
        'ui/same.tsx': canvasSrc('Same'),
        'ui/same.meta.json': JSON.stringify({ title: 'Server title' }),
        'ui-same.annotations.json': SERVER_BOARD,
        '_comments/ui-same.json': SERVER_COMMENTS,
      });
      const s = liveSync(seed);
      const seedPost = routeFor(seed, s.syncControl);
      const seedAsk = await seedPost({ url: hub.http });
      const seeded = await seedPost({ url: hub.http, confirm: seedAsk.body.confirm });
      expect(seeded.body.state).toBe('linked');
      hubBefore = await waitFor(async () => {
        const st = await hubState(hub);
        return Object.keys(st.docs).length >= 3 && Object.keys(st.files).length >= 2 && st;
      });
      await s.stop();

      // this Mac's folder: one of each kind, then the first link
      mine = makeFolder('mine', {
        'ui/both.tsx': canvasSrc('Mine'),
        'ui/local-only.tsx': canvasSrc('LocalOnly'),
        'components/both.css': '.mine{}\n',
        'components/local-only.css': '.lo{}\n',
        'ui/same.tsx': canvasSrc('Same'),
        'ui/same.meta.json': JSON.stringify({ title: 'My title' }),
        'ui-same.annotations.json': MY_BOARD,
        '_comments/ui-same.json': MY_COMMENTS,
      });
      const m = liveSync(mine);
      stop = m.stop;
      const post = routeFor(mine, m.syncControl);
      ask = await post({ url: hub.http });
      const yes = await post({ url: hub.http, confirm: ask.body.confirm });
      expect(yes.body.state).toBe('linked');
      const rt = await waitFor(() => m.runtimes[0]);
      // settled: the server-only canvas and file arrived, the conflict copy is on disk
      await waitFor(
        () =>
          existsSync(join(mine.designRoot, 'ui/server-only.tsx')) &&
          existsSync(join(mine.designRoot, 'components/server-only.css')) &&
          readdirSync(join(mine.designRoot, 'components')).some((n) => n.includes('maude-conflict'))
      );
      await Bun.sleep(1500);
      status = rt.status();
      hubAfter = await hubState(hub);
    }, 90_000);

    afterAll(async () => {
      await stop().catch(() => {});
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      await new Promise<void>((r) => {
        if (!hub || hub.proc.exitCode !== null) return r();
        hub.proc.once('exit', () => r());
        hub.proc.kill('SIGTERM');
      });
      rmSync(hubDir, { recursive: true, force: true });
      rmSync(tmp, { recursive: true, force: true });
    });

    const local = (rel: string) => readFileSync(join(mine.designRoot, rel), 'utf8');
    const copyOf = (dir: string, stem: string, ext: string) =>
      readdirSync(join(mine.designRoot, dir)).find(
        (n) => n.startsWith(`${stem}.maude-conflict-`) && n.endsWith(`local.${ext}`)
      );

    test('the confirm line counted one of each (canvas and file, here / there / differ)', () => {
      expect(ask.body.counts.canvases).toMatchObject({
        onlyHere: 1,
        onlyThere: 1,
        differ: 1,
        same: 1,
      });
      expect(ask.body.counts.files).toMatchObject({ onlyHere: 1, onlyThere: 1, differ: 1 });
    });

    test('canvas only here → created on the server; only there → pulled down', () => {
      expect(hubAfter.docs['ui/local-only.tsx']).toBeDefined();
      expect(hubBefore.docs['ui/local-only.tsx']).toBeUndefined();
      expect(local('ui/server-only.tsx')).toBe(canvasSrc('ServerOnly'));
      expect(Object.keys(hubAfter.docs)).toContain('ui/server-only.tsx');
    });

    test('canvas, both, source differs → each side keeps its own, a held conflict names the canvas', () => {
      expect(local('ui/both.tsx')).toBe(canvasSrc('Mine'));
      expect(hubAfter.docs['ui/both.tsx'].html).toBe(hubBefore.docs['ui/both.tsx'].html);
      expect(status.conflicts).toEqual([
        expect.objectContaining({ slug: 'ui-both', kind: 'body-rejected' }),
      ]);
      expect(status.notices.some((n: { id: string }) => n.id === 'source-conflict-ui-both')).toBe(
        true
      );
    });

    test('file only here → uploaded; only there → downloaded', () => {
      expect(hubAfter.files['components/local-only.css']).toBe(sha('.lo{}\n'));
      expect(local('components/server-only.css')).toBe('.so{}\n');
    });

    test('file, both, differ → the server’s bytes, this Mac’s parked beside it and uploaded too', () => {
      expect(local('components/both.css')).toBe('.server{}\n');
      const copy = copyOf('components', 'both', 'css') as string;
      expect(copy).toMatch(/^both\.maude-conflict-.+local\.css$/);
      expect(local(`components/${copy}`)).toBe('.mine{}\n');
      expect(hubAfter.files[`components/${copy}`]).toBe(sha('.mine{}\n'));
      expect(hubAfter.files['components/both.css']).toBe(sha('.server{}\n'));
      expect(status.files.conflicts).toBe(1);
      // T14 — the ledger keeps this file in `conflict`, with the copy named, until the person looks
      expect(status.files.delivery['components/both.css']).toBe('conflict');
      expect(status.files.conflictCopies).toEqual({ 'components/both.css': `components/${copy}` });
    });

    test('same source, layout differs → the server’s layout, this Mac’s kept, and a set-aside notice', () => {
      expect(JSON.parse(local('ui/same.meta.json')).title).toBe('Server title');
      expect(local('_history/ui-same/sync-recovery/local.meta.json')).toContain('My title');
      expect(status.notices.some((n: { id: string }) => n.id === 'set-aside-ui-same')).toBe(true);
    });

    test('same source, comments and sticky notes → the server gets both sets', () => {
      const commentsUnion = unionById('comments', MY_COMMENTS, SERVER_COMMENTS)?.value as string;
      const boardUnion = unionById('annotations', MY_BOARD, SERVER_BOARD)?.value as string;
      const lanes = hubAfter.docs['ui/same.tsx'];
      expect(lanes.comments).toBe(sha(commentsUnion));
      expect(lanes.annotations).toBe(sha(boardUnion));
      expect(lanes.comments).not.toBe(hubBefore.docs['ui/same.tsx'].comments);
      expect(lanes.annotations).not.toBe(hubBefore.docs['ui/same.tsx'].annotations);
    });
  }
);
