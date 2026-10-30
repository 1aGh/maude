// S11.4 — the availability read model (sync/availability.ts) and its route (routes/availability.ts).
//
// What "on this Mac" means must not race the file plane or a cold start, so every rule here is asked
// from both ends (memory: cloud and desktop are not symmetric):
//   - cold start: before the hub has answered, nothing is "not on this Mac";
//   - partial seed: "41 of 93", names for the ones still coming;
//   - a canvas arriving mid-listing goes arriving → present, never through missing — including when
//     the index is a beat behind the disk and when a listing refresh fails;
//   - a delete during the seed takes the row away instead of pulsing forever;
//   - local-only (made here, not on the hub yet) is present; hub-only is arriving;
//   - offline + listed + not on disk says not-local;
//   - a canvas-only session learns no name, path or count it was not granted; the route refuses a
//     canvas outside its grants.
// The last block runs two REAL runtimes on one in-memory hub (the two-peer harness) and asks the
// runtime's own `availability()` in both directions.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { resolveAccess } from '../access/scope.ts';
import type { Context, DevServerConfig } from '../context.ts';
import { createBus } from '../context.ts';
import { createAvailabilityRoutes } from '../routes/availability.ts';
import {
  type AvailabilitySource,
  availabilityOf,
  computeAvailability,
  MAX_PENDING_ROWS,
} from '../sync/availability.ts';
import { createSyncRuntime, type SyncProvider, type SyncRuntime } from '../sync/index.ts';

const DR = '.design';
const ns = (slug: string) => `ws/w/main/${slug}`;

/** A runtime-shaped source: listing names in THIS peer's namespace, paths by slug. */
function source(o: {
  listing: string[] | null;
  gone?: string[];
  state?: AvailabilitySource['state'];
  paths?: Record<string, string>;
}): AvailabilitySource {
  return {
    listing:
      o.listing === null ? null : o.listing.map((s) => ({ name: s.includes('/') ? s : ns(s) })),
    gone: new Set(o.gone ?? []),
    docNameFor: ns,
    relFor: (_doc, slug) => {
      const p = o.paths?.[slug];
      return p ? { rel: p, fromPath: true } : { rel: `ui/${slug}.tsx`, fromPath: false };
    },
    state: o.state ?? 'online',
  };
}

const ALLIGATORS: Record<string, string> = {
  'ui-2026-combine-kampan': 'ui/2026/Combine-kampan.tsx',
  'ui-2026-combine-letak-registrace': 'ui/2026/Combine-letak-registrace.tsx',
  'ui-2026-combine-cisla': 'ui/2026/Combine-cisla.tsx',
  'ui-2026-combine-video-ai': 'ui/2026/Combine-video-AI.tsx',
};

describe('cold start — nothing flashes "not on this Mac"', () => {
  test('before the first listing: phase waiting, no rows, counts are the disk', () => {
    for (const state of ['connecting', 'offline', 'offline-long', 'online', null] as const) {
      const m = computeAvailability({
        source: source({ listing: null, state }),
        local: ['.design/ui/2026/Combine-kampan.tsx'],
        designRel: DR,
      });
      expect(m.phase).toBe('waiting');
      expect(m.pending).toEqual([]);
      expect(m).toMatchObject({ done: 1, total: 1 });
      expect(availabilityOf(m, 'ui/2026/Combine-video-AI.tsx', [], DR)).toBe('unknown');
    }
  });

  test('a fresh Mac with nothing on disk and no listing yet is waiting — never an empty "complete"', () => {
    const m = computeAvailability({ source: source({ listing: null }), local: [], designRel: DR });
    expect(m.phase).toBe('waiting');
    expect(m.total).toBe(0);
  });

  test('not linked: solo, no rows', () => {
    const m = computeAvailability({ source: null, local: ['ui/a.tsx'], designRel: DR });
    expect(m).toMatchObject({ phase: 'solo', done: 1, total: 1, pending: [] });
  });
});

describe('partial seed', () => {
  test('41 of 93: listed ∖ on disk are arriving, by name and path', () => {
    const listed = Array.from({ length: 93 }, (_, i) => `ui-c${String(i).padStart(2, '0')}`);
    const local = listed.slice(0, 41).map((s) => `.design/ui/${s.slice(3)}.tsx`);
    const paths = Object.fromEntries(listed.map((s) => [s, `ui/${s.slice(3)}.tsx`]));
    const m = computeAvailability({
      source: source({ listing: listed, paths }),
      local,
      designRel: DR,
    });
    expect(m).toMatchObject({ phase: 'arriving', done: 41, total: 93 });
    expect(m.pending).toHaveLength(52);
    expect(m.pending[0]).toEqual({ path: 'ui/c41.tsx', name: 'c41', state: 'arriving' });
    expect(m.pending.every((p) => p.state === 'arriving')).toBe(true);
  });

  test('the names a person reads come from the document path (folders kept)', () => {
    const m = computeAvailability({
      source: source({ listing: Object.keys(ALLIGATORS), paths: ALLIGATORS }),
      local: ['.design/ui/2026/Combine-kampan.tsx', '.design/ui/2026/Combine-letak-registrace.tsx'],
      designRel: DR,
    });
    expect(m.pending.map((p) => p.name)).toEqual(['Combine-cisla', 'Combine-video-AI']);
    expect(m.pending.map((p) => p.path)).toEqual([
      'ui/2026/Combine-cisla.tsx',
      'ui/2026/Combine-video-AI.tsx',
    ]);
  });

  test("another branch's documents in a `scope: '*'` listing are not this project's canvases", () => {
    const m = computeAvailability({
      source: source({ listing: ['ws/w/feat-x/ui-hero', ns('ui-home')] }),
      local: ['ui/home.tsx'],
      designRel: DR,
    });
    expect(m).toMatchObject({ phase: 'complete', done: 1, total: 1, pending: [] });
  });

  test('a hub naming thousands of canvases: the count is exact, the drawn list is bounded', () => {
    const many = Array.from({ length: MAX_PENDING_ROWS + 50 }, (_, i) => `ui-n${i}`);
    const m = computeAvailability({ source: source({ listing: many }), local: [], designRel: DR });
    expect(m.total).toBe(MAX_PENDING_ROWS + 50);
    expect(m.pending).toHaveLength(MAX_PENDING_ROWS);
  });
});

describe('a canvas arriving mid-listing — arriving → present, never missing', () => {
  const listing = Object.keys(ALLIGATORS);
  test('the file lands: the row leaves pending and the canvas is present', () => {
    const before = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: ['ui/2026/Combine-kampan.tsx'],
      designRel: DR,
    });
    expect(
      availabilityOf(before, 'ui/2026/Combine-cisla.tsx', ['ui/2026/Combine-kampan.tsx'], DR)
    ).toBe('arriving');
    const local = ['ui/2026/Combine-kampan.tsx', 'ui/2026/Combine-cisla.tsx'];
    const after = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local,
      designRel: DR,
    });
    expect(availabilityOf(after, 'ui/2026/Combine-cisla.tsx', local, DR)).toBe('present');
    expect(after.done).toBe(before.done + 1);
    expect(after.total).toBe(before.total);
  });

  test('the listing refreshed AFTER the pull still names it; the disk decides — present', () => {
    // Desktop direction: the hub keeps listing a canvas this Mac now has.
    const m = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: Object.values(ALLIGATORS),
      designRel: DR,
    });
    expect(m).toMatchObject({ phase: 'complete', done: 4, total: 4 });
  });

  test('a canvas on disk that the hub stopped listing (or never listed) stays present', () => {
    // Cloud direction: made on this Mac, not on the hub yet — counted, never pending.
    const m = computeAvailability({
      source: source({ listing: ['ui-home'] }),
      local: ['ui/home.tsx', 'ui/made-here.tsx'],
      designRel: DR,
    });
    expect(m).toMatchObject({ phase: 'complete', done: 2, total: 2, pending: [] });
  });

  test('going offline mid-seed turns arriving into not-local — never drops the row', () => {
    const on = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: ['ui/2026/Combine-kampan.tsx'],
      designRel: DR,
    });
    const off = computeAvailability({
      source: source({ listing, paths: ALLIGATORS, state: 'offline' }),
      local: ['ui/2026/Combine-kampan.tsx'],
      designRel: DR,
    });
    expect(on.pending.map((p) => p.path)).toEqual(off.pending.map((p) => p.path));
    expect(off.phase).toBe('offline');
    expect(off.pending.every((p) => p.state === 'not-local')).toBe(true);
    // `connecting` (a reconnect, or the boot before the monitor speaks) is still arriving.
    const conn = computeAvailability({
      source: source({ listing, paths: ALLIGATORS, state: 'connecting' }),
      local: [],
      designRel: DR,
    });
    expect(conn.phase).toBe('arriving');
  });
});

describe('a delete during the seed', () => {
  test('a tombstoned / retired / refused slug is not coming: no pulsing row, not counted', () => {
    const m = computeAvailability({
      source: source({
        listing: Object.keys(ALLIGATORS),
        paths: ALLIGATORS,
        gone: ['ui-2026-combine-cisla'],
      }),
      local: ['ui/2026/Combine-kampan.tsx', 'ui/2026/Combine-letak-registrace.tsx'],
      designRel: DR,
    });
    expect(m.pending.map((p) => p.name)).toEqual(['Combine-video-AI']);
    expect(m.total).toBe(3);
  });
});

describe('a canvas-only session (same filter as the index: grants only)', () => {
  const tereza = resolveAccess({
    v: 1,
    role: null,
    grants: [{ c: 'ui/2026/Combine-video-AI.tsx', r: 'viewer' }],
  });
  const listing = Object.keys(ALLIGATORS);

  test('only granted canvases — names, paths and counts', () => {
    const m = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: ['ui/2026/Combine-kampan.tsx', 'ui/2026/Combine-letak-registrace.tsx'],
      designRel: DR,
      access: tereza,
    });
    expect(m).toMatchObject({ phase: 'arriving', done: 0, total: 1 });
    expect(m.pending).toEqual([
      { path: 'ui/2026/Combine-video-AI.tsx', name: 'Combine-video-AI', state: 'arriving' },
    ]);
    const text = JSON.stringify(m);
    for (const other of ['kampan', 'letak', 'cisla']) expect(text).not.toContain(other);
  });

  test("a pending canvas's path is the session's own grant, never the hub's", () => {
    const m = computeAvailability({
      source: source({
        listing: ['ui-2026-combine-video-ai'],
        paths: { 'ui-2026-combine-video-ai': 'ui/secret-folder/Combine-video-AI.tsx' },
      }),
      local: [],
      designRel: DR,
      access: tereza,
    });
    expect(m.pending[0]?.path).toBe('ui/2026/Combine-video-AI.tsx');
  });

  test('no access at all: nothing', () => {
    const none = resolveAccess(null);
    const m = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: Object.values(ALLIGATORS),
      designRel: DR,
      access: none,
    });
    expect(m).toMatchObject({ done: 0, total: 0, pending: [] });
  });

  test('a project viewer sees the whole project', () => {
    const m = computeAvailability({
      source: source({ listing, paths: ALLIGATORS }),
      local: [],
      designRel: DR,
      access: resolveAccess({ v: 1, role: 'viewer' }),
    });
    expect(m.total).toBe(4);
  });
});

describe('GET /_api/sync/availability', () => {
  const tereza = resolveAccess({
    v: 1,
    role: null,
    grants: [{ c: 'ui/2026/Combine-video-AI.tsx', r: 'viewer' }],
  });
  let fetched = 0;
  const route = (
    access: ReturnType<typeof resolveAccess> | null,
    src = source({ listing: Object.keys(ALLIGATORS), paths: ALLIGATORS })
  ) => {
    const [spec] = createAvailabilityRoutes({
      source: () => src,
      local: () => ['.design/ui/2026/Combine-kampan.tsx'],
      designRel: DR,
      access: () => access,
      project: () => 'Alligators brand',
    });
    return spec as NonNullable<typeof spec>;
  };
  const get = (spec: ReturnType<typeof route>, q = '') =>
    spec.handle(new Request(`http://localhost/_api/sync/availability${q}`), {});
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      return new Response('no', { status: 500 });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('main origin only, a read, and it never asks the hub', async () => {
    const spec = route(null);
    expect(spec).toMatchObject({ method: 'GET', origin: 'main', readOnly: 'allowed' });
    for (let i = 0; i < 20; i++) await get(spec);
    expect(fetched).toBe(0);
  });

  test('the owner gets the project, its name and one canvas state', async () => {
    const res = await get(route(null), '?canvas=ui/2026/Combine-video-AI.tsx');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      phase: 'arriving',
      done: 1,
      total: 4,
      project: 'Alligators brand',
    });
    expect(body.canvas).toEqual({ path: 'ui/2026/Combine-video-AI.tsx', state: 'arriving' });
  });

  test('refused for a canvas outside the ACL closure; the granted one answers', async () => {
    const spec = route(tereza);
    const out = await get(spec, '?canvas=ui/2026/Combine-cisla.tsx');
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ error: 'not-in-scope' });
    expect((await get(spec, '?canvas=.design/ui/2026/Combine-cisla.tsx')).status).toBe(403);
    expect((await get(spec, '?canvas=ui/2026/../2026/Combine-cisla.tsx')).status).toBe(403);
    const ok = await get(spec, '?canvas=ui/2026/Combine-video-AI.tsx');
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ done: 0, total: 1 });
    expect(JSON.stringify(body)).not.toContain('Combine-kampan');
  });

  test('a session with no access is refused', async () => {
    expect((await get(route(resolveAccess(null)))).status).toBe(403);
  });
});

// ── Two real runtimes, one hub: the runtime's own availability(), both directions ─────────────────

const HUB = 'https://hub.example.com';

describe('the runtime source — both directions', () => {
  let root: string;
  let cfgPathEnv: string | undefined;
  let realFetch: typeof fetch;
  let runtimes: (SyncRuntime | null)[] = [];
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'availability-'));
    cfgPathEnv = process.env.HUBS_CONFIG_PATH;
    process.env.HUBS_CONFIG_PATH = join(root, 'hubs.json');
    writeFileSync(
      process.env.HUBS_CONFIG_PATH,
      JSON.stringify({ hubs: { [HUB]: { token: 'mau_test', linkedAt: 1 } } })
    );
    chmodSync(process.env.HUBS_CONFIG_PATH, 0o600);
    realFetch = globalThis.fetch;
  });
  afterEach(async () => {
    for (const r of runtimes) await r?.stop();
    runtimes = [];
    globalThis.fetch = realFetch;
    if (cfgPathEnv === undefined) delete process.env.HUBS_CONFIG_PATH;
    else process.env.HUBS_CONFIG_PATH = cfgPathEnv;
    rmSync(root, { recursive: true, force: true });
  });

  function makeHub() {
    const docs = new Map<string, Y.Doc>();
    let up = true;
    const docFor = (name: string) => {
      let d = docs.get(name);
      if (!d) {
        d = new Y.Doc();
        docs.set(name, d);
      }
      return d;
    };
    const factory =
      () =>
      (args: { documentName: string; document?: Y.Doc }): SyncProvider => {
        const hubDoc = docFor(args.documentName);
        const local = args.document ?? new Y.Doc();
        const conn = Symbol('conn');
        Y.applyUpdate(local, Y.encodeStateAsUpdate(hubDoc), conn);
        Y.applyUpdate(hubDoc, Y.encodeStateAsUpdate(local), conn);
        const onLocal = (u: Uint8Array, o: unknown) => o !== conn && Y.applyUpdate(hubDoc, u, conn);
        const onHub = (u: Uint8Array, o: unknown) => o !== conn && Y.applyUpdate(local, u, conn);
        local.on('update', onLocal);
        hubDoc.on('update', onHub);
        return {
          document: local,
          awareness: new Awareness(local),
          async onceSynced() {},
          destroy() {
            local.off('update', onLocal);
            hubDoc.off('update', onHub);
          },
        };
      };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/documents') && up) {
        return Response.json({ documents: [...docs.keys()].map((name) => ({ name, bytes: 1 })) });
      }
      return new Response('nope', { status: up ? 404 : 503 });
    }) as typeof fetch;
    return { factory, setUp: (v: boolean) => (up = v) };
  }

  function makePeer(name: string) {
    const repoRoot = join(root, name);
    const designRoot = join(repoRoot, 'design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, '_comments'), { recursive: true });
    const linkedHub: DevServerConfig['linkedHub'] = { url: HUB, linkedAt: 1 };
    const ctx = {
      canvasOrigin: 'http://canvas.localhost:9',
      cfg: {
        name,
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
      projectLabel: name,
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
    } as Context;
    const onDisk = new Set<string>();
    return {
      ctx,
      onDisk,
      write(canvas: string, body: string) {
        writeFileSync(join(designRoot, 'ui', `${canvas}.tsx`), body);
        writeFileSync(
          join(designRoot, 'ui', `${canvas}.meta.json`),
          JSON.stringify({ syncable: true })
        );
        onDisk.add(`ui/${canvas}.tsx`);
      },
    };
  }

  const settle = (ms = 450) => new Promise((res) => setTimeout(res, ms));
  const model = (r: SyncRuntime | null, local: Iterable<string>) =>
    computeAvailability({
      source: r?.availability?.() ?? null,
      local: [...local],
      designRel: 'design',
    });

  test('cloud → desktop: waiting before the listing, arriving while the index lags, present after', async () => {
    const hub = makeHub();
    const a = makePeer('a');
    const b = makePeer('b');
    a.write('home', '<main>home</main>');
    b.write('home', '<main>home</main>');
    const ra = createSyncRuntime(a.ctx, { providerFactory: hub.factory() });
    const rb = createSyncRuntime(b.ctx, { providerFactory: hub.factory() });
    runtimes = [ra, rb];
    // Cold start: B has a runtime but has not asked the hub.
    expect(model(rb, b.onDisk).phase).toBe('waiting');
    await ra?.start();
    await rb?.start();
    await settle(50);
    expect(model(rb, b.onDisk)).toMatchObject({ phase: 'complete', done: 1, total: 1 });

    a.write('newidea', '<section>made on A</section>');
    a.ctx.bus.emit('canvas-list-update', { action: 'added', rel: 'ui/newidea.tsx' });
    await ra?.rescanNow();
    await settle();
    await rb?.pullRemoteNow();
    await settle();
    // The body is on B's disk; B's index is a beat behind (the stale list). Arriving, not missing.
    const lagging = model(rb, b.onDisk);
    expect(lagging.phase).toBe('arriving');
    expect(lagging.pending).toEqual([
      { path: 'ui/newidea.tsx', name: 'newidea', state: 'arriving' },
    ]);
    // The index catches up: present. Then the hub stops answering: still present, still 2 of 2.
    b.onDisk.add('ui/newidea.tsx');
    expect(model(rb, b.onDisk)).toMatchObject({ phase: 'complete', done: 2, total: 2 });
    hub.setUp(false);
    await rb?.pullRemoteNow();
    expect(model(rb, b.onDisk)).toMatchObject({ phase: 'complete', done: 2, total: 2 });
  });

  test('desktop → cloud: a canvas made here is present here and arriving there until it lands', async () => {
    const hub = makeHub();
    const a = makePeer('a');
    const b = makePeer('b');
    a.write('home', '<main>home</main>');
    b.write('home', '<main>home</main>');
    const ra = createSyncRuntime(a.ctx, { providerFactory: hub.factory() });
    const rb = createSyncRuntime(b.ctx, { providerFactory: hub.factory() });
    runtimes = [ra, rb];
    await ra?.start();
    await rb?.start();
    await settle(50);
    b.write('fromdesk', '<section>made on B</section>');
    // Before B's rescan pushes it: present on B (local-only), unknown to A.
    expect(model(rb, b.onDisk)).toMatchObject({ phase: 'complete', done: 2, total: 2 });
    b.ctx.bus.emit('canvas-list-update', { action: 'added', rel: 'ui/fromdesk.tsx' });
    await rb?.rescanNow();
    await settle();
    await ra?.pullRemoteNow();
    await settle();
    const onA = model(ra, a.onDisk);
    expect(onA.pending.map((p) => p.path)).toEqual(['ui/fromdesk.tsx']);
    expect(onA).toMatchObject({ done: 1, total: 2 });
  });

  test('a hub that never answers: the runtime stays waiting — nothing is "not on this Mac"', async () => {
    const hub = makeHub();
    hub.setUp(false);
    const b = makePeer('b');
    b.write('home', '<main>home</main>');
    const rb = createSyncRuntime(b.ctx, { providerFactory: hub.factory() });
    runtimes = [rb];
    await rb?.start();
    await settle(50);
    const m = model(rb, b.onDisk);
    expect(m.phase).toBe('waiting');
    expect(m.pending).toEqual([]);
  });
});
