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
import { createApi } from '../api.ts';
import type { Context } from '../context.ts';
import { CANVAS_SAFE_API, claimingLegacyRoutes } from '../http.ts';
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

  test('a canvas-safe path, /_api/canvas and a hook path keep their own handler', () => {
    const own = {
      '/_api/annotations': probe('/_api/annotations'),
      '/_api/canvas': probe('/_api/canvas'),
      '/_api/agent/x': probe('/_api/agent/x'),
      '/_api/insert-artboard': probe('/_api/insert-artboard'),
    };
    const wrapped = claimingLegacyRoutes(own, null);
    for (const p of CANVAS_SAFE_API)
      if (p in own) expect(wrapped[p as keyof typeof own]).toBe(own[p as keyof typeof own]);
    expect(wrapped['/_api/canvas']).toBe(own['/_api/canvas']);
    expect(wrapped['/_api/agent/x']).toBe(own['/_api/agent/x']);
    expect(wrapped['/_api/insert-artboard']).not.toBe(own['/_api/insert-artboard']);
    expect(Object.keys(wrapped)).toEqual(Object.keys(own));
  });
});
