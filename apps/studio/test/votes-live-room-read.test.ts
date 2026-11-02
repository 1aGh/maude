// S4.V4 G4 (wave-A gate fix 3c) — after "Start vote" the bar and the dots did not appear until a reload.
// With the canvas open its collab room holds the board, so the vote door's write (api.applyAnnotationOps)
// went to the room's replica — ahead of an 800 ms debounced flush — while the door's next read (the
// shell's GET right after the POST) read the FILE: no vote, and the store polls only while one is open.
// The door now reads the live room first (api.readBoardLive, wired in http.ts).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyOps as applyPure } from '../annotations/ops.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createVoteRoutes } from '../routes/votes.ts';
import { makeSandbox } from './_helpers.ts';

const FILE = '.design/ui/Site.tsx';

function rig() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Site.tsx'), 'export default function P(){return <main/>}');
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 'g4',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  // A populated live room (the canvas is open): ops land in its replica; its flush has not run.
  let room = serializeBoard([]);
  const api = createApi(ctx, {
    onCommentsChanged() {},
    onAnnotationsChanged() {},
    applyAnnotationOpsLive(_file, ops) {
      const before = parseBoard(room).elements;
      const r = applyPure(new Map(before.map((e) => [e.id, e])), ops);
      room = serializeBoard([...r.state.values()]);
      return r;
    },
    readAnnotationsLive: () => room,
  });
  const specs = createVoteRoutes({
    designRel: '.design',
    home: () => ({ kind: 'local' }),
    person: async () => 'You',
    readBoard: (f) => api.readBoardLive(f),
    applyOps: (f, ops) => api.applyAnnotationOps(f, ops),
  });
  const find = (m: string, p: string) =>
    specs.find((s) => s.method === m && s.path === p) as RouteSpec;
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const url = `http://127.0.0.1${path}`;
    const req = new Request(method === 'GET' ? `${url}?file=${encodeURIComponent(FILE)}` : url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const res = await find(method, path).handle(req, {});
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { api, call };
}

describe('S4.V4 G4 — the vote door reads its own write back while the canvas is open', () => {
  test('start → GET shows the open vote before the room has flushed', async () => {
    const r = rig();
    const s = await r.call('POST', '/_api/votes/start', {
      file: FILE,
      targets: ['ab:home', 'ab:pricing'],
      perVoter: 3,
      durationS: 120,
    });
    expect(s.status).toBe(201);
    const g = await r.call('GET', '/_api/votes');
    expect(g.status).toBe(200);
    expect(g.body.votes.map((v: { id: string; state: string }) => [v.id, v.state])).toEqual([
      [s.body.vote.id, 'open'],
    ]);
    // and a ballot right after the start finds the vote (not "not found")
    const b = await r.call('POST', '/_api/votes/ballot', {
      file: FILE,
      id: s.body.vote.id,
      picks: { 'ab:home': 2 },
    });
    expect(b.status).toBe(200);
  });

  test('no live room: readBoardLive is the file read', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    const api = createApi(
      {
        cfg: {} as Context['cfg'],
        projectLabel: 'g4b',
        bus: createBus(),
        paths: {
          repoRoot: root,
          designRel: '.design',
          designRoot,
          serverInfoFile: join(designRoot, '_server.json'),
          activeFile: join(designRoot, '_active.json'),
          commentsDir: join(designRoot, '_comments'),
          canvasStateDir: join(designRoot, '_canvas-state'),
          historyDir: join(designRoot, '_history'),
          tokensUrlRel: '',
          systemDirRel: 'system',
        },
      },
      { onCommentsChanged() {}, onAnnotationsChanged() {}, readAnnotationsLive: () => null }
    );
    expect(await api.readBoardLive(FILE)).toEqual(await api.readBoard(FILE));
  });

  test('http.ts wires the vote door to the live read', () => {
    const src = readFileSync(join(import.meta.dir, '../http.ts'), 'utf8');
    const at = src.indexOf('person: async () => ((await api.gitCurrentUser())');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 400)).toContain('readBoard: (file) => api.readBoardLive(file)');
  });
});
