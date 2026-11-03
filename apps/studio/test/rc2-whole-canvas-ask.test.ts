// rc2-e — the whole-canvas ask that never reached Claude (v2.0.0-rc.1 field bug, Michal's Mac mini).
//
// A canvas with 267 artboards: the chat's whole-canvas ask (`scope.artboards: '*'`) expanded into 267
// lease keys, the lease home refused `begin` (`capacity`, ≤ 200 keys a run), the registry ended the run
// `failed` in ~5 ms, nothing told the chat, and it showed "AI is working" forever. Meanwhile the agent's
// own hook calls (run/begin, edit/touched…) for that chat each opened a NEW run with no label that failed
// at once — 231 of them in 44 minutes.
//
// Part 1 — a whole canvas past the per-run cap begins without a lease per artboard; its writes claim.
// Part 2 — a run the home refuses tells the chat in plain words (the working state ends).
// Part 3 — a hook call for a chat with no live run opens ONE run that is already running (the agent's
//          turn is), never a run that wants a generated turn and fails at once, over and over.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { createAcp, refusedWords } from '../acp/index.ts';
import { createAgentRuns } from '../agent-runs.ts';
import { createLocalLeaseHome, type LeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { problemModel } from '../client/v2/ai/needs-you.js';
import { type Context, createBus } from '../context.ts';
import { agentRouteSpecs } from '../routes/agent.ts';
import { mountRoutes } from '../routes/table.ts';
import type { WsData } from '../ws.ts';

const dirs: string[] = [];
const cleanups: Array<() => void> = [];
// Never the real adapter or the real `claude`: every bridge this file might spawn is the mock agent.
const MOCK_ENV = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];
function mockAgentEnv(fixture = 'mock-acp-agent.mjs') {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = join(import.meta.dir, 'fixtures', fixture);
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
}
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const k of MOCK_ENV) delete process.env[k];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await sleep(10);
  }
}

const MANY = Array.from({ length: 267 }, (_, i) => `a${i + 1}`);
const WHOLE = { canvas: 'ui/Native app.tsx', artboards: '*' as const };

function registry(home: LeaseHome, device = 'mac', ids = MANY) {
  const sent: Array<{ runId: string; text: string | null }> = [];
  const reg = createRunRegistry({
    designRoot: null,
    home,
    device,
    autoRenew: false,
    artboardsOf: () => ids,
    turns: { send: (r, text) => void sent.push({ runId: r.runId, text }) },
    stage: { publish: () => ({ status: 'accepted' as const }) },
  });
  cleanups.push(() => reg.close());
  return { reg, sent };
}

describe('part 1 — a whole canvas past the per-run cap begins; its writes claim as they happen', () => {
  test('267 artboards: the ask starts and its turn goes out — no lease per artboard up front', async () => {
    const { reg, sent } = registry(createLocalLeaseHome({ actor: 'you' }));
    const run = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Tidy every screen',
      prompt: 'Tidy every screen',
      scope: WHOLE,
    });
    expect({ state: run.state, outcome: run.outcome }).toEqual({
      state: 'starting',
      outcome: undefined,
    });
    expect(run.leases).toEqual([]);
    await until(() => (sent.some((s) => s.runId === run.runId) ? true : undefined));
    expect(sent.find((s) => s.runId === run.runId)?.text).toBe(null); // the ask's own prompt
  });

  test('one AI per artboard still holds: a write claims its artboard; another run then waits for it', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    const { reg } = registry(home);
    const whole = await reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Tidy',
      prompt: 'Tidy',
      scope: WHOLE,
    });
    await reg.started(whole.runId);
    const key = reg.canvasKey(WHOLE.canvas);
    const c = await reg.claim(whole.runId, [{ canvas: key, artboard: 'a5' }]);
    expect(c.granted.map((g) => g.artboard)).toEqual(['a5']);
    expect(reg.get(whole.runId)?.leases.map((l) => l.artboard)).toEqual(['a5']);
    // a second chat's ask on a5 lines up behind it — never a second holder
    const other = await reg.ask({
      chatId: 'c2',
      origin: 'maude-chat',
      label: 'Recolour',
      prompt: 'Recolour',
      scope: { canvas: WHOLE.canvas, artboards: ['a5'] },
    });
    expect(other.state).toBe('waiting');
    expect(other.leases).toEqual([]);
    // a6 is not the whole-canvas run's (it never wrote there): another ask takes it at once
    const free = await reg.ask({
      chatId: 'c3',
      origin: 'maude-chat',
      label: 'Fix',
      prompt: 'Fix',
      scope: { canvas: WHOLE.canvas, artboards: ['a6'] },
    });
    expect(free.state).toBe('starting');
  });

  test('a collaborator’s lease is respected: the claim is busy and the artboard continues after the turn', async () => {
    const home = createLocalLeaseHome({ actor: 'you' });
    const mine = registry(home);
    const tereza = registry(home, 'tereza-mac');
    const t = await tereza.reg.ask({
      chatId: 't1',
      origin: 'maude-chat',
      label: 'Tereza',
      prompt: 'p',
      scope: { canvas: WHOLE.canvas, artboards: ['a7'] },
    });
    await tereza.reg.started(t.runId);
    const whole = await mine.reg.ask({
      chatId: 'c1',
      origin: 'maude-chat',
      label: 'Tidy',
      prompt: 'Tidy',
      scope: WHOLE,
    });
    await mine.reg.started(whole.runId);
    const c = await mine.reg.claim(whole.runId, [
      { canvas: mine.reg.canvasKey(WHOLE.canvas), artboard: 'a7' },
    ]);
    expect(c.granted).toEqual([]);
    expect(c.busy.map((b) => b.artboard)).toEqual(['a7']);
    expect(mine.reg.get(whole.runId)?.leases).toEqual([]);
    await mine.reg.turnEnded(whole.runId, 'done');
    const conts = mine.reg.view().mine.filter((r) => r.continuationOf === whole.runId);
    expect(conts.map((r) => [r.state, r.scope?.artboards])).toEqual([['waiting', ['a7']]]);
  });
});

// ── the ACP rig (as acp-runs-handoff.test.ts): a real registry, the real ACP sendTurn ─────────────

function fakeWs(id: string) {
  const frames: Array<Record<string, unknown>> = [];
  const ws = {
    data: { id } as WsData,
    send: (raw: string) => void frames.push(JSON.parse(raw)),
  } as unknown as ServerWebSocket<WsData>;
  return { ws, frames };
}

function rig(home: LeaseHome, fixture?: string) {
  mockAgentEnv(fixture);
  const root = mkdtempSync(join(tmpdir(), 'maude-rc2e-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, '_chat'), { recursive: true });
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{}');
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'export default () => null;\n');
  const bus = createBus();
  const ctx = {
    paths: { repoRoot: root, designRoot, designRel: '.design' },
    bus,
  } as unknown as Context;
  let acpRef: ReturnType<typeof createAcp> | null = null;
  const runs = createRunRegistry({
    designRoot,
    designRel: '.design',
    home,
    autoRenew: false,
    emit: (e, p) => bus.emit(e, p),
    artboardsOf: () => ['post'],
    turns: {
      send: (r, t) => acpRef?.sendTurn(r, t),
      cancel: (r) => acpRef?.cancelTurn(r),
    },
  });
  const acp = createAcp(ctx, undefined, { runs });
  acpRef = acp;
  const { exact } = mountRoutes(
    agentRouteSpecs({
      repoRoot: root,
      designRel: '.design',
      shells: () => 0,
      emit: () => {},
      runs: createAgentRuns({}, undefined, runs),
    })
  );
  cleanups.push(() => {
    acp.stopAll();
    runs.close();
  });
  async function post(route: string, body: unknown) {
    const h = exact[route] as (req: Request) => Response | Promise<Response>;
    const r = await h(
      new Request(`http://127.0.0.1:4399${route}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:4399', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  }
  return { runs, acp, post };
}

/** A lease home that refuses every `begin` the way the field's did. */
function refusingHome(reason: string): LeaseHome {
  const inner = createLocalLeaseHome({ actor: 'you' });
  return { ...inner, begin: async () => ({ refused: 'capacity' as const, reason }) };
}

describe('part 2 — a run the home refuses tells the chat; the working state ends', () => {
  test('capacity on begin → one coded error frame in plain words, and the ended run frame', async () => {
    const { runs, acp } = rig(refusingHome('at most 200 artboards a run'));
    const a = fakeWs('w1');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({
        t: 'prompt',
        text: 'tidy every screen',
        chat: 'c1',
        askId: 'a_rc2e0001',
        scope: { canvas: 'ui/a.tsx', artboards: ['post'] },
      })
    );
    const err = await until(() => a.frames.find((f) => f.t === 'error'));
    expect(err).toEqual({
      t: 'error',
      code: 'run-refused',
      chat: 'c1',
      message:
        'This canvas has too many artboards for one AI run. Select the artboards you mean and ask again.',
    });
    const [rec] = runs.view().mine;
    expect({ state: rec?.state, outcome: rec?.outcome }).toEqual({
      state: 'ended',
      outcome: 'failed',
    });
    await sleep(50);
    // told once, never repeated on the next change
    expect(a.frames.filter((f) => f.t === 'error')).toHaveLength(1);
    const ended = a.frames.filter(
      (f) => f.t === 'run' && (f.run as { state: string }).state === 'ended'
    );
    expect(ended.length).toBeGreaterThan(0);
  });

  test('too many live runs reads as that, not as an artboard problem', async () => {
    const { acp } = rig(refusingHome('at most 20 live runs'));
    const a = fakeWs('w2');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({
        t: 'prompt',
        text: 'go',
        chat: 'c2',
        askId: 'a_rc2e0002',
        scope: { canvas: 'ui/a.tsx', artboards: ['post'] },
      })
    );
    const err = (await until(() => a.frames.find((f) => f.t === 'error'))) as { message: string };
    expect(err.message).toBe(
      'Too many AI runs are open in this project. Stop one, then ask again.'
    );
  });
});

describe('part 3 — hook calls for a chat with no live run never loop new failing runs', () => {
  test('the agent keeps writing after its run ended: ONE run, running, ended by run/end', async () => {
    const { runs, post } = rig(createLocalLeaseHome({ actor: 'you' }));
    const hooks = 12;
    expect(
      (await post('/_api/agent/run/begin', { session: 's1', chat: 'c9', actor: 'maude-chat' }))
        .status
    ).toBe(200);
    for (let i = 0; i < hooks; i++) {
      const t = await post('/_api/agent/edit/touched', {
        session: 's1',
        chat: 'c9',
        toolUseId: `u${i}`,
        via: 'tool',
        path: 'ui/a.tsx',
      });
      expect(t.status).toBe(200);
      await sleep(5); // a generated turn would have failed the run by now
    }
    const mine = runs.view().mine.filter((r) => r.chatId === 'c9');
    // before the fix: 13 runs, every one `failed` in ~0 s with an empty label
    expect({
      runs: mine.length,
      failed: mine.filter((r) => r.outcome === 'failed').length,
    }).toEqual({
      runs: 1,
      failed: 0,
    });
    expect(mine[0]?.state).toBe('running');
    const e = await post('/_api/agent/run/end', { session: 's1', chat: 'c9', outcome: 'done' });
    expect(e.body.run).toBe(mine[0]?.runId);
    expect(runs.get(String(mine[0]?.runId))?.state).toBe('ended');
  });

  test('a run the hooks opened ends with the chat’s turn even with no run/end — the line never sticks', async () => {
    const { runs, acp, post } = rig(
      createLocalLeaseHome({ actor: 'you' }),
      'mock-acp-agent-slow.mjs'
    );
    const a = fakeWs('w3');
    acp.onOpen(a.ws);
    acp.onMessage(
      a.ws,
      JSON.stringify({ t: 'prompt', text: 'long one', chat: 'c7', askId: 'a_rc2e0007' })
    );
    const first = await until(() =>
      runs.view().mine.find((r) => r.chatId === 'c7' && r.state === 'running')
    );
    // the chat's run ends while its turn keeps going (the field: a run ended under a long turn)
    runs.endNow(first.runId, 'failed');
    await post('/_api/agent/edit/touched', {
      session: 's7',
      chat: 'c7',
      toolUseId: 'u1',
      via: 'tool',
      path: 'ui/a.tsx',
    });
    const opened = runs.view().mine.find((r) => r.chatId === 'c7' && r.runId !== first.runId);
    expect(opened?.state).toBe('running');
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    await until(() => (runs.get(String(opened?.runId))?.state === 'ended' ? true : undefined));
    expect(runs.live().filter((r) => r.chatId === 'c7')).toEqual([]);
  }, 15000);
});

describe('part 2, the chat — a refused run is a problem card with the server’s words', () => {
  test('`run-refused` → its plain words, "Nothing changed.", and no verb that would only fail again', () => {
    const message = refusedWords({ code: 'capacity', why: 'artboards' });
    expect(problemModel({ code: 'run-refused', message })).toEqual({
      code: 'run-refused',
      title: message,
      detail: 'Nothing changed.',
      verb: null,
    });
    // a coded error the card cannot draw draws NOTHING (NeedsYouSlot sends every coded error here)
    expect(problemModel({ code: 'run-refused', message: '' })?.title).toBe(
      'AI could not start on this. Ask again.'
    );
  });
});
