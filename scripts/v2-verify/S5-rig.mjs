#!/usr/bin/env bun
// S5.V verifier mock ACP agent: behaviour keyed on the prompt text. NEVER a real provider.
// Boot: MAUDE_ACP_ADAPTER_ENTRY=<this file> MAUDE_ACP_RUNTIME=$(which bun) MAUDE_CLAUDE_BIN=<script that prints {"loggedIn":true} for `auth status`>
//   NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_MACHINE_FILE=$(mktemp) bun run apps/studio/server.ts --root <scratch copy of apps/desktop/e2e/fixtures/project + a 3-artboard canvas ui/Site.tsx>
// Page: the chat is native-only. After load set window.__TAURI__ = {core:{invoke:async()=>null},event:{listen:async()=>()=>{},emit:async()=>{}},window:{}},
//   click [data-testid=panel-icon-right], then dispatch keydown {key:'/', metaKey:true} on window.
// Prompt words pick the behaviour: EDIT:<Artboard> SLOWn (edits Site.tsx + runs the real post-edit hook), ASK (elicitation), PERM (permission), FAIL, LONG, HOLDn, SLOWn.
// The absolute paths below are this session's scratch paths; edit them for a new run.
import { Readable, Writable } from 'node:stream';
import * as acp from '/Users/iagh/git/personal/maude/apps/studio/node_modules/@agentclientprotocol/sdk/dist/acp.js';
const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const MODEL = [
  { value: 'sonnet', name: 'Sonnet' },
  { value: 'opus', name: 'Opus' },
];
const cfg = () => [
  { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'sonnet', options: MODEL },
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Manual' },
      { value: 'plan', name: 'Plan Mode' },
    ],
  },
];
const note = (ctx, u) =>
  ctx.client.notify('session/update', { sessionId: ctx.params.sessionId, update: u });
const say = (ctx, text) =>
  note(ctx, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
acp
  .agent({ name: 'verifier-mock' })
  .onRequest('initialize', () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: true },
  }))
  .onRequest('session/new', () => ({
    sessionId: `vmock-${++n}`,
    modes: {
      currentModeId: 'default',
      availableModes: [
        { id: 'default', name: 'Manual' },
        { id: 'plan', name: 'Plan Mode' },
      ],
    },
    configOptions: cfg(),
  }))
  .onRequest('session/load', () => ({}))
  .onRequest('session/prompt', async (ctx) => {
    const text = (ctx.params.prompt || []).map((p) => p.text || '').join(' ');
    const sec = (re, d) => {
      const m = text.match(re);
      return m ? Number(m[1]) * 1000 : d;
    };
    if (/EDIT/.test(text)) {
      const fs = await import('node:fs');
      const P = '/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s5v/proj/.design/ui/Site.tsx';
      const art = (text.match(/EDIT:(\w+)/) || [])[1] || 'Pricing';
      const { spawnSync } = await import('node:child_process');
      const hook = (ev, extra) =>
        spawnSync('node', ['/Users/iagh/git/personal/maude/.claude/worktrees/agent-a66b2a4b954a8f150/cli/bin/maude.mjs', 'design', 'hook', ev], {
          input: JSON.stringify({ session_id: ctx.params.sessionId, cwd: '/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s5v/proj', tool_name: 'Edit', tool_use_id: `toolu_${Date.now()}`, ...extra }),
          env: { ...process.env, MAUDE_AGENT_ACTOR: 'maude-chat' },
          encoding: 'utf8',
        });
      const tuid = `toolu_${Math.random().toString(36).slice(2, 10)}`;
      let src = fs.readFileSync(P, 'utf8');
      const oldS = `<h1>${art}${/✦/.test(src.match(new RegExp(`<h1>${art}[^<]*</h1>`))?.[0] || '') ? ' ✦' : ''}</h1>`;
      const newS = `<h1>${art} ✦</h1>`;
      const input = { tool_use_id: tuid, tool_input: { file_path: P, old_string: oldS, new_string: newS } };
      // NOTE: pre-edit is denied for every scoped chat (G1: scope.canvas is repo-relative); record only the snapshot half
      const pre = process.env.VERIFY_PRE === '1' ? hook('pre-edit', { hook_event_name: 'PreToolUse', ...input }) : { stdout: '' };
      await note(ctx, { sessionUpdate: 'tool_call', toolCallId: 'e1', title: `Edit ${art}`, kind: 'edit', status: 'in_progress', locations: [{ path: P }], rawInput: { file_path: P } });
      await sleep(sec(/SLOW(\d+)/, 4000));
      if (pre.stdout && /deny/.test(pre.stdout)) { await say(ctx, `Blocked: ${pre.stdout.slice(0, 300)}`); return { stopReason: 'end_turn' }; }
      src = fs.readFileSync(P, 'utf8');
      src = src.replace(oldS, newS);
      fs.writeFileSync(P, src);
      hook('post-edit', { hook_event_name: 'PostToolUse', ...input, tool_response: { success: true } });
      await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: 'e1', status: 'completed', locations: [{ path: P }], rawInput: { file_path: P } });
      await say(ctx, `Done — ${art} is calmer: the headline carries a spark and the spacing is tighter.`);
      return { stopReason: 'end_turn' };
    }
    if (/HOLD/.test(text)) {
      await note(ctx, {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Edit Smoke.tsx',
        kind: 'edit',
        status: 'in_progress',
      });
      await sleep(sec(/HOLD(\d+)/, 600000));
      return { stopReason: 'end_turn' };
    }
    if (/PERM/.test(text)) {
      const o = await ctx.client.request(acp.methods.client.session.requestPermission, {
        sessionId: ctx.params.sessionId,
        toolCall: {
          toolCallId: 'tc1',
          title: 'Replace the Pricing artboard',
          kind: 'edit',
          rawInput: { path: 'Smoke.tsx' },
        },
        options: [
          { optionId: 'a', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'b', name: 'Allow always', kind: 'allow_always' },
          { optionId: 'c', name: 'Reject', kind: 'reject_once' },
        ],
      });
      await say(ctx, `Done. outcome=${JSON.stringify(o.outcome)}`);
      return { stopReason: 'end_turn' };
    }
    if (/ASK/.test(text)) {
      const r = await ctx.client.request(acp.methods.client.elicitation.create, {
        mode: 'form',
        sessionId: ctx.params.sessionId,
        toolCallId: 'te1',
        message: 'Which tone should the headline have?',
        requestedSchema: {
          type: 'object',
          properties: {
            question_0: {
              type: 'string',
              oneOf: [
                { const: 'Calm', title: 'Calm' },
                { const: 'Bold', title: 'Bold' },
              ],
            },
            question_0_custom: { type: 'string', title: 'Other' },
          },
        },
      });
      await say(ctx, `You said ${JSON.stringify(r)}. The canvas didn't change.`);
      return { stopReason: 'end_turn' };
    }
    if (/FAIL/.test(text)) {
      throw new Error('mock provider failure');
    }
    if (/LONG/.test(text)) {
      for (let i = 1; i <= 40; i++) {
        await say(ctx, `Paragraph ${i}. This is a long reply line to fill the chat feed so it scrolls.\n\n`);
        await sleep(30);
      }
      return { stopReason: 'end_turn' };
    }
    await note(ctx, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read Smoke.tsx',
      kind: 'read',
      status: 'in_progress',
    });
    await sleep(sec(/SLOW(\d+)/, 1500));
    await note(ctx, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    await say(ctx, 'Done — the Pricing artboard is calmer: I tightened the headline and spacing.');
    return { stopReason: 'end_turn' };
  })
  .connect(stream);
