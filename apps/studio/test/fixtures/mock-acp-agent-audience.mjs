#!/usr/bin/env bun
// V2-8.9 H1 — a mock ACP agent for the audience-aware write gate. Same wire shape as
// mock-acp-agent-may.mjs: each streamed `tool_call` carries the tool NAME on `_meta.claudeCode`.
// Per prompt it streams MAUDE_TEST_READS (a JSON array of `{ tool, input, locations? }`, the reads
// the agent "did"), then one write tool call (MAUDE_TEST_WRITE `{ tool, input }`) and asks for
// permission; the outcome comes back as an agent text chunk `outcome=<json>`.

import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

const READS = JSON.parse(process.env.MAUDE_TEST_READS || '[]');
const WRITE = JSON.parse(process.env.MAUDE_TEST_WRITE || '{"tool":"Write","input":{}}');
let n = 0;
let call = 0;
// V2-8.9 round 2 — Claude Code's allow rules: a Bash call a `Bash(<prefix>:*)` rule of the session
// covers runs without ever asking the client (the bridge never sees it).
const allowed = new Map();
const remember = (id, params) =>
  allowed.set(id, params?._meta?.claudeCode?.options?.allowedTools ?? []);
const ruleAllows = (rules, command) =>
  rules.some((r) => {
    const m = /^Bash\((.*):\*\)$/.exec(r);
    return m && (command === m[1] || command.startsWith(`${m[1]} `));
  });

acp
  .agent({ name: 'mock-acp-agent-audience' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
  }))
  .onRequest('session/new', (ctx) => {
    const sessionId = `audience-session-${++n}`;
    remember(sessionId, ctx.params);
    return { sessionId };
  })
  .onRequest('session/load', (ctx) => {
    remember(ctx.params.sessionId, ctx.params);
    return {};
  })
  .onRequest('session/close', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const sessionId = ctx.params.sessionId;
    for (const r of READS) {
      await ctx.client.notify('session/update', {
        sessionId,
        update: {
          _meta: { claudeCode: { toolName: r.tool } },
          toolCallId: `tc-read-${++call}`,
          sessionUpdate: 'tool_call',
          rawInput: r.input,
          ...(r.locations ? { locations: r.locations } : {}),
          status: 'completed',
          title: r.tool,
          kind: r.tool === 'Bash' ? 'execute' : 'read',
          content: [],
        },
      });
    }
    const toolCallId = `tc-write-${++call}`;
    await ctx.client.notify('session/update', {
      sessionId,
      update: {
        _meta: { claudeCode: { toolName: WRITE.tool } },
        toolCallId,
        sessionUpdate: 'tool_call',
        rawInput: WRITE.input,
        status: 'pending',
        title: WRITE.tool,
        kind: WRITE.tool === 'Bash' ? 'execute' : 'edit',
        content: [],
      },
    });
    if (
      WRITE.tool === 'Bash' &&
      ruleAllows(allowed.get(sessionId) ?? [], String(WRITE.input?.command ?? ''))
    ) {
      await ctx.client.notify('session/update', {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'outcome={"outcome":"allowed-by-rule"}' },
        },
      });
      return { stopReason: 'end_turn' };
    }
    const outcome = await ctx.client.request(acp.methods.client.session.requestPermission, {
      sessionId,
      toolCall: {
        toolCallId,
        rawInput: WRITE.input,
        title: WRITE.tool,
        kind: WRITE.tool === 'Bash' ? 'execute' : 'edit',
        content: [],
      },
      options: [
        { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    await ctx.client.notify('session/update', {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `outcome=${JSON.stringify(outcome.outcome)}` },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
