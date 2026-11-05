#!/usr/bin/env bun
// Mock ACP agent for issue #177 (test/acp-background-tasks.test.ts, and the hands-on chat check).
// Plays what claude-agent-acp 0.57.0 + Claude Code 2.1.x do when the AI starts background work:
//
//   · the Agent tool call (a subagent) and a Bash call with run_in_background each come as an ACP
//     tool_call that completes at once (the "launched in the background" result);
//   · the live set of background tasks never comes over ACP — the adapter has no case for the SDK's
//     `background_tasks_changed` and logs it to stderr as `Unexpected case: <json>` (with a
//     `command_lifecycle` line beside it, the host prompt's own queue lifecycle);
//   · the prompt settles (end_turn) while that work keeps running; the set shrinks as tasks end.
//
// MOCK_BG_STEP_MS (default 300) spaces the snapshots, so a hands-on run can stretch it to watch.

import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const STEP = Number(process.env.MOCK_BG_STEP_MS || 300);
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));

function unexpected(msg) {
  process.stderr.write(`Unexpected case: ${JSON.stringify(msg)}\n`);
}
function snapshot(sessionId, tasks) {
  unexpected({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks,
    uuid: crypto.randomUUID(),
    session_id: sessionId,
  });
}
const AGENT = {
  task_id: 'a1b2c3',
  task_type: 'local_agent',
  subagent_type: 'general-purpose',
  description: 'Review the Pricing canvas',
};
const SHELL = { task_id: 'bxk9q1', task_type: 'local_bash', description: 'Export the reel to mp4' };
const AMBIENT = { task_id: 'w1', task_type: 'monitor', description: 'watcher', ambient: true };

acp
  .agent({ name: 'mock-acp-agent-background' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => ({ sessionId: 'mock-bg-session' }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const sessionId = ctx.params.sessionId;
    const update = (u) => ctx.client.notify('session/update', { sessionId, update: u });
    unexpected({
      type: 'command_lifecycle',
      command_uuid: 'c-1',
      state: 'started',
      session_id: sessionId,
    });
    await update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-agent',
      title: 'Review the Pricing canvas',
      kind: 'think',
      status: 'pending',
      rawInput: { description: 'Review the Pricing canvas', run_in_background: true },
      _meta: { claudeCode: { toolName: 'Agent' } },
    });
    await update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-agent',
      status: 'completed',
    });
    await update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-bash',
      title: 'Export the reel to mp4',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'maude design export', run_in_background: true },
      _meta: { claudeCode: { toolName: 'Bash' } },
    });
    await update({ sessionUpdate: 'tool_call_update', toolCallId: 'tc-bash', status: 'completed' });
    snapshot(sessionId, [AGENT, SHELL, AMBIENT]);
    await update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Two helpers are working in the background.' },
    });
    // The turn settles here; the background work carries on.
    setTimeout(() => snapshot(sessionId, [SHELL, AMBIENT]), STEP);
    setTimeout(() => {
      snapshot(sessionId, [AMBIENT]);
      unexpected({
        type: 'command_lifecycle',
        command_uuid: 'c-1',
        state: 'completed',
        session_id: sessionId,
      });
    }, STEP * 2);
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
