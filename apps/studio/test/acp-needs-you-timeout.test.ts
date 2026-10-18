// S5.6 — Needs you has NO timeout while someone is attached (S5-slices D7, V2-1.15 Q1, R13).
//
// DDR-179 / Milestone B denied every pending permission after 120 s. 03 says "Needs you never times
// out", so the deadline now only runs while NOBODY is attached: an attended request waits for its
// answer, a detached bridge still fails closed once it has been unattended for the full timeout.
// Every other abandonment path (turn cancel, stop, quit, crash, lapse) still denies — pinned by
// acp-permission.test.ts / acp-bridge-lifetime.test.ts, unchanged.
//
// Red first: before S5.6 the bridge has no `detachedFor` option, so the 150 ms timeout denies the
// attended request (test 1) and the mid-wait detach (test 3) denies at 150 ms, not 150 ms after the
// detach.

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { AcpBridge } from '../acp/bridge.ts';
import { createAcp } from '../acp/index.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-permission.mjs');
const FIXTURE_ELICIT = join(import.meta.dir, 'fixtures', 'mock-acp-agent-elicit.mjs');
const TEST_ENV_KEYS = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];

function useMockAgent(fixture = FIXTURE) {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = fixture;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
}

afterEach(() => {
  for (const key of TEST_ENV_KEYS) delete process.env[key];
});

async function until<T>(fn: () => T | undefined, timeoutMs = 12000): Promise<T> {
  const start = performance.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (performance.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const textOf = (updates: unknown[]) =>
  (updates as Array<{ content?: { text?: string } }>).map((u) => u?.content?.text ?? '').join('');

describe('AcpBridge — the permission deadline runs only while detached (D7)', () => {
  test('an ATTENDED request is not auto-denied — it waits for the person', async () => {
    useMockAgent();
    const updates: unknown[] = [];
    const requests: string[] = [];
    const bridge = new AcpBridge({
      repoRoot: process.cwd(),
      onUpdate: (u) => updates.push(u),
      onPermissionRequest: (id) => requests.push(id),
      permissionTimeoutMs: 150,
      detachedFor: () => 0, // a socket is attached the whole time
    });
    try {
      const turn = bridge.prompt('hi', 'c1');
      const id = await until(() => requests[0]);
      await sleep(700); // well past 4 × the timeout
      expect(bridge.awaitingInputCount).toBe(1);
      expect(textOf(updates)).not.toContain('outcome=');
      bridge.resolvePermission(id, 'allow-once');
      await turn;
      expect(textOf(updates)).toContain('"optionId":"allow-once"');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('a DETACHED request still fails closed at the timeout', async () => {
    useMockAgent();
    const updates: unknown[] = [];
    const bridge = new AcpBridge({
      repoRoot: process.cwd(),
      onUpdate: (u) => updates.push(u),
      permissionTimeoutMs: 150,
      detachedFor: () => Number.POSITIVE_INFINITY,
    });
    try {
      await bridge.prompt('hi', 'c1'); // nobody answers — the bridge must settle it itself
      expect(textOf(updates)).toContain('"outcome":"cancelled"');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('the countdown starts when the last socket leaves, then denies', async () => {
    useMockAgent();
    const updates: unknown[] = [];
    const requests: string[] = [];
    let detachedAt = 0;
    const bridge = new AcpBridge({
      repoRoot: process.cwd(),
      onUpdate: (u) => updates.push(u),
      onPermissionRequest: (id) => requests.push(id),
      permissionTimeoutMs: 300,
      detachedFor: () => (detachedAt ? Date.now() - detachedAt : 0),
    });
    try {
      const turn = bridge.prompt('hi', 'c1');
      await until(() => requests[0]);
      await sleep(450); // attended past the timeout: still waiting
      expect(bridge.awaitingInputCount).toBe(1);
      detachedAt = Date.now();
      await sleep(120); // detached, but not yet for the full timeout
      expect(bridge.awaitingInputCount).toBe(1);
      await turn; // denies ≈ 300 ms after the detach
      expect(Date.now() - detachedAt).toBeGreaterThanOrEqual(280);
      expect(textOf(updates)).toContain('"outcome":"cancelled"');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('without the option the old fixed deadline holds (v1 callers)', async () => {
    useMockAgent();
    const updates: unknown[] = [];
    const bridge = new AcpBridge({
      repoRoot: process.cwd(),
      onUpdate: (u) => updates.push(u),
      permissionTimeoutMs: 150,
    });
    try {
      await bridge.prompt('hi', 'c1');
      expect(textOf(updates)).toContain('"outcome":"cancelled"');
    } finally {
      await bridge.stop();
    }
  }, 15000);

  test('an attended elicitation (AskUserQuestion) waits the same way', async () => {
    useMockAgent(FIXTURE_ELICIT);
    const ids: string[] = [];
    const bridge = new AcpBridge({
      repoRoot: process.cwd(),
      onUpdate: () => {},
      onElicitationRequest: (id) => ids.push(id),
      permissionTimeoutMs: 150,
      detachedFor: () => 0,
    });
    try {
      const turn = bridge.prompt('hi', 'c1');
      await until(() => ids[0]);
      await sleep(600);
      expect(bridge.awaitingInputCount).toBe(1);
      bridge.resolveElicitation(ids[0], { action: 'decline' });
      await turn;
      expect(bridge.awaitingInputCount).toBe(0);
    } finally {
      await bridge.stop();
    }
  }, 15000);
});

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

describe('Acp manager — Needs you while the owner socket is attached (R13)', () => {
  test('an attached chat keeps its permission card open past the timeout; detaching starts the deny clock', async () => {
    useMockAgent();
    const ctx = {
      paths: { repoRoot: process.cwd(), designRoot: '/tmp/does-not-matter' },
    } as unknown as Context;
    const acp = createAcp(ctx, undefined, { permissionTimeoutMs: 200 });
    const a = fakeWs('needs-you-a');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'hi', chat: 'n1' }));
      await until(() => a.frames.find((f) => f.t === 'permission-request'));
      await sleep(700);
      expect(a.frames.find((f) => f.t === 'turn-end')).toBeUndefined();
      // the owner leaves: the bridge is detached, and the request is denied ≈ 200 ms later
      acp.onClose(a.ws);
      const b = fakeWs('needs-you-b');
      acp.onOpen(b.ws);
      await sleep(600);
      acp.onMessage(b.ws, JSON.stringify({ t: 'attach', chat: 'n1', seq: 0 }));
      const attached = await until(() => b.frames.find((f) => f.t === 'attached'));
      expect(attached.running).toBe(false); // the denied turn already ended
      const replayed = b.frames
        .filter((f) => f.t === 'update')
        .map((f) => (f.update as { content?: { text?: string } })?.content?.text ?? '')
        .join('');
      expect(replayed).toContain('"outcome":"cancelled"');
    } finally {
      acp.stopAll();
    }
  }, 20000);
});
