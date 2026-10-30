#!/usr/bin/env bun
// P8 c7 follow-up (decision maude/v2-p8-c7-ai-may-enforced) — a mock ACP agent for the "AI may" gate.
// Same wire shape as mock-acp-agent-write.mjs (the tool NAME rides only on the streamed `tool_call`,
// then the permission request), plus what the may tests need to see:
//   • every session/new · session/load · session/close is appended to MAUDE_TEST_MAY_LOG as one JSON line,
//     with the `_meta.claudeCode.options` the bridge spawned it with (allowedTools / disallowedTools);
//   • the tool is env-driven: MAUDE_TEST_TOOL (name), MAUDE_TEST_TOOL_INPUT (rawInput JSON),
//     MAUDE_TEST_TOOL_KIND (the adapter's kind for it).

import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

const LOG = process.env.MAUDE_TEST_MAY_LOG || '';
const TOOL = process.env.MAUDE_TEST_TOOL || 'WebFetch';
const INPUT = JSON.parse(process.env.MAUDE_TEST_TOOL_INPUT || '{"url":"https://example.test/"}');
const KIND = process.env.MAUDE_TEST_TOOL_KIND || 'fetch';
let n = 0;
let call = 0;

function log(entry) {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}
const optionsOf = (params) => params?._meta?.claudeCode?.options ?? {};

acp
  .agent({ name: 'mock-acp-agent-may' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
  }))
  .onRequest('session/new', (ctx) => {
    const sessionId = `may-session-${++n}`;
    const o = optionsOf(ctx.params);
    log({ m: 'new', sessionId, allowed: o.allowedTools, disallowed: o.disallowedTools });
    return { sessionId };
  })
  .onRequest('session/load', (ctx) => {
    const o = optionsOf(ctx.params);
    log({
      m: 'load',
      sessionId: ctx.params.sessionId,
      allowed: o.allowedTools,
      disallowed: o.disallowedTools,
    });
    return {};
  })
  .onRequest('session/close', (ctx) => {
    log({ m: 'close', sessionId: ctx.params.sessionId });
    return {};
  })
  .onRequest('session/prompt', async (ctx) => {
    const toolCallId = `tc-may-${++call}`;
    await ctx.client.notify('session/update', {
      sessionId: ctx.params.sessionId,
      update: {
        _meta: { claudeCode: { toolName: TOOL } },
        toolCallId,
        sessionUpdate: 'tool_call',
        rawInput: INPUT,
        status: 'pending',
        title: TOOL,
        kind: KIND,
        content: [],
      },
    });
    const outcome = await ctx.client.request(acp.methods.client.session.requestPermission, {
      sessionId: ctx.params.sessionId,
      toolCall: { toolCallId, rawInput: INPUT, title: TOOL, kind: KIND, content: [] },
      options: [
        { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    await ctx.client.notify('session/update', {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `outcome=${JSON.stringify(outcome.outcome)}` },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
