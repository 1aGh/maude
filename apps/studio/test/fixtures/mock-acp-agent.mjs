#!/usr/bin/env bun
// Mock ACP agent for acp/bridge.test.ts. Stands in for `claude-agent-acp` so the
// bridge can be exercised without a real `claude` install. Implements the
// minimal handshake (initialize + session/new + session/prompt) and streams one
// `agent_message_chunk` whose text echoes whether ANTHROPIC_API_KEY survived
// into the child env — it MUST read `<unset>`, proving scrubAgentEnv (DDR-123
// guardrail #1) stripped it before spawn.
//
// session/load simulates the REAL adapter's cross-restart resume (this is a
// fresh subprocess per test, so it has no memory of a prior session/new call —
// exactly like the real claude-agent-acp adapter after an app restart, whose
// resume is backed by the underlying `claude` CLI's own on-disk store, not its
// own process memory). Any sessionId resolves EXCEPT the `not-found` sentinel
// (simulates a pruned/unresumable session), so a test controls resume
// success/failure by choosing which id it persists. It also emits one replay
// `session/update` BEFORE resolving, mirroring claude-agent-acp's
// `replaySessionHistory` — bridge.ts must not forward or re-transcript it.

import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

acp
  .agent({ name: 'mock-acp-agent' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest(
    'session/new',
    (() => {
      let n = 0;
      return () => ({ sessionId: `mock-session-${++n}` });
    })()
  )
  .onRequest('session/load', async (ctx) => {
    if (ctx.params.sessionId === 'not-found') {
      throw new Error('session not found');
    }
    await ctx.client.notify('session/update', {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'REPLAYED-HISTORY-SHOULD-NOT-SURFACE' },
      },
    });
    return {};
  })
  .onRequest('session/prompt', async (ctx) => {
    // The per-request handler context exposes the client connection at `.client`.
    await ctx.client.notify('session/update', {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text:
            `apiKey=${process.env.ANTHROPIC_API_KEY ?? '<unset>'} ` +
            `model=${process.env.ANTHROPIC_MODEL ?? '<unset>'} ` +
            `thinking=${process.env.MAX_THINKING_TOKENS ?? '<unset>'} ` +
            `claudeExe=${process.env.CLAUDE_CODE_EXECUTABLE ?? '<unset>'} ` +
            `actor=${process.env.MAUDE_AGENT_ACTOR ?? '<unset>'}`,
        },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
