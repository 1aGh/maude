// S5.18 (G10, 03 `ai-not-ready`) — signed out, a first send is KEPT, never dropped.
//
// Red first: the outbox gate read `probeAcpAvailability().available` (true once `claude` is installed, signed in or
// not), so a signed-out Mac looked connected: the prompt skipped the queue, started a run that failed, and the typed
// words were gone (the outbox stayed empty).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { createAskQueue } from '../acp/ask-queue.ts';
import { createConnectedFact } from '../acp/connected-fact.ts';
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

describe('connected fact', () => {
  test('a fresh answer is not re-asked; a stale one refreshes; false→true fires onOpen once', async () => {
    let t = 1000;
    let signedIn = false;
    let asked = 0;
    let opened = 0;
    const fact = createConnectedFact({
      probe: async () => {
        asked++;
        return { available: signedIn };
      },
      sync: () => true,
      onOpen: () => opened++,
      now: () => t,
    });
    expect(fact.read()).toBe(true); // the cheap answer until the first full one lands
    expect(await fact.ensure()).toBe(false);
    expect(fact.read()).toBe(false);
    await fact.ensure();
    expect(asked).toBe(1); // fresh: not asked again
    signedIn = true;
    t += 3000; // past the "not connected" ttl
    expect(await fact.ensure()).toBe(true);
    expect(opened).toBe(1);
    t += 40_000;
    await fact.ensure();
    expect(opened).toBe(1); // true→true is not an opening
  });

  test('a probe that throws is "not connected" (the prompt is kept, never lost)', async () => {
    const fact = createConnectedFact({
      probe: async () => {
        throw new Error('spawn failed');
      },
      sync: () => true,
    });
    expect(await fact.ensure()).toBe(false);
  });
});

describe('G10 — signed out: the first send is kept', () => {
  function rig() {
    process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
    process.env.MAUDE_ACP_RUNTIME = process.execPath;
    process.env.MAUDE_CLAUDE_BIN = process.execPath;
    const root = mkdtempSync(join(tmpdir(), 'maude-s518-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, '_chat'), { recursive: true });
    const bus = createBus();
    const ctx = {
      paths: { repoRoot: root, designRoot, designRel: '.design' },
      bus,
    } as unknown as Context;
    let signedIn = false;
    let now = Date.now();
    const outboxRef: { current: ReturnType<typeof createOutbox> | null } = { current: null };
    const fact = createConnectedFact({
      // `claude` IS installed (the cheap probe says so); only the sign-in differs
      probe: async () => ({ available: signedIn }),
      sync: () => true,
      onOpen: () => void outboxRef.current?.drain.wake(),
      now: () => now,
    });
    const gates = (): GateFacts => ({
      online: true,
      hubReachable: true,
      signedIn: true,
      aiConnected: fact.read(),
      aiReady: true,
      allowanceResetsAt: null,
    });
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
      gates,
      target: () => ({ projectId: null, projectName: 'p', role: 'owner' }),
    });
    outboxRef.current = outbox;
    outbox.store.load();
    const queue = createAskQueue({ outbox, gates, runs: () => runs, ready: () => fact.pending() });
    senders['ai.prompt'] = queue.sender;
    const acp = createAcp(ctx, undefined, { runs, queue: () => queue });
    acpRef = acp;
    cleanups.push(() => {
      outbox.drain.stop?.();
      acp.stopAll();
      runs.close();
    });
    return {
      runs,
      acp,
      outbox,
      signIn() {
        signedIn = true;
        now += 5000; // past the "not connected" ttl
      },
    };
  }

  test('claude installed but signed out: the prompt is queued under ai-connected, no run starts; signing in releases it once', async () => {
    const { runs, acp, outbox, signIn } = rig();
    const a = fakeWs('g10');
    acp.onOpen(a.ws);
    acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'make the hero bolder', chat: 'c1' }));
    const q = await until(() => a.frames.find((f) => f.t === 'queued'));
    expect(q.gates).toEqual(['ai-connected']);
    expect(outbox.store.list()).toHaveLength(1);
    expect(runs.view().mine).toHaveLength(0);
    expect(a.frames.find((f) => f.t === 'update' || f.t === 'error')).toBeUndefined();

    signIn(); // the connect flow finished; the next fact read notices
    await outbox.drain.wake(); // the drain's pass reads the stale fact and starts the refresh
    await until(() => (runs.view().mine.length === 1 ? true : undefined));
    await until(() => a.frames.find((f) => f.t === 'turn-end'));
    expect(runs.view().mine).toHaveLength(1);
  }, 30000);
});
