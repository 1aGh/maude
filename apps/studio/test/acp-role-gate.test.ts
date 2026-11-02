// S5.6 — acp-role-gate: `/_ws/acp` refuses a read-only session PER FRAME
// (decision v2-S5-acp-role-gate-per-frame, closing Phase 4 security low D2).
//
// The socket checked loopback + same origin only; the read-only gate was client-side (hidden ≠
// refused, rule 12). Now every state-changing frame — prompt, set-mode, set-config,
// permission-response (and an elicitation accept) — is checked against the LIVE predicate (role +
// format gate) when it arrives, never stamped once at upgrade: the role can drop mid-socket (A6
// removal, the V2-1.12 format gate). A refused frame answers `{t:'error', code:'read-only'}` and
// never reaches the bridge. The deny direction (cancel, a 'cancelled' decision, an elicitation
// decline) stays open: stopping the agent is never a write.
//
// Red first: before S5.6 `createAcp` has no read-only predicate, so every refused frame below
// reaches the bridge.

import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { ServerWebSocket } from 'bun';

import { createAcp } from '../acp/index.ts';
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

const ctx = {
  paths: { repoRoot: process.cwd(), designRoot: '/tmp/does-not-matter', designRel: '.design' },
} as unknown as Context;

const readOnlyErrors = (frames: Array<Record<string, unknown>>) =>
  frames.filter((f) => f.t === 'error' && f.code === 'read-only');

describe('acp-role-gate — a read-only session is refused per frame', () => {
  test('a read-only prompt frame → {t:error, code:read-only}; bridge.prompt never runs', async () => {
    useMockAgent();
    const acp = createAcp(ctx, undefined, { readOnly: () => true });
    const a = fakeWs('ro-a');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'delete it all', chat: 'r1' }));
      await until(() => readOnlyErrors(a.frames)[0]);
      await sleep(300);
      expect(acp.size()).toBe(0); // no bridge, so no `claude` was spawned
      expect(a.frames.find((f) => f.t === 'permission-request')).toBeUndefined();
      expect(a.frames.find((f) => f.t === 'update')).toBeUndefined();
      const err = readOnlyErrors(a.frames)[0];
      expect(err.chat).toBe('r1');
      expect(String(err.message)).toMatch(/view only/i);
    } finally {
      acp.stopAll();
    }
  }, 15000);

  test('the role drops MID-SOCKET: the next permission-response, set-mode, set-config and prompt are refused', async () => {
    useMockAgent();
    let readOnly = false;
    const acp = createAcp(ctx, undefined, { readOnly: () => readOnly });
    const a = fakeWs('ro-flip');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'hi', chat: 'r2' }));
      const req = await until(() => a.frames.find((f) => f.t === 'permission-request'));
      expect(readOnlyErrors(a.frames)).toHaveLength(0);

      readOnly = true; // e.g. the owner removed this person (A6) — same socket, no reconnect
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'permission-response', chat: 'r2', id: req.id, decision: 'allow-once' })
      );
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'set-mode', chat: 'r2', modeId: 'bypassPermissions' })
      );
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'set-config', chat: 'r2', configId: 'model', value: 'opus' })
      );
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'again', chat: 'r2' }));
      await until(() => (readOnlyErrors(a.frames).length >= 4 ? true : undefined));
      await sleep(200);
      // the allow never landed: the request is still open, nothing streamed an outcome
      expect(a.frames.find((f) => f.t === 'turn-end')).toBeUndefined();

      // the deny direction stays open: a 'cancelled' decision is not a write
      acp.onMessage(
        a.ws,
        JSON.stringify({ t: 'permission-response', chat: 'r2', id: req.id, decision: 'cancelled' })
      );
      await until(() => a.frames.find((f) => f.t === 'turn-end'));
      const text = a.frames
        .filter((f) => f.t === 'update')
        .map((f) => (f.update as { content?: { text?: string } })?.content?.text ?? '')
        .join('');
      expect(text).toContain('"outcome":"cancelled"');
      expect(text).not.toContain('allow-once');
      expect(readOnlyErrors(a.frames)).toHaveLength(4);
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('the role comes back: the same socket may prompt again (live predicate, not a stamp)', async () => {
    useMockAgent();
    let readOnly = true;
    const acp = createAcp(ctx, undefined, { readOnly: () => readOnly });
    const a = fakeWs('ro-back');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'one', chat: 'r3' }));
      await until(() => readOnlyErrors(a.frames)[0]);
      readOnly = false;
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'two', chat: 'r3' }));
      await until(() => a.frames.find((f) => f.t === 'permission-request'));
      acp.onMessage(a.ws, JSON.stringify({ t: 'cancel', chat: 'r3' })); // cancel is never refused
      await until(() => a.frames.find((f) => f.t === 'turn-end'));
    } finally {
      acp.stopAll();
    }
  }, 20000);

  test('a predicate that throws fails CLOSED', async () => {
    useMockAgent();
    const acp = createAcp(ctx, undefined, {
      readOnly: () => {
        throw new Error('hubs.json unreadable');
      },
    });
    const a = fakeWs('ro-throw');
    try {
      acp.onOpen(a.ws);
      acp.onMessage(a.ws, JSON.stringify({ t: 'prompt', text: 'hi', chat: 'r4' }));
      await until(() => readOnlyErrors(a.frames)[0]);
      expect(acp.size()).toBe(0);
    } finally {
      acp.stopAll();
    }
  }, 15000);
});
