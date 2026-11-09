// 2.1.1 — `POST /_api/hub/link-folder`: "Link your server" connects THIS folder to the person's own
// team server (routes/hub-link-folder.ts).
//
//   • refusals (window only, worktree, bad address, no sign-in, linked elsewhere, a newer server,
//     cross-origin, rebound Host, canvas origin) write nothing and never echo a credential;
//   • against a REAL hub (the Node fixture): an empty server → linked, and the live sync runtime the
//     attach lane cycles seeds the folder's canvas onto the hub; a server that already holds work →
//     `needs-confirm` with counts, nothing written, until the one-time confirm code comes back.
//
// Every machine file lives in a temp dir: HUBS_CONFIG_PATH and MAUDE_MACHINE_FILE never name ~/.config.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudEndpoints } from '../cloud/endpoints.ts';
import { createRegistry } from '../collab/registry.ts';
import type { Context } from '../context.ts';
import { createBus } from '../context.ts';
import { CANVAS_SAFE_API, guardTableRoute } from '../http.ts';
import { createHubLinkFolderRoutes, HUB_LINK_FOLDER_PATH } from '../routes/hub-link-folder.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes, type RouteSpec } from '../routes/table.ts';
import { isPersonOnlyRoute } from '../shell/api-key.ts';
import { saveHubCredential } from '../sync/hub-link.ts';
import { createSyncRuntime, type SyncRuntime } from '../sync/index.ts';
import { recordProjectLink } from '../sync/link-consent.ts';
import { compareSurveys, type SideSurvey } from '../sync/link-survey.ts';
import { storeFixtureHubCredential } from './_hub-password-login.ts';
import { stubDeps } from './_route-stubs.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY)
  console.warn('[hub-link-folder-route] real-hub part SKIPPED — needs apps/hub deps.');

const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

describe('compareSurveys — the four counts, per kind', () => {
  const side = (canvases: [string, string | null][], files: [string, string][], bySlug = false) =>
    ({
      canvases: new Map(canvases),
      files: new Map(files),
      ...(bySlug ? { bySlug } : {}),
    }) as SideSurvey;
  const H = (c: string) => c.repeat(64);

  test('only here · only there · differ · same; an unknown hash is never "same"', () => {
    const here = side(
      [
        ['ui/a.tsx', H('1')],
        ['ui/b.tsx', H('2')],
        ['ui/c.tsx', H('3')],
      ],
      [['assets/x.png', H('4')]]
    );
    const there = side(
      [
        ['ui/b.tsx', H('2')],
        ['ui/c.tsx', null],
        ['ui/d.tsx', H('5')],
      ],
      [
        ['assets/x.png', H('6')],
        ['assets/y.png', H('7')],
      ]
    );
    expect(compareSurveys(here, there)).toEqual({
      onlyHere: 1,
      onlyThere: 2,
      differ: 2,
      same: 1,
      canvases: { onlyHere: 1, onlyThere: 1, differ: 1, same: 1 },
      files: { onlyHere: 0, onlyThere: 1, differ: 1, same: 0 },
    });
  });

  test('an older server (names only): a canvas on both sides counts as differ', () => {
    const here = side(
      [
        ['ui/Home.tsx', H('1')],
        ['ui/b.tsx', H('2')],
      ],
      []
    );
    const there = side([['home', null]], [], true);
    expect(compareSurveys(here, there).canvases).toEqual({
      onlyHere: 1,
      onlyThere: 0,
      differ: 1,
      same: 0,
    });
  });
});
const TOKEN_RE = /hubtok_|secret-token|mpt_|ptok_/;

type Reply = {
  ok?: boolean;
  state?: string;
  reason?: string;
  error?: string;
  url?: string;
  confirm?: string;
  host?: string;
  empty?: boolean;
  counts?: { onlyHere: number; onlyThere: number; differ: number; same: number };
};

const canvasSrc = (title: string) =>
  `import { DesignCanvas } from '@maude/canvas-lib';\nexport default function Canvas() {\n  return <DesignCanvas><h1>${title}</h1></DesignCanvas>;\n}\n`;

let tmp = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['HUBS_CONFIG_PATH', 'MAUDE_MACHINE_FILE', 'MAUDE_CLOUD_CONFIG'];

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  tmp = mkdtempSync(join(tmpdir(), 'hub-link-folder-'));
  mkdirSync(join(tmp, 'machine'));
  process.env.HUBS_CONFIG_PATH = join(tmp, 'machine', 'hubs.json');
  process.env.MAUDE_MACHINE_FILE = join(tmp, 'machine', 'machine.json');
  process.env.MAUDE_CLOUD_CONFIG = join(tmp, 'machine', 'cloud.json');
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

/** A project folder: `<tmp>/<name>/.design` with config.json and optional canvases. */
function makeFolder(name: string, canvases: Record<string, string> = {}, cfg = {}) {
  const repoRoot = join(tmp, name);
  const designRoot = join(repoRoot, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'config.json'),
    `${JSON.stringify({ name, canvasGroups: [{ label: 'Canvases', path: 'ui' }], ...cfg }, null, 2)}\n`
  );
  for (const [rel, text] of Object.entries(canvases)) writeFileSync(join(designRoot, rel), text);
  return { repoRoot, designRoot };
}

const readCfg = (designRoot: string) =>
  JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));

/** The route for one folder, through the same gates the server mounts it behind. */
function routeFor(
  folder: { repoRoot: string; designRoot: string },
  over: {
    attachStored?: (url: string) => Promise<{ status: number; json: unknown }>;
    worktree?: string | null;
    syncControl?: unknown;
    fetchImpl?: typeof fetch;
  } = {}
) {
  const cloud = createCloudEndpoints({
    paths: folder,
    ...(over.syncControl ? { syncControl: over.syncControl } : {}),
  } as Parameters<typeof createCloudEndpoints>[0]);
  const [spec] = createHubLinkFolderRoutes({
    designRoot: folder.designRoot,
    canvasGroups: () => readCfg(folder.designRoot).canvasGroups,
    localFormat: () => readCfg(folder.designRoot).formatVersion ?? 1,
    attachStored: over.attachStored ?? ((url) => cloud.attachStored(url)),
    worktreeOf: () => over.worktree ?? null,
    ...(over.fetchImpl ? { fetchImpl: over.fetchImpl } : {}),
  }).map(guardTableRoute);
  const send = async (body: unknown, headers: Record<string, string> = {}) => {
    const res = await (spec as RouteSpec).handle(
      new Request(`http://127.0.0.1:4399${HUB_LINK_FOLDER_PATH}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:4399', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
    const text = await res.text();
    let reply: Reply = {};
    try {
      reply = JSON.parse(text) as Reply;
    } catch {
      /* a gate's refusal is plain text */
    }
    return { status: res.status, text, body: reply };
  };
  return {
    send,
    post: (body: unknown, h: Record<string, string> = {}) => send(body, { ...FROM_WINDOW, ...h }),
  };
}

// ── a fake server for the refusals (no real hub needed) ─────────────────────

const fakeHub = { formatVersion: 2, holds: false, calls: [] as string[] };
const fake = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(req) {
    const { pathname } = new URL(req.url);
    fakeHub.calls.push(pathname);
    if (pathname === '/health')
      return Response.json({
        ok: true,
        formatVersion: fakeHub.formatVersion,
        capabilities: ['format-v2'],
      });
    if (req.headers.get('authorization') !== 'Bearer hubtok_secret-token')
      return Response.json({ error: 'sign in' }, { status: 401 });
    if (pathname === '/api/projects/current/v1/bootstrap')
      return Response.json({
        docs: fakeHub.holds
          ? [{ path: 'ui/theirs.tsx', retired: false, lanes: { html: { hash: 'a'.repeat(64) } } }]
          : [],
      });
    if (pathname === '/api/files') return Response.json({ files: [] });
    return new Response('not found', { status: 404 });
  },
});
const FAKE = `http://127.0.0.1:${fake.port}`;
afterAll(() => fake.stop(true));

describe('POST /_api/hub/link-folder — refusals write nothing', () => {
  beforeEach(() => {
    fakeHub.formatVersion = 2;
    fakeHub.holds = false;
    fakeHub.calls = [];
  });

  test('not from the Maude window → 403 window-only, before the body or the server', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    const r = await routeFor(f).send({ url: FAKE });
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('window-only');
    expect(fakeHub.calls).toEqual([]);
    expect(readCfg(f.designRoot).linkedHub).toBeUndefined();
  });

  test('a worktree tab → 409 worktree', async () => {
    const f = makeFolder('a');
    const r = await routeFor(f, { worktree: 'Brand site' }).post({ url: FAKE });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('worktree');
  });

  test('a bad address → 400; an address with credentials in it → 400', async () => {
    const f = makeFolder('a');
    expect((await routeFor(f).post({ url: 'not a url' })).status).toBe(400);
    expect((await routeFor(f).post({ url: 'https://u:p@hub.example' })).status).toBe(400);
    expect((await routeFor(f).post({ url: 'file:///etc' })).status).toBe(400);
    expect((await routeFor(f).post({})).status).toBe(400);
  });

  test('no sign-in for that server → 401 signed-out, the server is never asked', async () => {
    const f = makeFolder('a');
    const r = await routeFor(f).post({ url: FAKE });
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe('signed-out');
    expect(fakeHub.calls).toEqual([]);
  });

  test('a credential the server no longer takes → 401, nothing linked', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, 'hubtok_stale', 'member');
    const r = await routeFor(f).post({ url: FAKE });
    expect(r.status).toBe(401);
    expect(readCfg(f.designRoot).linkedHub).toBeUndefined();
  });

  test('already linked to another server → 409 linked-elsewhere; to this one → ok, unchanged', async () => {
    const f = makeFolder('a', {}, { linkedHub: { url: 'https://other.example', linkedAt: 1 } });
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    const r = await routeFor(f).post({ url: FAKE });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('linked-elsewhere');
    expect(readCfg(f.designRoot).linkedHub.url).toBe('https://other.example');

    const same = makeFolder('b', {}, { linkedHub: { url: FAKE, linkedAt: 1 } });
    const r2 = await routeFor(same).post({ url: FAKE });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ ok: true, state: 'linked', already: true });
    expect(readCfg(same.designRoot).linkedHub.linkedAt).toBe(1);
  });

  test('a server on a newer format than this build → 409 format-newer, nothing linked', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    // a server this Mac already linked another folder to (a first link asks first — T8)
    recordProjectLink(join(tmp, 'elsewhere'), { url: FAKE }, 'link');
    fakeHub.formatVersion = 99;
    let attached = 0;
    const r = await routeFor(f, {
      attachStored: async () => {
        attached++;
        return { status: 200, json: { ok: true, url: FAKE } };
      },
    }).post({ url: FAKE });
    expect(r.status).toBe(409);
    expect(r.body.reason).toBe('format-newer');
    expect(attached).toBe(0);
  });

  test('a server that holds work → needs-confirm; a wrong or reused code is refused', async () => {
    const f = makeFolder('a', { 'ui/mine.tsx': canvasSrc('Mine') });
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    fakeHub.holds = true;
    let attached = 0;
    const route = routeFor(f, {
      attachStored: async () => {
        attached++;
        return { status: 200, json: { ok: true, url: FAKE, sync: { syncing: true, canvases: 1 } } };
      },
    });
    const r = await route.post({ url: FAKE });
    expect(r.body).toMatchObject({
      ok: true,
      state: 'needs-confirm',
      counts: { onlyHere: 1, onlyThere: 1, differ: 0, same: 0 },
    });
    expect(attached).toBe(0);
    expect((await route.post({ url: FAKE, confirm: 'guessed' })).body.reason).toBe(
      'confirm-expired'
    );
    // the same server spelled with a trailing slash normalizes to it: the code links, once
    const other = await route.post({ url: `${FAKE}/`, confirm: r.body.confirm });
    expect(other.status).toBe(200);
    expect(attached).toBe(1);
    expect((await route.post({ url: FAKE, confirm: r.body.confirm })).body.reason).toBe(
      'confirm-expired'
    );
  });

  test('no answer ever carries the credential', async () => {
    const f = makeFolder('a', { 'ui/mine.tsx': canvasSrc('Mine') });
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    fakeHub.holds = true;
    const route = routeFor(f, {
      attachStored: async () => ({
        status: 200,
        json: { ok: true, url: FAKE, token: 'hubtok_secret-token', sync: null },
      }),
    });
    const texts = [
      (await route.send({ url: FAKE })).text,
      (await route.post({ url: 'nope' })).text,
    ];
    const ask = await route.post({ url: FAKE });
    texts.push(ask.text, (await route.post({ url: FAKE, confirm: ask.body.confirm })).text);
    for (const t of texts) expect(t).not.toMatch(TOKEN_RE);
  });
});

describe('/_api/hub/link-folder — main origin, the person only', () => {
  const tableSpecs = allSpecs(stubDeps());
  test('in the route table, origin main, in neither canvas allowlist, person-only', () => {
    const mine = tableSpecs.filter((s: RouteSpec) => s.path === HUB_LINK_FOLDER_PATH);
    expect(mine.map((s) => `${s.method} ${s.origin}`)).toEqual(['POST main']);
    expect(mountRoutes(tableSpecs).canvasPaths).not.toContain(HUB_LINK_FOLDER_PATH);
    expect(CANVAS_SAFE_API.has(HUB_LINK_FOLDER_PATH)).toBe(false);
    expect(isPersonOnlyRoute('POST', HUB_LINK_FOLDER_PATH)).toBe(true);
  });

  test('a cross-site write and a rebound Host are refused before the handler runs', async () => {
    const f = makeFolder('a');
    saveHubCredential(FAKE, 'hubtok_secret-token', 'member');
    fakeHub.calls = [];
    const route = routeFor(f);
    expect((await route.post({ url: FAKE }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await route.post({ url: FAKE }, { host: 'evil.example' })).status).toBe(403);
    // the canvas origin is the same host on another port: cross-origin to this route
    expect(
      (
        await route.post(
          { url: FAKE },
          { origin: 'http://127.0.0.1:4400', 'sec-fetch-site': 'same-site' }
        )
      ).status
    ).toBe(403);
    expect(fakeHub.calls).toEqual([]);
    expect(readCfg(f.designRoot).linkedHub).toBeUndefined();
  });
});

// ── against a real hub ──────────────────────────────────────────────────────

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<string, string>;
}

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions', '--users'], {
      stdio: ['ignore', 'pipe', 'pipe'],
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

/** What the server's own manifest lists (owner bearer — the oracle, not the code under test). */
async function hubDocs(hub: Hub): Promise<string[]> {
  const res = await fetch(`${hub.http}/api/projects/current/v1/bootstrap`, {
    headers: { authorization: `Bearer ${hub.tokens.owner}` },
  });
  const j = (await res.json()) as { docs?: { path: string; retired: boolean }[] };
  return (j.docs ?? []).filter((d) => !d.retired && d.path).map((d) => d.path);
}

/** A Context for the folder, so the attach lane's restart starts a REAL sync runtime on it. */
function liveSync(folder: { repoRoot: string; designRoot: string }) {
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
          linkedHub: { ...linkedHub, fileEvents: false },
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
    stop: async () => {
      for (const rt of runtimes) await rt.stop?.();
    },
  };
}

async function waitFor<T>(fn: () => Promise<T | false | null>, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('timed out');
    await Bun.sleep(100);
  }
}

describe.skipIf(!HUB_READY)('POST /_api/hub/link-folder — a real team server', () => {
  let hub: Hub;
  let hubDir: string;
  const stops: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    hubDir = mkdtempSync(join(tmpdir(), 'hub-link-folder-hub-'));
    hub = await startHub(hubDir);
  });

  afterAll(async () => {
    for (const s of stops) await s().catch(() => {});
    await new Promise<void>((r) => {
      if (hub.proc.exitCode !== null) return r();
      hub.proc.once('exit', () => r());
      hub.proc.kill('SIGTERM');
    });
    rmSync(hubDir, { recursive: true, force: true });
  });

  test('an empty server → linked, linkedHub written, the folder’s canvas lands on the hub', async () => {
    const f = makeFolder('first', { 'ui/home.tsx': canvasSrc('Home') });
    await storeFixtureHubCredential(hub.http, 'designer@x.test', 'designer-pass-1');
    expect(await hubDocs(hub)).toEqual([]);
    const live = liveSync(f);
    stops.push(live.stop);

    const route = routeFor(f, { syncControl: live.syncControl });
    // T8 — the first link to a server this Mac never linked asks first, with what goes up
    const ask = await route.post({ url: hub.http });
    expect(ask.body).toMatchObject({ state: 'needs-confirm', empty: true });
    expect(await hubDocs(hub)).toEqual([]);
    const r = await route.post({ url: hub.http, confirm: ask.body.confirm });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, state: 'linked', url: hub.http });
    expect(r.text).not.toMatch(TOKEN_RE);
    expect(readCfg(f.designRoot).linkedHub.url).toBe(hub.http);
    await waitFor(async () => (await hubDocs(hub)).includes('ui/home.tsx'));
  }, 30_000);

  test('a server that holds work → needs-confirm with counts; nothing written until confirmed', async () => {
    // the server already holds `ui/home.tsx` (the test above); this folder has its own canvas
    if (!(await hubDocs(hub)).includes('ui/home.tsx')) throw new Error('needs the seeded hub');
    const f = makeFolder('second', { 'ui/other.tsx': canvasSrc('Other') });
    await storeFixtureHubCredential(hub.http, 'designer@x.test', 'designer-pass-1');
    const hubsBefore = readFileSync(process.env.HUBS_CONFIG_PATH as string, 'utf8');
    const cfgBefore = readFileSync(join(f.designRoot, 'config.json'), 'utf8');
    const live = liveSync(f);
    stops.push(live.stop);
    const route = routeFor(f, { syncControl: live.syncControl });

    const ask = await route.post({ url: hub.http });
    expect(ask.status).toBe(200);
    expect(ask.body.state).toBe('needs-confirm');
    expect(ask.body.counts).toMatchObject({
      onlyHere: 1,
      onlyThere: 1,
      differ: 0,
      same: 0,
      canvases: { onlyHere: 1, onlyThere: 1, differ: 0, same: 0 },
    });
    expect(typeof ask.body.confirm).toBe('string');
    expect(ask.text).not.toMatch(TOKEN_RE);
    // nothing written: config, this Mac's sign-ins, the hub
    expect(readFileSync(join(f.designRoot, 'config.json'), 'utf8')).toBe(cfgBefore);
    expect(readFileSync(process.env.HUBS_CONFIG_PATH as string, 'utf8')).toBe(hubsBefore);
    expect(await hubDocs(hub)).not.toContain('ui/other.tsx');

    const yes = await route.post({ url: hub.http, confirm: ask.body.confirm });
    expect(yes.status).toBe(200);
    expect(yes.body.state).toBe('linked');
    expect(readCfg(f.designRoot).linkedHub.url).toBe(hub.http);
    await waitFor(async () => (await hubDocs(hub)).includes('ui/other.tsx'));
  }, 30_000);
});
