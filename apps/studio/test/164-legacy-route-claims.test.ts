// #164 B4 — the legacy `routes` literal's writes claim into an AI run the way the table's do. An AI
// `curl-local` POST naming its chat (`X-Maude-Chat`) to `/_api/insert-artboard`, `/_api/set-artboard-label`
// or `/_api/edit-array-src` answers inside that chat's run claim (http.ts `claimingLegacyRoutes`), and the
// op says its bytes (`source-writing` / `source-written`, api.ts) so the local home CLAIMS them for the run.
// Before: the legacy routes were never wrapped and the three ops never said their bytes, so the watcher
// imported the write as OUTSIDE — never the run's, never in its one-step undo.
// Contract: apps/studio/client/v2/contracts/164-hash-diff-attribution.md §7 (lane writers claim).
//
// The rig is p8-a1-write-claims.test.ts's: a real local home (bun:sqlite, temp project) on the bus
// server.ts uses, the real run registry, the real api ops. The oracle is the store's history rows.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { currentWriteClaim, routeWriteClaim, withWriteClaim } from '../ai/write-claim.ts';
import { createApi } from '../api.ts';
import type { Context } from '../context.ts';
import { CANVAS_SAFE_API, claimingLegacyRoutes, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { runStageHooks } from '../routes/project-undo.ts';
import { attachLocalHome, type LocalHome, OUTSIDE_KIND } from '../sync/local-kernel.ts';

const canvas = (title: string) => `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
const CLIPS = [{ src: '/assets/a.mp4' }, { src: '/assets/b.mp4' }];
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <h1 data-cd-id="title">${title}</h1>
        {CLIPS.map((c) => <video key={c.src} src={c.src} />)}
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const HOME = 'ui/Home.tsx';

const dirs: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const c of closers) c();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function rig() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-164-legacy-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, HOME), canvas('Home'));
  process.env.MAUDE_MACHINE_FILE = path.join(root, 'machine.json');
  const subs = new Map<string, Array<(x: unknown) => void>>();
  const bus = {
    on(ev: string, fn: (x: unknown) => void) {
      subs.set(ev, [...(subs.get(ev) ?? []), fn]);
      return () => {};
    },
    emit(ev: string, x?: unknown) {
      for (const fn of subs.get(ev) ?? []) fn(x);
    },
  };
  const att = attachLocalHome(
    { cfg: { canvasGroups: [{ path: 'ui' }] }, paths: { designRoot, designRel: '.design' }, bus },
    { current: () => null },
    {}
  );
  closers.push(() => att.close());
  const home = att.home() as LocalHome;
  await home.ready();
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
  });
  closers.push(() => reg.close());
  const ctx = {
    cfg: { canvasGroups: [{ label: 'Canvases', path: 'ui' }] },
    projectLabel: 'test',
    bus,
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: path.join(designRoot, '_server.json'),
      activeFile: path.join(designRoot, '_active.json'),
      commentsDir: path.join(designRoot, '_comments'),
      canvasStateDir: path.join(designRoot, '_canvas-state'),
      historyDir: path.join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
    syncControl: { current: () => home.runtime },
  } as unknown as Context;
  const api = createApi(ctx, { onCommentsChanged: () => {} });
  const json = async (req: Request) => (await req.json()) as Record<string, unknown>;
  const answer = (r: { ok: boolean; status?: number }) =>
    Response.json(r, { status: r.ok ? 200 : (r.status ?? 500) });
  // the three legacy handlers' write path (http.ts parses the body, then calls the api op), wrapped as
  // http.ts mounts the literal
  const routes = claimingLegacyRoutes(
    {
      '/_api/insert-artboard': async (req: Request) =>
        answer(await api.insertArtboardOp(await json(req))),
      '/_api/set-artboard-label': async (req: Request) =>
        answer(await api.setArtboardLabelOp(await json(req))),
      '/_api/edit-array-src': async (req: Request) =>
        answer(await api.editArraySrcOp(await json(req))),
    },
    reg
  );
  const call = (route: keyof typeof routes, body: unknown, headers: Record<string, string> = {}) =>
    routes[route](
      new Request(`http://127.0.0.1:4399${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      })
    );
  const stage = runStageHooks({ control: () => home.runtime as never });
  const deliver = async (rel: string) => {
    bus.emit('fs:any', rel);
    await home.flush();
  };
  const ask = async (chatId: string, label: string) =>
    (await reg.ask({ origin: 'maude-chat', chatId, label, lazy: true })).runId as string;
  const publish = (runId: string) =>
    stage.publish({ runId }, { partial: false, fence: { runId, leases: [] } });
  const rows = async () =>
    (await home.runtime.acceptedHistory({ limit: 50 })).filter(
      (r) => r.kind !== 'migration.import'
    );
  const read = () => readFileSync(path.join(designRoot, HOME), 'utf8');
  return { call, deliver, ask, publish, rows, read };
}

const CASES = [
  {
    route: '/_api/insert-artboard',
    body: { canvas: HOME, id: 'mobile', label: 'Mobile', width: 390, height: 844 },
    landed: (src: string) => src.includes('id="mobile"'),
  },
  {
    route: '/_api/set-artboard-label',
    body: { canvas: HOME, artboardId: 'desktop', label: 'Wide' },
    landed: (src: string) => src.includes('label="Wide"'),
  },
  {
    route: '/_api/edit-array-src',
    body: { canvas: HOME, arrayName: 'CLIPS', index: 1, field: 'src', value: '/assets/c.mp4' },
    landed: (src: string) => src.includes('/assets/c.mp4'),
  },
] as const;

describe('#164 B4 — a legacy route write that names its chat is the run’s', () => {
  for (const c of CASES) {
    test(`${c.route} with X-Maude-Chat lands as the run’s one ai row`, async () => {
      const r = await rig();
      const runId = await r.ask('c1', 'Tidy the canvas');
      const res = await r.call(c.route, c.body, { 'X-Maude-Chat': 'c1' });
      expect(res.status).toBe(200);
      expect(c.landed(r.read())).toBe(true);
      await r.deliver(HOME);
      expect(await r.publish(runId)).toMatchObject({ status: 'accepted' });
      const rows = await r.rows();
      expect(rows.filter((x) => x.canvases.includes(HOME)).map((x) => [x.kind, x.runId])).toEqual([
        ['ai', runId],
      ]);
    });

    test(`${c.route} with no chat is the person’s edit, never the run’s and never outside`, async () => {
      const r = await rig();
      const runId = await r.ask('c1', 'Tidy the canvas');
      expect((await r.call(c.route, c.body)).status).toBe(200);
      await r.deliver(HOME);
      await r.publish(runId);
      const kinds = (await r.rows()).filter((x) => x.canvases.includes(HOME)).map((x) => x.kind);
      expect(kinds).not.toContain('ai');
      expect(kinds).not.toContain(OUTSIDE_KIND);
      expect(kinds.length).toBeGreaterThan(0);
    });
  }

  test('a cross-origin Origin claims nothing', async () => {
    const r = await rig();
    const runId = await r.ask('c1', 'Tidy the canvas');
    await r.call('/_api/insert-artboard', CASES[0].body, {
      'X-Maude-Chat': 'c1',
      origin: 'http://evil.test',
    });
    await r.deliver(HOME);
    await r.publish(runId);
    const kinds = (await r.rows()).filter((x) => x.canvases.includes(HOME)).map((x) => x.kind);
    expect(kinds).not.toContain('ai');
  });
});

describe('#164 B4 — which legacy paths are wrapped', () => {
  const seen: string[] = [];
  const probe = (p: string) => async () => {
    seen.push(p);
    return new Response('ok');
  };

  test('/_api/canvas and a hook path keep their own handler; F2 — a canvas-safe path is wrapped on the main origin', () => {
    const own = {
      '/_api/annotations': probe('/_api/annotations'),
      '/_api/canvas': probe('/_api/canvas'),
      '/_api/agent/x': probe('/_api/agent/x'),
      '/_api/insert-artboard': probe('/_api/insert-artboard'),
    };
    const wrapped = claimingLegacyRoutes(own, null);
    for (const p of CANVAS_SAFE_API)
      if (p in own) expect(wrapped[p as keyof typeof own]).not.toBe(own[p as keyof typeof own]);
    expect(wrapped['/_api/canvas']).toBe(own['/_api/canvas']);
    expect(wrapped['/_api/agent/x']).toBe(own['/_api/agent/x']);
    expect(wrapped['/_api/insert-artboard']).not.toBe(own['/_api/insert-artboard']);
    expect(Object.keys(wrapped)).toEqual(Object.keys(own));
  });
});

describe('#164 F2 / D5 — who a legacy write claims for', () => {
  const closers: Array<() => void> = [];
  afterAll(() => {
    for (const c of closers) c();
  });
  async function registry() {
    const reg = createRunRegistry({
      designRoot: null,
      home: createLocalLeaseHome({ actor: 'you' }),
      autoRenew: false,
    });
    closers.push(() => reg.close());
    const runId = (await reg.ask({ origin: 'maude-chat', chatId: 'c1', label: 'Tidy', lazy: true }))
      .runId as string;
    return { reg, runId };
  }
  /** A handler that records the run its writes would claim for (null: the person's). */
  const recorder = () => {
    const seen: Array<string | null> = [];
    const h = async () => {
      seen.push(currentWriteClaim()?.runId ?? null);
      return new Response('ok');
    };
    return { seen, h };
  };
  const req = (p: string, method: string, headers: Record<string, string>, body: unknown = {}) =>
    new Request(`http://127.0.0.1:4399${p}`, {
      method,
      headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
      body: JSON.stringify(body),
    });

  test('an AI request to PATCH /_api/canvas-meta or PUT /_api/annotations on the main origin is the run’s; the canvas origin never claims', async () => {
    const { reg, runId } = await registry();
    const meta = recorder();
    const board = recorder();
    const own = { '/_api/canvas-meta': meta.h, '/_api/annotations': board.h };
    const main = claimingLegacyRoutes(own, reg);
    const canvas = canvasOriginRoutes({
      routes: main,
      unclaimed: own,
      canvasRoutes: {},
      tableCanvasPaths: [],
    } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths' | 'unclaimed'>);
    const ai = { 'X-Maude-Chat': 'c1' };
    const patch = { file: 'ui/Home.tsx', patch: { layout: {} } };
    await main['/_api/canvas-meta'](req('/_api/canvas-meta', 'PATCH', ai, patch));
    await main['/_api/annotations'](req('/_api/annotations', 'PUT', ai));
    await main['/_api/canvas-meta'](req('/_api/canvas-meta', 'PATCH', {}, patch));
    await main['/_api/annotations'](req('/_api/annotations', 'PUT', {}));
    // the canvas listener: the same header from a planted canvas claims nothing
    await (canvas['/_api/canvas-meta'] as (r: Request) => Promise<Response>)(
      req('/_api/canvas-meta', 'PATCH', ai, patch)
    );
    await (canvas['/_api/annotations'] as (r: Request) => Promise<Response>)(
      req('/_api/annotations', 'PUT', ai)
    );
    expect(meta.seen).toEqual([runId, null, null]);
    expect(board.seen).toEqual([runId, null, null]);
  });

  test('D5 — a route that starts long-lived work (ACP chat, jobs, sync, hub link) answers under no claim', async () => {
    const { reg } = await registry();
    const paths = [
      '/_api/acp/chat',
      '/_api/export-jobs',
      '/_api/generate-jobs',
      '/_api/sync/settings',
      '/_api/hub/link',
    ];
    const rec = recorder();
    const main = claimingLegacyRoutes(Object.fromEntries(paths.map((p) => [p, rec.h])), reg);
    for (const p of paths) await main[p](req(p, 'POST', { 'X-Maude-Chat': 'c1' }));
    expect(rec.seen).toEqual(paths.map(() => null));
  });

  test('D5 — a claim is re-checked when it is read: once the run ended it claims nothing', async () => {
    const { reg, runId } = await registry();
    const run = routeWriteClaim(req('/_api/x', 'POST', { 'X-Maude-Chat': 'c1' }), reg);
    expect(run?.runId).toBe(runId);
    expect(withWriteClaim(run, () => currentWriteClaim()?.runId ?? null)).toBe(runId);
    await (reg as unknown as { stop(id: string): Promise<unknown> }).stop(runId);
    expect(withWriteClaim(run, () => currentWriteClaim()?.runId ?? null)).toBeNull();
  });
});
