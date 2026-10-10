// feature-acp-turn-notifications Task 2/3 — the activity snapshot the native
// shell's poller reads (notify.rs Task 5) to decide whether to fire an OS
// notification for a project that isn't the visible one. Covers:
//   • activitySnapshot() shape + monotonic seq (bumps only on real change).
//   • AcpBridge.awaitingInputCount reflects pending permission requests.
//   • The Acp manager's registered probe reports 'awaiting-input', not
//     'running', for a chat blocked on a permission prompt — the ordering
//     Task 2's gotcha calls out explicitly.
//   • /_api/acp/activity is absent from both canvas-origin allowlists
//     (Decision: NEITHER, like /_api/acp/running today).

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { AcpBridge } from '../acp/bridge.ts';
import { createAcp } from '../acp/index.ts';
import { activitySnapshot, registerActivityProbe } from '../acp/running.ts';
import type { Context } from '../context.ts';
import type { WsData } from '../ws.ts';

const FIXTURE = join(import.meta.dir, 'fixtures', 'mock-acp-agent-permission.mjs');
const TEST_ENV_KEYS = ['MAUDE_ACP_ADAPTER_ENTRY', 'MAUDE_ACP_RUNTIME', 'MAUDE_CLAUDE_BIN'];

function useMockAgent() {
  process.env.MAUDE_ACP_ADAPTER_ENTRY = FIXTURE;
  process.env.MAUDE_ACP_RUNTIME = process.execPath;
  process.env.MAUDE_CLAUDE_BIN = process.execPath;
}

afterEach(() => {
  for (const key of TEST_ENV_KEYS) delete process.env[key];
  // Restore a no-op probe so a later file's `registerRunningChatsProbe`-style
  // module-level state doesn't leak a stale closure across test files.
  registerActivityProbe(() => []);
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

describe('activitySnapshot (running.ts)', () => {
  test('reflects the registered probe and never throws on a bad one', () => {
    registerActivityProbe(() => [{ chatId: 'a', state: 'running' }]);
    expect(activitySnapshot().chats).toEqual([{ chatId: 'a', state: 'running' }]);

    registerActivityProbe(() => {
      throw new Error('boom');
    });
    expect(activitySnapshot().chats).toEqual([]);
  });

  test('seq bumps only when the (chatId, state) set actually changes', () => {
    registerActivityProbe(() => [{ chatId: 'a', state: 'idle' }]);
    const first = activitySnapshot().seq;
    const second = activitySnapshot().seq; // same state — no bump
    expect(second).toBe(first);

    registerActivityProbe(() => [{ chatId: 'a', state: 'running' }]);
    const third = activitySnapshot().seq; // real transition — bumps
    expect(third).toBe(first + 1);

    // Enumeration-order shuffle with the SAME states must NOT bump.
    registerActivityProbe(() => [
      { chatId: 'b', state: 'idle' },
      { chatId: 'a', state: 'running' },
    ]);
    activitySnapshot();
    registerActivityProbe(() => [
      { chatId: 'a', state: 'running' },
      { chatId: 'b', state: 'idle' },
    ]);
    const fourth = activitySnapshot().seq;
    const fifth = activitySnapshot().seq;
    expect(fifth).toBe(fourth);
  });
});

describe('AcpBridge.awaitingInputCount + the manager probe (Task 2 gotcha: awaiting-input wins over running)', () => {
  test('a pending permission request reports awaiting-input, not running', async () => {
    useMockAgent();
    const ctx = {
      paths: { repoRoot: process.cwd(), designRoot: '/tmp/does-not-matter-activity' },
    } as unknown as Context;
    const acp = createAcp(ctx);

    const a = fakeWs('activity-ws-a');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'hi', chat: 'activity-chat' }));
      const reqFrame = await until(() => a.frames.find((f) => f.t === 'permission-request'));

      const snap = activitySnapshot();
      expect(snap.chats).toContainEqual({ chatId: 'activity-chat', state: 'awaiting-input' });

      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'permission-response', id: reqFrame.id, decision: 'allow-once' })
      );
      await until(() => a.frames.find((f) => f.t === 'turn-end'));

      // Turn settled — no longer awaiting-input (running or idle, never stuck).
      const after = activitySnapshot().chats.find((c) => c.chatId === 'activity-chat');
      expect(after?.state).not.toBe('awaiting-input');
    } finally {
      acp.onClose(a.ws);
      acp.stopAll();
      await new Promise((r) => setTimeout(r, 50));
    }
  }, 20000);
});

describe('AcpBridge.awaitingInputCount — direct unit', () => {
  test('starts at 0 and counts a pending permission before resolution', async () => {
    useMockAgent();
    const bridge = new AcpBridge({ repoRoot: process.cwd(), onUpdate: () => {} });
    expect(bridge.awaitingInputCount).toBe(0);
    try {
      const promptPromise = bridge.prompt('hi', 'c1');
      await until(() => (bridge.awaitingInputCount > 0 ? true : undefined));
      expect(bridge.awaitingInputCount).toBe(1);
      await bridge.cancel(); // denies the pending request rather than hanging
      await promptPromise;
      expect(bridge.awaitingInputCount).toBe(0);
    } finally {
      await bridge.stop();
    }
  }, 15000);
});

describe('/_api/acp/activity — NEITHER canvas-origin allowlist (Decision D + dual-allowlist rule)', () => {
  const httpSrc = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
  const serverSrc = readFileSync(join(import.meta.dir, '..', 'server.ts'), 'utf8');

  test('the route exists on the main-origin route table', () => {
    expect(httpSrc).toContain("'/_api/acp/activity'");
  });

  test('is absent from CANVAS_SAFE_API', () => {
    const start = httpSrc.indexOf('CANVAS_SAFE_API: ReadonlySet<string> = new Set([');
    const end = httpSrc.indexOf(']);', start);
    expect(start).toBeGreaterThan(-1);
    const block = httpSrc.slice(start, end);
    expect(block).not.toContain('/_api/acp/activity');
  });

  test("is absent from startCanvasServer's routes map", () => {
    // V2-2.5 — the map lives in routes/canvas-origin.ts; server.ts only calls it.
    const start = serverSrc.indexOf('function startCanvasServer');
    const routesEnd = serverSrc.indexOf('async fetch(req, srv)', start);
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, routesEnd);
    expect(block).toContain('canvasOriginRoutes(http)');
    const mapSrc = readFileSync(join(import.meta.dir, '..', 'routes', 'canvas-origin.ts'), 'utf8');
    expect(mapSrc).toContain('export function canvasOriginRoutes');
    expect(mapSrc).not.toContain('/_api/acp/activity');
  });

  test('the payload never carries a chat title, message text, or transcript field name', () => {
    // Grep the route handler body itself (not the whole file) for the fields
    // Decision D forbids — a title/text field appearing HERE would mean
    // someone widened the payload without reading the comment.
    const start = httpSrc.indexOf("'/_api/acp/activity':");
    const end = httpSrc.indexOf('},', start);
    const block = httpSrc.slice(start, end);
    expect(block).not.toMatch(/title|message|transcript|content/i);
  });
});
