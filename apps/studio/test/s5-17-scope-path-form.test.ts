// S5.17 G1 — a scoped run has ONE path form: design-relative (`ui/Site.tsx`).
//
// The shell sends `prompt {scope.canvas}` repo-relative (the frame's data-path, `.design/ui/Site.tsx`);
// the edit hook, the lease key (`path:<designRel>/<rel>`), the ring/tag and the terminal run all speak
// design-relative. Before S5.17 the chat's own edits were denied `out-of-scope` (".design/ui/Site.tsx …
// ui/Site.tsx is outside it"), its leases were keyed `path:.design/.design/…` (no ring, no "Needs you",
// no collision with a terminal run). parseRunScope now normalises at the server boundary, and a scope
// that names a path outside the design root (`..`, absolute, a hidden segment) refuses the prompt — it
// never degrades to an unscoped (lazy) run, which could write every canvas.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { createAcp, parseRunScope } from '../acp/index.ts';
import { groupChatsByCanvas, linkChatCanvas, listChats } from '../acp/transcript.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry, type RunRegistry } from '../ai/runs.ts';
import { type Context, createBus } from '../context.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';
import type { WsData } from '../ws.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Site() {
  return (
    <DesignCanvas>
      <DCArtboard id="landing" width={800} height={600}><p>Hi</p></DCArtboard>
      <DCArtboard id="pricing" width={800} height={600}><p>x</p></DCArtboard>
    </DesignCanvas>
  );
}
`;
const REPO_REL = '.design/ui/Site.tsx';
const KEY = 'path:.design/ui/Site.tsx';

describe('parseRunScope — one path form', () => {
  test('a repo-relative canvas becomes design-relative; a design-relative one is kept', () => {
    expect(parseRunScope({ canvas: REPO_REL, artboards: ['pricing'] }, '.design')).toEqual({
      canvas: 'ui/Site.tsx',
      artboards: ['pricing'],
    });
    expect(parseRunScope({ canvas: REPO_REL, artboards: '*' }, '.design')).toEqual({
      canvas: 'ui/Site.tsx',
      artboards: '*',
    });
    expect(parseRunScope({ canvas: 'ui/Site.tsx', artboards: '*' }, '.design')?.canvas).toBe(
      'ui/Site.tsx'
    );
    // a nested design root
    expect(
      parseRunScope({ canvas: 'apps/web/.design/ui/A.tsx', artboards: '*' }, 'apps/web/.design')
        ?.canvas
    ).toBe('ui/A.tsx');
  });

  test('elements carry the normalised canvas', () => {
    const s = parseRunScope(
      {
        canvas: REPO_REL,
        artboards: ['landing'],
        elements: [{ artboard: 'landing', element: 'h' }],
      },
      '.design'
    );
    expect(s?.elements?.[0]?.canvas).toBe('ui/Site.tsx');
  });

  test('a path outside the design root is no scope: traversal, absolute, hidden, runtime', () => {
    for (const canvas of [
      '.design/../src/App.tsx',
      '../src/App.tsx',
      'ui/../../x.tsx',
      '/Users/x/.design/ui/Site.tsx',
      '.git/hooks.tsx',
      '.design/.secret/a.tsx',
      '.design/_draw/a.proof.tsx',
      '.design',
    ])
      expect({ canvas, s: parseRunScope({ canvas, artboards: '*' }, '.design') }).toEqual({
        canvas,
        s: null,
      });
  });
});

// ── the hook and the lease key see the same form ─────────────────────────────────────────────────

let project: string;
let reg: RunRegistry;
let exact: Record<string, (req: Request) => Response | Promise<Response>>;

beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'maude-s517-')));
  mkdirSync(join(project, '.design', 'ui'), { recursive: true });
  writeFileSync(join(project, '.design', 'config.json'), '{}');
  writeFileSync(join(project, '.design', 'ui', 'Site.tsx'), CANVAS);
  reg = createRunRegistry({
    designRoot: null,
    designRel: '.design',
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    artboardsOf: () => ['landing', 'pricing'],
  });
  ({ exact } = mountRoutes(
    agentRouteSpecs({
      repoRoot: project,
      designRel: '.design',
      shells: () => 0,
      emit: () => {},
      runs: createAgentRuns({}, undefined, reg),
      personHolds: () => [],
      memberName: () => null,
    })
  ));
});
afterEach(() => {
  reg.close();
  rmSync(project, { recursive: true, force: true });
});

async function post(route: string, body: unknown) {
  const r = await exact[route](
    new Request(`http://127.0.0.1:4399${route}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:4399', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  return (await r.json()) as Record<string, unknown>;
}
const LANDING = { old: '<p>Hi</p>', new: '<p>Hello</p>' };
const PRICING = { old: '<p>x</p>', new: '<p>y</p>' };
const check = (session: string, edit: { old: string; new: string }, chat?: string) =>
  post('/_api/agent/edit/check', {
    session,
    toolUseId: `t${Math.random().toString(36).slice(2, 10)}`,
    tool: 'Edit',
    path: 'ui/Site.tsx',
    edit,
    ...(chat ? { chat } : {}),
  });
/** a chat asked the way the shell asks: the canvas repo-relative */
async function chatAsk(chatId: string, session: string, artboards: string[] | '*') {
  const scope = parseRunScope({ canvas: REPO_REL, artboards }, '.design');
  const rec = await reg.ask({ chatId, origin: 'maude-chat', label: 'Ask', prompt: 'p', scope });
  await post('/_api/agent/run/begin', { session, chat: chatId, actor: 'maude-chat' });
  return rec;
}

describe('the edit hook: a scoped chat may change its scope and nothing else', () => {
  test('an artboard-scoped chat edits its artboard; another artboard is out-of-scope', async () => {
    await chatAsk('c1', 's1', ['pricing']);
    expect(await check('s1', PRICING, 'c1')).toEqual({ decision: 'none' });
    const out = await check('s1', LANDING, 'c1');
    expect(out.decision).toBe('deny');
    expect(out.code).toBe('out-of-scope');
    expect(String(out.reason)).toContain('ui/Site.tsx › pricing');
    expect(String(out.reason)).not.toContain('.design/');
  });

  test('a whole-canvas chat edits any artboard of its canvas, and no other canvas', async () => {
    writeFileSync(join(project, '.design', 'ui', 'Other.tsx'), CANVAS);
    await chatAsk('c2', 's2', '*');
    expect(await check('s2', LANDING, 'c2')).toEqual({ decision: 'none' });
    expect(await check('s2', PRICING, 'c2')).toEqual({ decision: 'none' });
    const other = await post('/_api/agent/edit/check', {
      session: 's2',
      toolUseId: 'tother1',
      tool: 'Edit',
      path: 'ui/Other.tsx',
      edit: PRICING,
      chat: 'c2',
    });
    expect(other.code).toBe('out-of-scope');
  });

  test('the lease key is the shell’s key (no doubled design root)', async () => {
    await chatAsk('c3', 's3', ['pricing']);
    const keys = reg.view().mine.flatMap((r) => r.leases.map((l) => l.canvas));
    expect(keys).toEqual([KEY]);
    expect(reg.view().mine[0]?.scope?.canvas).toBe('ui/Site.tsx');
  });

  test('a chat run and a terminal run on the same artboard collide', async () => {
    const rec = await chatAsk('c4', 's4', ['pricing']);
    await reg.started(rec.runId);
    await post('/_api/agent/run/begin', { session: 'term', actor: 'claude-code' });
    const r = await check('term', PRICING);
    expect(r.decision).toBe('deny');
    expect(r.code).toBe('artboard-busy');
    // elsewhere is free for the terminal
    expect(await check('term', LANDING)).toEqual({ decision: 'none' });
  });
});

// ── the WS prompt: a scope outside the design root refuses the prompt ───────────────────────────

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent.mjs');
const ENV_KEYS = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const k of ENV_KEYS) delete process.env[k];
});

async function until<T>(fn: () => T | undefined, ms = 15000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 25));
  }
}

function acpRig() {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  const designRoot = join(project, '.design');
  mkdirSync(join(designRoot, '_chat'), { recursive: true });
  const bus = createBus();
  const ctx = {
    paths: { repoRoot: project, designRoot, designRel: '.design' },
    bus,
  } as unknown as Context;
  let ref: ReturnType<typeof createAcp> | null = null;
  const runs = createRunRegistry({
    designRoot,
    designRel: '.design',
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    emit: (e, p) => bus.emit(e, p),
    turns: { send: (r, t) => ref?.sendTurn(r, t), cancel: (r) => ref?.cancelTurn(r) },
  });
  const acp = createAcp(ctx, undefined, { runs });
  ref = acp;
  cleanups.push(() => {
    acp.stopAll();
    runs.close();
  });
  const frames: Array<Record<string, unknown>> = [];
  const ws = {
    data: { id: 'w1' } as WsData,
    send: (raw: string) => frames.push(JSON.parse(raw)),
  } as unknown as ServerWebSocket<WsData>;
  acp.onOpen(ws);
  return { runs, acp, ws, frames };
}

describe('the chat prompt normalises its scope and refuses one outside the design root', () => {
  test('a repo-relative scope runs with the design-relative canvas and the shell’s lease key', async () => {
    const { runs, acp, ws } = acpRig();
    acp.onMessage(
      ws,
      JSON.stringify({
        t: 'prompt',
        text: 'make it blue',
        chat: 'cw1',
        askId: 'a_s517a',
        scope: { canvas: REPO_REL, artboards: ['pricing'] },
      })
    );
    const run = await until(() => runs.view().mine.find((r) => r.leases.length > 0));
    expect(run.scope?.canvas).toBe('ui/Site.tsx');
    expect(run.leases.map((l) => l.canvas)).toEqual([KEY]);
  });

  test('G5 — a whole-canvas chat groups under its canvas in the chat list', async () => {
    const { runs, acp, ws } = acpRig();
    acp.onMessage(
      ws,
      JSON.stringify({
        t: 'prompt',
        text: 'make it blue',
        chat: 'cw3',
        askId: 'a_s517c',
        scope: { canvas: REPO_REL, artboards: '*' },
      })
    );
    // (a whole-canvas ask in this rig leases nothing: no artboard list is wired)
    expect((await until(() => runs.view().mine[0], 4000)).scope?.canvas).toBe('ui/Site.tsx');
    const designRoot = join(project, '.design');
    await until(
      () => (listChats(designRoot).find((c) => c.id === 'cw3' && c.canvas) ? true : undefined),
      4000
    );
    const groups = groupChatsByCanvas(listChats(designRoot));
    expect(groups.map((g) => g.canvas)).toEqual(['ui/Site.tsx']);
    // a later ask about another canvas keeps the first link
    linkChatCanvas(designRoot, 'cw3', 'ui/Other.tsx');
    expect(listChats(designRoot).find((c) => c.id === 'cw3')?.canvas).toBe('ui/Site.tsx');
  });

  test('a traversal scope is refused with an error frame and never runs unscoped', async () => {
    const { runs, acp, ws, frames } = acpRig();
    acp.onMessage(
      ws,
      JSON.stringify({
        t: 'prompt',
        text: 'make it blue',
        chat: 'cw2',
        askId: 'a_s517b',
        scope: { canvas: '.design/../src/App.tsx', artboards: '*' },
      })
    );
    const err = await until(() => frames.find((f) => f.t === 'error'));
    expect(err.code).toBe('bad-scope');
    expect(err.chat).toBe('cw2');
    await new Promise((r) => setTimeout(r, 200));
    expect(runs.view().mine).toEqual([]);
    expect(frames.some((f) => f.t === 'update')).toBe(false);
  });
});
