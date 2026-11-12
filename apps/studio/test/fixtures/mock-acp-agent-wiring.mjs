#!/usr/bin/env bun
// B3/B4 (universal ACP) — a scripted non-Claude ACP agent for test/acp-agent-wiring.test.ts.
// Everything goes to MAUDE_TEST_WIRING_LOG as one JSON line per event:
//   spawn (argv + env) · initialize · new · load · close · set_mode · prompt (the blocks it got) ·
//   perm (the options it was offered back + the outcome) · client (a client method's error/result).
// Knobs (env):
//   MAUDE_TEST_LOAD_SESSION=0     no loadSession capability
//   MAUDE_TEST_SYSTEM_PROMPT=1    advertise sessionCapabilities.systemPrompt (codex-acp)
//   MAUDE_TEST_SCRIPT             JSON array of steps run on EVERY prompt:
//     { perm: <toolCall>, options?: [...] }   session/request_permission
//     { client: '<method>', params: {...} }   any client method (fs/*, terminal/*)
//     { update: <SessionUpdate> }             a session/update notification
//   MAUDE_TEST_STOP               the stopReason (default end_turn)

import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const LOG = process.env.MAUDE_TEST_WIRING_LOG || '';
const CAN_LOAD = process.env.MAUDE_TEST_LOAD_SESSION !== '0';
const SYSTEM_PROMPT = process.env.MAUDE_TEST_SYSTEM_PROMPT === '1';
const SCRIPT = process.env.MAUDE_TEST_SCRIPT ? JSON.parse(process.env.MAUDE_TEST_SCRIPT) : [];
const STOP = process.env.MAUDE_TEST_STOP || 'end_turn';
const OPTIONS = [
  { optionId: 'approved-always', name: 'Always', kind: 'allow_always' },
  { optionId: 'approved', name: 'Yes', kind: 'allow_once' },
  { optionId: 'abort', name: 'No', kind: 'reject_once' },
];
let n = 0;

function log(entry) {
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
}

log({ m: 'spawn', argv: process.argv.slice(2), env: { ...process.env } });

// The SDK's request parsing drops fields its schema does not know (an ACP draft like
// `systemPrompt`), so the raw session/new + session/load frames are logged before parsing.
const decoder = new TextDecoder();
let pending = '';
const rawIn = Readable.toWeb(process.stdin).pipeThrough(
  new TransformStream({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      for (let i = pending.indexOf('\n'); i >= 0; i = pending.indexOf('\n')) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'session/new' || msg.method === 'session/load') {
            log({ m: 'raw', method: msg.method, params: msg.params });
          }
        } catch {
          /* not a whole JSON line */
        }
      }
      controller.enqueue(chunk);
    },
  })
);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), rawIn);

acp
  .agent({ name: 'mock-acp-agent-wiring' })
  .onRequest('initialize', (ctx) => {
    log({ m: 'initialize', params: ctx.params });
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: CAN_LOAD,
        sessionCapabilities: { close: {}, ...(SYSTEM_PROMPT ? { systemPrompt: {} } : {}) },
      },
    };
  })
  .onRequest('session/new', (ctx) => {
    const sessionId = `wiring-${process.pid}-${++n}`;
    log({ m: 'new', sessionId, params: ctx.params });
    // MAUDE_TEST_MODES=1: report a Codex-shaped mode roster (rule 10 / allowedModes).
    if (process.env.MAUDE_TEST_MODES === '1') {
      return {
        sessionId,
        modes: {
          currentModeId: 'workspace-write',
          availableModes: [
            { id: 'read-only', name: 'Read only' },
            { id: 'workspace-write', name: 'Workspace' },
            { id: 'agent', name: 'Agent' },
          ],
        },
      };
    }
    return { sessionId };
  })
  .onRequest('session/load', (ctx) => {
    log({ m: 'load', sessionId: ctx.params.sessionId, params: ctx.params });
    if (!CAN_LOAD) return new Promise(() => {});
    return {};
  })
  .onRequest('session/close', (ctx) => {
    log({ m: 'close', sessionId: ctx.params.sessionId });
    return {};
  })
  .onRequest('session/set_mode', (ctx) => {
    log({ m: 'set_mode', params: ctx.params });
    return {};
  })
  .onRequest('session/prompt', async (ctx) => {
    const sessionId = ctx.params.sessionId;
    log({ m: 'prompt', sessionId, prompt: ctx.params.prompt });
    for (const step of SCRIPT) {
      if (step.perm) {
        try {
          const res = await ctx.client.request(acp.methods.client.session.requestPermission, {
            sessionId,
            toolCall: step.perm,
            options: step.options ?? OPTIONS,
          });
          log({ m: 'perm', toolCallId: step.perm.toolCallId, outcome: res.outcome });
        } catch (err) {
          log({ m: 'perm', toolCallId: step.perm.toolCallId, error: String(err?.message ?? err) });
        }
      } else if (step.client) {
        try {
          const result = await ctx.client.request(step.client, {
            sessionId,
            ...(step.params ?? {}),
          });
          log({ m: 'client', method: step.client, result });
        } catch (err) {
          log({
            m: 'client',
            method: step.client,
            error: { code: err?.code, message: String(err?.message ?? err) },
          });
        }
      } else if (step.update) {
        await ctx.client.notify('session/update', { sessionId, update: step.update });
      }
    }
    return { stopReason: STOP };
  })
  .onNotification('session/cancel', () => {})
  .connect(stream);
