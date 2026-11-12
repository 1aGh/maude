#!/usr/bin/env bun
// F3 (universal ACP, plan Task B2) — a mock ACP agent that records HOW it was spawned and what the
// bridge asked of it, for test/acp-agent-spawn.test.ts. Every line goes to MAUDE_TEST_SPAWN_LOG:
//   • spawn: its argv (after the script) and its whole env;
//   • initialize / session/new / session/load / session/set_mode / session/set_config_option: params.
// Knobs (env): MAUDE_TEST_LOAD_SESSION=0 advertises no loadSession and never answers session/load;
// MAUDE_TEST_MODES = the `modes` JSON session/new answers with.

import { appendFileSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const LOG = process.env.MAUDE_TEST_SPAWN_LOG || '';
const CAN_LOAD = process.env.MAUDE_TEST_LOAD_SESSION !== '0';
const MODES = process.env.MAUDE_TEST_MODES ? JSON.parse(process.env.MAUDE_TEST_MODES) : undefined;
let n = 0;

function log(entry) {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
}

log({ m: 'spawn', argv: process.argv.slice(2), env: { ...process.env } });

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

acp
  .agent({ name: 'mock-acp-agent-spawn' })
  .onRequest('initialize', (ctx) => {
    log({ m: 'initialize', params: ctx.params });
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: CAN_LOAD },
    };
  })
  .onRequest('session/new', (ctx) => {
    log({ m: 'new', params: ctx.params });
    return { sessionId: `spawn-session-${++n}`, ...(MODES ? { modes: MODES } : {}) };
  })
  .onRequest('session/load', (ctx) => {
    log({ m: 'load', params: ctx.params });
    // An agent without the capability never answers: a bridge that asks anyway waits it out.
    if (!CAN_LOAD) return new Promise(() => {});
    return MODES ? { modes: MODES } : {};
  })
  .onRequest('session/set_mode', (ctx) => {
    log({ m: 'set_mode', params: ctx.params });
    return {};
  })
  .onRequest('session/set_config_option', (ctx) => {
    log({ m: 'set_config_option', params: ctx.params });
    return { configOptions: [] };
  })
  .onRequest('session/prompt', () => ({ stopReason: 'end_turn' }))
  .onNotification('session/cancel', () => {})
  .connect(stream);
