// S5.6 — a chat prompt behind a closed gate waits in the outbox and is released into the run
// registry exactly once (V2-1.14 §5.4–§5.6, V2-1.15 §5.5 row 1; S5-slices G2/G5/G6/G12/G22–G24).
//
// Red first: before S5.6 nothing enqueues a prompt (`acp/ask-queue.ts` does not exist) — an
// offline prompt goes straight to the bridge and fails there.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { askIdForIntent, createAskQueue } from '../acp/ask-queue.ts';
import { createAcp } from '../acp/index.ts';
import { createLocalLeaseHome } from '../ai/lease-home.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { type Context, createBus } from '../context.ts';
import { createOutbox, type GateFacts } from '../outbox/index.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent.mjs');
const TEST_ENV_KEYS = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];

const dirs: string[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  for (const key of TEST_ENV_KEYS) delete process.env[key];
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function until<T>(fn: () => T | undefined, timeoutMs = 15000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeWs(id: string) {
  const frames: Array<Record<string, unknown>> = [];
  const ws = {
    data: { id } as WsData,
    send: (raw: string) => {
      frames.push(JSON.parse(raw));
    },
  } as unknown as ServerWebSocket<WsData>;
  return { ws, frames };
}

function rig() {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
  const root = mkdtempSync(join(tmpdir(), 'maude-acp-queue-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, '_chat'), { recursive: true });
  const bus = createBus();
  const ctx = {
    paths: { repoRoot: root, designRoot, designRel: '.design' },
    bus,
  } as unknown as Context;
  const facts: GateFacts = {
    online: true,
    hubReachable: true,
    signedIn: true,
    aiConnected: true,
    aiReady: true,
    allowanceResetsAt: null,
  };
  let acpRef: ReturnType<typeof createAcp> | null = null;
  const runs = createRunRegistry({
    designRoot,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    emit: (e, p) => bus.emit(e, p),
    turns: { send: (r, t) => acpRef?.sendTurn(r, t), cancel: (r) => acpRef?.cancelTurn(r) },
  });
  const senders: Parameters<typeof createOutbox>[0]['senders'] = {};
  const outbox = createOutbox({
    designRoot,
    senders,
    gates: () => facts,
    target: () => ({ projectId: null, projectName: 'p', role: 'owner' }),
  });
  outbox.store.load();
  const queue = createAskQueue({ outbox, gates: () => facts, runs: () => runs });
  senders['ai.prompt'] = queue.sender;
  const acp = createAcp(ctx, undefined, { runs, queue: () => queue });
  acpRef = acp;
  cleanups.push(() => {
    outbox.drain.stop?.();
    acp.stopAll();
    runs.close();
  });
  return { runs, acp, outbox, queue, facts };
}

describe('S5.6 — queued prompts', () => {
  test('offline: the prompt is queued (no run, no turn); online again → sent exactly once', async () => {
    const { runs, acp, outbox, facts } = rig();
    facts.online = false;
    const a = fakeWs('q1');
    acp.onOpen(a.ws);
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'make it blue', chat: 'c1' }));
    const q = await until(() => a.frames.find((f) => f.t === 'queued'));
    expect(q.words).toBe('Queued — sends when this Mac is online.');
    expect(q.gates).toEqual(['online']);
    await outbox.drain.wake();
    await sleep(300);
    expect(runs.view().mine).toHaveLength(0);
    expect(a.frames.find((f) => f.t === 'update')).toBeUndefined();

    facts.online = true;
    await outbox.drain.wake();
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    await outbox.drain.wake();
    await outbox.drain.wake();
    await sleep(400);
    const mine = runs.view().mine;
    expect(mine).toHaveLength(1);
    expect(mine[0].askId).toBe(q.askId as string);
    expect(a.frames.filter((f) => f.t === 'turn-end')).toHaveLength(1);
    expect(outbox.store.get(q.intentId as string)?.state).toBe('done');
  }, 25000);

  test('a replayed release (crash between send and answer) is the same ask — one run', async () => {
    const { runs, outbox, queue, facts } = rig();
    facts.aiConnected = false;
    const r = queue.maybeQueue({ chatId: 'c2', text: 'once', scope: null });
    expect(r && 'intentId' in r ? r.gates : []).toEqual(['ai-connected']);
    const rec = outbox.store.get((r as { intentId: string }).intentId);
    if (!rec) throw new Error('no record');
    await queue.sender(rec);
    await queue.sender(rec); // the drain replays the SAME id after a crash
    expect(runs.view().mine).toHaveLength(1);
    expect(runs.view().mine[0].askId).toBe(askIdForIntent(rec.id));
  }, 15000);

  test('used up: the prompt waits for resetsAt, then sends by itself', async () => {
    const { runs, acp, outbox, facts } = rig();
    facts.allowanceResetsAt = Date.now() + 600;
    const a = fakeWs('q3');
    acp.onOpen(a.ws);
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'later', chat: 'c3' }));
    const q = await until(() => a.frames.find((f) => f.t === 'queued'));
    expect(q.gates).toEqual(['ai-allowance']);
    expect(q.presentation).toBe('field');
    await outbox.drain.wake();
    expect(runs.view().mine).toHaveLength(0);
    // no further wake: the drain's own timer fires at the reset
    await until(() => a.frames.find((f) => f.t === 'turn-end'), 15000);
    expect(runs.view().mine).toHaveLength(1);
  }, 25000);

  test('O2: while a chat has a queued prompt, its next prompt queues behind it — order kept', async () => {
    const { runs, acp, outbox, facts } = rig();
    facts.online = false;
    const a = fakeWs('q4');
    acp.onOpen(a.ws);
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'first', chat: 'c4' }));
    await until(() => a.frames.find((f) => f.t === 'queued'));
    facts.online = true; // the gate opened, the drain has not run yet
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'second', chat: 'c4' }));
    await until(() => (a.frames.filter((f) => f.t === 'queued').length === 2 ? true : undefined));
    expect(runs.view().mine).toHaveLength(0); // the second did not overtake
    await outbox.drain.wake();
    await until(
      () =>
        runs.view().mine.length === 2 && runs.view().mine.every((r) => r.state === 'ended')
          ? true
          : undefined,
      25000
    );
    const order = runs
      .view()
      .mine.sort((x, y) => x.createdAt - y.createdAt)
      .map((r) => r.label);
    expect(order).toEqual(['first', 'second']);
  }, 35000);

  test('a double submit while offline is one queued prompt', async () => {
    const { acp, outbox, facts } = rig();
    facts.online = false;
    const a = fakeWs('q5');
    acp.onOpen(a.ws);
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'try again', chat: 'c5' }));
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'try again', chat: 'c5' }));
    await until(() => (a.frames.filter((f) => f.t === 'queued').length === 2 ? true : undefined));
    expect(outbox.store.list().filter((r) => r.kind === 'ai.prompt')).toHaveLength(1);
  }, 15000);
});
